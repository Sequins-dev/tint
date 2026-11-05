import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import {
  createNativeBatchBuilder,
  prepareNativeScripts,
  nativeTestResources,
} from "./test262-native.ts";
import { NativeImageRunner } from "./test262-native-process.ts";
import { executionPlan } from "./test262-execution.ts";
const sources = [
  "if(this.propertyIsEnumerable('parseInt')!==false)throw 1;var leaked=42; Object.prototype.leaked=42;",
  "if(typeof leaked!=='undefined'||({}).leaked!==undefined)throw 1;",
  "throw new TypeError('expected');",
  "throw new ReferenceError('expected');",
  'var jobLeaked=42;Promise.resolve().then(()=>print("Test262:AsyncTestComplete"));',
  'print("Test262:AsyncTestComplete");print("Test262:AsyncTestComplete");',
];
const cases = sources.map((source, index) => {
  const asynchronous = index >= 4;
  const metadata = {
    flags: asynchronous ? ["raw", "async"] : ["raw"],
    features: [],
    includes: [],
  };
  const plan = executionPlan(
    "if(harnessCount!==1)throw 99;" + source,
    "raw",
    metadata,
  );
  const prepared = prepareNativeScripts(
    { ...plan, harness: ["shared.js"] },
    "raw",
    [
      {
        filename: "shared.js",
        source:
          "var harnessCount=(typeof harnessCount==='undefined'?0:harnessCount)+1;",
      },
    ],
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  return { scripts: prepared.modules, asynchronous };
});
const snapshot = workspaceSources();
const built = createNativeBatchBuilder(snapshot)(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
const expected = [
  [0, "completed", undefined],
  [1, "completed", undefined],
  [2, "error", "TypeError"],
  [3, "error", "ReferenceError"],
  [1, "completed", undefined],
  [4, "completed", undefined],
  [5, "error", "Test262Error"],
  [4, "completed", undefined],
] as const;
if (process.env.TINT_BUILD_ONLY === "1") {
  const manifest = join(dirname(image.path), "fixture.json");
  writeFileSync(
    manifest,
    JSON.stringify(
      {
        kind: "native-batch-regression-fixture",
        conformance: false,
        sourceSnapshot: workspaceSourceIdentity(snapshot),
        resources: nativeTestResources,
        cases: sources,
        expected,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({ path: image.path, cases: cases.length, manifest }),
  );
} else
  try {
    for (const [index, kind, type] of expected) {
      const outcome = image.run(index);
      assert.equal(outcome.kind, kind, JSON.stringify({ index, outcome }));
      if (outcome.kind === "error") assert.equal(outcome.type, type);
      console.log(JSON.stringify({ index, outcome }));
    }
  } finally {
    image.close();
  }

if (process.env.TINT_BUILD_ONLY !== "1") await verifySyntaxBatch();

async function verifySyntaxBatch(): Promise<void> {
  const { createNativeSyntaxBatchBuilder } =
    await import("./test262-native-syntax.ts");
  const syntax = createNativeSyntaxBatchBuilder()([
    {
      source: "$DONOTEVALUATE(); const = ;",
      goal: "script",
      harness: [],
      asynchronous: false,
      canSuspend: false,
    },
    {
      source: "throw new Error('must not execute');",
      goal: "script",
      harness: [],
      asynchronous: false,
      canSuspend: false,
    },
    {
      source: "export { missing };",
      goal: "module",
      harness: [],
      asynchronous: false,
      canSuspend: false,
    },
  ]);
  if (!syntax.ok) assert.fail(JSON.stringify(syntax.outcome));
  const syntaxImage = new NativeImageRunner(
    syntax.bytes,
    nativeTestResources.timeoutMs,
  );
  try {
    for (const [index, kind] of [
      [0, "error"],
      [1, "completed"],
      [2, "error"],
    ] as const) {
      const outcome = syntaxImage.run(index);
      assert.equal(outcome.kind, kind, JSON.stringify({ index, outcome }));
      if (outcome.kind === "error") {
        assert.equal(outcome.phase, "parse");
        assert.equal(outcome.type, "SyntaxError");
      }
      console.log(JSON.stringify({ syntax: index, outcome }));
    }
  } finally {
    syntaxImage.close();
  }
}
