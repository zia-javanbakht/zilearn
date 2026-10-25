import { describe, expect, it } from "vitest";
import { checkKeywords, isGarbled, repairNote, repairTerm, repairText } from "@/lib/textRepair";

const fix = (s: string, o = {}) => repairText(s, o).text;

describe("repairText", () => {
  it("maps ligature code points and old TeX slots", () => {
    expect(fix("The \uFB00ect of \uFB01nite \uFB02ow")).toBe("The ffect of finite flow");
    expect(fix("the e\x0Bect is di\x0Berent; we de\x0Cne it")).toBe("the effect is different; we define it");
    expect(fix("e\uFFFDcient o\uFFFDce")).toBe("efficient office");
    // A form feed between pages is not a ligature.
    expect(fix("end.\x0CThe next page")).toBe("end.\x0CThe next page");
  });

  it("joins ligatures split off or lost as a space", () => {
    expect(fix("The e ect of damping is di erent in each o ce.")).toBe("The effect of damping is different in each office.");
    expect(fix("We de fi ne the e ff ect and the signi ficant coe cient.")).toBe("We define the effect and the significant coefficient.");
    expect(fix("E ect of the fi rst mode")).toBe("Effect of the first mode");
  });

  it("leaves real word pairs alone", () => {
    expect(fix("Turn it off ice is cold. The air flow meter. Prices in ate time.")).toBe("Turn it off ice is cold. The air flow meter. Prices in ate time.");
    expect(fix("We sat at the table and the lag grew.")).toBe("We sat at the table and the lag grew.");
  });

  it("restores silently lost ligatures once the document shows the damage", () => {
    const t = "The eect of the rst mode is dierent. An ecient method finds the coecient.";
    expect(fix(t)).toBe("The effect of the first mode is different. An efficient method finds the coefficient.");
    // One odd word in clean text is not enough evidence.
    expect(fix("The rst value.")).toBe("The rst value.");
  });

  it("joins words hyphenated at a line end", () => {
    expect(fix("the response is differ-\nent from the static one")).toBe("the response is different\nfrom the static one");
    expect(fix("a self-\nadjoint operator")).toBe("a self-adjoint\noperator");
    expect(fix("it is well-known; a well-\nknown result.\nNext")).toBe("it is well-known; a well-known\nresult.\nNext");
  });

  it("removes soft hyphens and joins letter-spaced words seen intact", () => {
    expect(fix("damp\u00ADing and damp\u00AD\ning")).toBe("damping and damping");
    expect(fix("S u m m a r y\nThe summary of x y z")).toBe("Summary\nThe summary of x y z");
  });

  it("undoes OCR letter-shape confusions by the majority spelling", () => {
    const t = "The modal mass. The modal shape. The modal damping. The rnodal mass. The c1assic modal form.";
    expect(fix(t, { ocr: true })).toContain("The modal mass. The modal shape. The modal damping. The modal mass.");
    // A PDF's own text layer can be an old scan's OCR, so it gets the same repair; real words stay.
    expect(fix(t)).toContain("The modal mass. The c1assic");
    expect(fix("The modern view. The modern way. The modern form. A modem.")).toContain("A modem.");
  });

  it("reads an old scan's J and $ for f and fi", () => {
    const t = "The finite field. A finite field again. Each finite field. The Jinite element and the strain$eld. ModiJed by the modified, modified, modified rule.";
    expect(fix(t)).toContain("The finite element and the strain field. Modified by");
  });

  it("reports what it fixed", () => {
    const r = repairText("The e ect is di erent.").report;
    expect(r.ligatures).toBe(2);
    expect(repairNote(r)).toMatch(/Repaired 2 words broken at ff\/fi\/fl \(e\.g\. "e ect" → "effect"/);
    expect(repairNote(repairText("Clean text.").report)).toBeNull();
  });
});

describe("key terms", () => {
  const text = "The damping coefficient sets the effect of the logarithmic decrement. The Lagrangian of the system. The Lagrangian gives the equations. Damping coefficient again.";

  it("repairs, respells and grounds key terms", () => {
    expect(repairTerm("damping coe cient", text)).toBe("damping coefficient");
    expect(checkKeywords(["damping coe\uFB03cient", "Lagrangain", "e ect", "quantum chromodynamics", "ect", "Damping coefficient", "c1ass"], text, { strict: true })).toEqual([
      "damping coefficient",
      "Lagrangian",
      "effect",
    ]);
  });

  it("lets AI terms paraphrase a little", () => {
    expect(checkKeywords(["logarithmic decrement method"], text)).toEqual(["logarithmic decrement method"]);
    expect(checkKeywords(["logarithmic decrement method"], text, { strict: true })).toEqual([]);
  });

  it("spots garbled sentences", () => {
    expect(isGarbled("The e ect o ce di erent is large here.")).toBe(true);
    expect(isGarbled("The effect of damping is to reduce the amplitude.")).toBe(false);
    expect(isGarbled("We write x as a function of t in the model.")).toBe(false);
  });
});
