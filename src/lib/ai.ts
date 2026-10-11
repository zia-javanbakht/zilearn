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
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM = `You are ziLearn, an expert university tutor and instructional designer.
You turn a student's course materials into well-structured study resources.
Ground everything in the provided materials; when you add general knowledge to fill gaps, keep it accurate and standard for the subject.
Write clearly for a university student.`;

// Server-side fallback reruns a request on another model if the primary declines it.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export class AIRefusalError extends Error {}

export type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

/** Ask Claude for JSON matching a Zod schema. */
export async function generateStructured<T extends z.ZodType>(opts: {
  schema: T;
  prompt: string | ContentBlock[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const content = typeof opts.prompt === "string" ? [{ type: "text" as const, text: opts.prompt }] : opts.prompt;
  const message = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: SYSTEM,
    ...FALLBACK,
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content }],
  });
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

/** Ask Claude for free-form Markdown. Streams under the hood so long answers don't time out. */
export async function generateText(opts: {
  prompt: string | ContentBlock[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<string> {
  const content = typeof opts.prompt === "string" ? [{ type: "text" as const, text: opts.prompt }] : opts.prompt;
  const stream = anthropic().beta.messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 32000,
    system: SYSTEM,
    ...FALLBACK,
    output_config: { effort: opts.effort ?? "medium" },
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new AIRefusalError("Claude declined this request.");
  return message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Human-readable message for an API failure, without leaking internals. */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof AIRefusalError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key is invalid.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limited right now. Try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Claude API.";
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? "unknown"}).`;
  return err instanceof Error ? err.message : String(err);
}
