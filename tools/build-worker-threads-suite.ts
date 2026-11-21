import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The Worker suite must run under LLDB on native Tint");
const nodeHosted = process.env.TINT_NODE_HOSTED_WORKERS === "1";
const moduleId = "worker-threads-suite.mjs";
const suite = readFileSync(
  new URL("./worker-threads-suite.mjs", import.meta.url),
  "utf8",
);
const parsed = parseModule(createSourceTextView(suite));
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));

verifyHostedFixture(
  `
import {run as suite} from 'suite';
export function run():unknown { return suite("${moduleId}"); }
`,
  "worker-threads-suite",
  [["suite", moduleId]],
  [
    {
      id: moduleId,
      module: parsed.value,
      dependencies: new Map([["node:worker_threads", "node:worker_threads"]]),
    },
  ],
  [],
  workerFixtureRuntimes,
  workerFixtureOptions([moduleId], nodeHosted),
);
