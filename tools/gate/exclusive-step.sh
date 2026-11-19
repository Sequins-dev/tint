#!/bin/sh
set -eu
: "${TINT_GATE_STEP_TIMEOUT:?}" "${TINT_GATE_EVIDENCE:?}"
if [ -s "$TINT_GATE_EVIDENCE/stalls.tsv" ]; then
  echo "An earlier gate step stalled. See $TINT_GATE_EVIDENCE/stalls.tsv." >&2
  exit 124
fi
gate_timing_tool=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lock.ts
exec /usr/bin/lockf -k "${TINT_GATE_EXCLUSIVE_LOCK:?}" node "$gate_timing_tool" timed "$@"
