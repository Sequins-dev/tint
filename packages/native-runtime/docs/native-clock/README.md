# @tint/native-runtime/intrinsics/clock

Caller-authorized monotonic clock leaf. `monotonicMilliseconds()` throws when
executed without a native host binding. The `monotonic-time` operation takes no
arguments and returns a floating-point millisecond timestamp. Absolute values
are opaque; use differences within one process.

The first host implementation calls Darwin `clock_gettime_nsec_np` with
`CLOCK_MONOTONIC_RAW`, then converts nanoseconds to milliseconds. Conversion can
lose sub-microsecond precision at long uptimes. Benchmarks batch operations to
amortize clock resolution and call overhead. Other targets must provide their
own monotonic clock implementation; wall-clock time is not a substitute.

`wallClockMilliseconds()` is an independent `wall-clock-time` capability returning
milliseconds since the Unix epoch. It may jump when the system clock is adjusted.
Darwin uses `clock_gettime_nsec_np(CLOCK_REALTIME)`. Embeddings authorize it
explicitly; it is never substituted for monotonic time or inferred from uptime.
