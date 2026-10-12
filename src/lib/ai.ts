import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError as GeminiApiError, FinishReason, GoogleGenAI, MediaResolution, type Part } from "@google/genai";
import { z } from "zod";
import { getSettings, maskKey, type ProviderChoice, type Settings } from "./settings";

/**
 * Thin wrapper around the AI provider: Claude (Anthropic), Gemini (Google) or any OpenAI-compatible
 * server (OpenAI, OpenRouter, Ollama, LM Studio, ...). The choice, keys and models come from Settings
 * (saved in the database) and fall back to environment variables. Both are read on every call, so a
 * change in Settings applies at once. Every feature in ziLearn has an offline heuristic fallback
 * ("built-in"), so callers check `aiEnabled()` and degrade gracefully.
 */

export type Provider = "claude" | "gemini" | "openai";

/** Models used when neither Settings nor the environment name one. */
export const DEFAULT_MODELS: Record<Provider, string> = { claude: "claude-opus-5-5", gemini: "gemini-flash-latest", openai: "gpt-5-mini" };
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

const env = (name: string) => process.env[name]?.trim() || "";

type Source = "saved" | "environment" | null;

interface ProviderConfig {
  key: string;
  keySource: Source;
  model: string;
  /** Model from the environment or the built-in default: what is used when no model is saved. */
  defaultModel: string;
}

function claudeConfig(s: Settings = getSettings()): ProviderConfig {
  const envKey = env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN");
  const defaultModel = env("ZILEARN_MODEL") || DEFAULT_MODELS.claude;
  return { key: s.anthropic.key || envKey, keySource: s.anthropic.key ? "saved" : envKey ? "environment" : null, model: s.anthropic.model || defaultModel, defaultModel };
}

function geminiConfig(s: Settings = getSettings()): ProviderConfig {
  const envKey = env("GEMINI_API_KEY") || env("GOOGLE_API_KEY");
  const defaultModel = env("GEMINI_MODEL") || DEFAULT_MODELS.gemini;
  return { key: s.gemini.key || envKey, keySource: s.gemini.key ? "saved" : envKey ? "environment" : null, model: s.gemini.model || defaultModel, defaultModel };
}

function openaiConfig(s: Settings = getSettings()): ProviderConfig & { baseUrl: string; baseUrlSource: Source } {
  const envKey = env("OPENAI_API_KEY");
  const defaultModel = env("OPENAI_MODEL") || DEFAULT_MODELS.openai;
  const envBase = env("OPENAI_BASE_URL");
  return {
    key: s.openai.key || envKey,
    keySource: s.openai.key ? "saved" : envKey ? "environment" : null,
    model: s.openai.model || defaultModel,
    defaultModel,
    baseUrl: (s.openai.baseUrl || envBase || OPENAI_BASE_URL).replace(/\/+$/, ""),
    baseUrlSource: s.openai.baseUrl ? "saved" : envBase ? "environment" : null,
  };
}

/** Local servers such as Ollama and LM Studio need no key, so a custom base URL is enough. */
function openaiReady(c: ReturnType<typeof openaiConfig>): boolean {
  return Boolean(c.key) || c.baseUrl !== OPENAI_BASE_URL;
}

/**
 * The provider in use, or null for the built-in offline mode. A provider picked in Settings is used
 * only when it has a key. "Automatic" keeps the original behaviour: ZILEARN_PROVIDER picks one when
 * several have keys; otherwise Claude, then Gemini, then an OpenAI-compatible server set up in Settings
 * (OPENAI_API_KEY alone counts only with ZILEARN_PROVIDER=openai, so a key meant for other tools isn't
 * picked up by surprise).
 */
export function provider(): Provider | null {
  return resolveProvider(getSettings());
}

function resolveProvider(s: Settings): Provider | null {
  const claude = Boolean(claudeConfig(s).key);
  const gemini = Boolean(geminiConfig(s).key);
  const oc = openaiConfig(s);
  const openai = openaiReady(oc);
  switch (s.provider) {
    case "builtin":
      return null;
    case "anthropic":
      return claude ? "claude" : null;
    case "gemini":
      return gemini ? "gemini" : null;
    case "openai":
      return openai ? "openai" : null;
  }
  const wanted = env("ZILEARN_PROVIDER").toLowerCase();
  if (wanted === "gemini" && gemini) return "gemini";
  if ((wanted === "claude" || wanted === "anthropic") && claude) return "claude";
  if (wanted === "openai" && openai) return "openai";
  if (claude) return "claude";
  if (gemini) return "gemini";
  if (openai && (oc.keySource === "saved" || oc.baseUrlSource === "saved")) return "openai";
  return null;
}

export function aiEnabled(): boolean {
  return provider() !== null;
}

/** Display name of an OpenAI-compatible server, from its address. */
export function openaiLabel(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "OpenAI-compatible";
  }
  const h = url.hostname;
  if (/(^|\.)openai\.com$/.test(h)) return "OpenAI";
  if (/(^|\.)openrouter\.ai$/.test(h)) return "OpenRouter";
  if (/(^|\.)groq\.com$/.test(h)) return "Groq";
  if (/(^|\.)mistral\.ai$/.test(h)) return "Mistral";
  if (/(^|\.)deepseek\.com$/.test(h)) return "DeepSeek";
  if (url.port === "11434" || /ollama/.test(h)) return "Ollama";
  if (url.port === "1234") return "LM Studio";
  return url.host;
}

const nameOf = (p: Provider, s: Settings) => (p === "gemini" ? "Gemini" : p === "openai" ? openaiLabel(openaiConfig(s).baseUrl) : "Claude");
const modelOf = (p: Provider, s: Settings) => (p === "claude" ? claudeConfig(s) : p === "gemini" ? geminiConfig(s) : openaiConfig(s)).model;

/** "Claude", "Gemini" or the OpenAI-compatible server's name, for messages shown to the student. */
export function providerName(): string {
  const s = getSettings();
  return nameOf(resolveProvider(s) ?? "claude", s);
}

/** The model in use, for display. */
export function activeModel(): string | null {
  const s = getSettings();
  const p = resolveProvider(s);
  return p && modelOf(p, s);
}

/** What the Settings page shows: the choice, and per provider where its key comes from (keys masked, never in full). */
export function settingsSummary() {
  const s = getSettings();
  const o = openaiConfig(s);
  const view = (saved: { model: string }, cfg: ProviderConfig) => ({
    hasKey: Boolean(cfg.key),
    maskedKey: maskKey(cfg.key),
    keySource: cfg.keySource,
    model: saved.model,
    defaultModel: cfg.defaultModel,
  });
  const active = resolveProvider(s);
  return {
    provider: s.provider as ProviderChoice,
    active: active && { provider: active, name: nameOf(active, s), model: modelOf(active, s) },
    anthropic: view(s.anthropic, claudeConfig(s)),
    gemini: view(s.gemini, geminiConfig(s)),
    openai: {
      ...view(s.openai, o),
      baseUrl: s.openai.baseUrl,
      baseUrlSource: o.baseUrlSource,
      defaultBaseUrl: env("OPENAI_BASE_URL") || OPENAI_BASE_URL,
    },
  };
}
export type SettingsSummary = ReturnType<typeof settingsSummary>;

let client: { key: string; sdk: Anthropic } | null = null;
let gemini: { key: string; sdk: GoogleGenAI } | null = null;

function anthropic(): Anthropic {
  // A key saved in Settings replaces the environment's; otherwise the SDK reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN.
  const saved = getSettings().anthropic.key;
  if (!client || client.key !== saved) {
    // Routes stop at 300s, so give up a little before that instead of the SDK's 10 minute default.
    client = { key: saved, sdk: new Anthropic({ maxRetries: 4, timeout: 280_000, ...(saved ? { apiKey: saved, authToken: null } : {}) }) };
  }
  return client.sdk;
}

/** The incoming request's abort signal, so a closed tab stops the AI call (set by `handle`). */
export const requestSignal = new AsyncLocalStorage<AbortSignal>();

const SYSTEM = `You are ziLearn, an expert university tutor and instructional designer.
You turn a student's course materials into well-structured study resources.
Ground everything in the provided materials; when you add general knowledge to fill gaps, keep it accurate and standard for the subject.
Write clearly for a university student.
When asked for a Markdown document, output only the document itself: no preamble, no closing remarks.`;

// Server-side fallback reruns a request on another model if the primary declines it.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export class AIRefusalError extends Error {}

/** The answer could not be read as the requested JSON (Gemini and OpenAI-compatible servers). */
class AIFormatError extends Error {}

/** An error caused by the user's input or state (reported as HTTP 400, not 500). */
export class UserError extends Error {}

export type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

interface CallOpts {
  prompt: string | ContentBlock[];
  /**
   * Large, stable material (e.g. course sources) sent before the prompt and marked for prompt caching,
   * so notes, exams and podcasts on the same scope reuse it instead of paying for it again.
   */
  context?: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

function content(opts: CallOpts): ContentBlock[] {
  const task: ContentBlock[] = typeof opts.prompt === "string" ? [{ type: "text", text: opts.prompt }] : opts.prompt;
  if (!opts.context) return task;
  return [{ type: "text", text: opts.context, cache_control: { type: "ephemeral" } }, ...task];
}

function claudeStream(opts: CallOpts, format?: ReturnType<typeof betaZodOutputFormat>) {
  return anthropic().beta.messages.stream(
    {
      model: claudeConfig().model,
      max_tokens: opts.maxTokens ?? 16000,
      system: SYSTEM,
      ...FALLBACK,
      output_config: { effort: opts.effort ?? "medium", ...(format ? { format } : {}) },
      messages: [{ role: "user", content: content(opts) }],
    },
    { signal: requestSignal.getStore() },
  );
}

/* ---------------- Gemini ---------------- */

function geminiClient(): GoogleGenAI {
  const key = geminiConfig().key;
  if (!gemini || gemini.key !== key) gemini = { key, sdk: new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 280_000, retryOptions: { attempts: 4 } } }) };
  return gemini.sdk;
}

function geminiParts(opts: CallOpts): Part[] {
  // The stable course material goes first so Gemini's implicit prefix caching can reuse it.
  const parts: Part[] = opts.context ? [{ text: opts.context }] : [];
  for (const b of content({ ...opts, context: undefined })) {
    if (b.type === "text") parts.push({ text: b.text });
    else if ((b.type === "image" || b.type === "document") && b.source.type === "base64")
      parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
  }
  return parts;
}

/** JSON Schema for Gemini's structured output, from the same Zod schema Claude uses. */
export function geminiSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  return rest;
}

async function geminiCall(opts: CallOpts, schema?: z.ZodType): Promise<{ text: string; truncated: boolean }> {
  const stream = await geminiClient().models.generateContentStream({
    model: geminiConfig().model,
    contents: [{ role: "user", parts: geminiParts(opts) }],
    config: {
      systemInstruction: SYSTEM,
      maxOutputTokens: opts.maxTokens ?? 16000,
      abortSignal: requestSignal.getStore(),
      ...(schema ? { responseMimeType: "application/json", responseJsonSchema: geminiSchema(schema) } : {}),
    },
  });
  let text = "";
  let finish: FinishReason | undefined;
  for await (const chunk of stream) {
    if (chunk.promptFeedback?.blockReason) throw new AIRefusalError("Gemini declined this request.");
    text += chunk.text ?? "";
    finish = chunk.candidates?.[0]?.finishReason ?? finish;
  }
  if (finish && [FinishReason.SAFETY, FinishReason.PROHIBITED_CONTENT, FinishReason.BLOCKLIST, FinishReason.SPII, FinishReason.RECITATION].includes(finish))
    throw new AIRefusalError("Gemini declined this request.");
  return { text: text.trim(), truncated: finish === FinishReason.MAX_TOKENS };
}

/**
 * Transcript of a public YouTube video, written by Gemini watching it (for videos without captions).
 * Low media resolution keeps an hour-long lecture well inside the context window: the speech is what matters.
 */
export async function transcribeVideoUrl(url: string): Promise<string | null> {
  if (provider() !== "gemini") return null;
  const stream = await geminiClient().models.generateContentStream({
    model: geminiConfig().model,
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: url, mimeType: "video/*" } },
          {
            text: "Transcribe the speech in this video for a student's study notes. Start a new paragraph about every minute, beginning with its [mm:ss] timestamp. Write maths in LaTeX ($...$). Where a slide or the board shows something important that is not said aloud (a formula, a diagram, a definition), add it in [brackets]. Output only the transcript.",
          },
        ],
      },
    ],
    config: { maxOutputTokens: 60000, mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW, abortSignal: requestSignal.getStore() },
  });
  let text = "";
  for await (const chunk of stream) text += chunk.text ?? "";
  return text.trim() || null;
}

/* ---------------- OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio, ...) ---------------- */

/** An error answer from an OpenAI-compatible server, or no answer at all (status 0). */
export class OpenAICompatError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly server: string,
    readonly model: string,
  ) {
    super(message);
  }
}

type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "file"; file: { filename: string; file_data: string } };

/** Ways of asking for JSON, best first: servers that reject one get the next. */
type JsonMode = "json_schema" | "json_object" | "prompt";

const OPENAI_RETRIES = 4;

function openaiMessages(opts: CallOpts, extra?: string) {
  // The stable course material goes first so servers with prefix caching can reuse it.
  const parts: ChatPart[] = opts.context ? [{ type: "text", text: opts.context }] : [];
  for (const b of content({ ...opts, context: undefined })) {
    if (b.type === "text") parts.push({ type: "text", text: b.text });
    else if (b.type === "image" && b.source.type === "base64")
      parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
    else if (b.type === "document" && b.source.type === "base64")
      parts.push({ type: "file", file: { filename: "document.pdf", file_data: `data:${b.source.media_type};base64,${b.source.data}` } });
    else if (b.type === "document" && b.source.type === "text") parts.push({ type: "text", text: b.source.data });
  }
  if (extra) parts.push({ type: "text", text: extra });
  // Plain text goes as one string, the form every compatible server understands.
  const user = parts.every((p) => p.type === "text") ? parts.map((p) => (p as { text: string }).text).join("\n\n") : parts;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/** The request body for a chat completion. Exported for tests. */
export function openaiRequest(opts: CallOpts, schema: z.ZodType | undefined, mode: JsonMode | null, model: string, baseUrl: string) {
  const jsonSchema = schema ? geminiSchema(schema) : undefined;
  const hint =
    jsonSchema && mode !== "json_schema"
      ? `Answer with one JSON object only (no Markdown fences, no commentary) that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`
      : undefined;
  return {
    model,
    messages: openaiMessages(opts, hint),
    // OpenAI's own API wants max_completion_tokens (its reasoning models reject max_tokens); other servers know max_tokens.
    [openaiLabel(baseUrl) === "OpenAI" ? "max_completion_tokens" : "max_tokens"]: opts.maxTokens ?? 16000,
    ...(mode === "json_schema" && jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: "response", schema: jsonSchema } } } : {}),
    ...(mode === "json_object" ? { response_format: { type: "json_object" } } : {}),
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

async function errorDetail(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const j = JSON.parse(raw) as { error?: string | { message?: string }; message?: string; detail?: string };
    const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? j.detail);
    if (m) return String(m).slice(0, 300);
  } catch {
    // not JSON
  }
  return raw.trim().slice(0, 300) || `HTTP ${res.status}`;
}

/** POST to the server, retrying rate limits, server errors and dropped connections like the SDKs do. */
async function openaiPost(path: string, body: unknown, cfg: ReturnType<typeof openaiConfig>): Promise<unknown> {
  const server = openaiLabel(cfg.baseUrl);
  const outer = requestSignal.getStore();
  // Routes stop at 300s, so give up a little before that.
  const signal = AbortSignal.any([AbortSignal.timeout(280_000), ...(outer ? [outer] : [])]);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.key) headers.authorization = `Bearer ${cfg.key}`;
  if (server === "OpenRouter") headers["x-title"] = "ziLearn";
  for (let attempt = 0; ; attempt++) {
    const backoff = Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() / 2);
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (err) {
      if (signal.aborted) throw signal.reason ?? err;
      if (attempt < OPENAI_RETRIES) {
        await sleep(backoff, signal);
        continue;
      }
      throw new OpenAICompatError(`Could not reach ${server} at ${cfg.baseUrl}.`, 0, server, cfg.model);
    }
    if (res.ok) return res.json();
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && res.headers.get("retry-after") !== null ? retryAfter * 1000 : backoff;
    if ((res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500) && attempt < OPENAI_RETRIES && wait <= 30_000) {
      await res.body?.cancel().catch(() => {});
      await sleep(wait, signal);
      continue;
    }
    throw new OpenAICompatError(await errorDetail(res), res.status, server, cfg.model);
  }
}

interface ChatCompletion {
  choices?: { message?: { content?: string | { type?: string; text?: string }[] | null; refusal?: string | null }; finish_reason?: string | null }[];
  error?: { message?: string; code?: number | string } | string;
}

async function openaiCall(opts: CallOpts, schema?: z.ZodType): Promise<{ text: string; truncated: boolean }> {
  const cfg = openaiConfig();
  const server = openaiLabel(cfg.baseUrl);
  const modes: (JsonMode | null)[] = schema ? ["json_schema", "json_object", "prompt"] : [null];
  let data: ChatCompletion | undefined;
  for (let i = 0; !data; i++) {
    try {
      data = (await openaiPost("/chat/completions", openaiRequest(opts, schema, modes[i], cfg.model, cfg.baseUrl), cfg)) as ChatCompletion;
    } catch (err) {
      // A server that doesn't support a response_format answers 400 (or 422/501): ask the next simpler way.
      const rejected = err instanceof OpenAICompatError && [400, 422, 501].includes(err.status);
      if (!rejected || i + 1 >= modes.length) throw err;
    }
  }
  const choice = data.choices?.[0];
  if (!choice) {
    const e = data.error;
    const status = typeof e === "object" && typeof e.code === "number" ? e.code : 502;
    throw new OpenAICompatError((typeof e === "string" ? e : e?.message) || `${server} returned no answer.`, status, server, cfg.model);
  }
  if (choice.message?.refusal || choice.finish_reason === "content_filter") throw new AIRefusalError(`${server} declined this request.`);
  const c = choice.message?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : "";
  // Reasoning models on some servers put their thinking inline; it isn't part of the answer.
  return { text: text.replace(/^\s*<think>[\s\S]*?<\/think>/, "").trim(), truncated: choice.finish_reason === "length" };
}

/** JSON from a model's answer, tolerating Markdown fences or a sentence around the object. */
function parseJsonAnswer(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    return undefined;
  }
}

/* ---------------- Public API ---------------- */

/** Ask the AI for JSON matching a Zod schema. Streamed so large outputs don't hit non-streaming limits. */
export async function generateStructured<T extends z.ZodType>(opts: CallOpts & { schema: T }): Promise<z.infer<T>> {
  const p = provider();
  if (p === "gemini") {
    const { text, truncated } = await geminiCall(opts, opts.schema);
    if (truncated) throw new Error("The AI's answer was cut off (too long). Try a smaller scope.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AIFormatError("Gemini returned an unexpected response.");
    }
    const out = opts.schema.safeParse(parsed);
    if (!out.success) throw new AIFormatError("Gemini returned an unexpected response.");
    return out.data;
  }
  if (p === "openai") {
    const { text, truncated } = await openaiCall(opts, opts.schema);
    if (truncated) throw new Error("The AI's answer was cut off (too long). Try a smaller scope.");
    const out = opts.schema.safeParse(parseJsonAnswer(text));
    if (!out.success) throw new AIFormatError(`${providerName()} returned an unexpected response.`);
    return out.data;
  }
  const message = await claudeStream(opts, betaZodOutputFormat(opts.schema)).finalMessage();
  if (message.stop_reason === "refusal") throw new AIRefusalError("Claude declined this request.");
  if (message.parsed_output == null) {
    throw new Error(
      message.stop_reason === "max_tokens"
        ? "Claude's answer was cut off (too long). Try a smaller scope."
        : "Claude returned an unexpected response.",
    );
  }
  return message.parsed_output as z.infer<T>;
}

/** Ask the AI for free-form Markdown. `truncated` is set when the answer hit the length limit. */
export async function generateText(opts: CallOpts): Promise<{ text: string; truncated: boolean }> {
  const p = provider();
  if (p === "gemini") return geminiCall(opts);
  if (p === "openai") return openaiCall(opts);
  const message = await claudeStream(opts).finalMessage();
  if (message.stop_reason === "refusal") throw new AIRefusalError("Claude declined this request.");
  const text = message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, truncated: message.stop_reason === "max_tokens" };
}

export const CUT_OFF_NOTE = "\n\n_(This text was cut off because it reached the length limit. Try a narrower scope.)_";

/** Human-readable message for an API failure, without leaking internals. */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof AIRefusalError || err instanceof UserError || err instanceof AIFormatError) return err.message;
  if (err instanceof GeminiApiError) {
    if ((err.status === 400 && /api key/i.test(err.message)) || err.status === 401 || err.status === 403) return "The Gemini API key is invalid or not allowed to use this model.";
    if (err.status === 404) return `Gemini model "${geminiConfig().model}" was not found. Choose a model your key can use in Settings.`;
    if (err.status === 429) return "Gemini is rate limited or out of quota right now. Try again in a minute.";
    if (err.status >= 500) return "Gemini is overloaded right now. Try again shortly.";
    return `Gemini rejected the request: ${err.message.slice(0, 300)}`;
  }
  if (err instanceof OpenAICompatError) {
    const s = err.server;
    if (err.status === 0) return `${err.message} Check the base URL in Settings and that the server is running.`;
    if (err.status === 401 || err.status === 403) return `The API key for ${s} is invalid or not allowed to use this model.`;
    if (err.status === 404) return `${s} could not find model "${err.model}" (or the base URL is wrong). Check both in Settings.`;
    if (err.status === 429) return `${s} is rate limited or out of quota right now. Try again in a minute.`;
    if (err.status >= 500) return `${s} is overloaded or had an error. Try again shortly.`;
    return `${s} rejected the request: ${err.message}`;
  }
  if (err instanceof Error && err.name === "AbortError") return "Cancelled.";
  if (err instanceof Error && err.name === "TimeoutError") return "The AI took too long to answer. Try a smaller scope.";
  if (err instanceof Anthropic.APIUserAbortError) return "Cancelled.";
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key is invalid.";
  if (err instanceof Anthropic.NotFoundError) return `Claude model "${claudeConfig().model}" was not found. Check the model name in Settings.`;
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limited right now. Try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "Claude took too long to answer. Try a smaller scope.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Claude API.";
  if (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500))
    return "Claude is overloaded right now. Try again shortly.";
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? "unknown"}).`;
  return err instanceof Error ? err.message : String(err);
}

export function errorStatus(err: unknown): number {
  if (err instanceof UserError) return 400;
  if (err instanceof GeminiApiError || err instanceof OpenAICompatError) return err.status === 429 ? 429 : err.status >= 500 ? 503 : 502;
  if (err instanceof AIRefusalError) return 422;
  if (err instanceof Error && err.name === "TimeoutError") return 504;
  if (err instanceof Anthropic.RateLimitError) return 429;
  if (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500)) return 503;
  return 500;
}

/**
 * One tiny call with the current provider, for the Settings page's "Test connection".
 * Run it inside `withSettings` to test values before they are saved.
 */
export async function testConnection(): Promise<{ provider: Provider; name: string; model: string; reply: string }> {
  const s = getSettings();
  const p = resolveProvider(s);
  if (!p) {
    if (s.provider === "builtin") throw new UserError("Built-in mode works offline and needs no connection.");
    if (s.provider === "anthropic") throw new UserError("Add an Anthropic API key first.");
    if (s.provider === "gemini") throw new UserError("Add a Gemini API key first.");
    if (s.provider === "openai") throw new UserError("Add an API key, or a base URL for a local server such as Ollama or LM Studio.");
    throw new UserError("No API key was found in the environment or in Settings, so ziLearn is using its built-in offline mode.");
  }
  const { text } = await generateText({ prompt: "This is a connection test. Reply with the single word OK.", maxTokens: 256, effort: "low" });
  return { provider: p, name: nameOf(p, s), model: modelOf(p, s), reply: text.slice(0, 200) };
}
