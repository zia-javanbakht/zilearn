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
| 47 | 52 terms for long texts (+0.08, but 66-node maps) | 89.1 | 77.01 | no |
| 48 | 30 terms for short texts | 89.1 | 76.76 | no |
| 49 | 14 main terms for long texts | 89.1 | 75.58 | no |
| 50 | 10 main terms for long texts | 89.1 | 76.56 | no |
| 51 | Operator names from formulas (sym Grad, Div) are never terms | 89.1 | 76.98 | yes |
| 52 | Terms of a section too slight to be a branch go to the sections that are | 89.1 | 76.59 | no |
| 53 | Italic headings at a section title's size are subsections (journal styles): the paper's real hierarchy | 89.1 | 77.67 | yes |
| 54 | A sub-subsection that a term is mostly discussed in is listed beside its subsection, holding the term | 89.1 | 77.81 | yes |
| 55 | A sub-term named like a section is that section's node, not a second one | 89.1 | 77.88 | yes |
| 56 | A term goes to the section whose box defines it (Theorem 2.2 — Divergence Theorem → The Global-to-Local Tools) | 89.1 | 78.21 | yes |
| 57 | Namesakes match without a leading article (The Closed-System Identity); a merged term's sub-terms stay where it was | 89.1 | 78.19 | yes |
| 58 | A section holding one term is a branch too (Conservation of Mass, Finite Elements) | 89.1 | 78.96 | yes |
| 59 | OCR's l for a slash between two words is read back (stresslplane → stress/plane) | 89.1 | 78.96 | yes |
| 60 | A phrase that starts or ends with a verb (ensures, enters, gives) is a clause, not a term | 89.1 | 79.03 | yes |
| 61 | Held-out lesson PDFs: lesson scaffolding (Where this fits, Key terms, Takeaways, Warm-up, Check yourself) is context, not branches; Key terms: lines boost their terms; icon-font bullets; unmarked numbered lines aren't headings where the reader marked them | 89.1 | 79.03 | yes |
| 62 | Held-out lessons: a lesson's map, key-term lists and takeaways don't decide where a term belongs; Map/Where this fits aren't title page; objectives aren't quoted first | 89.1 | 79.03 | yes |
| 63 | Held-out lessons: example and intuition titles that narrate, and step labels, aren't terms; a lesson's Key terms/Connections after its last section is its own context, not a subsection | 89.1 | 79.03 | yes |
| 64 | Source, glossary and pitfall lines aren't quoted as what a term is | 89.1 | 79.03 | yes |
| 65 | Formula cards: the lead is the whole sentence into the equation; a caption's lines are never an equation; eval also counts offline formula cards (0 on main, 89 now) | 89.1 | 78.98 | yes |
| 66 | A lone equation number (12) becomes 	ag{12} | 89.1 | 78.98 | yes |
| 67 | Eval deck keeps one card per answer, as the app does | 89.1 | 78.98 | yes |
| 68 | A radical bar drawn as ffiffiffi reads as √ | 89.1 | 78.98 | yes |
| 69 | No formula cards from a scan's misread or cut-off maths (formula cards 49→39, junk gone) | 89.1 | 78.98 | yes |
| 70 | Boost phrases that name a symbol (Cauchy stress σ) | 89.1 | 78.63 | no |
| 71 | Section notes drop the words leading into an equation that left it out | 89.1 | 79.22 | yes |
| 72 | A figure caption box runs on to its stop and starts with a capital | 89.1 | 79.62 | yes |
| 73 | A term's note prefers a sentence of six words or more over a bare list item | 89.1 | 79.7 | yes |
| 74 | A scrap of maths left open mid-sentence stays in the sentence | 89.1 | 79.7 | yes |
| 75 | A paper of ten sections or fewer keeps every section as a branch | 89.1 | 79.95 | yes |
| 76 | A term goes to the one section whose heading names it | 89.1 | 79.47 | no |
| 77 | A head noun nearly always qualified is named by its most used phrase (consistent tangent) | 89.1 | 80.03 | yes |
| 78 | A word mostly qualifying others is dropped for its main phrase | 89.1 | 80.03 | no |
| 79 | A long technical word used often ranks as a term of its own | 89.1 | 80.29 | yes |
| 80 | A long word qualified many ways stays a term | 89.1 | 80.22 | no |
| 81 | No terms ending on a joining word (distributed based, linear plus) | 89.1 | 80.29 | yes |
| 82 | A heading's run of garbled OCR words reads as the document's closest phrase | 89.1 | 80.29 | yes |
| 83 | A leading term stays a sub-branch though its one sentence is quoted already (committed with 84) | 89.1 | 80.32 | yes |
| 84 | A box that states only a formula gives its term that formula as its note | 89.1 | 80.46 | yes |
| 85 | A sub-term another section's heading names goes to that section | 89.1 | 80.46 | yes |
| 86 | A sub-term quoted from a section no term went to goes there | 89.1 | 80.29 | no |
| 87 | A term's quoted bullet reads as a sentence: capital first, stop at the end | 89.1 | 80.53 | yes |
| 88 | A section note reads each list item as a sentence of its own | 89.1 | 80.64 | yes |
| 89 | The paper's leading term, named in its title, is a branch of its own | 89.1 | 80.6 | no |
| 90 | One term in two word forms (pseudo-ductility/pseudo-ductile behavior) is mapped once | 89.1 | 80.62 | yes |
| 91 | A built-up formula's pieces on short lines join its block, down to its number | 89.1 | 80.62 | yes |
| 92 | An exercise's lettered part is a sentence about maths, not an equation | 89.1 | 80.62 | yes |
