import assert from "node:assert/strict";
import test from "node:test";
import * as native from "./test262-native.ts";
import { workspaceSources } from "./workspace-sources.ts";
import { parseModule } from "@tint/typescript/syntax";
import { createSourceTextView } from "@tint/source/text";

const specifier = "@tint/js-runtime/modules";
test("resource adapter capability cannot bypass module host validation", () => {
  assert.throws(
    () =>
      native.nativeScriptAdapter(
        undefined,
        false,
        false,
        false,
        true,
        false,
        false,
        true,
      ),
    /JSON host requires module execution/,
  );
});
test("resource host keys use NUL-separated type identities", () => {
  const evaluation = native.capturedScriptEvaluation(workspaceSources());
  const source = native.nativeTestRuntimeSource(
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
    undefined,
    true,
    true,
  );
  assert.ok(
    source.includes('resourceName="\\0"+attribute.value+"\\0"+resourceName;'),
  );
  assert.ok(source.includes('name.startsWith("\\0text\\0")'));
  const parsed = parseModule(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
});
test("module capability follows captured public exports including re-exports", () => {
  assert.equal(native.nativeModuleCapability(workspaceSources()), true);
});
test("older snapshots without the module contract remain unsupported", () => {
  const snapshot = workspaceSources();
  const without = {
    ...snapshot,
    publicEntries: snapshot.publicEntries!.filter(
      (entry) => entry.specifier !== specifier,
    ),
    mappings: snapshot.mappings.filter(
      (entry) => entry.specifier !== specifier,
    ),
  };
  assert.equal(native.nativeModuleCapability(without), false);
  const { publicEntries, ...legacy } = without;
  assert.equal(native.nativeModuleCapability(legacy), false);
});
test("an incomplete captured module contract is a setup error", () => {
  const snapshot = workspaceSources();
  for (const name of [
    "createLoweredSourceModule",
    "loadRequestedModules",
    "finishLoadingImportedModule",
    "linkModule",
    "evaluateModule",
    "settledModulePromise",
  ]) {
    const altered = {
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
                    new RegExp("\\b" + name + "\\b"),
                    name + " as hidden",
                  ),
              ),
            },
      ),
    };
    if (name === "createLoweredSourceModule")
      assert.equal(native.nativeModuleCapability(altered), false);
    else
      assert.throws(
        () => native.nativeModuleCapability(altered),
        /incomplete captured module host contract/,
        name,
      );
  }
});

test("module resolution exits preserve negative-test phases and host faults stay crashes", () => {
  for (let offset = 0; offset < 9; offset++) {
    const script = native.nativeExitOutcome(30 + offset);
    assert.equal(script.kind, "error");
    if (script.kind !== "error") assert.fail("expected typed runtime error");
    assert.deepEqual(native.nativeExitOutcome(60 + offset), {
      ...script,
      phase: "resolution",
      message: "native module resolution failed",
    });
  }
  assert.deepEqual(native.nativeExitOutcome(69), {
    kind: "crash",
    detail: "native module host invariant",
  });
  assert.deepEqual(native.nativeExitOutcome(70), {
    kind: "crash",
    detail: "unexpected native exit status 70",
  });
});

test("the v9 Script runtime text and batch retain their structure under the resource profile", async () => {
  const { createHash } = await import("node:crypto");
  const { executionPlan } = await import("./test262-execution.ts");
  assert.equal(
    process.env.TZ,
    undefined,
    "v9 runtime pins require the default captured time zone",
  );
  const evaluation = {
    evaluation: "packages/js-engine/src/script-evaluation.ts",
    compile: "packages/js-engine/src/native/script-compile.ts",
    indirectEval: true,
    functionFallback: true,
    directEval: true,
  } as const;
  const v9 = [
    true,
    true,
    true,
    true,
    "packages/native-runtime/src/intrinsics/spin-hint.ts",
    true,
    "packages/js-engine/src/native/code-storage.ts",
    "packages/js-engine/src/dynamic-function.ts",
    "packages/native-runtime/src/intrinsics/weak.ts",
    true,
    true,
  ] as const;
  const a = native.prepareNativeScripts(
    executionPlan("assert(true);", "strict", {
      flags: [],
      features: [],
      includes: [],
    }),
    "strict",
    [
      { filename: "assert.js", source: "function assert(x){if(!x)throw 1;}" },
      { filename: "sta.js", source: "var shared=42;" },
    ],
  );
  const b = native.prepareNativeScripts(
    executionPlan("42;", "raw", { flags: ["raw"], features: [], includes: [] }),
    "raw",
    [],
  );
  assert.ok(a.ok && b.ok);
  const batch = native.prepareNativeBatch(
    [
      { scripts: a.modules, asynchronous: false },
      { scripts: a.modules, asynchronous: true },
      { scripts: b.modules, asynchronous: false, canSuspend: false },
    ],
    ...v9,
    evaluation,
  );
  const canonical = JSON.stringify(
    batch.map((module) => [
      module.id,
      [...module.dependencies],
      module.id === "test262-runtime" ||
      module.id === "test262-host" ||
      /^test262-case-\d+-host$/.test(module.id)
        ? module.module
        : "lowered-script",
    ]),
    (key, value) => {
      if (key === "start" || key === "end" || key === "sourceStart")
        return undefined;
      if (
        value?.kind === "call" &&
        value.callee?.kind === "identifier" &&
        value.callee.name === "createEngineCodeStorage" &&
        Array.isArray(value.arguments)
      )
        return {
          ...value,
          arguments: value.arguments.map((argument: unknown, index: number) =>
            index === 0 &&
            typeof argument === "object" &&
            argument !== null &&
            "properties" in argument &&
            Array.isArray(argument.properties)
              ? {
                  ...argument,
                  properties: argument.properties.filter(
                    (property: {
                      readonly name?: string;
                      readonly value?: {
                        readonly kind?: string;
                        readonly value?: unknown;
                      };
                    }) =>
                      !(
                        property?.name === "architecture" &&
                        property.value?.kind === "string" &&
                        property.value.value === "x86_64"
                      ),
                  ),
                }
              : argument,
          ),
        };
      return value;
    },
  );
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const normalizeHost = (text: string) =>
    text
      .replaceAll('architecture:"x86_64",\n ', "")
      .replaceAll(
        "packages/platform/src/linux/fs.ts",
        "packages/platform/src/darwin/fs.ts",
      );
  const runtimeText = native.nativeTestRuntimeSource(evaluation, ...v9);
  if (native.nativeTestTarget.arch === "x86_64")
    assert.ok(runtimeText.includes('architecture:"x86_64",\n '));
  if (native.nativeTestTarget.os === "linux")
    assert.ok(canonical.includes("packages/platform/src/linux/fs.ts"));
  // Only uniform registry, Script-entry and private-arena quota literals change.
  assert.equal(
    hash(normalizeHost(runtimeText)),
    "c51b114809e488e30578eb86668d49746fab83ce93d5141631c437b910644b8f",
  );
  assert.equal(
    hash(normalizeHost(canonical)),
    "58d32ad43f7edae8e3da5492abf700b1c3715a48f1e42b17e85e09f7f0f32f68",
  );
});

test("module journals use a distinct adapter only with the complete v9 evaluation contract", () => {
  const evaluation = {
    evaluation: "eval",
    compile: "compile",
    indirectEval: true,
    directEval: true,
  } as const;
  assert.equal(
    native.nativeScriptAdapter(evaluation, false),
    "native-script-v9-direct-eval",
  );
  assert.equal(
    native.nativeScriptAdapter(evaluation, true),
    "native-script-v11-module-fixture-syntax",
  );
  assert.throws(
    () => native.nativeScriptAdapter(undefined, true),
    /module host requires the v9 Script contract/,
  );
  assert.throws(
    () =>
      native.nativeScriptAdapter(
        { evaluation: "eval", compile: "compile", indirectEval: true } as const,
        true,
      ),
    /module host requires the v9 Script contract/,
  );
  assert.throws(
    () =>
      native.nativeScriptAdapter(
        { evaluation: "eval", compile: "compile", dynamicImport: true },
        true,
      ),
    /module host requires the v9 Script contract/,
  );
});

test("module runner shares the realm protocol and checks sticky unsupported before phase results", () => {
  const evaluation = {
    evaluation: "eval",
    compile: "compile",
    indirectEval: true,
    directEval: true,
  } as const;
  const text = native.nativeTestRuntimeSource(
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
  const body = text.slice(text.indexOf("export function runNativeModuleTest"));
  assert.ok(body.startsWith("export function runNativeModuleTest"));
  assert.match(
    body,
    /const host=createRealmHost\(undefined,realms,canSuspend\)/,
  );
  for (const phase of ["loading", "evaluation"])
    assert.match(
      body,
      new RegExp(
        "if\\(anyUnsupported\\(\\)\\)return 10;\\s*const " +
          (phase === "loading" ? "loaded" : "evaluated") +
          "=settledModulePromise\\(" +
          phase,
      ),
    );
  assert.match(
    body.slice(
      body.indexOf("const linked=linkModule(root);"),
      body.indexOf("const evaluation=evaluateModule(root,hooks);"),
    ),
    /if\(anyUnsupported\(\)\)return 10;/,
  );
  assert.match(body, /records\.get\(name\)/);
  assert.match(body, /return anyUnsupported\(\)\?10:69/);
  assert.match(body, /failure\(loaded.error,60\)/);
  assert.match(body, /failure\(evaluated.error,30\)/);
});

test("the module gate only prefixes imports and appends a runner with the shared host fragments", () => {
  const evaluation = {
    evaluation: "eval",
    compile: "compile",
    indirectEval: true,
    directEval: true,
  } as const;
  const args = [
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
  ] as const;
  const off = native.nativeTestRuntimeSource(evaluation, ...args);
  const on = native.nativeTestRuntimeSource(evaluation, ...args, true);
  const prefix =
    'import {type ModuleRecord,type ModuleRequest,type GraphLoadingState,type ModuleCompletion,loadRequestedModules,finishLoadingImportedModule,linkModule,evaluateModule,settledModulePromise} from "modules";';
  assert.ok(on.startsWith(prefix + off));
  for (const marker of [
    "const realms:ErrorRealm[]=[];",
    "NATIVE_HARNESS_ENTRY_INVARIANT",
    "drainScriptJobs(realm.agent,",
  ]) {
    assert.equal(off.split(marker).length - 1, 1, marker);
    assert.equal(on.split(marker).length - 1, 2, marker);
  }
  const body = on.slice(on.indexOf("export function runNativeModuleTest"));
  for (const [first, last] of [
    ["const loading=", "const loaded="],
    ["const linked=", "if(!linked.ok)"],
    ["const evaluation=", "const evaluated="],
  ]) {
    const phase = body.slice(body.indexOf(first!), body.indexOf(last!));
    assert.ok(phase.indexOf("scriptFaultExit()") >= 0);
    assert.ok(
      phase.indexOf("scriptFaultExit()") <
        phase.indexOf("if(anyUnsupported())return 10;"),
    );
    assert.doesNotMatch(phase, /\.error|\.kind/);
  }
  const loader = body.slice(
    body.indexOf("realm.moduleLoader="),
    body.indexOf("const loading="),
  );
  assert.doesNotMatch(loader, /createRuntimeError|failure\(/);
  const caught = body.slice(
    body.indexOf("}catch(error){"),
    body.indexOf("drainScriptJobs(realm.agent"),
  );
  assert.ok(
    caught.indexOf("scriptFaultExit()") <
      caught.indexOf("return anyUnsupported()?10:69"),
  );
});

test("only a certified native fixture error becomes a load SyntaxError", () => {
  const evaluation = {
    evaluation: "eval",
    compile: "compile",
    indirectEval: true,
    directEval: true,
  } as const;
  const text = native.nativeTestRuntimeSource(
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
  assert.match(text, /function loadEntry\(index:number\):ModuleCompletion/);
  assert.match(
    text,
    /if\(code===40\)return \{ok:false,error:createRuntimeError\(realm,"syntax"\)\}/,
  );
  assert.match(
    text,
    /if\(code===42\|\|code===10\)return rejectUnsupportedExecution\(realm\)/,
  );
  assert.match(text, /throw "NATIVE_FIXTURE_VERDICT_INVARIANT"/);
  assert.match(
    text,
    /finishLoadingImportedModule\(referrer,request,payload,loadEntry\(index\)\)/,
  );
  assert.equal(text.split("loadEntry(").length, 3);
});

test("JSON module capability requires the captured parser and synthetic export contracts", () => {
  const snapshot = workspaceSources();
  assert.equal(native.nativeJSONModuleCapability(snapshot), true);
  for (const name of [
    "parseJSONModule",
    "createSyntheticModule",
    "setSyntheticModuleExport",
  ]) {
    const altered = {
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
                    new RegExp("\\b" + name + "\\b"),
                    name + " as hidden",
                  ),
              ),
            },
      ),
    };
    if (name === "parseJSONModule")
      assert.equal(native.nativeJSONModuleCapability(altered), false);
    else
      assert.throws(
        () => native.nativeJSONModuleCapability(altered),
        /incomplete captured JSON module contract/,
      );
  }
});

test("JSON host validates the request type before cache lookup and invokes factories only at load", () => {
  const source = native.nativeTestRuntimeSource(
    native.capturedScriptEvaluation(workspaceSources()),
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
  assert.match(source, /type NativeJSONModuleFactory=/);
  assert.match(source, /createScriptAgent\(canSuspend\),\["type"\]\)/);
  assert.match(
    source,
    /function loadEntry\(index:number,request:ModuleRequest\):ModuleCompletion/,
  );
  const load = source.slice(
    source.indexOf("function loadEntry("),
    source.indexOf("const verdict=verdicts[index]"),
  );
  assert.ok(load.indexOf("requestedType") < load.indexOf("records.get(name)"));
  assert.match(load, /createJSON\(global,realm,undefined\)/);
  assert.match(load, /error:createRuntimeError\(realm,"type"\)/);
  assert.match(source, /loadEntry\(index,request\)/);
  assert.equal(
    native.nativeScriptAdapter(
      native.capturedScriptEvaluation(workspaceSources()),
      true,
      true,
      true,
      true,
    ),
    "native-script-v26-stack-guard",
  );
});

test("JSON support keeps text and bytes module proposals explicitly unsupported", () => {
  const source = native.nativeTestRuntimeSource(
    native.capturedScriptEvaluation(workspaceSources()),
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
    source,
    /if\(requestedType==="text"\|\|requestedType==="bytes"\)return rejectUnsupportedExecution\(realm\);/,
  );
});

test("source-phase runtime advertises its captured intrinsic and module-source contract", () => {
  const snapshot = workspaceSources();
  assert.equal(native.nativeSourcePhaseCapability(snapshot), true);
  assert.equal(
    native.nativeScriptAdapter(
      native.capturedScriptEvaluation(snapshot),
      true,
      true,
      true,
      true,
      true,
    ),
    "native-script-v26-stack-guard",
  );
});

test("deferred modules require captured synchronous evaluation and async-dependency contracts", () => {
  const snapshot = workspaceSources();
  assert.equal(native.nativeDeferredModuleCapability(snapshot), true);
  assert.equal(
    native.nativeScriptAdapter(
      native.capturedScriptEvaluation(snapshot),
      true,
      true,
      true,
      true,
      true,
      true,
    ),
    "native-script-v26-stack-guard",
  );
});

test("ShadowRealm hosts initialize fresh realm-local module graphs", () => {
  const evaluation = {
    evaluation: "eval",
    compile: "compile",
    indirectEval: true as const,
    directEval: true as const,
    functionFallback: true as const,
    shadowRealm: true as const,
  };
  const source = native.nativeTestRuntimeSource(
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
    undefined,
    true,
    true,
  );
  assert.ok(source.includes("installShadowRealmIntrinsics(object,realm,hooks"));
  assert.ok(
    source.includes(
      "createShadowRealmEvaluator({realm:child.realm,global:child.global},service)",
    ),
  );
  assert.ok(
    source.includes("function initializeModuleHost(target:RealmHost):void"),
  );
  assert.ok(
    source.includes(
      "const global=target.global,realm=target.realm,hooks=target.hooks;",
    ),
  );
  assert.ok(source.includes("initializeModuleHost(child)"));
  assert.ok(parseModule(createSourceTextView(source)).ok);
});
