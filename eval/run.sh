#!/bin/sh
# Offline evaluation: dump extraction + brainmap for the fixture papers, then score them.
# usage: eval/run.sh OUTDIR [score.py options, e.g. --compare eval/baseline.json -v]
set -e
OUT=${1:?usage: eval/run.sh OUTDIR [--compare base.json] [-v]}; shift
rm -rf "$OUT"; mkdir -p "$OUT"
EVAL_OUT="$OUT" npx vitest run tests/evalDump.test.ts >"$OUT/vitest.log" 2>&1 || { tail -30 "$OUT/vitest.log"; exit 1; }
python3 "$(dirname "$0")/score.py" "$OUT" --save "$OUT/scores.json" "$@"
