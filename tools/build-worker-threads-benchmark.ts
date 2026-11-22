import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("Run the native worker benchmark under LLDB");

const moduleId = "worker-threads-benchmark.mjs";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const mode = process.env.TINT_WORKER_BENCH_MODE ?? "all";
if (!["all", "startup", "messages", "wakes", "idle"].includes(mode))
  throw Error("Invalid worker benchmark mode " + mode);
const workload = readFileSync(
  new URL("./" + moduleId, import.meta.url),
  "utf8",
);
const parsed = parseModule(createSourceTextView(workload));
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));

verifyHostedFixture(
  `
import {run as benchmark} from 'benchmark';
import {monotonicMilliseconds} from 'clock';
export function run():unknown { return benchmark("${moduleId}", monotonicMilliseconds, "${mode}"); }
`,
  "worker-threads-benchmark",
  [
    ["benchmark", moduleId],
    ["clock", clock],
  ],
  [
    {
      id: moduleId,
      module: parsed.value,
      dependencies: new Map([["node:worker_threads", "node:worker_threads"]]),
    },
  ],
  [],
  workerFixtureRuntimes,
  {
    ...workerFixtureOptions([moduleId]),
    managedBytes: 256 * 1024 * 1024,
    allocationCapacity: 4 * 1024 * 1024,
  },
);
