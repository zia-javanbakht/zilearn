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
