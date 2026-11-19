#!/bin/sh
set -eu
if [ "$(uname -s)/$(uname -m)" != Darwin/arm64 ]; then
  echo 'The macOS gate requires Darwin arm64.' >&2
  exit 1
fi
gate_tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$gate_tools/common.sh"

export TINT_GATE_EXCLUSIVE_LOCK="${TINT_GATE_EXCLUSIVE_LOCK:-$HOME/.t3/tint-gate.lock}"
export TINT_GATE_MEMORY_DIRECTORY="${TINT_GATE_MEMORY_DIRECTORY:-$HOME/.t3/tint-gate-memory}"
test262_link="$gate_root/.tint-bootstrap/test262"
test262=${TINT_GATE_TEST262:-$test262_link}
if [ ! -d "$test262/test" ] && [ -z "${TINT_GATE_TEST262:-}" ]; then
  test262="$HOME/Code/nodejs/tint/.tint-bootstrap/test262"
fi
if [ ! -d "$test262/test" ]; then
  printf 'Test262 checkout is missing at %s. Set TINT_GATE_TEST262.\n' "$test262" >&2
  exit 1
fi
# A workspace module-graph test reads this path directly; mirror the old gate.
if [ ! -e "$test262_link" ]; then
  test262=$(CDPATH= cd -- "$test262" && pwd -P)
  ln -sfn "$test262" "$test262_link"
fi

run_step build unlocked pnpm build
echo build=0
run_step catalog unlocked sh -e -c '
  node tools/generate-compiler-catalog.ts "$1"
  pnpm exec prettier --stdin-filepath packages/compiler/src/catalog.ts <"$1" >"$2"
  diff -u packages/compiler/src/catalog.ts "$2"
' tint-catalog "$gate_output/catalog.raw.ts" "$gate_output/catalog.ts"
echo catalog-dirty=0

run_step subset memory node --test --test-name-pattern="complete native compiler pipeline" tools/selfhost-linked.test.ts
echo subset=0
run_check_step() {
  run_step "$@" || {
    check_status=$?
    echo "check=$check_status"
    exit "$check_status"
  }
}
run_check_step check-concurrent unlocked env -u TZ pnpm check:concurrent
run_check_step check-memory memory env -u TZ node tools/check-test-files.ts memory
gate_step_timeout=${TINT_GATE_NATIVE_TIMEOUT:-1800} run_check_step check-native exclusive env -u TZ node tools/check-test-files.ts native
awk '/^ℹ pass / { pass += $3 } /^ℹ fail / { fail += $3 } END { printf "check=0 ℹ pass %d ℹ fail %d\n", pass, fail }' \
  "$gate_output"/check-*.log
storage_tests

bootstrap memory
stage_lldb memory-watchdog stage1 stage2
stage_lldb memory-watchdog stage2 stage3
run_step compare unlocked cmp "$gate_output/stage2" "$gate_output/stage3"
echo STAGE2_EQ_STAGE3
run_step stage-hashes unlocked shasum -a 256 "$gate_output/stage1" "$gate_output/stage2" "$gate_output/stage3"

run_step freeze memory node --input-type=module -e '
  import { freezeNodeToolchain } from "./tools/frozen-node-toolchain.ts";
  import { workspaceSources } from "./tools/workspace-sources.ts";
  console.log(freezeNodeToolchain(workspaceSources(), process.argv[1]));
' "$gate_output/toolchain"
echo freeze=0
for linking in units program; do
  smoke_json="$gate_output/smoke-$linking.json"
  smoke_err="$gate_output/smoke-$linking.err"
  smoke_status=0
  run_step_logged "smoke-$linking" memory "$smoke_json" "$smoke_err" env TZ=UTC \
    TINT_TEST262_LINKING="$linking" NODE_OPTIONS=--max-old-space-size=16000 \
    TINT_GATE_STEP_TIMEOUT="${TINT_GATE_SMOKE_TIMEOUT:-600}" \
    TINT_GATE_LAUNCH_LOCK="$TINT_GATE_EXCLUSIVE_LOCK" \
    node "$gate_output/toolchain/tools/test262-native-run.ts" "$test262" \
    language/expressions/object/11.1.5-0-1.js 128 || smoke_status=$?
  if [ "$smoke_status" -eq 0 ]; then
    result=$(node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const { totals } = JSON.parse(readFileSync(process.argv[1], "utf8"));
      console.log(totals.passed + "/" + totals.total);
      if (totals.passed !== 2 || totals.total !== 2) process.exitCode = 1;
    ' "$smoke_json") || smoke_status=$?
  else
    result=incomplete
  fi
  echo "smoke $linking exit=$smoke_status $result"
  if [ "$smoke_status" -ne 0 ]; then exit "$smoke_status"; fi
done

test "$(git rev-parse HEAD)" = "$gate_head"
echo MAC-DONE
