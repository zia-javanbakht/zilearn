import { aiEnabled, MODEL } from "@/lib/ai";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({ ai: aiEnabled(), model: aiEnabled() ? MODEL : null });
}
