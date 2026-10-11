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
