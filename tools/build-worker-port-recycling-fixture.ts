import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

// Runs tools/worker-port-recycling.mjs (recycled packet blocks across ports
// and Worker exit) on native Worker threads.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The Worker port recycling fixture must run under LLDB");
const moduleId = "worker-port-recycling.mjs";
const source = readFileSync(
  new URL("./worker-port-recycling.mjs", import.meta.url),
  "utf8",
);
const parsed = parseModule(createSourceTextView(source));
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));

verifyHostedFixture(
  `
import {run as recycling} from 'recycling';
export function run():unknown { return recycling("${moduleId}"); }
`,
  "worker-port-recycling",
  [["recycling", moduleId]],
  [
    {
      id: moduleId,
      module: parsed.value,
      dependencies: new Map([["node:worker_threads", "node:worker_threads"]]),
    },
  ],
  [],
  workerFixtureRuntimes,
  workerFixtureOptions([moduleId]),
);
