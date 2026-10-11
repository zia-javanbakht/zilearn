import { aiEnabled } from "@/lib/ai";
import { makeDigest } from "@/lib/digest";
import { getMaterial, setDigest } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** (Re)make a material's summary, key terms and topics; with the AI unless `{ ai: false }` or offline. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const m = getMaterial(id);
  if (!m) return fail("Not found", 404);
  if (!m.text?.trim()) return fail("This item has no text to summarise yet.");
  const b = await body<{ ai?: boolean }>(req);
  const digest = await makeDigest(m, b.ai !== false && aiEnabled());
  setDigest(id, digest);
  return ok({ ...m, digest });
});
