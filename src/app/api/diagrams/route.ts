import { diagramEdits, saveDiagramEdit } from "@/lib/diagramEdits";
import { parseDiagram } from "@/lib/diagramModel";
import { body, fail, handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The student's edits to diagrams, by key (`?keys=a,b`). */
export const GET = handle((req: Request) => {
  const keys = (new URL(req.url).searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => /^[a-z0-9]{1,16}$/.test(k))
    .slice(0, 200);
  return ok({ edits: diagramEdits(keys) });
});

/** Keep an edited diagram: `{ original, code }`, or `{ original, code: null }` to go back to the original. */
export const PUT = handle(async (req: Request) => {
  const b = await body<{ original?: string; code?: string | null }>(req);
  if (typeof b.original !== "string" || !b.original.trim() || b.original.length > 200_000) return fail("Which diagram?");
  if (b.code !== null && (typeof b.code !== "string" || b.code.length > 200_000 || !parseDiagram(b.code))) return fail("That diagram can't be saved: it isn't a flowchart or mindmap this editor can read.");
  saveDiagramEdit(b.original, b.code ?? null);
  return ok({ saved: true });
});
