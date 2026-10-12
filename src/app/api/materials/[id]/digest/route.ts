import { aiEnabled } from "@/lib/ai";
import { applyCorrections, digestWithFixes } from "@/lib/digest";
import { getMaterial, setDigest, updateMaterial } from "@/lib/store";
import type { Digest, DigestTopic } from "@/lib/types";
import { repairNote, repairText } from "@/lib/textRepair";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** (Re)make a material's summary, key terms and topics; with the AI unless `{ ai: false }` or offline. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  let m = getMaterial(id);
  if (!m) return fail("Not found", 404);
  if (!m.text?.trim()) return fail("This item has no text to summarise yet.");
  // Text imported before the repairs existed (or pasted in) gets them now.
  const { text, report } = repairText(m.text, { ocr: m.scan?.text_by === "ocr" });
  if (text !== m.text) {
    const note = repairNote(report);
    m = updateMaterial(id, { text, note: note ? [m.note, note].filter(Boolean).join(" ") : m.note }) ?? m;
  }
  const b = await body<{ ai?: boolean }>(req);
  const r = await digestWithFixes(m, b.ai !== false && aiEnabled());
  if (r?.corrections.length && m.text) {
    const fixed = applyCorrections(m.text, r.corrections);
    if (fixed.applied.length) m = updateMaterial(id, { text: fixed.text, note: [m.note, `Corrected ${fixed.applied.length} misspelt word${fixed.applied.length === 1 ? "" : "s"} (e.g. ${fixed.applied.slice(0, 2).join(", ")}).`].filter(Boolean).join(" ") }) ?? m;
  }
  setDigest(id, r?.digest ?? null);
  return ok({ ...m, digest: r?.digest ?? null });
});

/** Save a digest the student rearranged (topics moved, copied, renamed or deleted). */
export const PUT = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const m = getMaterial(id);
  if (!m) return fail("Not found", 404);
  if (!m.digest) return fail("This item has no summary to edit yet.");
  const b = await body<{ digest?: Digest }>(req);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const topic = (t: unknown, deep: boolean): DigestTopic | null => {
    const o = t as Partial<DigestTopic> | null;
    if (!o || typeof o.title !== "string" || !o.title.trim()) return null;
    const out: DigestTopic = { title: str(o.title, 120).trim(), start: typeof o.start === "string" ? o.start.slice(0, 10) : null, summary: str(o.summary, 2000) };
    if (deep) out.subtopics = (Array.isArray(o.subtopics) ? o.subtopics : []).map((s) => topic(s, false)).filter((s): s is DigestTopic => !!s).slice(0, 40);
    return out;
  };
  if (!b.digest || !Array.isArray(b.digest.topics)) return fail("No topics to save.");
  const digest: Digest = { ...m.digest, topics: b.digest.topics.map((t) => topic(t, true)).filter((t): t is DigestTopic => !!t).slice(0, 60) };
  setDigest(id, digest);
  return ok({ ...m, digest });
});
