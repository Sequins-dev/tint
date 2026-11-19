#!/bin/sh
set -eu
if [ "$(uname -s)" != Linux ]; then
  echo 'Run this gate on the Linux dev machine.' >&2
  exit 1
fi
gate_tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$gate_tools/common.sh"
export TZ=UTC
unset TINT_GATE_EXCLUSIVE_LOCK

run_step build unlocked pnpm build
storage_tests
bootstrap unlocked
stage_lldb watchdog stage1 stage2
stage_step stage3 watchdog "$gate_output/stage2" "$gate_output/source" "$gate_output/stage3"
echo stage3=0
run_step compare-stage1 unlocked cmp "$gate_output/stage1" "$gate_output/stage2"
run_step compare-stage2 unlocked cmp "$gate_output/stage2" "$gate_output/stage3"
echo LINUX_STAGE1_EQ_2_EQ_3
run_step stage-hashes unlocked sha256sum "$gate_output/stage1" "$gate_output/stage2" "$gate_output/stage3"
test "$(git rev-parse HEAD)" = "$gate_head"
