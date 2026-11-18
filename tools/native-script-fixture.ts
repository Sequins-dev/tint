import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import {
  createNativeBatchBuilder,
  deferNativeCase,
  prepareNativeScripts,
  nativeTestResources,
} from "./test262-native.ts";
import { NativeImageRunner } from "./test262-native-process.ts";
import { executionPlan } from "./test262-execution.ts";

/** Compare focused Scripts with Node, then verify isolated native executions. */
export function verifyNativeScriptCases(
  sources: readonly string[],
  options: {
    readonly nodeReference?: boolean;
    readonly asynchronous?: boolean;
  } = {},
): void {
  if (options.asynchronous === true && options.nodeReference !== false)
    throw new Error(
      "Async fixtures require an explicit asynchronous reference runner",
    );
  const cases = sources.map((source) => {
    if (options.nodeReference !== false) new Script(source).runInNewContext();
    const plan = executionPlan(source, "raw", {
      flags: options.asynchronous === true ? ["raw", "async"] : ["raw"],
      features: [],
      includes: [],
    });
    const prepared = prepareNativeScripts(plan, "raw", []);
    assert.ok(prepared.ok, JSON.stringify(prepared));
    return deferNativeCase({
      scripts: prepared.modules,
      asynchronous: plan.asynchronous,
    });
  });
  const snapshot = workspaceSources();
  const built = createNativeBatchBuilder(snapshot)(cases);
  // Build diagnostics only on failure: eagerly stringifying a successful native
  // image can exceed the host's string limit and hides the actual build result.
  if (!built.ok) assert.fail(JSON.stringify(built.outcome));
  const image = new NativeImageRunner(
    built.bytes,
    nativeTestResources.timeoutMs,
  );
  if (process.env.TINT_BUILD_ONLY === "1") {
    const manifest = join(dirname(image.path), "fixture.json");
    writeFileSync(
      manifest,
      JSON.stringify(
        {
          kind: "native-script-fixture",
          schemaVersion: 1,
          sourceSnapshot: workspaceSourceIdentity(snapshot),
          imageSha256: createHash("sha256").update(built.bytes).digest("hex"),
          asynchronous: options.asynchronous === true,
          nodeReference: options.nodeReference !== false,
          resources: nativeTestResources,
          cases: sources.map((source, index) => ({
            index,
            source,
            sha256: createHash("sha256").update(source).digest("hex"),
          })),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(
      JSON.stringify({ path: image.path, cases: cases.length, manifest }),
    );
    return;
  }
  try {
    for (let index = 0; index < cases.length; index++) {
      const outcome = image.run(index);
      assert.deepEqual(
        outcome,
        { kind: "completed" },
        JSON.stringify({ index, outcome }),
      );
      console.log(JSON.stringify({ index, outcome }));
    }
  } finally {
    image.close();
  }
}
