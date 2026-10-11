import { rebuildKnowledgeBase } from "@/lib/kb";
import { allTopics, listCourses, listLinks } from "@/lib/store";
import { handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function graph() {
  const courses = listCourses();
  const topics = new Map(allTopics().map((t) => [t.id, t]));
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  const links = listLinks()
    .map((l) => {
      const a = topics.get(l.from_topic);
      const b = topics.get(l.to_topic);
      if (!a || !b) return null;
      return {
        ...l,
        from: { id: a.id, title: a.title, course_id: a.course_id, course_name: courseName.get(a.course_id) ?? "" },
        to: { id: b.id, title: b.title, course_id: b.course_id, course_name: courseName.get(b.course_id) ?? "" },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Mermaid: one subgraph per course, edges between linked topics.
  const esc = (s: string) => s.replace(/"/g, "#quot;").replace(/[<>]/g, " ");
  const used = new Set(links.flatMap((l) => [l.from.id, l.to.id]));
  const nid = new Map([...used].map((id, i) => [id, `t${i}`]));
  const lines = ["flowchart LR"];
  courses.forEach((c, ci) => {
    const inCourse = [...used].filter((id) => topics.get(id)?.course_id === c.id);
    if (!inCourse.length) return;
    lines.push(`  subgraph c${ci}["${esc(c.name)}"]`);
    for (const id of inCourse) lines.push(`    ${nid.get(id)}["${esc(topics.get(id)!.title)}"]`);
    lines.push("  end");
  });
  for (const l of links.slice(0, 120)) lines.push(`  ${nid.get(l.from.id)} -.- ${nid.get(l.to.id)}`);
  return {
    courses: courses.map((c) => ({ id: c.id, name: c.name, topic_count: c.topic_count })),
    links,
    mermaid: links.length ? lines.join("\n") : null,
  };
}

export const GET = handle(() => ok(graph()));

export const POST = handle(async () => {
  const r = await rebuildKnowledgeBase();
  return ok({ ...graph(), by: r.by });
});
