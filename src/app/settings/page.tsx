"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { SETTINGS_CHANGED } from "@/components/AiBadge";
import { TexSettings } from "./TexSettings";

type Choice = "builtin" | "auto" | "anthropic" | "gemini" | "openai";
type Keyed = "anthropic" | "gemini" | "openai";
type Source = "saved" | "environment" | null;

interface ProviderView {
  hasKey: boolean;
  maskedKey: string;
  keySource: Source;
  model: string;
  defaultModel: string;
}

interface Summary {
  provider: Choice;
  active: { provider: string; name: string; model: string } | null;
  anthropic: ProviderView;
  gemini: ProviderView;
  openai: ProviderView & { baseUrl: string; baseUrlSource: Source; defaultBaseUrl: string };
}

interface Draft {
  key: string;
  clearKey: boolean;
  model: string;
  baseUrl: string;
}

type Notice = { kind: "success" | "error" | "info"; text: string } | null;

const CHOICES: { id: Choice; title: string; blurb: string }[] = [
  {
    id: "builtin",
    title: "Built-in",
    blurb: "Works offline, free and private. Simple helpers build brainmaps, lessons and quizzes from your headings and summaries. Nothing leaves this device.",
  },
  {
    id: "auto",
    title: "Automatic",
    blurb: "Uses the API keys set in the server's environment (for example .env.local), Claude first, then Gemini. Keys saved here count too.",
  },
  {
    id: "anthropic",
    title: "Anthropic Claude",
    blurb: "Best quality for lessons, mock exams and marking. Needs an Anthropic API key.",
  },
  {
    id: "gemini",
    title: "Google Gemini",
    blurb: "Fast, with a free tier. It can also transcribe YouTube videos that have no captions. Needs a Gemini API key.",
  },
  {
    id: "openai",
    title: "OpenAI-compatible",
    blurb: "OpenAI, OpenRouter, or a model running on your own computer with Ollama or LM Studio.",
  },
];

const KEY_LINKS: Record<Keyed, { href: string; label: string }> = {
  anthropic: { href: "https://console.anthropic.com/settings/keys", label: "Get an Anthropic key" },
  gemini: { href: "https://aistudio.google.com/apikey", label: "Get a Gemini key" },
  openai: { href: "https://platform.openai.com/api-keys", label: "Get an OpenAI key" },
};

const PRESETS: { label: string; url: string; model?: string }[] = [
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1", model: "openai/gpt-5-mini" },
  { label: "Ollama", url: "http://localhost:11434/v1", model: "llama3.2" },
  { label: "LM Studio", url: "http://localhost:1234/v1" },
];

const NAMES: Record<Keyed, string> = { anthropic: "Anthropic", gemini: "Gemini", openai: "the OpenAI-compatible server" };

function draftsFrom(s: Summary): Record<Keyed, Draft> {
  return {
    anthropic: { key: "", clearKey: false, model: s.anthropic.model, baseUrl: "" },
    gemini: { key: "", clearKey: false, model: s.gemini.model, baseUrl: "" },
    openai: { key: "", clearKey: false, model: s.openai.model, baseUrl: s.openai.baseUrl },
  };
}

function keyStatus(v: ProviderView): { label: string; cls: string } {
  if (v.keySource === "saved") return { label: "Key saved", cls: "know" };
  if (v.keySource === "environment") return { label: "Key from environment", cls: "accent" };
  return { label: "No key", cls: "" };
}

export default function SettingsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [choice, setChoice] = useState<Choice>("auto");
  const [drafts, setDrafts] = useState<Record<Keyed, Draft> | null>(null);
  const [shown, setShown] = useState<Record<Keyed, boolean>>({ anthropic: false, gemini: false, openai: false });
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  function apply(s: Summary) {
    setSummary(s);
    setChoice(s.provider);
    setDrafts(draftsFrom(s));
  }

  useEffect(() => {
    api<Summary>("/api/settings")
      .then(apply)
      .catch((e) => setNotice({ kind: "error", text: (e as Error).message }));
  }, []);

  function edit(p: Keyed, patch: Partial<Draft>) {
    setDrafts((d) => (d ? { ...d, [p]: { ...d[p], ...patch } } : d));
    setNotice(null);
  }

  function payload() {
    const part = (p: Keyed) => {
      const d = drafts![p];
      const key = d.key.trim() ? { key: d.key.trim() } : d.clearKey ? { key: "" } : {};
      return { model: d.model.trim(), ...key, ...(p === "openai" ? { baseUrl: d.baseUrl.trim() } : {}) };
    };
    return { provider: choice, anthropic: part("anthropic"), gemini: part("gemini"), openai: part("openai") };
  }

  async function save() {
    setBusy("save");
    setNotice(null);
    try {
      const s = await api<Summary>("/api/settings", { method: "PUT", json: payload() });
      apply(s);
      window.dispatchEvent(new Event(SETTINGS_CHANGED));
      const using = s.active ? `ziLearn now uses ${s.active.name} (${s.active.model}).` : "ziLearn now uses its built-in offline helpers.";
      const missing = !s.active && (s.provider === "anthropic" || s.provider === "gemini" || s.provider === "openai");
      setNotice(
        missing
          ? { kind: "info", text: `Saved. ${NAMES[s.provider as Keyed]} has no key yet, so the built-in offline helpers are used until you add one.` }
          : { kind: "success", text: `Saved. ${using}` },
      );
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setNotice({ kind: "info", text: "Testing the connection. This can take a few seconds." });
    try {
      const r = await api<{ name: string; model: string; reply: string }>("/api/settings/test", { method: "POST", json: payload() });
      const said = r.reply ? ` It replied: "${r.reply}".` : "";
      setNotice({ kind: "success", text: `Connected to ${r.name} using ${r.model}.${said} Remember to save if you changed anything.` });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!summary || !drafts)
    return (
      <div className="settings stack">
        <h1>Settings</h1>
        {notice ? <div className={`alert ${notice.kind}`}>{notice.text}</div> : <p className="muted">Loading…</p>}
      </div>
    );

  const views: Record<Keyed, ProviderView> = { anthropic: summary.anthropic, gemini: summary.gemini, openai: summary.openai };

  function details(p: Keyed) {
    const d = drafts![p];
    const v = views[p];
    const keyId = `key-${p}`;
    const savedHint =
      v.keySource === "saved" && !d.clearKey
        ? `Saved key ${v.maskedKey}. Type a new one to replace it.`
        : v.keySource === "environment"
          ? `Using ${v.maskedKey} from the environment. Type a key to use a different one here.`
          : null;
    return (
      <div className="choice-body">
        <div className="field">
          <label htmlFor={keyId}>API key{p === "openai" ? " (not needed for Ollama or LM Studio)" : ""}</label>
          <div className="keyfield">
            <input
              id={keyId}
              type={shown[p] ? "text" : "password"}
              value={d.key}
              onChange={(e) => edit(p, { key: e.target.value, clearKey: false })}
              placeholder={v.keySource === "saved" && !d.clearKey ? v.maskedKey : "Paste your key"}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="button" onClick={() => setShown({ ...shown, [p]: !shown[p] })} aria-pressed={shown[p]} aria-controls={keyId}>
              {shown[p] ? "Hide" : "Show"}
            </button>
          </div>
          <span className="small muted">
            {d.clearKey ? "The saved key will be removed when you save." : savedHint ?? "Saved only in this computer's ziLearn database."}{" "}
            <a href={KEY_LINKS[p].href} target="_blank" rel="noreferrer">
              {KEY_LINKS[p].label}
            </a>
          </span>
          {v.keySource === "saved" && !d.clearKey && (
            <div>
              <button type="button" className="sm danger" onClick={() => edit(p, { key: "", clearKey: true })}>
                Remove saved key
              </button>
            </div>
          )}
        </div>

        {p === "openai" && (
          <div className="field">
            <label htmlFor="base-openai">Base URL</label>
            <input
              id="base-openai"
              type="url"
              inputMode="url"
              value={d.baseUrl}
              onChange={(e) => edit(p, { baseUrl: e.target.value })}
              placeholder={summary!.openai.defaultBaseUrl}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="row presets">
              {PRESETS.map((pr) => (
                <button
                  key={pr.label}
                  type="button"
                  className="sm"
                  onClick={() => edit(p, { baseUrl: pr.url, ...(pr.model && !d.model ? { model: pr.model } : {}) })}
                >
                  {pr.label}
                </button>
              ))}
            </div>
            <span className="small muted">Leave empty for OpenAI. Any server that speaks the OpenAI chat completions API works.</span>
          </div>
        )}

        <div className="field">
          <label htmlFor={`model-${p}`}>Model</label>
          <input
            id={`model-${p}`}
            value={d.model}
            onChange={(e) => edit(p, { model: e.target.value })}
            placeholder={v.defaultModel}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="small muted">Leave empty to use {v.defaultModel}.</span>
        </div>
      </div>
    );
  }

  function autoDetails() {
    const rows: [string, ProviderView][] = [
      ["Anthropic Claude", summary!.anthropic],
      ["Google Gemini", summary!.gemini],
      ["OpenAI-compatible", summary!.openai],
    ];
    return (
      <div className="choice-body">
        <ul className="plain-list">
          {rows.map(([name, v]) => (
            <li key={name} className="spread">
              <span>{name}</span>
              <span className={`badge ${keyStatus(v).cls}`}>{keyStatus(v).label}</span>
            </li>
          ))}
        </ul>
        <span className="small muted">To add or change a key, pick that provider above, enter it, then switch back to Automatic if you like.</span>
      </div>
    );
  }

  return (
    <>
      <form
        className="settings stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Choose which AI ziLearn uses to build brainmaps, lessons, mock exams, notes, flashcards and podcasts. Without one, ziLearn still works with
            its built-in helpers.
          </p>
          <p className="small">
            <span className="muted">Now using: </span>
            {summary.active ? (
              <strong>
                {summary.active.name} ({summary.active.model})
              </strong>
            ) : (
              <strong>Built-in offline helpers</strong>
            )}
          </p>
        </div>

        <fieldset className="choice-list">
          <legend>AI provider</legend>
          {CHOICES.map((c) => {
            const keyed = c.id === "anthropic" || c.id === "gemini" || c.id === "openai";
            const status = keyed ? keyStatus(views[c.id as Keyed]) : null;
            const on = choice === c.id;
            return (
              <div key={c.id} className={`choice${on ? " on" : ""}`}>
                <label className="choice-head">
                  <input
                    type="radio"
                    name="provider"
                    value={c.id}
                    checked={on}
                    onChange={() => {
                      setChoice(c.id);
                      setNotice(null);
                    }}
                  />
                  <span className="grow">
                    <span className="choice-title">
                      {c.title}
                      {c.id === summary.provider && <span className="badge accent">Current</span>}
                      {status && <span className={`badge ${status.cls}`}>{status.label}</span>}
                    </span>
                    <span className="choice-blurb small muted">{c.blurb}</span>
                  </span>
                </label>
                {on && keyed && details(c.id as Keyed)}
                {on && c.id === "auto" && autoDetails()}
              </div>
            );
          })}
        </fieldset>

        {notice && (
          <div className={`alert ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
            {notice.text}
          </div>
        )}

        <div className="row settings-actions">
          <button type="submit" className="primary" disabled={busy !== null}>
            {busy === "save" && <span className="spinner" role="status" aria-label="Saving" />} Save
          </button>
          <button type="button" onClick={test} disabled={busy !== null || choice === "builtin"}>
            {busy === "test" && <span className="spinner" role="status" aria-label="Testing" />} Test connection
          </button>
        </div>
        <p className="small muted">
          Keys are stored only in the ziLearn database on the computer that runs ziLearn, and are never shown in full again. Keys saved here are used
          instead of the ones in the environment.
        </p>
      </form>
      <TexSettings />
    </>
  );
}
