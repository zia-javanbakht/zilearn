import { generateCards, parseScope } from "@/lib/generate";
import { addCards, cardStats, dueCards, getCourse, listCards } from "@/lib/store";
import { body, fail, handle, ok, todayFrom, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stats plus either today's review queue (?due=1) or every card. */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const q = new URL(req.url).searchParams;
  const today = todayFrom(q.get("today"));
  return ok({ stats: cardStats(id, today), cards: q.get("due") ? dueCards(id, today) : listCards(id) });
});

/** Generate cards for a scope, or add one card written by the student ({front, back}). */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const b = await body<{ scope?: unknown; count?: number; front?: string; back?: string; topic_id?: string; today?: string }>(req);
  let added: number;
  let by: string = "student";
  if (typeof b.front === "string" || typeof b.back === "string") {
    if (!b.front?.trim() || !b.back?.trim()) return fail("A card needs a front and a back.");
    added = addCards(id, [{ front: b.front.slice(0, 4000), back: b.back.slice(0, 8000), topic_id: b.topic_id ?? null }], "manual", "student");
    if (!added) return fail("You already have a card with that front.");
  } else {
    const out = await generateCards(id, parseScope(b.scope), Number(b.count) || 20);
    added = addCards(id, out.cards, "generated", out.by);
    by = out.by;
  }
  return ok({ added, by, stats: cardStats(id, todayFrom(b.today)) }, 201);
});
