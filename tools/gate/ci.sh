#!/bin/sh
# Runs one job of the CI gate (.github/workflows/gate.yml). The bootstrap job
# packs its build into bundles under $TINT_CI_BUNDLES and reports each
# bundle's SHA-256; every other job checks the SHA-256 it was handed before
# unpacking. See docs/validation-gate.md.
set -eu
usage() {
  echo 'Usage: ci.sh static|bootstrap [TARGET]|fixpoint|tests SHARD|native SHARD|test262-host|test262' >&2
  exit 2
}
job=${1:-}
test -n "$job" || usage
shift
gate_tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$gate_tools/common.sh"
. "$gate_tools/jobs.sh"
# A CI job owns its runner, so its bundles and locks live in the job's
# temporary directory. The locks still order LLDB launches and heavy builds
# within the job.
ci_temp=${RUNNER_TEMP:-$gate_output}
bundles=${TINT_CI_BUNDLES:-$ci_temp/tint-bundles}
export TINT_GATE_EXCLUSIVE_LOCK="${TINT_GATE_EXCLUSIVE_LOCK:-$ci_temp/tint-gate/exclusive.lock}"
export TINT_GATE_MEMORY_DIRECTORY="${TINT_GATE_MEMORY_DIRECTORY:-$ci_temp/tint-gate/memory}"
mkdir -p "$(dirname -- "$TINT_GATE_EXCLUSIVE_LOCK")"
case "$(uname -s)" in
  Darwin)
    lldb_resource=exclusive
    ;;
  *) lldb_resource=watchdog ;;
esac
# On a native Linux x86-64 runner, enable direct x86-64 native execution.
if [ "$(uname -s)/$(uname -m)" = Linux/x86_64 ]; then
  export TINT_NATIVE_RUNNER="${TINT_NATIVE_RUNNER:-x64-local}"
  export TINT_X64_HOSTED_RUNNER="${TINT_X64_HOSTED_RUNNER:-x64-local}"
  export TINT_X64_RUNNER_TEST="${TINT_X64_RUNNER_TEST:-x64-local}"
  export TINT_X64_SCALAR_RUNNER="${TINT_X64_SCALAR_RUNNER:-x64-local}"
fi

# Runner hardware differs between jobs; record it beside the timings.
{
  uname -a
  if [ "$(uname -s)" = Darwin ]; then
    sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize
  else
    grep -m 1 'model name' /proc/cpuinfo || true
    nproc
    grep MemTotal /proc/meminfo
  fi
} >"$gate_output/host.txt" 2>&1 || true
printf 'host %s\n' "$(tr '\n' ' ' <"$gate_output/host.txt")"

# Records a job output for the workflow and in the evidence.
output() {
  printf '%s=%s\n' "$1" "$2" | tee -a "$gate_output/outputs.txt"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
  fi
}

sha256() {
  gate_sha256 "$1" | cut -d ' ' -f 1
}

# pack NAME DIRECTORY PATH...: archives PATHs under DIRECTORY with this
# commit, and reports the archive's SHA-256 as the output NAME-bundle-sha256.
pack() {
  pack_name=$1 pack_root=$2
  shift 2
  mkdir -p "$gate_output/.tint-bootstrap" "$bundles"
  git rev-parse HEAD >"$gate_output/.tint-bootstrap/$pack_name.head"
  tar -cf "$bundles/$pack_name.tar" \
    -C "$gate_output" ".tint-bootstrap/$pack_name.head" -C "$pack_root" "$@"
  output "$pack_name-bundle-sha256" "$(sha256 "$bundles/$pack_name.tar")"
}

# unpack NAME EXPECTED-SHA256 DIRECTORY: fails unless the bundle matches the
# producing job's report and was built from this commit.
unpack() {
  unpack_file="$bundles/$1.tar"
  if [ -z "$2" ]; then
    echo "No SHA-256 was reported for bundle $1." >&2
    exit 1
  fi
  unpack_actual=$(sha256 "$unpack_file")
  if [ "$unpack_actual" != "$2" ]; then
    printf 'Bundle %s has SHA-256 %s; its job reported %s.\n' "$1" "$unpack_actual" "$2" >&2
    exit 1
  fi
  mkdir -p "$3"
  # -m: unpacked files are newer than this checkout's sources.
  tar -xmf "$unpack_file" -C "$3"
  unpack_head=$(cat "$3/.tint-bootstrap/$1.head")
  if [ "$unpack_head" != "$gate_head" ]; then
    printf 'Bundle %s was built from %s, not %s.\n' "$1" "$unpack_head" "$gate_head" >&2
    exit 1
  fi
  echo "bundle $1 sha256=$unpack_actual verified"
}

# The Node-hosted toolchain's TypeScript output from the bootstrap job.
unpack_build() {
  unpack build "${TINT_CI_BUILD_BUNDLE_SHA256:-}" "$gate_root"
}

case "$job" in
  static)
    test "$#" -eq 0 || usage
    static_checks
    ;;
  bootstrap)
    # TARGET cross-builds stage 1; Node compiles it identically on any host.
    test "$#" -le 1 || usage
    run_step build unlocked pnpm build
    echo build=0
    storage_tests
    bootstrap unlocked "${1:-}"
    output stage1-sha256 "$(sha256 "$gate_output/stage1")"
    pack build "$gate_root" packages/*/dist packages/*/tsconfig.tsbuildinfo
    pack stage1 "$gate_output" stage1 source
    ;;
  fixpoint)
    test "$#" -eq 0 || usage
    unpack stage1 "${TINT_CI_STAGE1_BUNDLE_SHA256:-}" "$gate_output"
    stage1_actual=$(sha256 "$gate_output/stage1")
    if [ "$stage1_actual" != "${TINT_CI_STAGE1_SHA256:-}" ]; then
      printf 'stage1 has SHA-256 %s; the bootstrap job reported %s.\n' \
        "$stage1_actual" "${TINT_CI_STAGE1_SHA256:-}" >&2
      exit 1
    fi
    echo "stage1 sha256=$stage1_actual verified"
    fixpoint "$lldb_resource"
    ;;
  tests)
    test "$#" -eq 1 || usage
    unpack_build
    find_test262
    workspace_tests "$1"
    ;;
  native)
    test "$#" -eq 1 || usage
    unpack_build
    native_checks "$1"
    ;;
  test262-host)
    # Any host with the memory for it compiles TINT_NATIVE_TARGET's units host.
    test "$#" -eq 0 || usage
    run_step build unlocked pnpm build
    echo build=0
    find_test262
    freeze_toolchain unlocked
    output toolchain-sha256 "$frozen_toolchain"
    test262_unit_host unlocked "$gate_output/unit-host"
    output unit-host-sha256 "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sha256' "$host_report")"
    pack unit-host "$gate_output" unit-host
    ;;
  test262)
    test "$#" -eq 0 || usage
    unpack_build
    unpack unit-host "${TINT_CI_UNIT_HOST_BUNDLE_SHA256:-}" "$gate_output"
    find_test262
    freeze_toolchain unlocked
    # The host's cache key includes the toolchain; name a mismatch directly.
    if [ "$frozen_toolchain" != "${TINT_CI_UNIT_HOST_TOOLCHAIN:-}" ]; then
      printf 'Frozen toolchain %s differs from the unit host'"'"'s %s.\n' \
        "$frozen_toolchain" "${TINT_CI_UNIT_HOST_TOOLCHAIN:-}" >&2
      exit 1
    fi
    test262_smoke unlocked require "$gate_output/unit-host"
    ;;
  *) usage ;;
esac
test "$(git rev-parse HEAD)" = "$gate_head"
echo "CI-$job-DONE"
