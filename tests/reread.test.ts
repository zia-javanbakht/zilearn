import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { openDb, setDb } from "@/lib/db";
import { createCourse, getMaterial, insertMaterial, setScan } from "@/lib/store";

const ai = vi.hoisted(() => ({ on: false, generateText: vi.fn() }));
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  aiEnabled: () => ai.on,
  providerName: () => "Claude",
  generateText: (...a: unknown[]) => ai.generateText(...a),
}));
// The digest of the new text is written offline here.
vi.mock("@/lib/digest", async (orig) => ({ ...(await orig<typeof import("@/lib/digest")>()), wantsAiDigest: () => false, settleNewText: async () => {} }));

const { PATCH } = await import("@/app/api/materials/[id]/route");

/** One page of prose with numbered equations that the text layer flattens. */
async function equationPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);
  ["Equilibrium of the reference body", "Div P + f0 = 0 in B0 (12)", "and the weak form follows by testing it", "G(u, v) = 0 for all v (13)", "which is the principle of virtual work."].forEach((l, i) =>
    page.drawText(l, { x: 60, y: 760 - i * 24, size: 12, font }),
  );
  return Buffer.from(await doc.save());
}

describe("reading a PDF again", () => {
  beforeEach(() => {
    process.env.ZILEARN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zilearn-reread-"));
    setDb(openDb(":memory:"));
    ai.generateText.mockReset();
  });

  async function stored() {
    const c = createCourse({ name: "Solids" });
    fs.mkdirSync(path.join(process.env.ZILEARN_DATA_DIR!, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(process.env.ZILEARN_DATA_DIR!, "uploads", "notes.pdf"), await equationPdf());
    const m = insertMaterial({
      course_id: c.id, kind: "reading", title: "Notes", source_type: "file", filename: "notes.pdf", mime: "application/pdf", path: "uploads/notes.pdf", url: null,
      text: "Div P + f0 = 0 in B0 (12)", status: "ready", note: null,
    });
    setScan(m.id, { pages: [], total: 1, maths: [1] });
    return m.id;
  }
  const patch = (id: string) => PATCH(new Request(`http://x/api/materials/${id}`, { method: "PATCH", body: JSON.stringify({ reread: true }) }), { params: Promise.resolve({ id }) });

  it("needs an AI provider", async () => {
    const res = await patch(await stored());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/AI provider/);
  });

  it("replaces the equation pages with the AI's transcription and records which pages it read", async () => {
    ai.on = true;
    ai.generateText.mockResolvedValue({ text: "=== Page 1 ===\n## Equilibrium\n$$\\operatorname{Div} \\mathbf{P} + \\mathbf{f}_0 = \\mathbf{0} \\tag{12}$$", truncated: false });
    const id = await stored();
    const res = await patch(id);
    expect(res.status).toBe(200);
    const m = getMaterial(id)!;
    expect(m.text).toContain("\\tag{12}");
    expect(m.note).toMatch(/Claude read 1 page from the PDF itself \(1 with equations\)/);
    expect(m.scan).toMatchObject({ maths: [1], ai_pages: [1] });
    ai.on = false;
  });
});
