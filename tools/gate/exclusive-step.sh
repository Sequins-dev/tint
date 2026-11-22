#!/bin/sh
set -eu
: "${TINT_GATE_STEP_TIMEOUT:?}" "${TINT_GATE_EVIDENCE:?}" "${TINT_GATE_EXCLUSIVE_LOCK:?}"
if [ -s "$TINT_GATE_EVIDENCE/stalls.tsv" ]; then
  echo "An earlier gate step stalled. See $TINT_GATE_EVIDENCE/stalls.tsv." >&2
  exit "$(awk -F '\t' 'NR == 1 {print $5 ? $5 : 124}' "$TINT_GATE_EVIDENCE/stalls.tsv")"
fi
exec sh "$(dirname -- "$0")/with-lock.sh" launch "$@"
