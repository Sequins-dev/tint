#!/bin/sh
set -eu
case "${1:-}" in
  launch|timing|both) resource=$1; shift ;;
  *) echo 'Usage: with-lock.sh launch|timing|both LABEL COMMAND [ARG ...]' >&2; exit 2 ;;
esac
test "$#" -ge 2
gate_tool=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lock.ts
export TINT_GATE_EXCLUSIVE_LOCK="${TINT_GATE_EXCLUSIVE_LOCK:-$HOME/.t3/tint-gate.lock}"
export TINT_GATE_TIMING_LOCK="${TINT_GATE_TIMING_LOCK:-$HOME/.t3/tint-timing.lock}"
case "$resource" in
  launch) lock=$TINT_GATE_EXCLUSIVE_LOCK ;;
  timing) lock=$TINT_GATE_TIMING_LOCK ;;
  both)
    mkdir -p "$(dirname -- "$TINT_GATE_EXCLUSIVE_LOCK")" "$(dirname -- "$TINT_GATE_TIMING_LOCK")"
    exec node "$gate_tool" timing-and-launch "$@"
    ;;
esac
mkdir -p "$(dirname -- "$lock")"
export TINT_GATE_HELD_LOCK="$lock"
exec /usr/bin/lockf -k "$lock" node "$gate_tool" timed "$@"
