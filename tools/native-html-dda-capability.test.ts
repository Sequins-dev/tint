// The Annex B [[IsHTMLDDA]] host capability selects how Scripts lower
// `x == null`. Scripts lowered for a host that declares it keep the brand
// check; Scripts lowered without it test the tag alone and exclude such
// objects when they evaluate. This image runs both beside the Test262 host,
// which marks `$262.IsHTMLDDA` before any Script runs: the declared Script
// completes, and the mismatched Script must refuse to run rather than
// observe `$262.IsHTMLDDA == null` as false.
import assert from "node:assert/strict";
import test from "node:test";
import { withNativeFixtureMemory } from "./gate/native-fixture.ts";
import { executionPlan } from "./test262-execution.ts";
import { NativeImageRunner } from "./test262-native-process.ts";
import {
  benchmarkScriptHost,
  createNativeBatchBuilder,
  deferNativeCase,
  nativeTestResources,
  prepareNativeScripts,
  test262ScriptHost,
  type NativeScriptHost,
} from "./test262-native.ts";
import { workspaceSources } from "./workspace-sources.ts";

const cases: readonly {
  readonly source: string;
  readonly host: NativeScriptHost;
  readonly expected: unknown;
}[] = [
  {
    // The declared capability keeps Annex B loose equality.
    source: String.raw`const d=$262.IsHTMLDDA;if(!(d==null)||d!=undefined||!(null==d))throw 1;`,
    host: test262ScriptHost,
    expected: { kind: "completed" },
  },
  {
    // Lowered without the capability: the exclusion refuses the host's
    // marked object before the Script body runs, and the refusal escapes
    // the entry uncaught (status 70, docs/runtime-diagnostics.md).
    source: String.raw`if($262.IsHTMLDDA==null)throw 1;`,
    host: benchmarkScriptHost,
    expected: { kind: "crash", detail: "unexpected native exit status 70" },
  },
  {
    // Without a skipped check there is nothing to exclude.
    source: String.raw`if(typeof $262.IsHTMLDDA!=="undefined")throw 1;`,
    host: benchmarkScriptHost,
    expected: { kind: "completed" },
  },
];

test("Scripts lowered without the IsHTMLDDA capability refuse a host that creates one", () => {
  const deferred = cases.map(({ source, host }) => {
    const plan = executionPlan(source, "raw", {
      flags: ["raw"],
      features: [],
      includes: [],
    });
    const prepared = prepareNativeScripts(plan, "raw", [], host);
    assert.ok(prepared.ok, JSON.stringify(prepared));
    return deferNativeCase({
      scripts: prepared.modules,
      asynchronous: plan.asynchronous,
    });
  });
  const built = withNativeFixtureMemory(() =>
    createNativeBatchBuilder(workspaceSources())(deferred),
  );
  if (!built.ok) assert.fail(JSON.stringify(built.outcome));
  const image = new NativeImageRunner(
    built.bytes,
    nativeTestResources.timeoutMs,
  );
  try {
    for (const [index, { expected }] of cases.entries()) {
      const outcome = image.run(index);
      console.log(JSON.stringify({ index, outcome }));
      assert.deepEqual(outcome, expected, JSON.stringify({ index, outcome }));
    }
  } finally {
    image.close();
  }
});
