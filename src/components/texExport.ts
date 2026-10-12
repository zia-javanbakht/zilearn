/* Downloading ziLearn's LaTeX exports (and the PDFs compiled from them), and printing a part of the page. */

export class ExportError extends Error {
  constructor(
    message: string,
    /** No TeX on the computer that runs ziLearn: printing from the browser is the way to a PDF. */
    public noTex: boolean,
  ) {
    super(message);
  }
}

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/**
 * Fetch `url` with `format=tex` or `format=pdf` and save the file. Resolves with the server's note
 * (e.g. that the stand-in class was used instead of Z), or null.
 */
export async function downloadExport(url: string, format: "tex" | "pdf"): Promise<string | null> {
  const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}format=${format}`);
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new ExportError(j?.error ?? `Couldn't make the ${format === "pdf" ? "PDF" : "LaTeX file"}.`, r.status === 501);
  }
  const name = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `ziLearn.${format}`;
  saveBlob(await r.blob(), name);
  const note = r.headers.get("x-zilearn-note");
  return note ? decodeURIComponent(note) : null;
}

/**
 * Print one element as it looks in the app (maths and all, always in the light theme) through the browser's print dialog, where
 * "Save as PDF" makes a PDF without TeX. It is printed from a hidden frame that has the page's styles.
 */
export function printElement(el: HTMLElement, title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((s) => s.outerHTML).join("\n");
  const safeTitle = title.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>${styles}<style>:root{--bg:#fff;--surface:#fff;--surface-2:#f1f3f9;--border:#e3e6ef;--text:#141a2e;--muted:#5d6680;--accent:#3b5bdb;--accent-soft:#e8edff;--shadow:none;color-scheme:light} body{background:#fff;padding:0 8mm} .no-print{display:none!important} @page{margin:15mm}</style></head><body><h1>${safeTitle}</h1>${el.outerHTML}</body></html>`,
  );
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  // Give the styles (and KaTeX's fonts) a moment to load.
  if (doc.readyState === "complete") setTimeout(go, 300);
  else frame.addEventListener("load", () => setTimeout(go, 300), { once: true });
}
