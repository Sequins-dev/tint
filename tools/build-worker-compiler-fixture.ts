import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The compiler Worker fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const threads = "node:worker_threads";
const peer = "./parser-peer.ts";
const client = "./parser-client.ts";

function source(
  id: string,
  text: string,
  dependencies: readonly (readonly [string, string])[],
): SourceModule {
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok) throw Error(JSON.stringify(parsed.error));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}

verifyHostedFixture(
  `import { runCompilerJob } from "./parser-client.ts";
export function run(): number { return runCompilerJob(); }`,
  "compiler-source-worker",
  [[client, client]],
  [
    source(
      client,
      `
import { Worker } from "node:worker_threads";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";

export function runCompilerJob(): number {
  const job = new Worker("./parser-peer.ts");
  let delivered = false;
  job.once("message", (reply: unknown): void => {
    if (reply !== 42) throw "wrong compiler job result";
    delivered = true;
  });
  job.once("exit", (status: unknown): void => {
    if (status !== 0 || !delivered) throw "compiler job failed";
  });
  const parsed = parseModule(createSourceTextView("const a=1;export const b=2;"));
  if (!parsed.ok) throw "compiler input did not parse";
  job.postMessage(parsed.value.statements.length + 40);
  return 42;
}
`,
      [
        [threads, threads],
        ["@tint/source/text", "packages/source/src/text.ts"],
        ["@tint/typescript/syntax", "packages/typescript/src/syntax/index.ts"],
      ],
    ),
    source(
      peer,
      `import { parentPort } from "node:worker_threads";
const port = parentPort;
port.once("message", (value) => {
  port.postMessage(value);
  port.close();
});`,
      [[threads, threads]],
    ),
  ],
  [],
  workerFixtureRuntimes,
  workerFixtureOptions([peer]),
);
