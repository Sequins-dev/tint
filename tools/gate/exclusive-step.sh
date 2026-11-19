#!/bin/sh
set -eu
gate_timing_tool=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lock.ts
exec /usr/bin/lockf "${TINT_GATE_EXCLUSIVE_LOCK:?}" node "$gate_timing_tool" timed "$@"
