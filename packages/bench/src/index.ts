/** Synchronous measurement subset shared by Node-shaped and native runners. */
export interface BenchOptions {
  readonly samples?: number;
  readonly warmup?: number;
}
export interface BenchContext {
  readonly name: string;
  readonly phase: "warmup" | "measurement";
  readonly index: number;
  readonly start: () => void;
  readonly end: (operations: number) => void;
}
export interface BenchSample {
  readonly duration_ns: number;
  readonly operations: number;
  readonly rate: number;
}
export interface BenchResult {
  readonly name: string;
  readonly samples: readonly BenchSample[];
}
/** Clock values are monotonic milliseconds. No clock is read outside start/end.
 * Durations are rounded to nanoseconds and must fit exact positive integers.
 * The adapter owns reporting, scheduling and any cross-process comparison. */
export function measureBenchmark(
  name: string,
  options: BenchOptions,
  body: (context: BenchContext) => void,
  now: () => number,
): BenchResult {
  const warmup = options.warmup ?? 10,
    count = options.samples ?? 30;
  if (
    !Number.isInteger(warmup) ||
    warmup < 0 ||
    warmup > 0xffffffff ||
    !Number.isInteger(count) ||
    count <= 0 ||
    count > 0xffffffff
  )
    throw "INVALID_BENCHMARK_COUNTS";
  const samples: BenchSample[] = [];
  for (let invocation = 0; invocation < warmup + count; invocation++) {
    const measured = invocation >= warmup;
    let state = 0,
      started = 0,
      operations = 0,
      duration = 0;
    const context: BenchContext = {
      name,
      phase: measured ? "measurement" : "warmup",
      index: measured ? invocation - warmup : invocation,
      start: () => {
        if (state !== 0) throw "DUPLICATE_BENCHMARK_START";
        started = now();
        if (!Number.isFinite(started)) throw "INVALID_BENCHMARK_CLOCK";
        state = 1;
      },
      end: (completed) => {
        const ended = now();
        if (state !== 1) throw "INVALID_BENCHMARK_END";
        if (!Number.isSafeInteger(completed) || completed <= 0)
          throw "INVALID_BENCHMARK_OPERATIONS";
        duration = Math.floor((ended - started) * 1000000 + 0.5);
        if (!Number.isSafeInteger(duration) || duration <= 0)
          throw "INVALID_BENCHMARK_DURATION";
        operations = completed;
        state = 2;
      },
    };
    body(context);
    if (state !== 2) throw "MISSING_BENCHMARK_MEASUREMENT";
    if (measured)
      samples.push({
        duration_ns: duration,
        operations,
        rate: (operations * 1000000000) / duration,
      });
  }
  return { name, samples };
}
