import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeNativeJournals } from "./test262-throughput.ts";

function journal(
  engine: string,
  selection: string,
  compileMs: number,
  variants: number,
) {
  return (
    [
      { kind: "start", engine, selection, batchSize: 64 },
      {
        kind: "compilation",
        compilation: {
          id: 0,
          variants,
          kind: "execution",
          compileMs,
          outcome: "compiled",
        },
      },
      {
        kind: "observation",
        path: selection,
        batch: 0,
        elapsedMs: compileMs + 50,
        status: "pass",
      },
      {
        kind: "observation",
        path: selection,
        batch: 0,
        elapsedMs: compileMs + 90,
        status: "pass",
      },
      { kind: "complete" },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n"
  );
}

test("throughput keeps engine and directory rates separate and counts compilation once", () => {
  const result = analyzeNativeJournals([
    { path: "a.jsonl", text: journal("v4", "built-ins/Date/a.js", 100, 2) },
    {
      path: "b.jsonl",
      text: journal("v19", "language/expressions/addition/a.js", 6400, 64),
    },
  ]);
  assert.equal(result.engines.length, 2);
  const slow = result.engines.find((row) => row.key === "v19")!;
  assert.equal(slow.compileMs, 6400);
  assert.equal(slow.compileMsPerVariant, 100);
  assert.equal(slow.projectedCompileHours, (103264 * 100) / 3600000);
  assert.equal(slow.executionWallMs, null);
  assert.equal(slow.observationElapsedMs, 12940);
  assert.equal(slow.withinBatchElapsedDeltaMs, 40);
  assert.equal(
    result.directories.some(
      (row) => row.key === "v19:language/expressions/addition",
    ),
    true,
  );
});

test("throughput retains interrupted compiles and reports truncated tails without dropping complete rows", () => {
  const text = journal("v19", "built-ins/Proxy/a.js", 1000, 2);
  const result = analyzeNativeJournals([
    {
      path: "partial.jsonl",
      text: text.slice(0, text.indexOf('{"kind":"observation"')) + '{"kind":',
    },
  ]);
  assert.equal(result.journals[0]!.complete, false);
  assert.equal(result.journals[0]!.truncatedTail, true);
  assert.equal(result.engines[0]!.compiledVariants, 2);
  assert.equal(result.engines[0]!.observations, 0);
});

test("throughput rejects malformed complete rows with journal and line context", () => {
  assert.throws(
    () => analyzeNativeJournals([{ path: "bad.jsonl", text: "{}\nwrong\n" }]),
    /bad.jsonl:2/,
  );
});

test("throughput separates syntax and execution, weights rates by variants and exposes batch medians", () => {
  const rows = journal("v19", "built-ins/Proxy/a.js", 1000, 2)
    .trimEnd()
    .split("\n");
  rows.splice(
    2,
    0,
    JSON.stringify({
      kind: "compilation",
      compilation: {
        id: 1,
        variants: 64,
        compileMs: 100,
        kind: "syntax",
        outcome: "compiled",
      },
    }),
  );
  const result = analyzeNativeJournals([
    { path: "mixed", text: rows.join("\n") + "\n" },
  ]);
  assert.equal(
    result.phases.find((row) => row.key === "v19:syntax")!.compileMs,
    100,
  );
  assert.equal(result.engines[0]!.medianBatchCompileMs, 550);
  assert.equal(result.engines[0]!.compileMsPerVariant, 1100 / 66);
});

test("profile attribution charges samples to their innermost stage and retains GC and external waits", async () => {
  const { analyzeCPUProfile } = await import("./test262-throughput.ts");
  const result = analyzeCPUProfile({
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: "buildMacOSProgram",
          url: "file:///packages/compiler/dist/build.js",
        },
        children: [2, 4, 5],
      },
      {
        id: 2,
        callFrame: {
          functionName: "checkClosureModule",
          url: "file:///packages/typescript/dist/checker/closures.js",
        },
        children: [3],
      },
      {
        id: 3,
        callFrame: {
          functionName: "bindModule",
          url: "file:///packages/typescript/dist/binding/binder.js",
        },
      },
      { id: 4, callFrame: { functionName: "(garbage collector)", url: "" } },
      {
        id: 5,
        callFrame: { functionName: "spawnSync", url: "node:child_process" },
      },
    ],
    samples: [2, 3, 4, 5],
    timeDeltas: [1000, 2000, 3000, 4000],
  });
  assert.deepEqual(
    Object.fromEntries(result.stages.map((row) => [row.stage, row.sampledMs])),
    { "external-process-wait": 4, gc: 3, bind: 2, check: 1 },
  );
  assert.equal(result.sampledMs, 10);
});
