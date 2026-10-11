import { beforeEach, describe, expect, it } from "vitest";
import { formatTranscript, mixToMono, stamp } from "@/lib/transcript";
import { openDb, setDb } from "@/lib/db";
import { createCourse, insertMaterial } from "@/lib/store";
import { PATCH } from "@/app/api/materials/[id]/route";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

describe("transcript formatting", () => {
  it("stamps paragraphs, breaks at sentence ends and drops noise and loops", () => {
    const text = formatTranscript([
      { start: 0, end: 4, text: " Today we cover entropy." },
      { start: 4, end: 8, text: "[BLANK_AUDIO]" },
      { start: 30, end: 40, text: " It measures uncertainty" },
      { start: 65, end: 70, text: " in bits." },
      { start: 70, end: 75, text: " Next, cross-entropy." },
      { start: 75, end: 80, text: " Next, cross-entropy." },
      { start: 3700, end: 3705, text: " Last point." },
    ]);
    expect(text).toBe("[00:00] Today we cover entropy. It measures uncertainty in bits.\n\n[01:10] Next, cross-entropy.\n\n[1:01:40] Last point.");
  });

  it("formats times and mixes channels", () => {
    expect(stamp(59.9)).toBe("00:59");
    expect(stamp(3600)).toBe("1:00:00");
    expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
  });
});

describe("saving a transcript", () => {
  beforeEach(() => setDb(openDb(":memory:")));

  it("marks the recording ready and searchable, keeping the raw text offline", async () => {
    const c = createCourse({ name: "Info theory" });
    const m = insertMaterial({
      course_id: c.id, kind: "audio_memo", title: "Lecture 3", source_type: "file", filename: "l3.m4a", mime: "audio/mp4", path: null, url: null,
      text: "", status: "partial", note: "Recording saved.",
    });
    const req = new Request("http://x/api/materials/" + m.id, {
      method: "PATCH",
      body: JSON.stringify({ text: "[00:00] Entropy measures uncertainty.", transcript: true, tidy: true, kind: "bogus" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: m.id }) });
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out).toMatchObject({ status: "ready", kind: "audio_memo", text: "[00:00] Entropy measures uncertainty." });
    expect(out.note).toMatch(/Transcribed on this device/);
    const { search } = await import("@/lib/kb");
    expect(search("entropy").length).toBeGreaterThan(0);
  });
});

describe("podcast audio", () => {
  beforeEach(() => setDb(openDb(":memory:")));

  it("stores an MP3 with segment marks, serves byte ranges, and rejects non-MP3 uploads", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    process.env.ZILEARN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zl-"));
    const { savePodcast } = await import("@/lib/store");
    const route = await import("@/app/api/podcasts/[id]/audio/route");
    const c = createCourse({ name: "Audio" });
    const p = savePodcast({ course_id: c.id, title: "Ep 1", scope: "All", hosts: { A: "Alex", B: "Sam" }, segments: [{ speaker: "A", text: "Hi" }, { speaker: "B", text: "Hello" }], generated_by: "heuristic" });
    const ctx = { params: Promise.resolve({ id: p.id }) };
    const put = (bytes: number[], marks: unknown) => {
      const fd = new FormData();
      fd.append("audio", new File([new Uint8Array(bytes)], "x.mp3"));
      fd.append("marks", JSON.stringify(marks));
      return route.PUT(new Request("http://x", { method: "PUT", body: fd }), ctx);
    };
    expect((await put([0x3c, 0x68, 0x74], [0, 1])).status).toBe(400);
    const mp3 = [0x49, 0x44, 0x33, ...Array.from({ length: 97 }, (_, i) => i)];
    const saved = await (await put(mp3, [0, 1.5])).json();
    expect(saved.audio).toMatch(/podcasts/);
    expect(saved.audio_marks).toEqual([0, 1.5]);
    const full = await route.GET(new Request("http://x"), ctx);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect((await full.arrayBuffer()).byteLength).toBe(100);
    const part = await route.GET(new Request("http://x", { headers: { range: "bytes=10-19" } }), ctx);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(new Uint8Array(await part.arrayBuffer())[0]).toBe(7);
  });
});

describe("segmentAt", () => {
  it("finds the segment playing at a time", async () => {
    const { segmentAt } = await import("@/components/podcastAudio");
    expect([0, 0.5, 2, 2.1, 9].map((t) => segmentAt([0, 2, 5], t))).toEqual([0, 0, 1, 1, 2]);
  });
});
