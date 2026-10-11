import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { getPodcast, setPodcastAudio } from "@/lib/store";
import { fail, fileResponse, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

function fileName(title: string) {
  return `${title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "podcast"}.mp3`;
}

/** The recorded MP3. `?download=1` saves it instead of playing it. */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const p = getPodcast((await params).id);
  if (!p?.audio) return fail("This episode has no recording yet.", 404);
  const buf = await fs.readFile(path.join(dataDir(), p.audio)).catch(() => null);
  if (!buf) return fail("The recording is missing on disk. Record it again.", 404);
  const download = new URL(req.url).searchParams.has("download");
  return fileResponse(req, buf, { mime: "audio/mpeg", filename: fileName(p.title), inline: !download });
});

/** Store an MP3 recorded in the browser (multipart: `audio` file plus `marks` JSON array of segment start times). */
export const PUT = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const p = getPodcast((await params).id);
  if (!p) return fail("Not found", 404);
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof File) || !file.size) return fail("No audio received.");
  if (file.size > MAX_BYTES) return fail("The recording is too large.");
  const buf = Buffer.from(await file.arrayBuffer());
  // MPEG audio starts with an ID3 tag or a frame sync; refuse anything else.
  if (!(buf.subarray(0, 3).toString("latin1") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return fail("That isn't an MP3 file.");
  let marks: number[] | null = null;
  try {
    const m = JSON.parse(String(form.get("marks") ?? "null"));
    if (Array.isArray(m) && m.length === p.segments.length && m.every((x) => typeof x === "number" && Number.isFinite(x))) marks = m;
  } catch {}
  // A new name per recording, so players don't keep a cached earlier take.
  const rel = path.join("uploads", p.course_id, "podcasts", `${p.id}-${Date.now()}.mp3`);
  await fs.mkdir(path.dirname(path.join(dataDir(), rel)), { recursive: true });
  await fs.writeFile(path.join(dataDir(), rel), buf);
  setPodcastAudio(p.id, rel, marks);
  if (p.audio && p.audio !== rel) await fs.rm(path.join(dataDir(), p.audio), { force: true });
  return ok(getPodcast(p.id));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const p = getPodcast((await params).id);
  if (!p) return fail("Not found", 404);
  if (p.audio) await fs.rm(path.join(dataDir(), p.audio), { force: true });
  setPodcastAudio(p.id, null, null);
  return ok(getPodcast(p.id));
});
