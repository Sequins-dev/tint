// Typed shared memory across Workers (docs/design-worker-runtime.md, "Typed
// buffers"): a typed main program and typed Worker entries add to counters
// in a typed SharedArrayBuffer. The main posts a view of it; each Worker
// receives a realm typed array over the same block and runs Atomics on it
// natively. Build with TINT_BUILD_ONLY=1 and run the printed image under
// LLDB; it exits 42. tools/worker-typed-shared.test.ts runs the same sources
// under Node.
import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The typed shared Worker fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const threads = "node:worker_threads";
function source(
  file: string,
  dependencies: readonly (readonly [string, string])[],
): SourceModule {
  const text = readFileSync(
    new URL("./worker-typed-shared/" + file, import.meta.url),
    "utf8",
  );
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok) throw Error(file + ": " + JSON.stringify(parsed.error));
  return {
    id: "worker-typed-shared/" + file,
    module: parsed.value,
    dependencies: new Map(dependencies),
  };
}
const peer = source("peer.ts", [[threads, threads]]);
const main = source("main.ts", [[threads, threads]]);

verifyHostedFixture(
  `import { run as main } from "./main.ts";
export function run(): number { return main("${peer.id}"); }`,
  "worker-typed-shared",
  [["./main.ts", main.id]],
  [peer, main],
  [],
  workerFixtureRuntimes,
  {
    ...workerFixtureOptions([peer.id]),
    requireTyped: true,
    onGeneralFallback: (modules: readonly string[], reason: string): void => {
      throw Error("general fallback for " + modules.join(", ") + ": " + reason);
    },
  },
);
