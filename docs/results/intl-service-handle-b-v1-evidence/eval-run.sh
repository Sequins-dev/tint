#!/bin/zsh
# (1) Eval-preparation counters: pre-engine aeac2897 vs engine main 6412d984f vs handle 6f7436e4c, alternating.
# (2) Native Test262 regression set for the handle (DTF, DurationFormat, Date, Temporal toLocaleString).
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-f3c644cf
B=.tint-bootstrap/b-resume
export PATH=$HOME/.nvm/versions/node/v24.12.0/bin:$PATH NODE_OPTIONS=--max-old-space-size=8192 TINT_TEST262_HEARTBEAT_MS=30000 TINT_TEST262_STALL_MS=150000
export TINT_NATIVE_SERVICE_CACHE=$PWD/.tint-bootstrap/native-service-cache
cp $B/perf2/pre-engine.eval24 $B/perf3/pre-engine.eval24
for spec in "frozen-main-6412d984f main-engine aot" "frozen-handle-v2 handle aot"; do
  set -- ${=spec}
  echo "=== $(date -u +%T) build $2"
  PERF_ONLY=eval24 node $B/perf-batch-bench.mjs $B/$1 $B/perf-array64-v1.variants.json $2 $B/perf3/$2.json $3 2> $B/perf3/$2.stderr
  echo "exit=$?"
  cp $B/perf3/$2.json.eval24.image $B/perf3/$2.eval24.tmp && chmod 755 $B/perf3/$2.eval24.tmp && mv $B/perf3/$2.eval24.tmp $B/perf3/$2.eval24
done
for rep in 1 2 3; do
  for img in pre-engine main-engine handle; do
    echo "=== $(date -u +%T) eval24 $img rep$rep load $(uptime | sed 's/.*load averages: //')"
    $B/perf-inferior.sh $B/perf3/$img.eval24 2 $B/perf3/instr-eval24-$img-rep$rep.tsv 1
  done
done
echo PERF3-DONE
echo "=== $(date -u +%T) test262 handle regression"
export TINT_TEST262_JOURNAL=$B/handle-intl-regression-v1.jsonl TINT_TEST262_VARIANTS=$B/handle-intl-regression-v1.variants.json
export TINT_TEST262_CONTAINMENT_MS=300000 TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct
export TINT_TEST262_SOURCES=$PWD/$B/frozen-handle-v2/source-snapshot.json
node $B/frozen-handle-v2/tools/test262-native-run.ts .tint-bootstrap/test262 language 64 > $B/handle-intl-regression-v1.json 2> $B/handle-intl-regression-v1.stderr
echo "test262 exit=$?"
echo RUN3-DONE
