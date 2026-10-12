import { notesToTex } from "@/lib/latex";
import { getCourse, getNote } from "@/lib/store";
import { texDownload, texFileName } from "@/lib/texPdf";
import { fail, handle, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A review note as a Z LaTeX document (`?format=tex`, the default) or compiled to PDF (`?format=pdf`). */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const note = getNote((await params).id);
  if (!note) return fail("These notes no longer exist.", 404);
  const source = notesToTex(note, getCourse(note.course_id)?.name ?? "");
  return texDownload(source, texFileName(note.title), new URL(req.url).searchParams.get("format"));
});
