# Improvement iterations: structure extraction and brainmap

Each iteration: find a weakness in the offline output, change the code, re-run `eval/run.sh`, keep the change only if the test suite passes and the two mean scores together improve, with neither dropping by more than 0.3 (a neutral change that fixes a visible defect is kept too).

Baseline (main c100b8c): extraction 85.01, brainmap 62.12. Reference point: the AI-path brainmaps judged 92-95 by the examiner earlier score 82.7 / 89.7 / 85.9 here.

| # | Change | Extraction | Brainmap | Kept |
|---|---|---|---|---|
| 0 | Baseline | 85.01 | 62.12 | |
| 1 | Box labels (Definition/Theorem/Keypoint names) become key terms, quoted from the box | 85.01 | 64.62 | yes |
| 2 | More main terms for long documents; offline, a paper's sections gather more than 8 main terms (the AI path groups them itself) | 85.01 | 65.29 | yes |
| 3 | Headings run into their paragraph ("Effect of …: ", "2.3.1. Title. Text") start sections | 85.01 | 66.36 | yes |
| 4 | Lettered appendix headings (A, A.1, B Exercises); exercises, hints and quizzes don't supply key terms; en-dash names (Piola–Kirchhoff) are one word | 85.01 | 67.84 | yes |
| 5 | Names joined by an en dash match their sentences, so they get notes | 85.01 | 68.18 | yes |
| 6 | Section titles as candidate key terms (boost 2) | 85.01 | 67.20 | no |
| 7 | Section titles boost key terms the text uses (x1.5) | 85.01 | 68.02 | no |
| 8 | Lone adjectives and words mostly used inside longer terms aren't key terms; quiz/exercise sections never gather terms | 85.01 | 68.47 | yes |
| 9 | A term's note is the first quote no other term's note uses | 85.01 | 68.20 | no |
| 10 | A list item's label ("- Jacobian ratio: …") is a key term the item defines | 85.01 | 69.01 | yes |
| 11 | Key terms keep the text's own capitals: names (Jacobian, Piola–Kirchhoff) stay capitalised, Title Case labels don't | 85.01 | 69.01 | yes |
| 12 | Figure labels up to 7 words ("Same internal virtual work after integration") are folded into the diagram pointer | 85.41 | 68.8 | yes |
| 13 | Display equations in a PDF's text become $$…$$ blocks (KaTeX-checked); sentences keep the equation they lead into | 86.65 | 68.93 | yes |
| 14 | Exponents set smaller after a capital or bracket (pdfTeX's Fᵀ, F⁻ᵀ, (QF)ᵀ) are read as ^T, ^{−T} | 87.23 | 68.84 | yes |
| 15 | Stacked fractions (numerator over denominator) are read as a/b on one line, e.g. P = ∂Ψ/∂F | 87.41 | 68.81 | yes |
| 16 | A document's sections gather its terms from 6 main terms up (was 9) | 87.41 | 69.43 | yes |
| 17 | Within a section branch, its subsections are branches too, holding the terms they discuss most | 87.41 | 72.21 | yes |
| 18a | A term goes to the section named after it | 87.41 | 71.41 | no |
| 18 | A term a section is named after merges into that section's branch (no duplicate node) | 87.41 | 72.19 | yes |
| 19 | A numbered title with a colon ("4.2. Example 1: A plane element") stays one heading | 87.41 | 72.32 | yes |
| 20 | Headings (or exercise titles) count as a mention of the terms they name | 87.41 | 72.23 | no |
| 21 | OCR shape fixes (J for f, n for ll) also run on a PDF's own text layer, which may be an old scan's OCR | 87.67 | 72.36 | yes |
| 22 | OCR section numbers (2.2.I . → 2.2.1.) and l for slash; headings right, but 6.1 now hides the 6.1.1 Beam bending part | 87.82 | 71.88 | no |
| 23 | A term sharing no sentence with a main term goes under the nearest main term of its section, after the others take their quotes | 87.67 | 73.09 | yes |
| 24 | Up to 6 sub-terms per main term (was 5) | 87.67 | 73.1 | no |
| 25a | Exercise and quiz sentences count toward terms at weight 0.75 | 87.67 | 73.44 | no |
| 25 | Exercise and quiz sentences count toward a term at half weight (never quoted) | 87.67 | 73.55 | yes |
| 26 | A box's sentences count as mentions of the term its label names, so the term is placed with the main term they discuss | 87.67 | 73.75 | yes |
| 27 | Terms sharing only 'of the X' (role of / two uses of the Jacobian) are not pieces of one name | 87.67 | 73.85 | yes |
| 28 | A box label line (Keypoint 2.2 — …) starts its own paragraph even after chart labels, so its term is read | 87.67 | 74.85 | yes |
| 29 | A figure caption that names what it shows (Figure 4. Graded mesh: …) is read as a box naming a term | 87.67 | 75.28 | yes |
| 30 | A longer term isn't dropped for a word that is itself mostly part of phrases (Weibull modulus is kept) | 87.67 | 75.4 | yes |
| 31 | A single-word term used 6+ times is penalised less (×0.8, was ×0.6): objectivity, delamination | 87.67 | 75.92 | yes |
| 32 | Single-word penalty ×0.95 at 6+ uses | 87.67 | 75.78 | no |
| 33 | Single-word penalty eased from 4 uses | 87.67 | 75.92 | no |
| 34 | Evidence avoids sentences thick with maths symbols | 87.67 | 75.76 | no |
| 35 | Long sentences are no longer cut into 30-word pieces when they end with a stop, and never inside an equation | 87.67 | 76.11 | yes |
| 36 | Subscripts are read in equations (ϵ_{ik}, and U_i^{j+} where pdf.js ends the line between exponent and subscript); prose keeps 𝑆𝑝 | 88.42 | 76.51 | yes |
| 37 | An exponent's broken-font minus or plus (\u0001, þ) stays in the exponent: U_i^{j−} | 88.56 | 76.51 | yes |
| 38 | In a symbol-font equation, big brackets and raised fraction parts stay on the equation's line (Hashin criteria) | 88.75 | 76.51 | yes |
| 39 | An exponent after a big symbol-font bracket is read against the line's baseline: (σ11/XT)^2 | 88.85 | 76.51 | yes |
| 40 | A subscript's digits and an equation's (8) tag no longer make an equation line look like a table row | 88.88 | 76.51 | yes |
| 41 | A term named like any section merges into that section, wherever the term was placed (no duplicate Stress measures) | 88.88 | 76.52 | yes |
| 42 | Single word dropped when a third of its uses are inside phrases (was half) | 88.88 | 76.52 | no |
| 43 | OCR'd section numbers are read as numbers (2.2.I . → 2.2.1., 3. I . → 3.1.) | 89.03 | 76.43 | yes |
| 44 | OCR's J and $ for the fi ligature are read back (ModiJed → Modified, strain$eld → strain field) | 89.03 | 76.43 | yes |
| 45 | A Roman numeral OCR read as ones in a capitals heading is put back (MODEL PROBLEM 11: → II:) | 89.1 | 76.43 | yes |
| 46 | A long paper or chapter maps up to 44 terms (was 36) | 89.1 | 76.93 | yes |
