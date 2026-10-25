import { describe, expect, it } from "vitest";
import { headingRepairer } from "@/lib/headingRepair";

describe("heading repair", () => {
  const doc = "Mixed finite element methods for viscoplasticity. The finite element method and viscoplasticity in the axisymmetric case. Axisymmetric shells. See Appendix I and Appendix II. Model Problem I is plane strain.";
  const mend = headingRepairer(doc);

  it("swaps OCR look-alike letters when the document knows the mended word", () => {
    expect(mend("Mixed Jinite element approximations")).toBe("Mixed finite element approximations");
    expect(mend("Rate-independent viscoplusticity")).toBe("Rate-independent viscoplasticity");
    expect(mend("Jinite elements")).toBe("Finite elements");
  });

  it("reads a run of garbled words as the document's closest phrase", () => {
    const m = headingRepairer("The enhanced strain field is new. An enhanced strain field again. Its interpolation and interpolation. Derivation of the weak form.");
    expect(m("Enkanwd srrainjfield interpolation")).toBe("Enhanced strain field interpolation");
    expect(m("Derivation of the weak form")).toBe("Derivation of the weak form");
    expect(m("Example 1 : A plane problem")).toBe("Example 1: A plane problem");
  });

  it("joins a word split by a stray space", () => {
    expect(mend("Axis ymmetric problems")).toBe("Axisymmetric problems");
    expect(mend("Finite element")).toBe("Finite element");
  });

  it("reads ones as roman numerals only where the document numbers that label in roman numerals", () => {
    expect(mend("Appendix 11")).toBe("Appendix II");
    expect(mend("Model Problem 111")).toBe("Model Problem III");
    expect(headingRepairer("See Appendix 1 for details.")("Appendix 11")).toBe("Appendix 11");
  });

  it("leaves real words and unknown names alone", () => {
    expect(mend("Hellinger-Reissner principle")).toBe("Hellinger-Reissner principle");
    expect(mend("Numerical examples")).toBe("Numerical examples");
  });
});
