#!/bin/zsh
# Sequential matched compile benchmarks on one runner slot: before, after (aot), after (monolithic), then before/after repeats.
set -u
cd /Users/stephenbelanger/.t3/worktrees/tint/t3-f3c644cf
B=.tint-bootstrap/b-resume
export PATH=$HOME/.nvm/versions/node/v24.12.0/bin:$PATH NODE_OPTIONS=--max-old-space-size=8192 TINT_TEST262_HEARTBEAT_MS=30000
export TINT_NATIVE_SERVICE_CACHE=$PWD/.tint-bootstrap/native-service-cache
M=$B/perf-array64-v1.variants.json
for spec in "frozen-main-b45 before-1 monolithic" "frozen-intl-v4 after-aot-1 aot" "frozen-intl-v4 after-mono-1 monolithic" "frozen-main-b45 before-2 monolithic" "frozen-intl-v4 after-aot-2 aot"; do
  set -- ${=spec}
  echo "=== $(date -u +%T) $2 $(uptime | sed 's/.*load averages: //')"
  node $B/perf-batch-bench.mjs $B/$1 $M $2 $B/perf/$2.json $3 2> $B/perf/$2.stderr
  echo "exit=$? $(date -u +%T)"
done
echo PERF-DONE
