// Builds tools/worker-bench/call-floor.mjs natively (a diagnostic of the
// untyped call floor under Atomics; see call-floor.mjs).
import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "../worker-fixture-options.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The call floor diagnostic must run under LLDB");
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const moduleId = "worker-bench/call-floor.mjs";
const parsed = parseModule(
  createSourceTextView(
    readFileSync(new URL("./call-floor.mjs", import.meta.url), "utf8"),
  ),
);
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));
// Worker images already provide the clock intrinsics.
const options = workerFixtureOptions([moduleId]);
verifyHostedFixture(
  `import { run as floor } from "./call-floor.mjs";
import { monotonicMilliseconds } from "clock";
export function run(): unknown { return floor(monotonicMilliseconds); }`,
  "worker-bench-call-floor",
  [
    ["./call-floor.mjs", moduleId],
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
  options,
);
