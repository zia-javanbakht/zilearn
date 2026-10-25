import { todayOverview } from "@/lib/store";
import { handle, ok, todayFrom } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Today's sessions and flashcards across every course (?today=YYYY-MM-DD, the student's own date). */
export const GET = handle((req: Request) => ok(todayOverview(todayFrom(new URL(req.url).searchParams.get("today")))));
