import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { openDb, setDb } from "@/lib/db";
import { emptySettings, getSettings, maskKey, saveSettings, withSettings, type Settings } from "@/lib/settings";
import * as ai from "@/lib/ai";

const env = { ...process.env };
const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "ZILEARN_PROVIDER", "ZILEARN_MODEL", "GEMINI_MODEL"];

beforeEach(() => {
  setDb(openDb(":memory:"));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("settings store", () => {
  it("starts on Automatic with nothing saved", () => {
    expect(getSettings()).toEqual(emptySettings());
  });

  it("saves, trims and reads back; missing fields stay, empty strings clear", () => {
    saveSettings({ provider: "gemini", gemini: { key: "  AIzaSyEXAMPLEKEY1234  ", model: "gemini-pro-latest" } });
    expect(getSettings().provider).toBe("gemini");
    expect(getSettings().gemini).toEqual({ key: "AIzaSyEXAMPLEKEY1234", model: "gemini-pro-latest" });

    saveSettings({ anthropic: { key: "sk-ant-api03-secret-abcd" } });
    expect(getSettings().gemini.key).toBe("AIzaSyEXAMPLEKEY1234"); // untouched
    expect(getSettings().provider).toBe("gemini");

    saveSettings({ gemini: { key: "" }, openai: { baseUrl: "http://localhost:11434/v1/" } });
    expect(getSettings().gemini).toEqual({ key: "", model: "gemini-pro-latest" });
    expect(getSettings().openai.baseUrl).toBe("http://localhost:11434/v1"); // trailing slash dropped

    saveSettings({ provider: "auto" });
    expect(getSettings().provider).toBe("auto");
  });

  it("masks keys for display", () => {
    expect(maskKey("sk-ant-api03-0123456789abcd")).toBe("sk-…abcd");
    expect(maskKey("short-key")).toBe("…ey");
    expect(maskKey("")).toBe("");
  });

  it("never returns a full key from the summary, and says where each key came from", () => {
    process.env.GEMINI_API_KEY = "AIzaSyENVIRONMENTKEY9876";
    saveSettings({ anthropic: { key: "sk-ant-api03-SAVEDSECRET-wxyz" } });
    const s = ai.settingsSummary();
    const json = JSON.stringify(s);
    expect(json).not.toContain("SAVEDSECRET");
    expect(json).not.toContain("ENVIRONMENTKEY");
    expect(s.anthropic).toMatchObject({ hasKey: true, maskedKey: "sk-…wxyz", keySource: "saved", model: "", defaultModel: "claude-opus-5-5" });
    expect(s.gemini).toMatchObject({ hasKey: true, maskedKey: "AIz…9876", keySource: "environment" });
    expect(s.openai).toMatchObject({ hasKey: false, keySource: null, defaultBaseUrl: ai.OPENAI_BASE_URL });
    expect(s.active).toEqual({ provider: "claude", name: "Claude", model: "claude-opus-5-5" });
  });
});

describe("provider selection", () => {
  it("Automatic keeps the environment behaviour", () => {
    expect(ai.aiEnabled()).toBe(false);
    process.env.GEMINI_API_KEY = "g";
    expect(ai.provider()).toBe("gemini");
    process.env.ANTHROPIC_API_KEY = "a";
    expect(ai.provider()).toBe("claude");
    process.env.ZILEARN_PROVIDER = "gemini";
    expect(ai.provider()).toBe("gemini");
  });

  it("an OPENAI_API_KEY alone is only used when asked for", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    expect(ai.provider()).toBe(null);
    process.env.ZILEARN_PROVIDER = "openai";
    expect(ai.provider()).toBe("openai");
    expect(ai.providerName()).toBe("OpenAI");
  });

  it("saved keys count in Automatic and win over the environment for their provider", () => {
    saveSettings({ gemini: { key: "saved-gemini-key" } });
    expect(ai.provider()).toBe("gemini");
    process.env.ANTHROPIC_API_KEY = "env-claude";
    expect(ai.provider()).toBe("claude"); // Claude first, as before
    expect(ai.settingsSummary().anthropic.keySource).toBe("environment");
    saveSettings({ anthropic: { key: "saved-claude-key-1234" } });
    expect(ai.settingsSummary().anthropic.keySource).toBe("saved");
  });

  it("a provider picked in Settings is used only with a key, whatever the environment says", () => {
    process.env.ANTHROPIC_API_KEY = "env-claude";
    saveSettings({ provider: "gemini" });
    expect(ai.provider()).toBe(null); // no Gemini key: offline rather than a surprise provider
    process.env.GEMINI_API_KEY = "env-gemini";
    expect(ai.provider()).toBe("gemini");
    saveSettings({ provider: "anthropic", anthropic: { model: "claude-sonnet-custom" } });
    expect(ai.provider()).toBe("claude");
    expect(ai.activeModel()).toBe("claude-sonnet-custom");
  });

  it("Built-in turns AI off even with keys", () => {
    process.env.ANTHROPIC_API_KEY = "env-claude";
    saveSettings({ provider: "builtin", gemini: { key: "saved" } });
    expect(ai.aiEnabled()).toBe(false);
    expect(ai.activeModel()).toBe(null);
  });

  it("models: saved, then environment, then the default", () => {
    process.env.GEMINI_API_KEY = "g";
    expect(ai.activeModel()).toBe("gemini-flash-latest");
    process.env.GEMINI_MODEL = "gemini-env-model";
    expect(ai.activeModel()).toBe("gemini-env-model");
    saveSettings({ gemini: { model: "gemini-saved-model" } });
    expect(ai.activeModel()).toBe("gemini-saved-model");
  });

  it("a local OpenAI-compatible server needs only a base URL, and is named after it", () => {
    saveSettings({ provider: "openai", openai: { baseUrl: "http://localhost:11434/v1", model: "llama3.2" } });
    expect(ai.provider()).toBe("openai");
    expect(ai.providerName()).toBe("Ollama");
    expect(ai.activeModel()).toBe("llama3.2");
    saveSettings({ openai: { baseUrl: "" } });
    expect(ai.provider()).toBe(null); // plain OpenAI without a key
    expect(ai.openaiLabel("https://openrouter.ai/api/v1")).toBe("OpenRouter");
    expect(ai.openaiLabel("http://127.0.0.1:1234/v1")).toBe("LM Studio");
    expect(ai.openaiLabel("https://llm.example.edu/v1")).toBe("llm.example.edu");
  });
});

/* ---------------- OpenAI-compatible calls ---------------- */

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: { role: string; content: unknown }[];
    max_tokens?: number;
    max_completion_tokens?: number;
    response_format?: { type: string; json_schema?: { name: string; schema: Record<string, unknown> } };
  };
}

/** Mock fetch: answers in order, recording each request. */
function mockFetch(...answers: (Response | (() => Response))[]) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw init.signal.reason;
      sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      const a = answers.shift();
      if (!a) throw new Error("unexpected extra request");
      return typeof a === "function" ? a() : a;
    }),
  );
  return sent;
}

const reply = (content: string, finish = "stop") => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: finish }] }), { status: 200 });
const error = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json", ...headers } });

const Schema = z.object({ items: z.array(z.object({ name: z.string().describe("Topic name"), n: z.number().int().nullable() })) });

describe("OpenAI-compatible calls", () => {
  beforeEach(() => {
    saveSettings({ provider: "openai", openai: { key: "sk-test-key-0000", model: "gpt-test" } });
  });

  it("posts a chat completion with a JSON schema and validates the answer", async () => {
    const sent = mockFetch(reply('{"items":[{"name":"Entropy","n":null}]}'));
    const out = await ai.generateStructured({ schema: Schema, context: "<course_sources>…</course_sources>", prompt: "List topics", maxTokens: 1234 });
    expect(out).toEqual({ items: [{ name: "Entropy", n: null }] });
    const [req] = sent;
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers.authorization).toBe("Bearer sk-test-key-0000");
    expect(req.body.model).toBe("gpt-test");
    expect(req.body.max_completion_tokens).toBe(1234); // OpenAI's own API
    expect(req.body.messages[0].role).toBe("system");
    expect(req.body.messages[1]).toEqual({ role: "user", content: "<course_sources>…</course_sources>\n\nList topics" });
    expect(req.body.response_format?.type).toBe("json_schema");
    expect(req.body.response_format?.json_schema?.name).toBe("response");
    expect(JSON.stringify(req.body.response_format?.json_schema?.schema)).toContain('"description":"Topic name"');
    expect(req.body.response_format?.json_schema?.schema).not.toHaveProperty("$schema");
  });

  it("uses max_tokens and no auth header for a local server", async () => {
    saveSettings({ openai: { key: "", baseUrl: "http://localhost:1234/v1" } });
    const sent = mockFetch(reply("# Notes"));
    expect(await ai.generateText({ prompt: "Write notes", maxTokens: 500 })).toEqual({ text: "# Notes", truncated: false });
    expect(sent[0].url).toBe("http://localhost:1234/v1/chat/completions");
    expect(sent[0].headers.authorization).toBeUndefined();
    expect(sent[0].body.max_tokens).toBe(500);
    expect(sent[0].body.max_completion_tokens).toBeUndefined();
    expect(sent[0].body.response_format).toBeUndefined();
  });

  it("falls back to json_object with the schema in the prompt when json_schema is rejected", async () => {
    const sent = mockFetch(error(400, "response_format json_schema is not supported"), reply('```json\n{"items":[{"name":"Waves","n":2}]}\n```'));
    const out = await ai.generateStructured({ schema: Schema, prompt: "List topics" });
    expect(out).toEqual({ items: [{ name: "Waves", n: 2 }] });
    expect(sent).toHaveLength(2);
    expect(sent[1].body.response_format).toEqual({ type: "json_object" });
    const prompt = sent[1].body.messages[1].content as string;
    expect(prompt).toContain("List topics");
    expect(prompt).toContain("JSON Schema");
    expect(prompt).toContain('"description":"Topic name"');
  });

  it("rejects JSON that doesn't match the schema", async () => {
    mockFetch(reply('{"items":[{"name":3}]}'));
    await expect(ai.generateStructured({ schema: Schema, prompt: "x" })).rejects.toThrow(/unexpected response/);
  });

  it("reports cut-offs, refusals and strips inline thinking", async () => {
    mockFetch(reply("Half a lesson", "length"), reply("", "content_filter"), reply("<think>hmm</think>\n\nThe answer"));
    expect(await ai.generateText({ prompt: "x" })).toEqual({ text: "Half a lesson", truncated: true });
    await expect(ai.generateText({ prompt: "x" })).rejects.toThrow(/declined/);
    expect((await ai.generateText({ prompt: "x" })).text).toBe("The answer");
  });

  it("sends images and PDFs as content parts", async () => {
    const sent = mockFetch(reply("Transcript"));
    await ai.generateText({
      prompt: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBO" } },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "UERG" } },
        { type: "text", text: "Transcribe" },
      ],
    });
    expect(sent[0].body.messages[1].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBO" } },
      { type: "file", file: { filename: "document.pdf", file_data: "data:application/pdf;base64,UERG" } },
      { type: "text", text: "Transcribe" },
    ]);
  });

  it("retries rate limits, then explains errors in plain words", async () => {
    const sent = mockFetch(error(429, "slow down", { "retry-after": "0" }), reply("ok"));
    expect((await ai.generateText({ prompt: "x" })).text).toBe("ok");
    expect(sent).toHaveLength(2);

    mockFetch(error(401, "Incorrect API key provided"));
    const err = await ai.generateText({ prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ai.OpenAICompatError);
    expect(ai.aiErrorMessage(err)).toBe("The API key for OpenAI is invalid or not allowed to use this model.");
    expect(ai.errorStatus(err)).toBe(502);

    mockFetch(error(404, "model not found"));
    expect(ai.aiErrorMessage(await ai.generateText({ prompt: "x" }).catch((e) => e))).toMatch(/could not find model "gpt-test"/);
  });

  it("stops when the request is cancelled", async () => {
    mockFetch(reply("never"));
    const ctl = new AbortController();
    ctl.abort();
    const err = await ai.requestSignal.run(ctl.signal, () => ai.generateText({ prompt: "x" })).catch((e) => e);
    expect(ai.aiErrorMessage(err)).toBe("Cancelled.");
  });
});

describe("test connection", () => {
  it("tests unsaved values without storing them", async () => {
    const sent = mockFetch(reply("OK"));
    const draft: Settings = { ...emptySettings(), provider: "openai", openai: { key: "", model: "llama3.2", baseUrl: "http://localhost:11434/v1" } };
    const r = await withSettings(draft, ai.testConnection);
    expect(r).toEqual({ provider: "openai", name: "Ollama", model: "llama3.2", reply: "OK" });
    expect(sent[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(getSettings().provider).toBe("auto"); // nothing was saved
  });

  it("explains what is missing instead of calling anything", async () => {
    await expect(withSettings({ ...emptySettings(), provider: "builtin" }, ai.testConnection)).rejects.toThrow(/needs no connection/);
    await expect(withSettings({ ...emptySettings(), provider: "gemini" }, ai.testConnection)).rejects.toThrow(/Add a Gemini API key/);
    await expect(withSettings(emptySettings(), ai.testConnection)).rejects.toThrow(/No API key was found/);
  });
});
