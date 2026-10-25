# Improvement iterations: structure extraction and brainmap

Each iteration: find a weakness in the offline output, change the code, re-run `eval/run.sh`, keep the change only if neither mean score drops (and the test suite passes).

Baseline (main c100b8c): extraction 85.01, brainmap 55.24. Reference point: the AI-path brainmaps judged 92-95 by the examiner earlier score 82.7 / 89.7 / 85.9 here.

| # | Change | Extraction | Brainmap | Kept |
|---|---|---|---|---|
| 0 | Baseline | 85.01 | 55.24 | |
