# @tint/bench

Portable synchronous measurement core with an injected monotonic millisecond
clock. `measureBenchmark(name, options, body, now)` runs unreported warmups and
retains individual measured samples. Defaults match `node:bench`: ten warmups
and thirty samples. Every invocation receives a fresh context containing name,
phase, index, `start()` and `end(operations)`.

Only the explicit start/end interval is measured. Validate observable results
after `end`; setup belongs before `start`. Missing, duplicate, nonpositive,
nonfinite or out-of-order measurements fail. Nanosecond durations are rounded
from clock differences and must fit a positive safe integer. The core has no
platform imports, scheduling, process execution, reporting or comparison policy.

This is the reusable measurement primitive, not a complete Node benchmark runner.
