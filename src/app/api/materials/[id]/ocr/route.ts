import { fail, handle, later, ok, type Ctx } from "@/lib/http";
import { continueTextLayer } from "@/lib/textLayer";
import { digestNow, settleNewText } from "@/lib/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Add a text layer to a scanned PDF with OCR on this computer. Each call reads the pages that fit in
 * about 20 seconds and reports progress; call again until `done`.
 */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  try {
    const r = await continueTextLayer(id);
    if (!r.done) return ok(r);
    const [m] = digestNow([r.material]);
    later(() => settleNewText([id]));
    return ok({ ...r, material: m });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
});
