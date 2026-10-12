import { aiEnabled } from "@/lib/ai";
import { applyCorrections, digestWithFixes } from "@/lib/digest";
import { getMaterial, setDigest, updateMaterial } from "@/lib/store";
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
