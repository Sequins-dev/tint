// Typed zlib stress (tools/worker-zlib-stress/): a typed main program and a
// typed Worker entry run node:zlib while both isolates churn their
// generational heaps. Build with TINT_BUILD_ONLY=1 and run the printed image
// under LLDB; it exits 42. tools/worker-transfer-stress.test.ts runs the same
// sources under Node.
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
  throw Error("The typed zlib stress fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const threads = "node:worker_threads";
const zlib = "packages/native-runtime/src/node/zlib.ts";
function source(
  file: string,
  dependencies: readonly (readonly [string, string])[],
): SourceModule {
  const text = readFileSync(
    new URL("./worker-zlib-stress/" + file, import.meta.url),
    "utf8",
  );
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok) throw Error(file + ": " + JSON.stringify(parsed.error));
  return {
    id: "worker-zlib-stress/" + file,
    module: parsed.value,
    dependencies: new Map(dependencies),
  };
}
const common = source("common.ts", [["node:zlib", zlib]]);
const peer = source("peer.ts", [
  [threads, threads],
  ["./common.ts", common.id],
]);
const main = source("main.ts", [
  [threads, threads],
  ["./common.ts", common.id],
]);

verifyHostedFixture(
  `import { run as main } from "./main.ts";
export function run(): number { return main("${peer.id}"); }`,
  "worker-zlib-stress",
  [
    ["./main.ts", main.id],
    // Listed here too so the workspace loader includes zlib's module graph.
    ["node:zlib", zlib],
  ],
  [common, peer, main],
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
