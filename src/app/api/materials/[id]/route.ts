import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { deleteMaterial, getMaterial, updateMaterial } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";
import { tidyTranscript } from "@/lib/extract";
import { providerName } from "@/lib/ai";
import { MATERIAL_KINDS } from "@/lib/types";
import { fetchYoutube, youtubeId, youtubeNote } from "@/lib/youtube";
import { stripTimestamps } from "@/lib/transcript";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const m = getMaterial((await params).id);
  return m ? ok(m) : fail("Not found", 404);
});

export const maxDuration = 300;

/**
 * Edit a material. `transcript: true` marks the text as a speech-to-text transcript made in the browser;
 * `refresh: true` fetches a YouTube video's transcript again (captions are often added after upload);
 * `clean: true` removes the [mm:ss] timestamps (from the text sent, or else from the saved text).
 */
export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const id = (await params).id;
  const b = await body<{ title?: string; kind?: string; text?: string; transcript?: boolean; tidy?: boolean; refresh?: boolean; clean?: boolean }>(req);
  const current = getMaterial(id);
  if (!current) return fail("Not found", 404);
  if (b.refresh) {
    if (!current.url || !youtubeId(current.url)) return fail("Only YouTube videos can be fetched again.");
    const yt = await fetchYoutube(current.url);
    if (!yt.transcript) return fail("This video still has no transcript YouTube will share. Paste a summary or your notes instead.");
    return ok(updateMaterial(id, { text: yt.transcript, note: youtubeNote(yt, providerName()) }));
  }
  const patch: { title?: string; kind?: string; text?: string; note?: string | null } = {
    title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 300) : undefined,
    kind: (MATERIAL_KINDS as readonly string[]).includes(b.kind ?? "") ? b.kind : undefined,
    text: typeof b.text === "string" ? b.text : undefined,
  };
  if (b.transcript && patch.text) {
    let tidied: string | null = null;
    let tidyFailed = false;
    if (b.tidy) {
      try {
        tidied = await tidyTranscript(current.title, current.kind, patch.text);
      } catch (err) {
        console.error(err);
        tidyFailed = true;
      }
    }
    patch.text = tidied ?? patch.text;
    patch.note = tidied
      ? `Transcribed on this device and organised into notes by ${providerName()}.`
      : tidyFailed
        ? `Transcribed on this device. ${providerName()} couldn't tidy it this time, so this is the raw transcript.`
        : "Transcribed on this device. [mm:ss] marks where each part is in the recording.";
  } else if (patch.text?.trim() && current.status !== "ready") {
    patch.note = null;
  }
  if (b.clean) {
    const source = patch.text ?? current.text ?? "";
    patch.text = stripTimestamps(source);
    // Drop the sentence telling the student what the (now removed) markers mean.
    const note = patch.note !== undefined ? patch.note : current.note;
    patch.note = note?.replace(/\s*\[mm:ss\][^.]*\./, "").trim() || null;
  }
  const m = updateMaterial(id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  return m ? ok(m) : fail("Not found", 404);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const m = getMaterial(id);
  if (m?.path) await fs.rm(path.join(dataDir(), m.path), { force: true });
  deleteMaterial(id);
  return ok({ ok: true });
});
