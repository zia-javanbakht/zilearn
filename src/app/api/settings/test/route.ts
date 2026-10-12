import { testConnection } from "@/lib/ai";
import { body, fail, handle, ok } from "@/lib/http";
import { applyPatch, getSettings, SettingsPatch, withSettings } from "@/lib/settings";
import { check } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Make one tiny call with the chosen provider. The body takes the same fields as PUT /api/settings,
 * so the form can be tested before it is saved; nothing is stored.
 */
export const POST = handle(async (req: Request) => {
  const v = check(SettingsPatch, await body(req));
  if (!v.ok) return fail(v.error);
  return ok(await withSettings(applyPatch(getSettings(), v.data), testConnection));
});
