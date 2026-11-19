#!/usr/bin/env bash
# Batch run for the photo decoder checks. From beefgrading.study: bash ../fleece-grader/dev/photo-decode-check.sh [port]
# Starts the dev server, runs each scenario in a fresh headless Chrome, stops the server.
PORT=${1:-8077}; SHOT=../.claude/tools/cdp-shot.mjs; BASE=http://localhost:$PORT/index.html
python ../fleece-grader/dev/devserver.py $PORT >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT; sleep 2
run() { printf '%s: ' "$1"; shift; node $SHOT "$BASE" 390 - --wait 1200 --eval "import('/dev/photo-decode-check.js').then(m => m.$1)" | head -c 600; echo; }
K1='Scan from 2026-11-18 09_39_02 AM.jpg'; K2='Scan from 2026-11-18 12_13_16 PM.jpg'
for S in sheet02 sheet05; do
  run "$S normal"   "sheet('$S')"
  run "$S stub"     "sheet('$S', { stub: true })"
  run "$S noimg"    "sheet('$S', { noimg: true })"
done
run "key1 normal" "key('$K1')"; run "key1 stub" "key('$K1', { stub: true })"
run "key2 normal" "key('$K2')"; run "key2 stub" "key('$K2', { stub: true })"
run "big 8064x6048 EXIF-6 (stub)" "sheet('sheet02', { file: '/assets/test/excluded/big-sheet02.jpg', stub: true })"
run "big 8064x6048 EXIF-6" "sheet('sheet02', { file: '/assets/test/excluded/big-sheet02.jpg' })"
run "big 6048x8064 canvas upscale" "sheet('sheet02', { big: '6048x8064' })"
run "bad" "bad()"
