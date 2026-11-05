import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as native from "./test262-native.ts";
import { workspaceSources } from "./workspace-sources.ts";
const snapshot = workspaceSources(),
  evaluation = native.capturedScriptEvaluation(snapshot);
function runtime(
  moduleExecution: boolean,
  scriptRoots: boolean,
  topLevelAwait: boolean,
) {
  return native.nativeTestRuntimeSource(
    evaluation,
    true,
    true,
    false,
    false,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    false,
    moduleExecution,
    moduleExecution,
    scriptRoots,
    topLevelAwait,
  );
}
const baseline = new URL(
  "../docs/results/module-await-host-byte-baseline-node-v1.json",
  import.meta.url,
);
test("top-level-await capability requires the captured async source factory", () => {
  assert.equal(typeof native.nativeTopLevelAwaitCapability, "function");
  assert.equal(native.nativeTopLevelAwaitCapability(snapshot), true);
  const older = {
    ...snapshot,
    inputs: snapshot.inputs.map((input) =>
      input.id !== "packages/js-runtime/src/modules/index.ts"
        ? input
        : {
            ...input,
            bytes: new TextEncoder().encode(
              new TextDecoder()
                .decode(input.bytes)
                .replace(
                  "createLoweredAsyncSourceModule,",
                  "createLoweredAsyncSourceModule as hiddenAsyncSourceModule,",
                ),
            ),
          },
    ),
  };
  assert.equal(native.nativeTopLevelAwaitCapability(older), false);
});
test("historical generated hosts remain byte-identical when the capability is off", () => {
  const expected = JSON.parse(readFileSync(baseline, "utf8"));
  for (const row of expected.cases)
    assert.equal(
      createHash("sha256")
        .update(runtime(row.moduleExecution, row.scriptRoots, false))
        .digest("hex"),
      row.sha256,
    );
});
test("async module hosts drain jobs before reading evaluation and preserve fault priority", () => {
  const source = runtime(true, false, true),
    module = source.slice(
      source.indexOf("export function runNativeModuleTest"),
    ),
    evaluate = module.indexOf("const evaluation=evaluateModule"),
    drain = module.indexOf("drainScriptJobs", evaluate),
    read = module.indexOf("const evaluated=settledModulePromise", evaluate);
  assert.ok(evaluate >= 0 && drain > evaluate && read > drain);
  assert.ok(module.indexOf("if(anyUnsupported())return 10", drain) < read);
  assert.ok(module.indexOf("if(anyModuleFault())return 69", drain) < read);
  assert.ok(
    module.includes(
      'if(evaluated.kind==="pending")return asynchronous&&completionCount!==0?completion:11;',
    ),
  );
  assert.equal((module.match(/drainScriptJobs/g) ?? []).length, 1);
});
test("the adapter changes only for a module host with top-level-await capability", () => {
  const {
    dynamicImport: _managedImport,
    templateSites: _templateSites,
    ...legacy
  } = evaluation!;
  assert.equal(
    native.nativeScriptAdapter(evaluation, true, true, true),
    "native-script-v19-managed-templates",
  );
  assert.equal(
    native.nativeScriptAdapter(legacy, true, true, true),
    "native-script-v15-top-level-await",
  );
  assert.equal(
    native.nativeScriptAdapter(legacy, true, true, false),
    "native-script-v14-fixture-binding-verdicts",
  );
  assert.throws(
    () => runtime(false, false, true),
    /top-level await host requires module execution/,
  );
  assert.throws(
    () => native.nativeScriptAdapter(evaluation, false, false, true),
    /top-level await host requires module execution/,
  );
});
