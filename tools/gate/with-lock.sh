#!/bin/sh
# Runs a command under the shared launch and/or timing lock through the fair
# FIFO queue in lock.ts, or prints the holders and the queue.
set -eu
usage() {
  echo 'Usage: with-lock.sh launch|timing|both LABEL COMMAND [ARG ...]' >&2
  echo '       with-lock.sh status' >&2
  exit 2
}
gate_tool=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lock.ts
export TINT_GATE_EXCLUSIVE_LOCK="${TINT_GATE_EXCLUSIVE_LOCK:-$HOME/.t3/tint-gate.lock}"
export TINT_GATE_TIMING_LOCK="${TINT_GATE_TIMING_LOCK:-$HOME/.t3/tint-timing.lock}"
case "${1:-}" in
  status) test "$#" -eq 1 || usage; exec node "$gate_tool" status ;;
  launch|timing) resource=$1 ;;
  both) resource=timing-and-launch ;;
  *) usage ;;
esac
shift
test "$#" -ge 2 || usage
mkdir -p "$(dirname -- "$TINT_GATE_EXCLUSIVE_LOCK")" "$(dirname -- "$TINT_GATE_TIMING_LOCK")"
exec node "$gate_tool" "$resource" "$@"
