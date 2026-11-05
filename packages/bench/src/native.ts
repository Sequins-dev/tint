import {
  measureBenchmark,
  type BenchContext,
  type BenchOptions,
  type BenchResult,
} from "./index.ts";
export type { BenchContext, BenchOptions, BenchResult } from "./index.ts";
interface Declaration {
  readonly name: string;
  readonly options: BenchOptions;
  readonly body: (context: BenchContext) => void;
}
const declarations: Declaration[] = [];
const suites: string[] = [];
const state: number[] = [0];
/** Native synchronous subset of node:bench declaration syntax. Returned promises,
 * asynchronous callbacks and stream APIs are outside this profile. */
export function bench(
  name: string,
  options: BenchOptions,
  body: (context: BenchContext) => void,
): void {
  if (state[0] !== 0) throw "BENCHMARK_DECLARATIONS_CLOSED";
  let fullName = "";
  for (const suite of suites) {
    if (suite === undefined) throw "benchmark suite invariant";
    fullName += suite + " > ";
  }
  declarations.push({ name: fullName + name, options, body });
}
export function suite(name: string, body: () => void): void {
  if (state[0] !== 0) throw "BENCHMARK_DECLARATIONS_CLOSED";
  suites.push(name);
  try {
    body();
  } finally {
    suites.pop();
  }
}
/** Host integration, separate from the mirrored declaration API. Errors abort
 * this native run; the driver must reject partial results. No hidden scheduling. */
export function runBenchmarks(
  now: () => number,
  emit: (result: BenchResult) => void,
): number {
  if (state[0] !== 0) throw "BENCHMARK_RUN_ALREADY_STARTED";
  state[0] = 1;
  let count = 0;
  for (const item of declarations) {
    if (item === undefined) throw "benchmark declaration invariant";
    emit(measureBenchmark(item.name, item.options, item.body, now));
    count++;
  }
  return count;
}
