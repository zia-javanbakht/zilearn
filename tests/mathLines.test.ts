import { describe, expect, it } from "vitest";
import { isMathLine, markDisplayMaths } from "@/lib/mathLines";

describe("display maths in a PDF's text", () => {
  it("tells equation lines from sentences that mention maths", () => {
    expect(isMathLine("F = Grad φ = I + Grad u, J = det F > 0.")).toBe(true);
    expect(isMathLine("∫_{B0} ρ0b · φ dV −")).toBe(true);
    expect(isMathLine("Div P + ρ0b = 0 in B0, (1)")).toBe(true);
    expect(isMathLine("we recover ∫_{B0} P : Grad η dV =")).toBe(false);
    expect(isMathLine("The Jacobian 𝑱 = 𝜕(𝑥, 𝑦)/𝜕(𝜉 , 𝜂) is the link between natural and physical space")).toBe(false);
    expect(isMathLine("- h-refinement: reduce element size ℎ, fixed 𝑝")).toBe(false);
    expect(isMathLine("Elastic modulus (GPa) 294 620 3.15 4.1 5.2")).toBe(false);
  });

  it("marks each run of equation lines as one block KaTeX can render", () => {
    const text = "The strong form is\nDiv P + ρ0b = 0 in B0, (1)\nφ = φ̄ on Γφ, (2)\nHere, ρ0 is the density.\n𝒙 = ∑\n𝑖\n𝑁𝑖 𝒙𝑖";
    expect(markDisplayMaths(text)).toBe("The strong form is\n$$Div P + ρ0b = 0 in B0, (1) φ = φ̄ on Γφ, (2)$$\nHere, ρ0 is the density.\n$$𝒙 = ∑ 𝑖 𝑁𝑖 𝒙𝑖$$");
    // LaTeX's own characters are escaped; a line it still can't read stays text.
    expect(markDisplayMaths("a & b = 50%")).toBe("$$a \\& b = 50\\%$$");
    // Text that already has maths blocks (an AI transcription) is left alone.
    expect(markDisplayMaths("$$x = 1$$\ny = 2")).toBe("$$x = 1$$\ny = 2");
  });
});
