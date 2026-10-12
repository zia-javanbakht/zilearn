import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderPageAsImage } from "unpdf";
import { extractFile } from "@/lib/extract";
import { importFile, type ImportResult } from "@/lib/importer";
import { createCourse, getMaterial } from "@/lib/store";
import { continueTextLayer } from "@/lib/textLayer";
import { applyCorrections, offlineDigest } from "@/lib/digest";

beforeAll(() => {
  process.env.ZILEARN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zilearn-scan-"));
});

const BODY = [
  "Damped free vibration",
  "The effect of damping is different for each mode of the structure.",
  "An efficient method finds the damping coefficient from the decay.",
  "The logarithmic decrement measures how fast the amplitude falls.",
];

async function pdfWith(scanned: boolean): Promise<Buffer> {
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.TimesRoman);
  const p = src.addPage([595, 842]);
  BODY.forEach((l, i) => p.drawText(l, { x: 60, y: 760 - i * 26, size: i ? 13 : 20, font }));
  if (!scanned) return Buffer.from(await src.save());
  const png = await renderPageAsImage(new Uint8Array(await src.save()), 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 3 });
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 595, height: 842 });
  return Buffer.from(await doc.save());
}

describe("scanned PDFs", () => {
  it("spots a scan and offers a text layer when no AI is set", async () => {
    const ex = await extractFile(await pdfWith(true), "scan.pdf", "application/pdf");
    expect(ex.status).toBe("partial");
    expect(ex.scan).toEqual({ pages: [1], total: 1 });
    expect(ex.note).toMatch(/This PDF is scanned pages.*Add text layer/);
  });

  it("reads a text PDF without a scan note", async () => {
    const ex = await extractFile(await pdfWith(false), "notes.pdf", "application/pdf");
    expect(ex.status).toBe("ready");
    expect(ex.scan).toBeUndefined();
    expect(ex.text).toMatch(/logarithmic decrement/);
  });

  it("adds a text layer on import's file and fills in the text", { timeout: 120_000 }, async () => {
    const course = createCourse({ name: "Vibrations" });
    const result: ImportResult = { materials: [], skipped: [] };
    await importFile(course.id, { name: "scan.pdf", mime: "application/pdf", buf: await pdfWith(true) }, result);
    const id = result.materials[0].id;
    expect(getMaterial(id)!.scan?.pages).toEqual([1]);
    let r = await continueTextLayer(id, 1);
    while (!r.done) r = await continueTextLayer(id, 1);
    const m = getMaterial(id)!;
    expect(m.status).toBe("ready");
    expect(m.scan).toMatchObject({ layer: true, text_by: "ocr" });
    expect(m.text).toMatch(/--- Page 1 ---\nDamped free vibration/);
    expect(m.text).toMatch(/efficient method finds the damping coefficient/);
    expect(m.note).toMatch(/Text layer added: Page 1 read with OCR/);
    // The stored PDF now has the words as text.
    const ex = await extractFile(fs.readFileSync(path.join(process.env.ZILEARN_DATA_DIR!, m.path!)), "scan.pdf", "application/pdf");
    expect(ex.scan).toBeUndefined();
    expect(ex.text).toMatch(/logarithmic decrement/);
    await expect(continueTextLayer(id)).rejects.toThrow(/already has a text layer/);
  });
});

describe("digests of damaged text", () => {
  const damaged =
    "Damping. The e ect of damping is di erent for each mode. The damping coe cient sets the decay. An e cient method finds the damping coe cient. The rst mode decays slowly and the e ect grows.";

  it("offline key terms come out whole", () => {
    const d = offlineDigest(damaged);
    expect(d.keywords).toContain("damping coefficient");
    expect(d.keywords.join(" ")).not.toMatch(/\b(ect|cient|erent|coe)\b/);
  });

  it("applies AI corrections only where safe", () => {
    const text = "We form the matrix from the modes. Take the eigen vaule. Then form it again.";
    const r = applyCorrections(text, [
      { wrong: "vaule", right: "value", context: "the eigen vaule" },
      { wrong: "form", right: "from", context: "Then form it again" }, // real word: only in its context
      { wrong: "matrix", right: "stiffness tensor field", context: "" }, // a rewrite, not a spelling fix
    ]);
    expect(r.text).toBe("We form the matrix from the modes. Take the eigen value. Then from it again.");
    expect(r.applied).toHaveLength(2);
  });
});
