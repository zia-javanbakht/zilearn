import { generatePodcast, parseScope } from "@/lib/generate";
import { getCourse, listPodcasts, savePodcast } from "@/lib/store";
import { PodcastInput } from "@/lib/validate";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => ok(listPodcasts((await params).id)));

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const b = await body<{ scope?: unknown; minutes?: number }>(req);
  const p = await generatePodcast(id, parseScope(b.scope), PodcastInput.parse(b).minutes);
  return ok(savePodcast({ course_id: id, title: p.title, scope: p.scope, hosts: p.hosts, segments: p.segments, generated_by: p.by }), 201);
});
