import { settingsSummary } from "@/lib/ai";
import { body, fail, handle, ok } from "@/lib/http";
import { saveSettings, SettingsPatch } from "@/lib/settings";
import { check } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** The AI provider settings. Keys are only ever returned masked. */
export const GET = handle(() => ok(settingsSummary()));

/** Save the provider, models, keys and base URL. Fields left out stay as they are; an empty string clears one. */
export const PUT = handle(async (req: Request) => {
  const v = check(SettingsPatch, await body(req));
  if (!v.ok) return fail(v.error);
  saveSettings(v.data);
  return ok(settingsSummary());
});
