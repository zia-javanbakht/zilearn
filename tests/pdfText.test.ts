import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fixMathGlyphs, isPoor, isPublisherLine, mathsHeavy, pageQuality, pagesFromLines, runningLines, wordCounts, type PdfLine } from "@/lib/pdfText";
import { isAuthorLine, splitSections, studySections } from "@/lib/text";

const generateText = vi.fn();
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), generateText: (...a: unknown[]) => generateText(...a) }));

describe("running headers and page numbers", () => {
  const pages = [1, 2, 3, 4, 5, 6].map((n) => [
    n % 2 ? "International Journal of Damage Mechanics 33(4)" : "Abdellahi et al.",
    ["Fibres carry the load", "The matrix cracks first", "Damage spreads slowly", "Plies delaminate late", "Strain hardening follows", "The model is validated"][n - 1],
    ["against the tests.", "under tension.", "near the notch.", "in the middle ply.", "after the knee.", "by experiment."][n - 1],
    String(n + 10),
  ]);
  // OCR misreads the head on one page; it still counts.
  pages[4][0] = "lnternational Journa1 of Damage Mechanics 33(4)";

  it("drops repeated heads on odd and even pages, including misread ones, and bare page numbers", () => {
    const drop = runningLines(pages);
    for (const [p, d] of drop.entries()) {
      expect(d.has(0), `page ${p + 1} head`).toBe(true);
      expect(d.has(3)).toBe(true);
      expect(d.has(1) || d.has(2)).toBe(false);
    }
  });

  it("knows publisher furniture on a first page", () => {
    for (const l of ["Original Article", "DOI: 10.1177/10567895241234567", "https://doi.org/10.1002/nme.1620290802", "© The Author(s) 2024", "Article reuse guidelines:", "Vol. 29, 1595-1638 (1990)", "name@uni.edu.au"])
      expect(isPublisherLine(l), l).toBe(true);
    for (const l of ["Abstract", "The volume of fibres in the composite", "Introduction"]) expect(isPublisherLine(l), l).toBe(false);
  });
});

describe("maths glyphs", () => {
  it("reads MathPi's =, +, ( and ) and the minus in slot 1", () => {
    const { text, report } = fixMathGlyphs("s ¼ ðA þ BÞ x ¼ y ¼ ðu \u0001 vÞ");
    expect(text).toBe("s = (A + B) x = y = (u − v)");
    expect(report.mathpi).toBe(true);
  });

  it("leaves ¼ and þ alone in a document without MathPi", () => {
    expect(fixMathGlyphs("a ¼ teaspoon in Þórr's saga").text).toBe("a ¼ teaspoon in Þórr's saga");
  });

  it("turns cmex delimiters back into brackets and the lone Z into an integral", () => {
    const { text, report } = fixMathGlyphs("W = Z\nB0\nP : F dV and G = Z\nΓT\nT dA, \u0012a\u0013");
    expect(text).toBe("W = ∫_{B0} P : F dV and G = ∫_{ΓT} T dA, (a)");
    expect(report.integrals).toBe(2);
  });
});

describe("page quality", () => {
  const good = "The stiffness matrix of the element follows from the strain energy of the deformed body. ".repeat(4);
  const ocr = "Thc stiffncss rnatrix o f t h e elernent follows frorn thc slrain cncrgy of the dcforrned body. ".repeat(4);

  it("trusts clean text and flags a bad OCR layer", () => {
    expect(isPoor(pageQuality(good, wordCounts(good)), true)).toBe(false);
    const all = wordCounts(good + ocr.replace(/stiffncss/g, "stiffness"));
    expect(isPoor(pageQuality(ocr, all), true)).toBe(true);
  });

  it("never flags a short page", () => {
    expect(isPoor(pageQuality("o f t h e m a k e"), true)).toBe(false);
  });

  it("spots pages of equations the text layer can't carry", () => {
    expect(mathsHeavy("Equilibrium gives\nDiv P + f0 = 0 in B0 (12)\nand the weak form\nG(φ, η) = 0 (13)")).toBe(true);
    expect(mathsHeavy("The results agree with Simo and Rifai (1990) and with the tests of Wilson (19)")).toBe(false);
    // abs2024 p. 5: one numbered equation whose exponent and logarithm the text layer flattens.
    expect(mathsHeavy("The Weibull distribution gives the strength:\nσ = σ0 [ln(1/(1 − η))]1/m (1)\nwhere m is the shape parameter.")).toBe(true);
    expect(mathsHeavy("The strength is drawn from\nln\n1 − η\n(1)\nwhere η is a random number in [0,1].")).toBe(true);
    expect(mathsHeavy(["∂Ψ", "∂E", "= S", "1", "2", "(λ2 − 1)", "Some prose that explains the derivation step by step."].join("\n"))).toBe(true);
  });
});

describe("headings from type sizes", () => {
  const l = (text: string, size = 10): PdfLine => ({ text, size });
  const body = Array.from({ length: 20 }, (_, i) => l(`Body sentence number ${i} of the paper, set in the text size.`));

  it("joins a title set over several lines and keeps adjacent section headings apart", () => {
    const { pages } = pagesFromLines([
      [l("Prediction of the failure", 16), l("behavior of composites", 16), ...body.slice(0, 5), l("2 Finite element model", 12), l("Generation of the RVE", 12), ...body],
    ]);
    expect(pages[0]).toContain("## Prediction of the failure behavior of composites\n");
    expect(pages[0]).toContain("### 2 Finite element model\n### Generation of the RVE\n");
  });

  it("doesn't take sizes from an OCR layer", () => {
    expect(pagesFromLines([[l("Big scanned words", 16), ...body]], { ocrPages: new Set([1]) }).pages[0]).not.toContain("#");
  });
});

describe("study sections of a paper", () => {
  it("skips references and funding, and keeps author lines and front labels untitled", () => {
    const text = [
      "# Prediction of failure",
      "### Behzad Abdellahi , Fatemeh Azhari and Phu Nguyen",
      "Abstract",
      "We study failure.",
      "1 Introduction",
      "Composites fail.",
      "Funding",
      "The author(s) received no financial support.",
      "References",
      "1. Netravali AN. Composites get greener.",
    ].join("\n");
    expect(studySections(text).map((s) => s.heading)).toEqual(["Prediction of failure", "", "Introduction"]);
  });

  it("tells author lines from titles with 'and'", () => {
    expect(isAuthorLine("J. C. SIMO AND M. S. RIFAI")).toBe(true);
    expect(isAuthorLine("Kinematics and Primary Solution Field")).toBe(false);
    expect(isAuthorLine("Work-Conjugate Stress and Strain")).toBe(false);
  });

  it("keeps a closing Summary section", () => {
    const text = ["1 Kinematics", "a", "2 Stress", "b", "3 Weak Form", "c", "4 Tangent", "d", "5 Elements", "e", "6 Summary", "f"].join("\n");
    expect(studySections(text).map((s) => s.heading)).toContain("Summary");
  });

  it("doesn't take wrapped sentences or maths for headings", () => {
    const heads = splitSections(["condition (i) of", "Section 2 is violated.", "2521 J 2 2", "Ψ(E) = 1", "2 KE2, E = 1", "3.3. Stress recovery", "text"].join("\n"))
      .map((s) => s.heading)
      .filter(Boolean);
    expect(heads).toEqual(["Stress recovery"]);
  });

  it("joins a shouted title set over two lines", () => {
    const heads = splitSections("A CLASS OF MIXED ASSUMED STRAIN METHODS AND\nTHE METHOD OF INCOMPATIBLE MODES*\nbody\n1. INTRODUCTION AND MOTIVATION\nbody").map((s) => s.heading);
    expect(heads).toEqual(["A Class of Mixed Assumed Strain Methods and The Method of Incompatible Modes", "Introduction and Motivation"]);
  });
});

describe("AI transcription of pages", () => {
  async function pdf(n: number) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= n; i++) doc.addPage([300, 300]).drawText(`Page ${i}`, { x: 20, y: 250, size: 12, font });
    return Buffer.from(await doc.save());
  }

  it("sends the pages in batches as PDF documents and places each answer by its marker", async () => {
    generateText.mockReset();
    generateText.mockImplementation(async ({ prompt }: { prompt: { type: string; source?: { data: string }; text?: string }[] }) => {
      const part = await PDFDocument.load(Buffer.from(prompt[0].source!.data, "base64"));
      const n = part.getPageCount();
      expect(prompt[1].text).toMatch(new RegExp(`these ${n} pages|this page`));
      return { text: Array.from({ length: n }, (_, k) => `=== Page ${k + 1} ===\n## Read ${n}-${k + 1}`).join("\n"), truncated: false };
    });
    const { transcribePages } = await import("@/lib/extract");
    const out = await transcribePages(await pdf(9), [1, 2, 3, 4, 5, 6, 7, 9]);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect([...out.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(out.get(6)).toBe("## Read 6-6");
    expect(out.get(9)).toBe("## Read 2-2");
  });

  it("sends the same bytes for the same pages on every run", async () => {
    const sent: string[] = [];
    generateText.mockReset();
    generateText.mockImplementation(async ({ prompt }: { prompt: { source?: { data: string } }[] }) => {
      sent.push(prompt[0].source!.data);
      return { text: "=== Page 1 ===\nx", truncated: false };
    });
    const { transcribePages } = await import("@/lib/extract");
    const buf = await pdf(2);
    await transcribePages(buf, [2]);
    await new Promise((r) => setTimeout(r, 1100));
    await transcribePages(buf, [2]);
    expect(sent[0]).toBe(sent[1]);
  });

  it("skips a batch whose answer has no page markers", async () => {
    generateText.mockReset();
    generateText.mockResolvedValue({ text: "Some text with no markers", truncated: false });
    const { transcribePages } = await import("@/lib/extract");
    expect((await transcribePages(await pdf(3), [1, 2])).size).toBe(0);
  });
});
