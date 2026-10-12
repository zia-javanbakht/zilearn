import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { db } from "./db";

/**
 * App settings saved in the database: which AI provider to use, and a key, model and (for
 * OpenAI-compatible servers) base URL per provider. Saved values win over environment variables;
 * an empty value means "not saved", so the environment (or the built-in default) applies.
 */

export const PROVIDER_CHOICES = ["auto", "anthropic", "gemini", "openai", "builtin"] as const;
export type ProviderChoice = (typeof PROVIDER_CHOICES)[number];

export interface Settings {
  provider: ProviderChoice;
  anthropic: { key: string; model: string };
  gemini: { key: string; model: string };
  openai: { key: string; model: string; baseUrl: string };
}

const KEYS = ["provider", "anthropic.key", "anthropic.model", "gemini.key", "gemini.model", "openai.key", "openai.model", "openai.baseUrl"] as const;

/** Settings used instead of the saved ones while a callback runs (for "Test connection" before saving). */
const override = new AsyncLocalStorage<Settings>();

export function withSettings<T>(s: Settings, fn: () => T): T {
  return override.run(s, fn);
}

export function emptySettings(): Settings {
  return { provider: "auto", anthropic: { key: "", model: "" }, gemini: { key: "", model: "" }, openai: { key: "", model: "", baseUrl: "" } };
}

function fromRows(rows: Map<string, string>): Settings {
  const v = (k: string) => rows.get(k) ?? "";
  const choice = v("provider") as ProviderChoice;
  return {
    provider: PROVIDER_CHOICES.includes(choice) ? choice : "auto",
    anthropic: { key: v("anthropic.key"), model: v("anthropic.model") },
    gemini: { key: v("gemini.key"), model: v("gemini.model") },
    openai: { key: v("openai.key"), model: v("openai.model"), baseUrl: v("openai.baseUrl") },
  };
}

/** The current settings (saved, or the override while testing). Read on every call, so changes apply at once. */
export function getSettings(): Settings {
  const o = override.getStore();
  if (o) return o;
  try {
    const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    return fromRows(new Map(rows.map((r) => [r.key, r.value])));
  } catch {
    // An unreadable database should not take the AI wrapper down with it: behave as if nothing is saved.
    return emptySettings();
  }
}

const field = z.string().trim().max(4000).optional();
const baseUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => u === "" || /^https?:\/\/[^\s/]+/i.test(u), "The base URL must start with http:// or https://")
  .optional();

/** What PUT /api/settings accepts. A missing field is left as it is; an empty string clears it. */
export const SettingsPatch = z.object({
  provider: z.enum(PROVIDER_CHOICES).optional(),
  anthropic: z.object({ key: field, model: field }).optional(),
  gemini: z.object({ key: field, model: field }).optional(),
  openai: z.object({ key: field, model: field, baseUrl }).optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

/** The settings with a patch applied, without saving anything. */
export function applyPatch(base: Settings, patch: SettingsPatch): Settings {
  const pick = (next: string | undefined, prev: string) => (next === undefined ? prev : next.trim());
  return {
    provider: patch.provider ?? base.provider,
    anthropic: { key: pick(patch.anthropic?.key, base.anthropic.key), model: pick(patch.anthropic?.model, base.anthropic.model) },
    gemini: { key: pick(patch.gemini?.key, base.gemini.key), model: pick(patch.gemini?.model, base.gemini.model) },
    openai: {
      key: pick(patch.openai?.key, base.openai.key),
      model: pick(patch.openai?.model, base.openai.model),
      baseUrl: pick(patch.openai?.baseUrl, base.openai.baseUrl).replace(/\/+$/, ""),
    },
  };
}

export function saveSettings(patch: SettingsPatch): Settings {
  const next = applyPatch(getSettings(), patch);
  const values: Record<(typeof KEYS)[number], string> = {
    provider: next.provider,
    "anthropic.key": next.anthropic.key,
    "anthropic.model": next.anthropic.model,
    "gemini.key": next.gemini.key,
    "gemini.model": next.gemini.model,
    "openai.key": next.openai.key,
    "openai.model": next.openai.model,
    "openai.baseUrl": next.openai.baseUrl,
  };
  const d = db();
  const put = d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const del = d.prepare("DELETE FROM settings WHERE key = ?");
  d.transaction(() => {
    for (const k of KEYS) {
      if (values[k] === "" || (k === "provider" && values[k] === "auto")) del.run(k);
      else put.run(k, values[k]);
    }
  })();
  return next;
}

/** A key shortened for display, e.g. "sk-…abcd". Short keys show only their last two characters. */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length < 12) return `…${key.slice(-2)}`;
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
