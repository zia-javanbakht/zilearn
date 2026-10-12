import { describe, expect, it } from "vitest";
import { digestPaths, insideAny, moveDigestItems, removeDigestItems, renameDigestItem } from "@/lib/digestEdit";
import { digestMindmap } from "@/lib/mermaid";
import type { Digest } from "@/lib/types";

const t = (title: string, subs?: string[]) => ({ title, start: null, summary: "", ...(subs ? { subtopics: subs.map((s) => ({ title: s, start: null, summary: "" })) } : {}) });
const d: Digest = { summary: "", keywords: [], by: "offline", topics: [t("A", ["a1", "a2"]), t("B", ["b1"]), t("C", [])] };
const titles = (x: Digest) => x.topics.map((tp) => `${tp.title}(${(tp.subtopics ?? []).map((s) => s.title).join(",")})`).join(" ");

describe("editing a material's topic map", () => {
  it("names items the way the mindmap does", () => {
    expect(digestPaths(d)).toEqual({ n0: [0], n1: [0, 0], n2: [0, 1], n3: [1], n4: [1, 0], n5: [2] });
    expect(digestMindmap("M", d)).toMatch(/n0\[A\]\n\s+n1\[a1\]\n\s+n2\[a2\]\n\s+n3\[B\]/);
  });

  it("moves subtopics and topics", () => {
    expect(titles(moveDigestItems(d, ["n1"], "n3"))).toBe("A(a2) B(b1,a1) C()");
    expect(titles(moveDigestItems(d, ["n4"], "root"))).toBe("A(a1,a2) B() C() b1()");
    // A topic dropped on a topic becomes a subtopic and brings its own subtopics along.
    expect(titles(moveDigestItems(d, ["n0"], "n5"))).toBe("B(b1) C(A,a1,a2)");
    // Onto a subtopic: right after it.
    expect(titles(moveDigestItems(d, ["n5"], "n1"))).toBe("A(a1,C,a2) B(b1)");
    // A subtopic whose topic moves too goes with the topic.
    expect(titles(moveDigestItems(d, ["n0", "n1"], "n3"))).toBe("B(b1,A,a1,a2) C()");
  });

  it("copies without removing", () => {
    expect(titles(moveDigestItems(d, ["n4"], "n0", true))).toBe("A(a1,a2,b1) B(b1) C()");
  });

  it("refuses to put a topic inside itself", () => {
    expect(insideAny(d, ["n0"], "n2")).toBe(true);
    expect(moveDigestItems(d, ["n0"], "n2")).toBe(d);
  });

  it("removes and renames", () => {
    expect(titles(removeDigestItems(d, ["n2", "n3"]))).toBe("A(a1) C()");
    expect(titles(renameDigestItem(d, "n4", " beta one "))).toBe("A(a1,a2) B(beta one) C()");
  });
});
