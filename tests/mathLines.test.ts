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
    // A scrap of an integral's line, left open mid-sentence, stays in the sentence.
    expect(markDisplayMaths("The angular momentum of the cut-out is H = ∫S\n𝒙 ×\n𝜌𝒗 d𝑣. Its rate of change follows.")).toBe("The angular momentum of the cut-out is H = ∫S\n𝒙 ×\n𝜌𝒗 d𝑣. Its rate of change follows.");
    // A built-up formula's pieces on short lines, down to its number, are one block.
    expect(markDisplayMaths("determined as follows:\nσ = σ0[\nln\n( 1\n1 − η\n)] 1\nm\n(1)\nwhere η is a random number.")).toBe("determined as follows:\n$$σ = σ0[ ln ( 1 1 − η )] 1 m \\tag{1}$$\nwhere η is a random number.");
    // An exercise's part is a sentence about maths.
    expect(markDisplayMaths("Exercise.\n(a) Derive S = ∂Ψ/∂E and K = dR/dd. Verify P = λS independently.")).toBe("Exercise.\n(a) Derive S = ∂Ψ/∂E and K = dR/dd. Verify P = λS independently.");
    // A lone equation number is LaTeX's tag.
    expect(markDisplayMaths("Text before.\nE = mc^2 (3)")).toBe("Text before.\n$$E = mc^2 \\tag{3}$$");
    // Text that already has maths blocks (an AI transcription) is left alone.
    expect(markDisplayMaths("$$x = 1$$\ny = 2")).toBe("$$x = 1$$\ny = 2");
  });
});
