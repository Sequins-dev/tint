import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as native from "./test262-native.ts";
import { executionPlan } from "./test262-execution.ts";
import { workspaceSources } from "./workspace-sources.ts";
function withoutShadowRealm(value: native.NativeScriptEvaluation | undefined) {
  if (value === undefined) return undefined;
  // Shared literal-table entries postdate ShadowRealm hosts.
  const {
    shadowRealm: _shadowRealm,
    literalTables: _literalTables,
    hostGc: _hostGc,
    stackGuard: _stackGuard,
    ...legacy
  } = value;
  return legacy;
}
function without(name: string) {
  const snapshot = workspaceSources();
  return {
    ...snapshot,
    inputs: snapshot.inputs.map((input) =>
      input.id !== "packages/js-runtime/src/modules/index.ts"
        ? input
        : {
            ...input,
            bytes: new TextEncoder().encode(
              new TextDecoder()
                .decode(input.bytes)
                .replace(new RegExp("\\b" + name + "\\b"), name + " as hidden"),
            ),
          },
    ),
  };
}
test("dynamic import capability is captured as a complete module contract", () => {
  assert.equal(typeof native.nativeDynamicImportCapability, "function");
  assert.equal(native.nativeDynamicImportCapability(workspaceSources()), true);
  assert.equal(
    native.nativeDynamicImportCapability(without("evaluateImportCall")),
    false,
  );
  for (const name of [
    "getActiveImportMeta",
    "viewModuleRecord",
    "viewScriptRecord",
  ]) {
    assert.throws(
      () => native.nativeDynamicImportCapability(without(name)),
      /incomplete captured dynamic import contract/,
      name,
    );
  }
});
test("module referrer image contracts retain exactly the two checked views", () => {
  assert.deepEqual(native.moduleReferrerImageContract(false), {
    runtimes: [],
    recordBindings: [],
  });
  const contract = native.moduleReferrerImageContract(true);
  assert.deepEqual(
    contract.recordBindings.map((binding) => [binding.name, binding.operation]),
    [
      ["viewModuleRecord", "view"],
      ["viewScriptRecord", "view"],
    ],
  );
  assert.equal(contract.runtimes.length, 1);
  assert.deepEqual(contract.runtimes[0]?.retainedExports, [
    "viewModuleRecord",
    "viewScriptRecord",
  ]);
});
test("generated module loaders widen only with explicit dynamic import capability", () => {
  const evaluation = withoutShadowRealm(
    native.capturedScriptEvaluation(workspaceSources()),
  );
  const old = native.nativeTestRuntimeSource(
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
    true,
  );
  assert.equal(process.env.TZ, undefined);
  assert.equal(
    createHash("sha256")
      .update(old.replaceAll('architecture:"x86_64",\n ', ""))
      .digest("hex"),
    "39e9305032a00956f823e618a6b3791aa4cffa7cd741a1f8f06d4d397d9fba65",
  );
  assert.match(
    old,
    /referrer:ModuleRecord,request:ModuleRequest,hostDefined:unknown,payload:GraphLoadingState/,
  );
  const enabled = native.nativeTestRuntimeSource(
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
    true,
    true,
  );
  assert.match(
    enabled,
    /referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload/,
  );
  assert.match(enabled, /type ModuleReferrer/);
  assert.match(enabled, /type ModuleLoadPayload/);
  assert.equal(
    native.nativeTestRuntimeSource(
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
      true,
      false,
    ),
    old,
  );
});

test("dynamic module runs have a distinct adapter while Script and old module labels remain stable", () => {
  const captured = native.capturedScriptEvaluation(workspaceSources());
  assert.equal(captured?.dynamicImport, true);
  assert.equal(
    native.nativeScriptAdapter(captured, true, true, true, true),
    "native-script-v26-stack-guard",
  );
  const {
    dynamicImport: _managedImport,
    shadowRealm: _shadowRealm,
    templateSites: _templateSites,
    literalTables: _literalTables,
    hostGc: _hostGc,
    stackGuard: _stackGuard,
    ...evaluation
  } = captured!;
  assert.equal(
    native.nativeScriptAdapter(evaluation, true, true),
    "native-script-v14-fixture-binding-verdicts",
  );
  assert.equal(
    native.nativeScriptAdapter(evaluation, true, false),
    "native-script-v11-module-fixture-syntax",
  );
  assert.equal(
    native.nativeScriptAdapter(evaluation, false, false),
    "native-script-v9-direct-eval",
  );
});
test("Script dynamic imports stop before image compilation until the Script-root host lands", async () => {
  const { executionPlan } = await import("./test262-execution.ts");
  const plan = executionPlan('import("./target");', "sloppy", {
    flags: [],
    features: [],
    includes: [],
  });
  const result = native.prepareNativeScripts(
    plan,
    "sloppy",
    plan.harness.map((filename) => ({ filename, source: "" })),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.outcome.kind, "unsupported");
  if (!result.ok && result.outcome.kind === "unsupported")
    assert.equal(
      result.outcome.reason,
      "test: Script dynamic import requires HOST-ESM M3b",
    );
});

test("dynamic import capability requires its type-only public contracts once the value marker exists", () => {
  for (const name of ["ModuleReferrer", "ModuleLoadPayload"])
    assert.throws(
      () => native.nativeDynamicImportCapability(without(name)),
      /incomplete captured dynamic import contract/,
      name,
    );
});

test("Script roots keep the Script goal and prepare discovered siblings", async () => {
  const { executionPlan } = await import("./test262-execution.ts");
  const source = 'import("./dep.js"); import("./gone.js");';
  const plan = executionPlan(source, "sloppy", {
      flags: [],
      features: [],
      includes: [],
    }),
    harness = plan.harness.map((filename) => ({ filename, source: "" })),
    goals: string[] = [];
  assert.equal(typeof native.prepareNativeScriptProgram, "function");
  const result = native.prepareNativeScriptProgram(
    plan,
    "sloppy",
    harness,
    "/fixtures/root.js",
    (_filename, _text, goal) => {
      goals.push(goal);
      return {
        root: "root.js",
        siblings: ["dep.js", "root.js"],
        absent: ["gone.js"],
        nodes: [
          {
            name: "dep.js",
            kind: "javascript",
            source: "export const value=42;",
            sha256: "dep-hash",
            parsed: true,
          },
        ],
      };
    },
  );
  assert.deepEqual(goals, ["script"]);
  assert.ok(result.ok && result.root !== undefined, JSON.stringify(result));
  assert.deepEqual(
    result.root.entries.map((e) => e.name),
    ["dep.js"],
  );
  assert.deepEqual(result.root.fixtures, [
    { name: "dep.js", sha256: "dep-hash" },
  ]);
  assert.deepEqual(result.root.absent, ["gone.js"]);
  assert.equal(result.scripts.length, harness.length + 1);
  const root = result.scripts.at(-1)!;
  assert.equal(
    root.dependencies.get("@tint/js-runtime/modules"),
    "packages/js-runtime/src/modules/index.ts",
  );
});
test("plain Scripts keep the old preparation and do not trigger fixture discovery", async () => {
  const { executionPlan } = await import("./test262-execution.ts");
  const plan = executionPlan("42;", "sloppy", {
      flags: [],
      features: [],
      includes: [],
    }),
    harness = plan.harness.map((filename) => ({ filename, source: "" }));
  const result = native.prepareNativeScriptProgram(
    plan,
    "sloppy",
    harness,
    "/fixtures/root.js",
    () => assert.fail("plain Script discovered a graph"),
  );
  assert.ok(result.ok);
  assert.equal(result.root, undefined);
  const old = native.prepareNativeScripts(plan, "sloppy", harness);
  assert.ok(old.ok);
  assert.deepEqual(result.scripts, old.modules);
});

test("Script-root runtime text is enabled only for batches that need it", () => {
  const evaluation = withoutShadowRealm(
    native.capturedScriptEvaluation(workspaceSources()),
  );
  const moduleOnly = native.nativeTestRuntimeSource(
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
    true,
    true,
  );
  assert.equal(
    createHash("sha256")
      .update(moduleOnly.replaceAll('architecture:"x86_64",\n ', ""))
      .digest("hex"),
    "5663ed9ce3c02cba87154af78ed5f36846aa517fa4862cac956a0ac44dbf56e7",
  );
  const roots = native.nativeTestRuntimeSource(
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
    true,
    true,
    true,
  );
  assert.match(roots, /export function runNativeScriptRootTest/);
  assert.ok(!moduleOnly.includes("runNativeScriptRootTest"));
  assert.equal(
    native.nativeTestRuntimeSource(
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
      true,
      true,
      false,
    ),
    moduleOnly,
  );
  assert.throws(
    () =>
      native.nativeTestRuntimeSource(
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
        true,
        false,
        true,
      ),
    /Script-root host requires dynamic import/,
  );
});
test("an empty Script fixture table routes to the Script-root runner", async () => {
  const { executionPlan } = await import("./test262-execution.ts"),
    plan = executionPlan('import("");', "raw", {
      flags: ["raw"],
      features: [],
      includes: [],
    });
  const prepared = native.prepareNativeScriptProgram(
    plan,
    "raw",
    [],
    "/fixtures/root.js",
    () => ({ root: "root.js", siblings: ["root.js"], absent: [], nodes: [] }),
  );
  assert.ok(prepared.ok && prepared.root !== undefined);
  const cases = [
    {
      scripts: prepared.scripts,
      modules: prepared.root.entries,
      scriptRoot: { absent: [] },
      asynchronous: false,
    },
  ];
  const evaluation = native.capturedScriptEvaluation(workspaceSources());
  const batch = native.prepareNativeBatch(
    cases,
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
    evaluation,
    true,
    true,
  );
  assert.ok(
    batch.some((m) =>
      m.module.imports.some((i) =>
        i.bindings.some((b) => b.imported === "runNativeScriptRootTest"),
      ),
    ),
  );
  assert.throws(
    () => native.prepareNativeBatch(cases),
    /Script-root case requires the dynamic import host/,
  );
});

test("the current Script host rejects unresolved bare specifiers through the import promise", () => {
  const evaluation = native.capturedScriptEvaluation(workspaceSources());
  const current = native.nativeTestRuntimeSource(
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
    true,
    true,
    true,
    true,
    true,
  );
  assert.match(
    current,
    /if\(name!==undefined&&absent.indexOf\(name\)<0\)rejectUnsupportedExecution\(realm\);/,
  );
  assert.match(
    current,
    /if\(!request.specifier.startsWith\("\.\/"\)\)\{finishLoadingImportedModule/,
  );
  assert.doesNotMatch(
    current,
    /if\(specifier!==""&&\(name===undefined\|\|absent.indexOf\(name\)<0\)\)/,
  );
  assert.equal(
    native.nativeScriptAdapter(evaluation, true, true, true, true),
    "native-script-v26-stack-guard",
  );
  const old = native.nativeTestRuntimeSource(
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
    true,
    true,
    true,
    true,
  );
  assert.match(
    old,
    /if\(specifier!==""&&\(name===undefined\|\|absent.indexOf\(name\)<0\)\)/,
  );
});

test("runtime-compiled import calls discover fixtures only with the captured capability", async () => {
  const { executionPlan } = await import("./test262-execution.ts");
  const plan = executionPlan("eval(\"import('./dep.js')\");", "sloppy", {
    flags: [],
    features: [],
    includes: [],
  });
  const harness = plan.harness.map((filename) => ({ filename, source: "" }));
  let discoveries = 0;
  const discover: Parameters<
    typeof native.prepareNativeScriptProgram
  >[4] = () => {
    discoveries++;
    return {
      root: "root.js",
      siblings: ["dep.js"],
      absent: [],
      nodes: [
        {
          name: "dep.js",
          kind: "javascript",
          source: "export const value=42;",
          sha256: "dep-hash",
          parsed: true,
        },
      ],
    };
  };
  const old = native.prepareNativeScriptProgram(
    plan,
    "sloppy",
    harness,
    "/fixtures/root.js",
    discover,
    true,
  );
  assert.ok(old.ok);
  assert.equal(old.root, undefined);
  assert.equal(discoveries, 0);
  const enabled = native.prepareNativeScriptProgram(
    plan,
    "sloppy",
    harness,
    "/fixtures/root.js",
    discover,
    true,
    true,
  );
  assert.ok(enabled.ok && enabled.root !== undefined);
  assert.equal(discoveries, 1);
  assert.deepEqual(enabled.root.fixtures, [
    { name: "dep.js", sha256: "dep-hash" },
  ]);
});

test("captures without compact result completion keep their vocabulary", async () => {
  const {
    capturedScriptCompactResults,
    capturedScriptFusedResults,
    capturedScriptRetainedFunctions,
    createScriptRuntimeRequest,
  } = await import("./script-runtime-request.ts");
  const snapshot = workspaceSources();
  const old = {
    ...snapshot,
    inputs: snapshot.inputs.map((input) =>
      input.id !== "packages/js-engine/src/lowering/index.ts"
        ? input
        : {
            ...input,
            bytes: new TextEncoder().encode(
              new TextDecoder()
                .decode(input.bytes)
                .replace("  scriptRuntimeSupportsCompactResults,\n", ""),
            ),
          },
    ),
  };
  assert.equal(capturedScriptCompactResults(snapshot), true);
  assert.equal(capturedScriptCompactResults(old), false);
  const bind = { module: "fixture-host", name: "bindScript" };
  const names = (request: ReturnType<typeof createScriptRuntimeRequest>) =>
    request.values.map((value) => value.name);
  const previous = names(createScriptRuntimeRequest(bind, true, old)),
    current = names(createScriptRuntimeRequest(bind, true, snapshot));
  // Fused identifier reads are base vocabulary for this lowering; only the
  // out-of-line result completion depends on the compact-results marker.
  assert.equal(current.length, previous.length + 1);
  assert.ok(!previous.includes("throwIfRuntimeError"));
  assert.ok(current.includes("throwIfRuntimeError"));
  assert.ok(previous.includes("getIdentifierValue"));
  assert.ok(current.includes("getIdentifierValue"));
  // Fused result helpers and the split Script context have their own marker.
  const unfused = {
    ...snapshot,
    inputs: snapshot.inputs.map((input) =>
      input.id !== "packages/js-engine/src/lowering/index.ts"
        ? input
        : {
            ...input,
            bytes: new TextEncoder().encode(
              new TextDecoder()
                .decode(input.bytes)
                .replace("  scriptRuntimeSupportsFusedResults,\n", ""),
            ),
          },
    ),
  };
  assert.equal(capturedScriptFusedResults(snapshot), true);
  assert.equal(capturedScriptFusedResults(unfused), false);
  const withoutFused = names(createScriptRuntimeRequest(bind, true, unfused));
  assert.equal(current.length, withoutFused.length + 16);
  assert.ok(!withoutFused.includes("objectPropertyKeyOrThrow"));
  assert.ok(!withoutFused.includes("enterScriptContext"));
  assert.ok(current.includes("objectPropertyKeyOrThrow"));
  assert.ok(withoutFused.includes("throwIfRuntimeError"));
  // So does one-call function creation.
  const unretained = {
    ...snapshot,
    inputs: snapshot.inputs.map((input) =>
      input.id !== "packages/js-engine/src/lowering/index.ts"
        ? input
        : {
            ...input,
            bytes: new TextEncoder().encode(
              new TextDecoder()
                .decode(input.bytes)
                .replace("  scriptRuntimeSupportsRetainedFunctions,\n", ""),
            ),
          },
    ),
  };
  assert.equal(capturedScriptRetainedFunctions(snapshot), true);
  assert.equal(capturedScriptRetainedFunctions(unretained), false);
  const withoutRetained = names(
    createScriptRuntimeRequest(bind, true, unretained),
  );
  assert.deepEqual(
    current.filter((name) => !withoutRetained.includes(name)),
    ["createRetainedSourceFunction"],
  );
});
test("historical captures keep their managed vocabulary and adapter", async () => {
  const { capturedScriptDynamicImport, createScriptRuntimeRequest } =
    await import("./script-runtime-request.ts");
  const snapshot = workspaceSources();
  const fastPaths = [
    "createRegisterSourceFunction",
    "callRegisterObjectValue",
    "createWideRegisterSourceFunction",
    "callWideRegisterObjectValue",
    "createScriptPropertyCache",
    "readCachedObjectValueProperty",
    "writeCachedObjectValueProperty",
    "scriptIsHTMLDDA",
    "looselyEqualOrThrow",
    "excludeHTMLDDAObjects",
  ];
  const old = {
    ...snapshot,
    inputs: snapshot.inputs.map((input) => {
      if (input.id === "packages/js-runtime/src/objects/index.ts") {
        let source = new TextDecoder().decode(input.bytes);
        for (const name of fastPaths)
          source = source
            .replace(`  ${name},\n`, "")
            .replace(`, ${name} }`, " }");
        return { ...input, bytes: new TextEncoder().encode(source) };
      }
      if (input.id !== "packages/js-engine/src/lowering/index.ts") return input;
      const source = new TextDecoder()
        .decode(input.bytes)
        .replace("  scriptRuntimeSupportsDynamicImport,\n", "")
        .replace("  scriptRuntimeSupportsTemplateSites,\n", "")
        .replace("  scriptRuntimeSupportsLiteralTables,\n", "")
        .replace("  scriptRuntimeSupportsEngineAborts,\n", "");
      return { ...input, bytes: new TextEncoder().encode(source) };
    }),
  };
  assert.equal(capturedScriptDynamicImport(snapshot), true);
  assert.equal(capturedScriptDynamicImport(old), false);
  const evaluation = withoutShadowRealm(native.capturedScriptEvaluation(old));
  assert.equal(evaluation?.dynamicImport, undefined);
  assert.equal(
    native.nativeScriptAdapter(evaluation, true, true, true, true),
    "native-script-v17-import-resolution",
  );
  const bind = { module: "fixture-host", name: "bindScript" };
  const previous = createScriptRuntimeRequest(bind, true, old),
    current = createScriptRuntimeRequest(bind, true, snapshot);
  assert.equal(previous.values.length, 136);
  assert.equal(current.values.length, 150);
  for (const name of fastPaths) {
    assert.ok(!previous.values.some((value) => value.name === name), name);
    assert.ok(
      current.values.some((value) => value.name === name),
      name,
    );
  }
  assert.ok(
    !previous.values.some((value) => value.name === "evaluateImportCall"),
  );
  assert.ok(
    current.values.some((value) => value.name === "evaluateImportCall"),
  );
});

test("ShadowRealm programs retain a module graph for importValue and evaluated imports", () => {
  const source =
    "const realm=new ShadowRealm();realm.importValue('./entry.js','value');";
  const plan = executionPlan(source, "sloppy", {
    flags: [],
    features: ["ShadowRealm"],
    includes: [],
  });
  let discovered = false;
  const prepared = native.prepareNativeScriptProgram(
    plan,
    "sloppy",
    plan.harness.map((filename) => ({ filename, source: "" })),
    "entry.js",
    () => {
      discovered = true;
      return { root: "entry.js", nodes: [], siblings: [], absent: [] };
    },
    false,
    true,
    false,
    true,
  );
  assert.ok(prepared.ok);
  assert.equal(discovered, true);
  if (prepared.ok) assert.ok(prepared.root);
});
