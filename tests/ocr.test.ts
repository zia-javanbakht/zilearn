import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { addTextLayer, findScannedPages, ocrPdfPages, pageList } from "@/lib/ocr";

const LINES = ["Damped free vibration", "The effect of damping is different for each mode.", "An efficient method finds the coefficient of the stiffness matrix."];

/** A two-page PDF: page 1 has real text, page 2 is a picture of text (a scan). */
async function scannedPdf(): Promise<Buffer> {
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.TimesRoman);
  const p = src.addPage([595, 842]);
  LINES.forEach((l, i) => p.drawText(l, { x: 60, y: 760 - i * 28, size: i ? 14 : 20, font }));
  const png = await renderPageAsImage(new Uint8Array(await src.save()), 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 3 });
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const t = doc.addPage([595, 842]);
  t.drawText("This first page has a real text layer with plenty of letters in it for the test.", { x: 40, y: 800, size: 10, font: helv });
  const img = await doc.embedPng(png);
  doc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  return Buffer.from(await doc.save());
}

describe("OCR", () => {
  it("finds scanned pages, reads them and adds a text layer", { timeout: 120_000 }, async () => {
    const buf = await scannedPdf();
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    const scan = await findScannedPages(pdf, text as string[]);
    expect(scan).toEqual({ pages: [2], total: 2 });

    const pages = await ocrPdfPages(buf, scan.pages);
    expect(pages[0].page).toBe(2);
    expect(pages[0].text).toMatch(/damping is different/);
    expect(pages[0].words.length).toBeGreaterThan(15);
    // Words land where they are drawn: the title near the top of the page.
    const title = pages[0].words.find((w) => w.text === "Damped")!;
    expect(title.y).toBeGreaterThan(740);
    expect(title.x).toBeGreaterThan(50);
    expect(title.x).toBeLessThan(75);

    const layered = await addTextLayer(buf, pages);
    const again = await extractText(await getDocumentProxy(new Uint8Array(layered)), { mergePages: false });
    expect((again.text as string[])[1]).toMatch(/efficient method finds the coefficient/);
    expect((again.text as string[])[0]).toMatch(/real text layer/);
  });

  it("writes page lists compactly", () => {
    expect(pageList([1, 2, 3, 5, 7, 8])).toBe("1–3, 5, 7–8");
  });
});
