// Typed Atomics.wait / Atomics.notify across Workers (Int32Array and
// BigInt64Array) plus worker.terminate() interruption of parked waits.
// Runs the identical sources under Node and natively under LLDB with
// TINT_GENERAL_FALLBACK=0 and requireTyped: true.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");
const { workerFixtureOptions, workerFixtureRuntimes } =
  await import("./worker-fixture-options.ts");
const { run } = await import("./worker-typed-atomics-wait/main.ts");

test("typed Atomics.wait/notify Worker sources run under Node", () => {
  const peer = new URL("./worker-typed-atomics-wait/peer.ts", import.meta.url)
    .pathname;
  assert.equal(run(peer), 42);
});

test("typed Atomics.wait/notify and terminate interruption run natively", () => {
  const threads = "node:worker_threads";
  function source(
    file: string,
    dependencies: readonly (readonly [string, string])[],
  ): SourceModule {
    const text = readFileSync(
      new URL("./worker-typed-atomics-wait/" + file, import.meta.url),
      "utf8",
    );
    const parsed = parseModule(createSourceTextView(text));
    if (!parsed.ok) throw Error(file + ": " + JSON.stringify(parsed.error));
    return {
      id: "worker-typed-atomics-wait/" + file,
      module: parsed.value,
      dependencies: new Map(dependencies),
    };
  }
  const peer = source("peer.ts", [[threads, threads]]);
  const main = source("main.ts", [[threads, threads]]);
  verifyHostedFixture(
    `import { run as main } from "./main.ts";
export function run(): number { return main("${peer.id}"); }`,
    "worker-typed-atomics-wait",
    [["./main.ts", main.id]],
    [peer, main],
    [],
    workerFixtureRuntimes,
    {
      ...workerFixtureOptions([peer.id]),
      requireTyped: true,
      onGeneralFallback: (modules: readonly string[], reason: string): void => {
        throw Error(
          "general fallback for " + modules.join(", ") + ": " + reason,
        );
      },
    },
  );
});
