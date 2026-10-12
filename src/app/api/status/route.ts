import { activeModel, aiEnabled, providerName } from "@/lib/ai";
import { ok } from "@/lib/http";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({ ai: aiEnabled(), provider: aiEnabled() ? providerName() : null, model: activeModel(), choice: getSettings().provider });
}
