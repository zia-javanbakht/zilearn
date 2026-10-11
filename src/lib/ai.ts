import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * Thin wrapper around the Claude API. Every feature in ziLearn has an offline
 * heuristic fallback, so callers check `aiEnabled()` and degrade gracefully.
 */

export const MODEL = process.env.ZILEARN_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

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

function stream(opts: CallOpts, format?: ReturnType<typeof betaZodOutputFormat>) {
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

/** Ask Claude for JSON matching a Zod schema. Streamed so large outputs don't hit the non-streaming limit. */
export async function generateStructured<T extends z.ZodType>(opts: CallOpts & { schema: T }): Promise<z.infer<T>> {
  const message = await stream(opts, betaZodOutputFormat(opts.schema)).finalMessage();
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

/** Ask Claude for free-form Markdown. `truncated` is set when the answer hit the length limit. */
export async function generateText(opts: CallOpts): Promise<{ text: string; truncated: boolean }> {
  const message = await stream(opts).finalMessage();
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
  if (err instanceof AIRefusalError || err instanceof UserError) return err.message;
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
  if (err instanceof AIRefusalError) return 422;
  if (err instanceof Anthropic.RateLimitError) return 429;
  if (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500)) return 503;
  return 500;
}
