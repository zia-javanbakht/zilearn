// Records a podcast script as an MP3, entirely in the browser.
// Voices: Kokoro (open-weight neural text-to-speech) via kokoro-js; encoding: LAME via lamejs.
// Plain JS module worker served as a static file, so the large runtimes are never bundled into the app.
// In:  { type: "run", id, segments: [{ speaker: "A" | "B", text }], voices: { A, B }, speed }
// Out: { type: "status", id, phase: "loading", progress } | { type: "status", id, phase: "speaking", done, total }
//      { type: "status", id, phase: "encoding" } | { type: "result", id, mp3: ArrayBuffer, marks: number[] }
//      { type: "error", id, message }

const KOKORO = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const LAME = "https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/dist/lamejs.js";
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const RATE = 24000;
const TURN_GAP = 0.35; // seconds of silence between speakers
const SENTENCE_GAP = 0.08;

let ttsPromise = null;

function loadTts(id) {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import(KOKORO);
      const progress_callback = (p) => {
        if (p.status === "progress_total") self.postMessage({ type: "status", id, phase: "loading", progress: p.progress });
      };
      if (self.navigator && "gpu" in self.navigator) {
        try {
          return await KokoroTTS.from_pretrained(MODEL, { dtype: "fp32", device: "webgpu", progress_callback });
        } catch {
          // fall through to WebAssembly
        }
      }
      return KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback });
    })();
    ttsPromise.catch(() => (ttsPromise = null));
  }
  return ttsPromise;
}

/** Split a turn into pieces short enough for the model (it reads at most ~500 phonemes at a time). */
function pieces(text, max = 280) {
  const out = [];
  for (const sentence of text.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/)) {
    if (!sentence) continue;
    if (sentence.length <= max) {
      const last = out[out.length - 1];
      if (last && last.length + sentence.length + 1 <= max) out[out.length - 1] = `${last} ${sentence}`;
      else out.push(sentence);
      continue;
    }
    let cur = "";
    for (const part of sentence.split(/(?<=[,;:])\s+|\s+/)) {
      if (cur && cur.length + part.length + 1 > max) {
        out.push(cur);
        cur = part;
      } else cur = cur ? `${cur} ${part}` : part;
    }
    if (cur) out.push(cur);
  }
  return out;
}

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = async (e) => {
  const { type, id, segments, voices, speed = 1 } = e.data;
  if (type !== "run") return;
  try {
    self.postMessage({ type: "status", id, phase: "loading", progress: 0 });
    const [tts, lame] = await Promise.all([loadTts(id), import(LAME)]);
    const encoder = new lame.Mp3Encoder(1, RATE, 64);
    const parts = [];
    const marks = [];
    let samples = 0;
    const push = (f32) => {
      const pcm = toInt16(f32);
      for (let i = 0; i < pcm.length; i += 1152 * 20) {
        const buf = encoder.encodeBuffer(pcm.subarray(i, i + 1152 * 20));
        if (buf.length) parts.push(new Uint8Array(buf));
      }
      samples += f32.length;
    };
    const silence = (sec) => push(new Float32Array(Math.round(sec * RATE)));
    for (let i = 0; i < segments.length; i++) {
      self.postMessage({ type: "status", id, phase: "speaking", done: i, total: segments.length });
      if (i > 0) silence(TURN_GAP);
      marks.push(samples / RATE);
      const voice = voices[segments[i].speaker] ?? voices.A;
      const chunks = pieces(segments[i].text);
      for (let k = 0; k < chunks.length; k++) {
        if (k > 0) silence(SENTENCE_GAP);
        const audio = await tts.generate(chunks[k], { voice, speed });
        push(audio.audio);
      }
    }
    self.postMessage({ type: "status", id, phase: "encoding" });
    const end = encoder.flush();
    if (end.length) parts.push(new Uint8Array(end));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const mp3 = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      mp3.set(p, o);
      o += p.length;
    }
    self.postMessage({ type: "result", id, mp3: mp3.buffer, marks: marks.map((m) => Math.round(m * 100) / 100) }, [mp3.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", id, message: err && err.message ? err.message : String(err) });
  }
};
