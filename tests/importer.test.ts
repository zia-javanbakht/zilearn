import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { openDb, setDb } from "@/lib/db";
import { createCourse, listMaterials } from "@/lib/store";
import { importFile, kindFor, titleFor, type ImportResult } from "@/lib/importer";
import { isJunk, isUnsupported } from "@/lib/filetypes";
import { batches, filterPicked } from "@/components/folderImport";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

describe("folder hints", () => {
  it("uses the file name first, then the nearest telling folder", () => {
    expect(kindFor("week3.pdf", "application/pdf", "ML/Tutorials/week3.pdf")).toBe("tutorial");
    expect(kindFor("2023.pdf", "application/pdf", "ML/Past exams/2023.pdf")).toBe("sample_exam");
    expect(kindFor("intro.pdf", "application/pdf", "ML/Week 1/Lecture notes/intro.pdf")).toBe("lecture_notes");
    expect(kindFor("Lecture 5 slides.pptx", "", "ML/Tutorials/Lecture 5 slides.pptx")).toBe("slides"); // name wins
    expect(kindFor("x.pdf", "application/pdf", "x.pdf")).toBe("pdf");
  });

  it("gives generic file names their folder as context", () => {
    expect(titleFor("notes.pdf", "ML/Week 3/notes.pdf")).toBe("Week 3 › notes");
    expect(titleFor("1.pdf", "ML/Tutorial_sheets/1.pdf")).toBe("Tutorial sheets › 1");
    expect(titleFor("Backpropagation.pdf", "ML/Week 3/Backpropagation.pdf")).toBe("Backpropagation");
  });

  it("leaves out clutter and non-study files", () => {
    expect(["ML/.DS_Store", "ML/__MACOSX/a.pdf", "ML/~$draft.docx", "ML/.git/config", "Thumbs.db"].every(isJunk)).toBe(true);
    expect(isJunk("ML/Week 1/notes.pdf")).toBe(false);
    expect(isUnsupported("setup.exe") && isUnsupported("archive.rar") && !isUnsupported("notes.pdf") && !isUnsupported("course.zip")).toBe(true);
    const f = (name: string, size = 1) => ({ file: new File([new Uint8Array(size)], name), path: `F/${name}` });
    expect(filterPicked([f("a.pdf"), f(".DS_Store"), f("b.exe")]).ignored).toBe(2);
    const groups = batches([f("a.pdf", 10), f("b.pdf", 10), f("c.pdf", 10), f("big.pdf", 100)], 2, 50);
    expect(groups.map((g) => g.map((p) => p.file.name))).toEqual([["a.pdf", "b.pdf"], ["c.pdf"], ["big.pdf"]]);
  });
});

describe("importing", () => {
  beforeEach(() => {
    setDb(openDb(":memory:"));
    process.env.ZILEARN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zl-imp-"));
  });

  it("imports a zip like a folder and skips duplicates on a second import", async () => {
    const c = createCourse({ name: "ML" });
    const zip = new JSZip();
    zip.file("Week 1/notes.md", "# Gradient descent\nStep against the gradient.");
    zip.file("Tutorials/sheet1.txt", "Question 1: compute the gradient.");
    zip.file("Week 1/copy-of-notes.md", "# Gradient descent\nStep against the gradient.");
    zip.file("__MACOSX/._notes.md", "junk");
    zip.file("tools/setup.exe", "MZ");
    const buf = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

    const first: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "ML course.zip", mime: "application/zip", buf }, first);
    expect(first.materials.map((m) => [m.title, m.kind, m.rel_path])).toEqual([
      ["Week 1 › notes", "lecture_notes", "ML course/Week 1/notes.md"],
      ["sheet1", "tutorial", "ML course/Tutorials/sheet1.txt"],
    ]);
    expect(first.skipped.map((s) => s.reason)).toEqual(['already added as "Week 1 › notes"', "not a study file"]);

    const again: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "ML course.zip", mime: "application/zip", buf }, again);
    expect(again.materials).toHaveLength(0);
    expect(listMaterials(c.id)).toHaveLength(2);
    expect(listMaterials(c.id, true)[0].text).toContain("Gradient descent");
  });

  it("reports an unreadable zip instead of failing", async () => {
    const c = createCourse({ name: "ML" });
    const r: ImportResult = { materials: [], skipped: [] };
    await importFile(c.id, { name: "broken.zip", mime: "", buf: Buffer.from("not a zip") }, r);
    expect(r.skipped).toEqual([{ name: "broken.zip", reason: "not a readable zip file" }]);
  });
});
