import { addTopic, getMaterial, listTopics, normTitle } from "@/lib/store";
import { offlineDigest } from "@/lib/digest";
import { fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Add one material's topics to the course brainmap as a new branch, without rebuilding the whole map
 * (e.g. a video just watched). The branch is not marked as hand-made, so a later rebuild reorganises it.
 */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const m = getMaterial(id);
  if (!m) return fail("Not found", 404);
  const digest = m.digest ?? (m.text?.trim() ? offlineDigest(m.text) : null);
  if (!digest?.topics.length) return fail("This item has no topics yet. Add or transcribe its text first.");
  if (listTopics(m.course_id).some((t) => !t.parent_id && normTitle(t.title) === normTitle(m.title)))
    return fail(`"${m.title}" is already a branch of the brainmap.`);
  const at = (s: string | null) => (s ? `[${s}] ` : "");
  const branch = addTopic(m.course_id, { title: m.title, summary: digest.summary, keywords: digest.keywords.slice(0, 8), material_ids: [m.id], manual: false });
  for (const t of digest.topics) {
    const child = addTopic(m.course_id, { title: t.title, summary: at(t.start) + t.summary, parent_id: branch.id, material_ids: [m.id], manual: false });
    for (const s of t.subtopics ?? []) addTopic(m.course_id, { title: s.title, summary: at(s.start) + s.summary, parent_id: child.id, material_ids: [m.id], manual: false });
  }
  return ok({ topic_id: branch.id }, 201);
});
