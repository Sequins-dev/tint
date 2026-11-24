#!/bin/sh
# The whole Linux gate in sequence on the Linux dev machine. CI splits the
# same jobs across runners (tools/gate/ci.sh); see docs/validation-gate.md.
set -eu
if [ "$(uname -s)" != Linux ]; then
  echo 'Run this gate on the Linux dev machine.' >&2
  exit 1
fi
gate_tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$gate_tools/common.sh"
. "$gate_tools/jobs.sh"
export TZ=UTC
unset TINT_GATE_EXCLUSIVE_LOCK

run_step build unlocked pnpm build
storage_tests
bootstrap unlocked
fixpoint watchdog
test "$(git rev-parse HEAD)" = "$gate_head"
