// Shared string bodies across Worker isolates (docs/design-worker-runtime.md,
// "Shared string bodies"): echo without copies, a message discarded unreceived,
// one body held by four isolates, terminated holders, a minor collection
// making a hold old and a full one freeing it, and a body kept only by a
// message in flight. Every body is freed at the end.
//
// TINT_SHARED_STRINGS_COLLECTOR selects the collectors under test:
// - serial: generational heaps small enough for serial minors and marking;
// - parallel: heaps whose minors and marking run on the collector pool;
// - copying: the copying runtime, where every collection is full.
// Build with TINT_BUILD_ONLY=1 and run the image under LLDB: it exits 42 and
// prints "shared strings: ok".
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
  throw Error("The shared string fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const collector = process.env.TINT_SHARED_STRINGS_COLLECTOR ?? "parallel";
const heaps: Record<string, number> = {
  serial: 8388608,
  parallel: 67108864,
  copying: 33554432,
};
const managedBytes = heaps[collector];
if (managedBytes === undefined)
  throw Error("unknown TINT_SHARED_STRINGS_COLLECTOR " + collector);

const threads = "node:worker_threads";
const runtime = "packages/native-runtime/src/";
const aliases: readonly (readonly [string, string])[] = [
  ["host", runtime + "shared-memory-host.ts"],
  ["strings", runtime + "shared-strings.ts"],
  ["string-address", runtime + "intrinsics/shared-strings.ts"],
  ["gc", runtime + "intrinsics/memory.ts"],
  ["clock", runtime + "intrinsics/clock.ts"],
];
function source(
  file: string,
  dependencies: readonly (readonly [string, string])[],
): SourceModule {
  const text = readFileSync(
    new URL("./worker-shared-strings/" + file, import.meta.url),
    "utf8",
  );
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok) throw Error(file + ": " + JSON.stringify(parsed.error));
  return {
    id: "worker-shared-strings/" + file,
    module: parsed.value,
    dependencies: new Map([...aliases, ...dependencies]),
  };
}
// TINT_SHARED_STRINGS_STRESS=1 builds the contention stress instead: four
// Workers making and freeing bodies at once (stress.ts).
const stress = process.env.TINT_SHARED_STRINGS_STRESS === "1";
const strings = source("strings.ts", []);
const peer = source(stress ? "stress-peer.ts" : "peer.ts", [
  [threads, threads],
  ["./strings.ts", strings.id],
]);
const main = source(stress ? "stress.ts" : "main.ts", [
  [threads, threads],
  ["./strings.ts", strings.id],
]);

verifyHostedFixture(
  `import { run as main } from "./main.ts";
export function run(): number { return main("${peer.id}"${stress ? "" : `, "${collector}"`}); }`,
  "worker-shared-strings-" + (stress ? "stress-" : "") + collector,
  [["./main.ts", main.id]],
  [strings, peer, main],
  [],
  workerFixtureRuntimes,
  {
    ...workerFixtureOptions([peer.id]),
    managedBytes,
    ...(collector === "copying"
      ? { runtimeEntry: "initializeCopyingRuntime" as const }
      : {}),
    requireTyped: true,
    onGeneralFallback: (modules: readonly string[], reason: string): void => {
      throw Error("general fallback for " + modules.join(", ") + ": " + reason);
    },
  },
);
