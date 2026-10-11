import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError as GeminiApiError, FinishReason, GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";

/**
 * Thin wrapper around the AI provider: Claude (Anthropic) or Gemini (Google), whichever has a key.
 * Every feature in ziLearn has an offline heuristic fallback, so callers check `aiEnabled()` and
 * degrade gracefully.
 */

export type Provider = "claude" | "gemini";

const hasClaudeKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

/** ZILEARN_PROVIDER picks one when both keys are set; otherwise whichever key exists (Claude first). */
export function provider(): Provider | null {
  const wanted = process.env.ZILEARN_PROVIDER?.toLowerCase();
  if (wanted === "gemini" && geminiKey()) return "gemini";
  if (wanted === "claude" && hasClaudeKey()) return "claude";
  if (hasClaudeKey()) return "claude";
  if (geminiKey()) return "gemini";
  return null;
}

export function aiEnabled(): boolean {
  return provider() !== null;
}

export const MODEL = process.env.ZILEARN_MODEL || "claude-opus-5-5";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

/** "Claude" or "Gemini", for messages shown to the student. */
export function providerName(): string {
  return provider() === "gemini" ? "Gemini" : "Claude";
}

/** The model in use, for display. */
export function activeModel(): string | null {
  const p = provider();
  return p === "claude" ? MODEL : p === "gemini" ? GEMINI_MODEL : null;
}

let client: Anthropic | null = null;
let gemini: GoogleGenAI | null = null;

function anthropic(): Anthropic {
  // Routes stop at 300s, so give up a little before that instead of the SDK's 10 minute default.
  if (!client) client = new Anthropic({ maxRetries: 4, timeout: 280_000 });
  return client;
}

/** The incoming request's abort signal, so a closed tab stops the Claude call (set by `handle`). */
export const requestSignal = new AsyncLocalStorage<AbortSignal>();

const SYSTEM = `You are ziLearn, an expert university tutor and instructional designer.
You turn a student's course materials into well-structured study resources.
Ground everything in the provided materials; when you add general knowledge to fill gaps, keep it accurate and standard for the subject.
Write clearly for a university student.
When asked for a Markdown document, output only the document itself: no preamble, no closing remarks.`;

// Server-side fallback reruns a request on another model if the primary declines it.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export class AIRefusalError extends Error {}

/** Gemini's answer could not be read as the requested JSON. */
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
      model: MODEL,
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
  if (!gemini) gemini = new GoogleGenAI({ apiKey: geminiKey(), httpOptions: { timeout: 280_000, retryOptions: { attempts: 4 } } });
  return gemini;
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
    model: GEMINI_MODEL,
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

/* ---------------- Public API ---------------- */

/** Ask the AI for JSON matching a Zod schema. Streamed so large outputs don't hit non-streaming limits. */
export async function generateStructured<T extends z.ZodType>(opts: CallOpts & { schema: T }): Promise<z.infer<T>> {
  if (provider() === "gemini") {
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
  if (provider() === "gemini") return geminiCall(opts);
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
    if (err.status === 404) return `Gemini model "${GEMINI_MODEL}" was not found. Set GEMINI_MODEL to a model your key can use.`;
    if (err.status === 429) return "Gemini is rate limited or out of quota right now. Try again in a minute.";
    if (err.status >= 500) return "Gemini is overloaded right now. Try again shortly.";
    return `Gemini rejected the request: ${err.message.slice(0, 300)}`;
  }
  if (err instanceof Error && err.name === "AbortError") return "Cancelled.";
  if (err instanceof Anthropic.APIUserAbortError) return "Cancelled.";
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key is invalid.";
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
  if (err instanceof GeminiApiError) return err.status === 429 ? 429 : err.status >= 500 ? 503 : 502;
  if (err instanceof AIRefusalError) return 422;
  if (err instanceof Anthropic.RateLimitError) return 429;
  if (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500)) return 503;
  return 500;
}
