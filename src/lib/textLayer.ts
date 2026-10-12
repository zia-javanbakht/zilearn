import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db";
import { joinPages, splitPages } from "./extract";
import { addTextLayer, findScannedPages, ocrPdfPages, pageList, type OcrPage } from "./ocr";
import { getMaterial, setScan, updateMaterial } from "./store";
import { repairText } from "./textRepair";
import type { Material, ScanInfo } from "./types";

/**
 * "Add text layer" for a scanned PDF: OCR its pictured pages a few at a time (each request does what
 * fits in its time budget and saves progress next to the file), then write the words into the PDF as
 * invisible text and give the material the text of those pages.
 */

export type LayerProgress = { done: false; read: number; total: number } | { done: true; read: number; total: number; material: Material };

const running = new Set<string>();

export async function continueTextLayer(id: string, budgetMs = 20_000): Promise<LayerProgress> {
  if (running.has(id)) throw new Error("Already reading this PDF.");
  running.add(id);
  try {
    return await step(id, budgetMs);
  } finally {
    running.delete(id);
  }
}

async function step(id: string, budgetMs: number): Promise<LayerProgress> {
  const m = getMaterial(id);
  if (!m?.path || !/pdf/i.test(`${m.mime} ${m.filename}`)) throw new Error("Only PDFs can get a text layer.");
  const root = path.resolve(dataDir());
  const file = path.resolve(root, m.path);
  if (!file.startsWith(root + path.sep)) throw new Error("Bad file path.");
  const buf = await fs.readFile(file);
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const raw = ((await extractText(pdf, { mergePages: false })).text as string[]).map((t) => t.trim());
  const scan: ScanInfo = m.scan?.pages.length ? m.scan : await findScannedPages(pdf, raw);
  if (!scan.pages.length) throw new Error("Every page of this PDF already has text.");
  if (scan.layer) throw new Error("This PDF already has a text layer.");

  const progressFile = `${file}.ocr.json`;
  const done: OcrPage[] = JSON.parse(await fs.readFile(progressFile, "utf8").catch(() => "[]"));
  const todo = scan.pages.filter((p) => !done.some((d) => d.page === p));
  if (todo.length) {
    done.push(...(await ocrPdfPages(buf, todo, { budgetMs })));
    await fs.writeFile(progressFile, JSON.stringify(done));
    if (done.length < scan.pages.length) return { done: false, read: done.length, total: scan.pages.length };
  }

  // Write the layer to a new file first and only swap it in once it reads back.
  const layered = await addTextLayer(buf, done);
  const check = await getDocumentProxy(new Uint8Array(layered));
  if (check.numPages !== pdf.numPages) throw new Error("Could not write the text layer into this PDF.");
  await fs.writeFile(`${file}.tmp`, layered);
  await fs.rename(`${file}.tmp`, file);
  await fs.rm(progressFile, { force: true });

  const { text, replaced } = mergeText(m.text ?? "", raw, done);
  const conf = Math.round(done.reduce((s, p) => s + p.confidence, 0) / done.length);
  const pages = `${scan.pages.length === 1 ? "Page" : "Pages"} ${pageList(scan.pages)}`;
  const note = replaced
    ? `Text layer added: ${pages} read with OCR on this computer (about ${conf}% confident), so the PDF is now searchable. Check formulas and symbols in the text, OCR often misreads them.`
    : `Text layer added: ${pages} read with OCR on this computer, so the PDF is now searchable. The text already here was kept.`;
  const updated = updateMaterial(id, { text, note });
  setScan(id, { ...scan, layer: true, text_by: replaced ? "ocr" : (scan.text_by ?? null) });
  return { done: true, read: done.length, total: scan.pages.length, material: { ...updated!, scan: { ...scan, layer: true } } };
}

/**
 * The material's text with the OCR'd pages filled in. Pages that already have text (from the PDF, the
 * AI, or the student's own edits) are kept; text the student rewrote without page markers is left alone.
 */
export function mergeText(current: string, raw: string[], ocr: OcrPage[]): { text: string; replaced: boolean } {
  const letters = (s: string) => s.replace(/[^A-Za-z]/g, "").length;
  const hasPages = /^--- Page \d+ ---$/m.test(current);
  if (!hasPages && letters(current) > 200) return { text: current, replaced: false };
  const cur = hasPages ? splitPages(current, raw.length) : raw;
  let replaced = false;
  const pages = cur.map((t, i) => {
    const o = ocr.find((p) => p.page === i + 1);
    if (!o || letters(t) >= 40) return t;
    replaced = true;
    return o.text;
  });
  if (!replaced) return { text: current, replaced: false };
  return { text: repairText(joinPages(pages), { ocr: true }).text, replaced };
}
