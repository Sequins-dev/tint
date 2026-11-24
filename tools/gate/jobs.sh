# The validation gate's jobs, sourced after common.sh. The local gates run
# them in sequence on one host; CI runs each as its own job (tools/gate/ci.sh)
# and hands the bootstrap job's build to the others as a verified bundle.
# See docs/validation-gate.md.

# Typecheck, boundaries, formatting and the generated catalog. None of these
# depend on the host, so CI runs them once.
static_checks() {
  run_step build unlocked pnpm build
  run_step catalog unlocked sh -e -c '
    node tools/generate-compiler-catalog.ts "$1"
    pnpm exec prettier --stdin-filepath packages/compiler/src/catalog.ts <"$1" >"$2"
    diff -u packages/compiler/src/catalog.ts "$2"
  ' tint-catalog "$gate_output/catalog.raw.ts" "$gate_output/catalog.ts"
  echo catalog-dirty=0
  run_step typecheck unlocked sh -e -c '
    pnpm exec tsc -p tsconfig.tests.json
    pnpm exec tsc -p tsconfig.host.json
  '
  run_step boundaries unlocked pnpm boundaries
  run_step format unlocked pnpm format:check
  echo static=0
}

storage_tests() {
  run_step storage unlocked node --test packages/ir/test/function-store.test.ts tools/function-store-files.test.ts
  printf 'storage-tests=0 %s\n' "$(grep -E '^ℹ (pass|fail) ' "$step_log" | tr '\n' ' ')"
}

# bootstrap RESOURCE [TARGET]: builds stage 1 with the Node-hosted compiler
# from a fresh source snapshot, for TARGET (default: this host).
bootstrap() {
  run_step bootstrap "$1" env TZ=UTC node tools/bootstrap-compiler.ts \
    "$gate_output/stage1" --snapshot "$gate_output/source" ${2:+--target "$2"}
  echo bootstrap=0
}

# Stage 1 builds stage 2 from the same snapshot under LLDB. Stage 1 is the
# Node-hosted pipeline's output, so stage1 == stage2 shows that the native
# compiler reproduces the Node-hosted build of itself byte for byte.
fixpoint() {
  stage_lldb "$1" stage1 stage2
  run_step compare unlocked cmp "$gate_output/stage1" "$gate_output/stage2"
  echo STAGE1_EQ_STAGE2
  run_step stage-hashes unlocked gate_sha256 "$gate_output/stage1" "$gate_output/stage2"
}

# Runs one check-test-files group (optionally one shard of it) as a step,
# recording per-file times for shard balancing.
check_group() {
  check_step=$1 check_resource=$2
  shift 2
  run_step "$check_step" "$check_resource" env -u TZ \
    TINT_GATE_TEST_FILE_TIMES="$gate_output/$check_step-files.tsv" \
    node tools/check-test-files.ts "$@" || {
    check_status=$?
    echo "check=$check_status"
    exit "$check_status"
  }
  check_summary "$check_step"
}

check_summary() {
  awk '/^ℹ pass / { pass += $3 } /^ℹ fail / { fail += $3 } END { printf "check=0 ℹ pass %d ℹ fail %d\n", pass, fail }' \
    "$gate_output/$1.log"
}

# The selfhost subset is part of the memory group too; it runs first so a
# broken native pipeline fails in seconds.
selfhost_subset() {
  run_step subset memory node --test --test-name-pattern="complete native compiler pipeline" tools/selfhost-linked.test.ts
  echo subset=0
}

memory_checks() {
  selfhost_subset
  check_group check-memory memory memory
}

# workspace_tests INDEX/COUNT: one shard of the concurrent group, then one
# shard of the memory group; the first shard starts with the subset.
workspace_tests() {
  case "$1" in 1/*) selfhost_subset ;; esac
  check_group check-concurrent unlocked concurrent --shard="$1"
  check_group check-memory memory memory --shard="$1"
}

# The native fixtures build and launch images under the gate's memory slots
# and launch lock (see docs/validation-gate.md).
native_checks() {
  native_name=check-native${1:+-$(echo "$1" | tr / -)}
  native_images="$gate_output/native-images.jsonl"
  native_status=0
  TINT_GATE_NATIVE_IMAGES="$native_images" gate_step_timeout=${TINT_GATE_NATIVE_TIMEOUT:-1800} \
    run_step "$native_name" watchdog env -u TZ \
    TINT_GATE_TEST_FILE_TIMES="$gate_output/$native_name-files.tsv" \
    node tools/check-test-files.ts native ${1:+--shard=$1} || native_status=$?
  node tools/gate/native-fixture.ts "$native_images"
  if [ "$native_status" -ne 0 ]; then
    echo "check=$native_status"
    exit "$native_status"
  fi
  check_summary "$native_name"
}

freeze_toolchain() {
  run_step freeze "$1" node --input-type=module -e '
    import { freezeNodeToolchain } from "./tools/frozen-node-toolchain.ts";
    import { workspaceSources } from "./tools/workspace-sources.ts";
    console.log(freezeNodeToolchain(workspaceSources(), process.argv[1]).sha256);
  ' "$gate_output/toolchain"
  frozen_toolchain=$(tail -n 1 "$step_log")
  echo "freeze=0 toolchain=$frozen_toolchain"
}

# The Test262 smoke runs one file (strict and sloppy) through the frozen
# Node-hosted toolchain with linked Script units, the only linking whose
# runtime host can be compiled once and reused (docs/test262-runner.md).
test262_smoke_file=language/expressions/object/11.1.5-0-1.js

# Compiles the linked-unit host into $2 without running a case.
test262_unit_host() {
  host_report="$gate_output/unit-host.json"
  run_step_logged test262-unit-host "$1" "$host_report" "$gate_output/unit-host.err" \
    env TZ=UTC TINT_TEST262_LINKING=units TINT_TEST262_UNIT_HOST=prepare \
    TINT_TEST262_UNIT_HOST_CACHE="$2" NODE_OPTIONS=--max-old-space-size=16000 \
    node "$gate_output/toolchain/tools/test262-native-run.ts" "$test262" \
    "$test262_smoke_file" 128
  cat "$host_report"
}

# test262_smoke RESOURCE [require HOST-CACHE]: with require, the smoke loads
# the host precompiled into HOST-CACHE and fails rather than compile one.
test262_smoke() {
  smoke_json="$gate_output/smoke-units.json"
  smoke_status=0
  run_step_logged smoke-units "$1" "$smoke_json" "$gate_output/smoke-units.err" env TZ=UTC \
    TINT_TEST262_LINKING=units ${2:+TINT_TEST262_UNIT_HOST=$2} \
    TINT_TEST262_UNIT_HOST_CACHE="${3:-.tint-bootstrap/unit-host-cache}" \
    NODE_OPTIONS=--max-old-space-size=16000 \
    TINT_GATE_STEP_TIMEOUT="${TINT_GATE_SMOKE_TIMEOUT:-600}" \
    TINT_GATE_LAUNCH_LOCK="$TINT_GATE_EXCLUSIVE_LOCK" \
    node "$gate_output/toolchain/tools/test262-native-run.ts" "$test262" \
    "$test262_smoke_file" 128 || smoke_status=$?
  if [ "$smoke_status" -eq 0 ]; then
    result=$(node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const { totals, compilation } = JSON.parse(
        readFileSync(process.argv[1], "utf8"),
      );
      console.log(totals.passed + "/" + totals.total);
      if (totals.passed !== 2 || totals.total !== 2) process.exitCode = 1;
      // A Script that fell back to a whole-program batch passes its tests
      // but compiles the runtime per batch.
      if (compilation.batches.some((batch) => batch.linking !== "units")) {
        console.log("units smoke fell back to program linking");
        process.exitCode = 1;
      }
    ' "$smoke_json") || smoke_status=$?
  else
    result=incomplete
  fi
  echo "smoke units exit=$smoke_status $result"
  if [ "$smoke_status" -ne 0 ]; then exit "$smoke_status"; fi
}

# Resolves the pinned Test262 checkout into $test262.
find_test262() {
  test262_link="$gate_root/.tint-bootstrap/test262"
  test262=${TINT_GATE_TEST262:-$test262_link}
  if [ ! -d "$test262/test" ] && [ -z "${TINT_GATE_TEST262:-}" ]; then
    test262="$HOME/Code/nodejs/tint/.tint-bootstrap/test262"
  fi
  if [ ! -d "$test262/test" ]; then
    printf 'Test262 checkout is missing at %s. Set TINT_GATE_TEST262.\n' "$test262" >&2
    exit 1
  fi
  # A workspace module-graph test reads this path directly.
  if [ ! -e "$test262_link" ]; then
    test262=$(CDPATH= cd -- "$test262" && pwd -P)
    ln -sfn "$test262" "$test262_link"
  fi
}
