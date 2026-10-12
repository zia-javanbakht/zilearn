import path from "node:path";

/**
 * OCR for scanned PDFs, on this computer: each page that is only a picture is rendered and read
 * with Tesseract, and the words are written back into the PDF as invisible text over the image, so
 * the file itself becomes searchable and selectable (a "text layer") and the material gets its text.
 */

export interface OcrWord {
  text: string;
  /** Box in PDF points: left, bottom, width, height (PDF y runs upwards). */
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface OcrPage {
  page: number; // 1-based
  text: string;
  words: OcrWord[];
  confidence: number;
}

export interface PageScan {
  /** Pages (1-based) that are images with little or no text. */
  pages: number[];
  total: number;
}

const MIN_LETTERS = 40;

type Pdf = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;

/**
 * Find the pages of a PDF that are pictures without a text layer: little extracted text, but an
 * image, or a lot of drawing (text turned into outlines). `texts` is each page's extracted text.
 */
export async function findScannedPages(pdf: Pdf, texts: string[]): Promise<PageScan> {
  const { OPS } = await (await import("unpdf")).getResolvedPDFJS();
  const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
  const pages: number[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    if ((texts[i] ?? "").replace(/[^A-Za-z]/g, "").length >= MIN_LETTERS) continue;
    const page = await pdf.getPage(i + 1);
    const ops = await page.getOperatorList();
    if (ops.fnArray.some((op: number) => imageOps.has(op)) || ops.fnArray.length > 400) pages.push(i + 1);
  }
  return { pages, total: pdf.numPages };
}

/**
 * Pages carrying an OCR layer: invisible text (rendering mode 3) over a picture, as scanners and
 * Acrobat's Paper Capture write it. That text was guessed from the image, so it can't be trusted the
 * way a born-digital PDF's text can.
 */
export async function ocrLayerPages(pdf: Pdf): Promise<Set<number>> {
  const { OPS } = await (await import("unpdf")).getResolvedPDFJS();
  const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
  const out = new Set<number>();
  for (let i = 1; i <= pdf.numPages; i++) {
    const { fnArray, argsArray } = await (await pdf.getPage(i)).getOperatorList();
    const invisible = fnArray.some((op: number, k: number) => op === OPS.setTextRenderingMode && argsArray[k]?.[0] === 3);
    if (invisible && fnArray.some((op: number) => imageOps.has(op))) out.add(i);
  }
  return out;
}

/** "3", "3-5", "2, 4-6": page numbers for a note. */
export function pageList(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j;
  }
  return out.join(", ");
}

type Worker = import("tesseract.js").Worker;

async function tesseract(): Promise<Worker> {
  const { createWorker, OEM } = await import("tesseract.js");
  // The English model ships with the app (an npm package), so OCR needs no download. The package
  // says where its files are; the smaller "best_int" model sits next to the one it names.
  const eng = (await import("@tesseract.js-data/eng")) as { langPath?: string; default?: { langPath: string } };
  const langPath = path.join(path.dirname(eng.langPath ?? eng.default!.langPath), "4.0.0_best_int");
  return createWorker("eng", OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: "none" });
}

/**
 * Read the given pages with OCR. Stops early (returning what it has) once `budgetMs` has passed, so
 * a long scan can be done over several requests; `onPage` reports progress.
 */
export async function ocrPdfPages(buf: Buffer, pages: number[], opts: { budgetMs?: number; onPage?: (page: number) => void } = {}): Promise<OcrPage[]> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const start = Date.now();
  const out: OcrPage[] = [];
  const worker = await tesseract();
  try {
    for (const n of pages) {
      if (out.length && opts.budgetMs && Date.now() - start > opts.budgetMs) break;
      opts.onPage?.(n);
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // About 300 dpi on an A4 or letter page: Tesseract reads best at that size.
      const scale = Math.min(4, Math.max(1.5, 3300 / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const png = await renderPageAsImage(pdf, n, { canvasImport: () => import("@napi-rs/canvas"), scale });
      const { data } = await worker.recognize(Buffer.from(png), {}, { text: true, blocks: true });
      const words: OcrWord[] = [];
      for (const b of data.blocks ?? [])
        for (const p of b.paragraphs)
          for (const l of p.lines)
            for (const w of l.words) {
              const text = w.text.trim();
              if (!text || w.confidence < 30) continue;
              // Pixel box to PDF points; the viewport knows the page's crop box and rotation.
              const [ax, ay] = viewport.convertToPdfPoint(w.bbox.x0, w.bbox.y1);
              const [bx, by] = viewport.convertToPdfPoint(w.bbox.x1, w.bbox.y0);
              words.push({ text, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay), conf: w.confidence });
            }
      out.push({ page: n, text: (data.text ?? "").trim(), words, confidence: data.confidence ?? 0 });
    }
  } finally {
    await worker.terminate();
    await pdf.cleanup?.();
  }
  return out;
}

/** The PDF with the OCR'd words written invisibly over each scanned page. */
export async function addTextLayer(buf: Buffer, pages: OcrPage[]): Promise<Buffer> {
  const { PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setCharacterSqueeze, moveText, showText } =
    await import("pdf-lib");
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  // Helvetica only encodes Latin text; anything else (Greek, maths) becomes "?" in the layer (the material text keeps it).
  const encodable = (s: string) => [...s].map((c) => (charset.has(c.codePointAt(0)!) ? c : "?")).join("");
  for (const p of pages) {
    if (p.page < 1 || p.page > doc.getPageCount() || !p.words.length) continue;
    const page = doc.getPage(p.page - 1);
    const key = page.node.newFontDictionary("ZiOcr", font.ref);
    const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    let cx = 0;
    let cy = 0;
    for (const w of p.words) {
      const text = encodable(w.text);
      const size = Math.max(1, w.h * 0.85);
      const natural = font.widthOfTextAtSize(text, size);
      if (!natural) continue;
      ops.push(setFontAndSize(key, size), setCharacterSqueeze(Math.max(10, Math.min(500, (100 * w.w) / natural))));
      // Text position is relative to the previous word's start inside one text object.
      ops.push(moveText(w.x - cx, w.y + w.h * 0.2 - cy), showText(font.encodeText(text)));
      cx = w.x;
      cy = w.y + w.h * 0.2;
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
