import { z } from "zod";
import { deleteCard, getCard, restoreCard, reviewCard, updateCard } from "@/lib/store";
import { body, fail, handle, ok, todayFrom, type Ctx } from "@/lib/http";
import type { Rating } from "@/lib/srs";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const Schedule = z.object({ stability: z.number().min(0).max(100000).nullable(), difficulty: z.number().min(0).max(10).nullable(), interval: z.number().min(0).max(36500), reps: z.number().int().min(0), lapses: z.number().int().min(0), due: day, last_review: day });

/** Record a review ({rating: 1-4, today}), undo one ({undo: the schedule from before}), or edit the card ({front, back}). */
export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCard(id)) return fail("Card not found", 404);
  const b = await body<{ rating?: number; today?: string; front?: string; back?: string; undo?: unknown }>(req);
  if (b.undo !== undefined) {
    const s = Schedule.safeParse(b.undo);
    return s.success ? ok(restoreCard(id, s.data)) : fail("That isn't a card's schedule to go back to.");
  }
  if (b.rating !== undefined) {
    if (![1, 2, 3, 4].includes(b.rating)) return fail("rating must be 1 (again) to 4 (easy)");
    return ok(reviewCard(id, b.rating as Rating, todayFrom(b.today)));
  }
  return ok(updateCard(id, { front: b.front?.slice(0, 4000), back: b.back?.slice(0, 8000) }));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  deleteCard((await params).id);
  return ok({ ok: true });
});
