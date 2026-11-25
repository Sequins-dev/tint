// Typed Worker entries (docs/design-worker-runtime.md): a typed main program
// starts typed Worker entries that run on the typed path in their own
// isolates. Build with TINT_BUILD_ONLY=1 and run the printed image under LLDB;
// it exits 42 and prints the Worker-only module's line exactly once. tools/worker-typed-entry.test.ts runs the same sources under
// Node.
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
  throw Error("The typed Worker entry fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const threads = "node:worker_threads";
function source(
  file: string,
  dependencies: readonly (readonly [string, string])[],
): SourceModule {
  const text = readFileSync(
    new URL("./worker-typed-entry/" + file, import.meta.url),
    "utf8",
  );
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok) throw Error(file + ": " + JSON.stringify(parsed.error));
  return {
    id: "worker-typed-entry/" + file,
    module: parsed.value,
    dependencies: new Map(dependencies),
  };
}
const shared = source("shared.ts", []);
const tally = source("tally.ts", []);
const peer = source("peer.ts", [
  [threads, threads],
  ["./shared.ts", shared.id],
  ["./tally.ts", tally.id],
]);
const thrower = source("thrower.ts", [[threads, threads]]);
const main = source("main.ts", [
  [threads, threads],
  ["./shared.ts", shared.id],
]);

verifyHostedFixture(
  `import { run as main } from "./main.ts";
export function run(): number { return main("${peer.id}", "${thrower.id}"); }`,
  "worker-typed-entry",
  [["./main.ts", main.id]],
  [shared, tally, peer, thrower, main],
  [],
  workerFixtureRuntimes,
  {
    ...workerFixtureOptions([peer.id, thrower.id]),
    requireTyped: true,
    // The Worker entries must not keep JavaScript semantics.
    onGeneralFallback: (modules: readonly string[], reason: string): void => {
      throw Error("general fallback for " + modules.join(", ") + ": " + reason);
    },
  },
);
