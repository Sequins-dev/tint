#!/bin/sh
# The whole macOS gate in sequence on the shared Mac. CI splits the same jobs
# across runners (tools/gate/ci.sh); see docs/validation-gate.md.
set -eu
if [ "$(uname -s)/$(uname -m)" != Darwin/arm64 ]; then
  echo 'The macOS gate requires Darwin arm64.' >&2
  exit 1
fi
gate_tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "${1:-}" != --admitted ]; then
  exec node "$gate_tools/lock.ts" mac-budget mac-gate sh "$0" --admitted
fi
. "$gate_tools/common.sh"
. "$gate_tools/jobs.sh"

export TINT_GATE_EXCLUSIVE_LOCK="${TINT_GATE_EXCLUSIVE_LOCK:-$HOME/.t3/tint-gate.lock}"
export TINT_GATE_MEMORY_DIRECTORY="${TINT_GATE_MEMORY_DIRECTORY:-$HOME/.t3/tint-gate-memory}"
export TINT_GATE_NATIVE_CONCURRENCY="${TINT_GATE_NATIVE_CONCURRENCY:-3}"
TINT_GATE_NATIVE_CONCURRENCY=$(node tools/check-test-files.ts native-concurrency)
export TINT_GATE_NATIVE_CONCURRENCY
printf "check-native-concurrency=%s\n" "$TINT_GATE_NATIVE_CONCURRENCY" | tee "$gate_output/check-native-concurrency.txt"
find_test262

static_checks
check_group check-concurrent unlocked concurrent
memory_checks
native_checks
storage_tests

bootstrap memory
fixpoint exclusive

freeze_toolchain memory
test262_smoke memory

test "$(git rev-parse HEAD)" = "$gate_head"
echo MAC-DONE
