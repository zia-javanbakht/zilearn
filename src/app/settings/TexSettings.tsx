"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";

interface TexSetup {
  engine: string | null;
  engines: string[];
  z: { found: boolean; dir: string | null; from: "tex" | "settings" | "env" | "nearby" | null };
  saved: string | null;
  warning?: string;
  test?: { ok: boolean; engine?: string; note?: string | null; seconds?: number; error?: string };
}

const ENGINE_NAMES: Record<string, string> = { xelatex: "XeLaTeX", lualatex: "LuaLaTeX", tectonic: "Tectonic", pdflatex: "pdfLaTeX" };
const name = (e: string) => ENGINE_NAMES[e] ?? e;

/** Where lessons, review notes and summaries are compiled to PDF: the TeX engine and the Z class. */
export function TexSettings() {
  const [setup, setSetup] = useState<TexSetup | null>(null);
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "look" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(kind: "save" | "test" | "look", fn: () => Promise<TexSetup>) {
    setBusy(kind);
    setError(null);
    try {
      const s = await fn();
      setSetup(s);
      if (kind !== "test") setDir(s.saved ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    call("look", () => api<TexSetup>("/api/settings/tex"));
  }, []);

  const z = setup?.z;
  const where = !z?.found
    ? "Not found. PDFs use ziLearn's stand-in layout with the same boxes; point this at your Z folder to print with Z."
    : z.from === "tex"
      ? "Installed in TeX."
      : `Found in ${z.dir}${z.from === "settings" ? "" : z.from === "env" ? " (from Z_TEX_DIR)" : " (found on its own)"}.`;

  return (
    <section className="settings stack" style={{ marginTop: 24 }} aria-labelledby="tex-head">
      <div>
        <h2 id="tex-head">PDF export (LaTeX)</h2>
        <p className="muted small">
          Lessons, review notes and summaries export as LaTeX for your Z class, and ziLearn compiles them to PDF with the TeX installed on the computer that runs it.
          Without TeX, use Export, then Print from browser.
        </p>
      </div>
      {!setup ? (
        <p className="small muted">{busy ? "Looking for TeX…" : error}</p>
      ) : (
        <ul className="plain-list small">
          <li className="spread">
            <span>TeX engine</span>
            <span className={`badge ${setup.engine ? "know" : "dont_know"}`}>
              {setup.engine ? `${name(setup.engine)}${setup.engines.length > 1 ? ` (also ${setup.engines.slice(1).map(name).join(", ")})` : ""}` : "None found"}
            </span>
          </li>
          {!setup.engine && (
            <li className="muted">Install TeX Live (or MacTeX, or MiKTeX on Windows), or the single program Tectonic, then press Look again.</li>
          )}
          <li className="spread">
            <span>Z class</span>
            <span className={`badge ${z?.found ? "know" : "familiar"}`}>{z?.found ? "Found" : "Not found"}</span>
          </li>
          <li className="muted">{where}</li>
        </ul>
      )}
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          call("save", () => api<TexSetup>("/api/settings/tex", { method: "PUT", json: { zDir: dir } }));
        }}
      >
        <label htmlFor="zdir">Z class folder (its tex/latex folder)</label>
        <div className="row">
          <input id="zdir" className="grow" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="e.g. /Users/you/z/tex/latex" spellCheck={false} autoCapitalize="off" />
          <button type="submit" disabled={!!busy || dir.trim() === (setup?.saved ?? "")}>
            {busy === "save" ? "Saving…" : dir.trim() || !setup?.saved ? "Save" : "Clear"}
          </button>
        </div>
      </form>
      {setup?.warning && <div className="alert">{setup.warning}</div>}
      {error && setup && <div className="alert error">{error}</div>}
      <div className="row">
        <button type="button" disabled={!!busy || !setup?.engine} onClick={() => call("test", () => api<TexSetup>("/api/settings/tex", { method: "POST" }))}>
          {busy === "test" && <span className="spinner" role="status" aria-label="Compiling" />} Make a test PDF
        </button>
        <button type="button" disabled={!!busy} onClick={() => call("look", () => api<TexSetup>("/api/settings/tex?fresh=1"))}>
          Look again
        </button>
      </div>
      {setup?.test && (
        <div className={`alert ${setup.test.ok ? (setup.test.note ? "info" : "success") : "error"}`} role="status" style={{ whiteSpace: "pre-wrap" }}>
          {setup.test.ok ? `Made a test PDF with ${name(setup.test.engine ?? "")} in ${setup.test.seconds} s. ${setup.test.note ?? "It used your Z class."}` : setup.test.error}
        </div>
      )}
    </section>
  );
}
