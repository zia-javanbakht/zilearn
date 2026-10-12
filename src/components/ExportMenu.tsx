"use client";

import { useRef, useState } from "react";
import { downloadExport, ExportError, printElement, saveBlob } from "./texExport";

/**
 * Export menu for anything ziLearn writes as LaTeX: a PDF compiled on this computer (with the Z class
 * when it is found), the .tex itself, the Markdown, and printing the page from the browser, which
 * makes a PDF even without TeX.
 */
export function ExportMenu({
  url,
  title,
  markdown,
  printTarget,
  disabled,
}: {
  /** The print route, without the format. */
  url: string;
  title: string;
  markdown?: string;
  /** What "Print from browser" prints. */
  printTarget?: () => HTMLElement | null;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState<"pdf" | "tex" | null>(null);
  const [msg, setMsg] = useState<{
    text: string;
    error?: boolean;
    noTex?: boolean;
  } | null>(null);

  async function get(format: "pdf" | "tex") {
    ref.current?.removeAttribute("open");
    setBusy(format);
    setMsg(null);
    try {
      const note = await downloadExport(url, format);
      if (note) setMsg({ text: note });
    } catch (e) {
      setMsg({
        text: (e as Error).message,
        error: true,
        noTex: e instanceof ExportError && e.noTex,
      });
    } finally {
      setBusy(null);
    }
  }

  const print = () => {
    ref.current?.removeAttribute("open");
    const el = printTarget?.();
    if (el) printElement(el, title);
  };
  const fileBase = title.replace(/[\\/:*?"<>|]+/g, "_");

  return (
    <div className="export-menu no-print">
      <details className="menu" ref={ref}>
        <summary className="btn sm" aria-disabled={disabled || !!busy}>
          {busy === "pdf" ? "Making the PDF…" : busy === "tex" ? "Making the LaTeX…" : "Export ▾"}
        </summary>
        <div className="menu-list">
          <button
            className="sm"
            disabled={disabled || !!busy}
            onClick={() => get("pdf")}
            title="Compile a PDF with LaTeX on this computer, using your Z class when ziLearn finds it"
          >
            PDF (LaTeX)
          </button>
          <button className="sm" disabled={disabled || !!busy} onClick={() => get("tex")} title="The LaTeX source, for the Z class">
            LaTeX (.tex)
          </button>
          {markdown !== undefined && (
            <button
              className="sm"
              disabled={disabled}
              onClick={() => {
                ref.current?.removeAttribute("open");
                saveBlob(new Blob([markdown], { type: "text/markdown" }), `${fileBase}.md`);
              }}
            >
              Markdown (.md)
            </button>
          )}
          {printTarget && (
            <button className="sm" disabled={disabled} onClick={print} title="Print what you see here; choose Save as PDF in the print dialog">
              Print from browser
            </button>
          )}
        </div>
      </details>
      {msg && (
        <div className={`small export-msg${msg.error ? " error" : ""}`} role={msg.error ? "alert" : "status"}>
          <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
          {msg.noTex && printTarget && (
            <>
              {" "}
              <button className="link small" onClick={print}>
                Print from the browser instead
              </button>
            </>
          )}{" "}
          <button className="link small" onClick={() => setMsg(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
