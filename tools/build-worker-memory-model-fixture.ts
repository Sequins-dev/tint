import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

// Runs the shared-memory litmus tests in tools/worker-memory-model.mjs on
// native Worker threads, with whole-program optimization of threaded images.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The Worker memory-model fixture must run under LLDB");
const moduleId = "worker-memory-model.mjs";
const source = readFileSync(
  new URL("./worker-memory-model.mjs", import.meta.url),
  "utf8",
);
const parsed = parseModule(createSourceTextView(source));
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));

verifyHostedFixture(
  `
import {run as litmus} from 'litmus';
export function run():unknown { return litmus("${moduleId}"); }
`,
  "worker-memory-model",
  [["litmus", moduleId]],
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
