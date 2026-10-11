import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// A stand-in for the Gemini SDK: each test sets the chunks the "stream" yields.
const calls: unknown[] = [];
let chunks: unknown[] = [];
vi.mock("@google/genai", async (orig) => {
  const real = await orig<typeof import("@google/genai")>();
  class GoogleGenAI {
    models = {
      generateContentStream: async (req: unknown) => {
        calls.push(req);
        return (async function* () {
          yield* chunks;
        })();
      },
    };
  }
  return { ...real, GoogleGenAI };
});

const ai = await import("@/lib/ai");
const env = { ...process.env };

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ZILEARN_PROVIDER;
  process.env.GEMINI_API_KEY = "test-key";
  calls.length = 0;
});
afterEach(() => {
  process.env = { ...env };
});

describe("provider selection", () => {
  it("uses whichever key is set, Claude first, and ZILEARN_PROVIDER decides when both are", () => {
    expect(ai.provider()).toBe("gemini");
    expect(ai.providerName()).toBe("Gemini");
    process.env.ANTHROPIC_API_KEY = "x";
    expect(ai.provider()).toBe("claude");
    process.env.ZILEARN_PROVIDER = "gemini";
    expect(ai.provider()).toBe("gemini");
    delete process.env.GEMINI_API_KEY;
    expect(ai.provider()).toBe("claude"); // asked for Gemini but there is no Gemini key
    delete process.env.ANTHROPIC_API_KEY;
    expect(ai.aiEnabled()).toBe(false);
  });
});

describe("Gemini calls", () => {
  const Schema = z.object({ items: z.array(z.object({ name: z.string().describe("Topic name"), n: z.number().int().nullable() })) });

  it("sends the cached context first, asks for JSON in the schema, and validates the answer", async () => {
    chunks = [{ text: '{"items":[{"name":"Entropy",' }, { text: '"n":null}]}', candidates: [{ finishReason: "STOP" }] }];
    const out = await ai.generateStructured({ schema: Schema, context: "<course_sources>…</course_sources>", prompt: "List topics", maxTokens: 1234 });
    expect(out).toEqual({ items: [{ name: "Entropy", n: null }] });
    const req = calls[0] as { contents: { parts: { text?: string }[] }[]; config: Record<string, unknown> };
    expect(req.contents[0].parts.map((p) => p.text)).toEqual(["<course_sources>…</course_sources>", "List topics"]);
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.maxOutputTokens).toBe(1234);
    expect(JSON.stringify(req.config.responseJsonSchema)).toContain('"description":"Topic name"');
    expect(req.config.responseJsonSchema).not.toHaveProperty("$schema");
  });

  it("rejects JSON that doesn't match the schema, and reports refusals and cut-offs", async () => {
    chunks = [{ text: '{"items":[{"name":3}]}' }];
    await expect(ai.generateStructured({ schema: Schema, prompt: "x" })).rejects.toThrow(/unexpected response/);
    chunks = [{ text: "", candidates: [{ finishReason: "SAFETY" }] }];
    await expect(ai.generateText({ prompt: "x" })).rejects.toThrow(/declined/);
    chunks = [{ text: "Half a lesson", candidates: [{ finishReason: "MAX_TOKENS" }] }];
    expect(await ai.generateText({ prompt: "x" })).toEqual({ text: "Half a lesson", truncated: true });
  });

  it("passes images and PDFs as inline data", async () => {
    chunks = [{ text: "# Notes" }];
    await ai.generateText({
      prompt: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "UERG" } },
        { type: "text", text: "Transcribe" },
      ],
    });
    const req = calls[0] as { contents: { parts: unknown[] }[] };
    expect(req.contents[0].parts).toEqual([{ inlineData: { mimeType: "application/pdf", data: "UERG" } }, { text: "Transcribe" }]);
  });

  it("produces Gemini-compatible schemas for every structured feature", () => {
    const s = ai.geminiSchema(z.object({ a: z.enum(["x", "y"]), b: z.array(z.string()), c: z.number().int().nullable() }));
    expect(s).toMatchObject({ type: "object", required: ["a", "b", "c"] });
  });
});
