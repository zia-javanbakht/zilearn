import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { createCourse, getMaterial, listMaterials } from "@/lib/store";
import { importFile, sizeLimit, MAX_MEDIA, MAX_FILE, type ImportResult } from "@/lib/importer";
import { linkFromShortcut, mediaStem } from "@/lib/filetypes";
import { parseCaptions, formatTranscript } from "@/lib/transcript";
import { parseTimedText, pickTrack, youtubeId } from "@/lib/youtube";
import { guessKind } from "@/lib/extract";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const SRT = `1
00:00:01,000 --> 00:00:03,000
Welcome to <i>lecture five</i>.

2
00:01:05,500 --> 00:01:08,000
Today: gradient descent &amp; momentum.
`;

const VTT = `WEBVTT
Kind: captions

00:00:00.000 --> 00:00:02.000
so today we<00:00:01.000><c> start</c>

00:00:02.000 --> 00:00:04.000
so today we start
with backpropagation

00:00:04.000 --> 00:00:06.000
with backpropagation
and the chain rule
`;

describe("captions and links", () => {
  it("reads .srt and rolling .vtt captions into timestamped text", () => {
    expect(formatTranscript(parseCaptions(SRT))).toBe("[00:01] Welcome to lecture five.\n\n[01:05] Today: gradient descent & momentum.");
    expect(parseCaptions(VTT).map((c) => c.text)).toEqual(["so today we start", "with backpropagation", "and the chain rule"]);
  });

  it("finds the web address in saved shortcuts", () => {
    expect(linkFromShortcut("[InternetShortcut]\r\nURL=https://www.youtube.com/watch?v=abc123XYZ_-\r\n")).toBe("https://www.youtube.com/watch?v=abc123XYZ_-");
    expect(linkFromShortcut('<plist><dict><key>URL</key><string>https://youtu.be/abc?t=1&amp;x=2</string></dict></plist>')).toBe("https://youtu.be/abc?t=1&x=2");
    expect(linkFromShortcut("[Desktop Entry]\nType=Link\nURL=https://example.com/a")).toBe("https://example.com/a");
    expect(linkFromShortcut("nothing here")).toBeNull();
  });

  it("pairs a video with its captions by folder and name", () => {
    expect(mediaStem("ML/Week 1/Lecture 2.mp4")).toBe("ml/week 1/lecture 2");
    expect(mediaStem("ML/Week 1/Lecture 2.en.srt")).toBe("ml/week 1/lecture 2");
    expect(mediaStem("ML/Week 1/Lecture 2.en-GB.vtt")).toBe("ml/week 1/lecture 2");
    expect(guessKind("Lecture 2.mp4")).toBe("video");
    expect(guessKind("memo.m4a")).toBe("audio_memo");
    expect(sizeLimit("Lecture 2.mp4")).toBe(MAX_MEDIA);
    expect(sizeLimit("notes.pdf")).toBe(MAX_FILE);
  });

  it("reads YouTube timed text in both formats and prefers human English captions", () => {
    expect(parseTimedText('<transcript><text start="0.5" dur="2">it&amp;#39;s a <b>test</b></text><text start="61" dur="1">next</text></transcript>')).toEqual([
      { start: 0.5, end: null, text: "it's a test" },
      { start: 61, end: null, text: "next" },
    ]);
    expect(parseTimedText('<timedtext><body><p t="1500" d="900"><s>hello</s><s> world</s></p></body></timedtext>')).toEqual([{ start: 1.5, end: null, text: "hello world" }]);
    const tracks = [
      { baseUrl: "a", languageCode: "en", kind: "asr" },
      { baseUrl: "b", languageCode: "de" },
      { baseUrl: "c", languageCode: "en-GB" },
    ];
    expect(pickTrack(tracks)?.baseUrl).toBe("c");
    expect(pickTrack(tracks.slice(0, 2))?.baseUrl).toBe("a");
    expect(youtubeId("https://www.youtube.com/live/abcDEF12345?si=x")).toBe("abcDEF12345");
  });
});

describe("importing recordings", () => {
  beforeEach(() => {
    setDb(openDb(":memory:"));
    process.env.ZILEARN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zl-media-"));
  });
  afterEach(() => vi.unstubAllGlobals());

  const fakeMp4 = (seed: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42" + seed)]);

  it("uses a captions file as its video's transcript, whichever arrives first", async () => {
    const c = createCourse({ name: "ML" });
    const r: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "Lecture 5.mp4", mime: "video/mp4", buf: fakeMp4("a"), relPath: "ML/Week 5/Lecture 5.mp4" }, r);
    expect(r.materials[0]).toMatchObject({ kind: "video", status: "partial" });
    await importFile(c.id, { name: "Lecture 5.en.srt", mime: "", buf: Buffer.from(SRT), relPath: "ML/Week 5/Lecture 5.en.srt" }, r);
    expect(r.materials).toHaveLength(1);
    expect(r.materials[0]).toMatchObject({ kind: "video", status: "ready" });
    expect(getMaterial(r.materials[0].id)?.text).toContain("[01:05] Today: gradient descent");

    // Captions first (e.g. "talk.vtt" sorts before "talk.webm"): the video takes them over.
    const r2: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "talk.vtt", mime: "", buf: Buffer.from(VTT), relPath: "ML/Extra/talk.vtt" }, r2);
    await importFile(c.id, { name: "talk.webm", mime: "video/webm", buf: fakeMp4("b"), relPath: "ML/Extra/talk.webm" }, r2);
    expect(r2.materials.map((m) => [m.filename, m.status])).toEqual([["talk.webm", "ready"]]);
    expect(listMaterials(c.id).map((m) => m.filename)).toEqual(["Lecture 5.mp4", "talk.webm"]);

    // Importing the folder again adds nothing.
    const again: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "Lecture 5.en.srt", mime: "", buf: Buffer.from(SRT), relPath: "ML/Week 5/Lecture 5.en.srt" }, again);
    await importFile(c.id, { name: "Lecture 5.mp4", mime: "video/mp4", buf: fakeMp4("a"), relPath: "ML/Week 5/Lecture 5.mp4" }, again);
    expect(again.materials).toHaveLength(0);
    expect(again.skipped.map((s) => s.reason)).toEqual(['"Lecture 5" already has a transcript', 'already added as "Lecture 5"']);
  });

  it("imports saved YouTube links with the video's captions, once", async () => {
    const c = createCourse({ name: "ML" });
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.includes("/oembed")) return Response.json({ title: "Backprop, intuitively", author_name: "3B1B" });
      if (url.includes("/watch")) return new Response('<script>ytcfg.set({"INNERTUBE_API_KEY": "KEY"})</script>');
      if (url.includes("/youtubei/v1/player"))
        return Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?v=x&fmt=srv3", languageCode: "en" }] } } });
      if (url.includes("/timedtext")) return new Response('<transcript><text start="0" dur="2">What is backpropagation?</text></transcript>');
      return new Response("", { status: 404 });
    });
    const shortcut = Buffer.from("[InternetShortcut]\nURL=https://www.youtube.com/watch?v=Ilg3gGewQ5U\n");
    const r: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "Backprop - YouTube.url", mime: "", buf: shortcut, relPath: "ML/Videos/Backprop - YouTube.url" }, r);
    expect(r.materials[0]).toMatchObject({ kind: "youtube", title: "Backprop, intuitively", status: "ready", url: "https://www.youtube.com/watch?v=Ilg3gGewQ5U" });
    expect(r.materials[0].note).toContain("captions");
    expect(getMaterial(r.materials[0].id)?.text).toBe("[00:00] What is backpropagation?");
    expect(calls).toContain("POST https://www.youtube.com/youtubei/v1/player");

    const again: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "Backprop - YouTube.url", mime: "", buf: shortcut, relPath: "ML/Videos/Backprop - YouTube.url" }, again);
    expect(again.materials).toHaveLength(0);
  });

  it("still adds a video link when YouTube can't be reached", async () => {
    const c = createCourse({ name: "ML" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const r: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "v.webloc", mime: "", buf: Buffer.from("<string>https://youtu.be/Ilg3gGewQ5U</string>"), relPath: "ML/v.webloc" }, r);
    expect(r.materials[0]).toMatchObject({ kind: "youtube", status: "partial", title: "v" });
    expect(r.materials[0].note).toContain("Try again");
    expect(listMaterials(c.id)[0].rel_path).toBe("ML/v.webloc");
  });
});
