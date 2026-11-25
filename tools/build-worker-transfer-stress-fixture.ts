import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

// Runs tools/worker-transfer-stress.mjs on native Worker threads: transfers
// and clones during allocation-heavy loops in both isolates.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The Worker transfer stress fixture must run under LLDB");
const moduleId = "worker-transfer-stress.mjs";
const source = readFileSync(
  new URL("./worker-transfer-stress.mjs", import.meta.url),
  "utf8",
);
const parsed = parseModule(createSourceTextView(source));
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));

verifyHostedFixture(
  `
import {run as stress} from 'stress';
export function run():unknown { return stress("${moduleId}"); }
`,
  "worker-transfer-stress",
  [["stress", moduleId]],
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
