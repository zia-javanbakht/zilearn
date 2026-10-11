import { activeModel, aiEnabled, providerName } from "@/lib/ai";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({ ai: aiEnabled(), provider: aiEnabled() ? providerName() : null, model: activeModel() });
}
