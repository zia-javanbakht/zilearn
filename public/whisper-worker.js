// Speech-to-text that runs entirely in the browser (Whisper via transformers.js).
// Plain JS module worker served as a static file, so the large runtime is never bundled into the app.
// Messages in:  { type: "run", id, model, audio: Float32Array (16 kHz mono), language? }
// Messages out: { type: "status", id, phase: "loading" | "transcribing", progress?, done?, total? }
//               { type: "result", id, chunks: [{ start, end, text }] } | { type: "error", id, message }

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
const RATE = 16000;
const SEGMENT_S = 600; // transcribe ten minutes at a time so progress can be reported

let lib = null;
const pipelines = new Map();

async function getPipeline(model, id) {
  if (!lib) lib = await import(LIB);
  if (!pipelines.has(model)) {
    const device = self.navigator && "gpu" in self.navigator ? "webgpu" : "wasm";
    const load = (dev) =>
      lib.pipeline("automatic-speech-recognition", model, {
        device: dev,
        progress_callback: (p) => {
          if (p.status === "progress_total") self.postMessage({ type: "status", id, phase: "loading", progress: p.progress });
        },
      });
    // WebGPU can be listed but unusable (old drivers); fall back to WebAssembly.
    pipelines.set(model, load(device).catch((e) => (device === "wasm" ? Promise.reject(e) : load("wasm"))));
  }
  try {
    return await pipelines.get(model);
  } catch (e) {
    pipelines.delete(model);
    throw e;
  }
}

self.onmessage = async (e) => {
  const { type, id, model, audio, language } = e.data;
  if (type !== "run") return;
  try {
    self.postMessage({ type: "status", id, phase: "loading", progress: 0 });
    const asr = await getPipeline(model, id);
    const per = SEGMENT_S * RATE;
    const total = Math.max(1, Math.ceil(audio.length / per));
    const chunks = [];
    for (let i = 0; i < total; i++) {
      self.postMessage({ type: "status", id, phase: "transcribing", done: i, total });
      const part = audio.subarray(i * per, Math.min(audio.length, (i + 1) * per));
      if (part.length < RATE / 2) continue;
      const out = await asr(part, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        ...(language ? { language, task: "transcribe" } : {}),
      });
      const offset = i * SEGMENT_S;
      for (const c of out.chunks ?? [{ timestamp: [0, part.length / RATE], text: out.text }]) {
        const [s, en] = c.timestamp ?? [0, null];
        chunks.push({ start: offset + (s ?? 0), end: en == null ? null : offset + en, text: c.text });
      }
    }
    self.postMessage({ type: "status", id, phase: "transcribing", done: total, total });
    self.postMessage({ type: "result", id, chunks });
  } catch (err) {
    self.postMessage({ type: "error", id, message: err && err.message ? err.message : String(err) });
  }
};
