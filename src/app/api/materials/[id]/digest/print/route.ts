import { digestToTex } from "@/lib/latex";
import { getCourse, getMaterial } from "@/lib/store";
import { texDownload, texFileName } from "@/lib/texPdf";
import { MATERIAL_KIND_LABELS } from "@/lib/types";
import { fail, handle, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A material's summary as a Z LaTeX document (`?format=tex`, the default) or compiled to PDF (`?format=pdf`). */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const m = getMaterial((await params).id);
  if (!m) return fail("This item no longer exists.", 404);
  if (!m.digest) return fail("Summarise this item first.", 404);
  const source = digestToTex(m.title, getCourse(m.course_id)?.name ?? "", MATERIAL_KIND_LABELS[m.kind] ?? "material", m.digest);
  return texDownload(source, texFileName(m.title, "-summary"), new URL(req.url).searchParams.get("format"));
});
