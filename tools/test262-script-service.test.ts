import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as native from "./test262-native.ts";
import { workspaceSources } from "./workspace-sources.ts";
import { createScriptRuntimeRequest } from "./script-runtime-request.ts";
const evaluation = {
  evaluation: "packages/js-engine/src/script-evaluation.ts",
  compile: "packages/js-engine/src/native/script-compile.ts",
};
test("Script evaluator host faults stay crashes with their reason", () => {
  for (const [i, reason] of [
    "compile-threw",
    "invoke-threw",
    "completion-view",
    "completion-kind",
    "context-leak",
  ].entries())
    assert.deepEqual(native.nativeExitOutcome(13 + i), {
      kind: "crash",
      detail: "native Script evaluator host fault: " + reason,
    });
  assert.match(
    JSON.stringify(native.nativeExitOutcome(18)),
    /unexpected native exit status 18/,
  );
});
test("Script service capture requires both public factories", () => {
  const snapshot = workspaceSources();
  assert.deepEqual(native.capturedScriptEvaluation(snapshot), {
    ...evaluation,
    indirectEval: true,
    functionFallback: true,
    directEval: true,
    dynamicImport: true,
    templateSites: true,
  });
  const entries = snapshot.publicEntries!;
  const remove = (specifiers: string[]) => ({
    ...snapshot,
    publicEntries: entries.filter((x) => !specifiers.includes(x.specifier)),
  });
  assert.throws(
    () =>
      native.capturedScriptEvaluation(
        remove(["@tint/js-engine/script-evaluation"]),
      ),
    /incomplete captured Script/,
  );
  assert.equal(
    native.capturedScriptEvaluation(
      remove([
        "@tint/js-engine/script-evaluation",
        "@tint/js-engine/native/script-compile",
      ]),
    ),
    undefined,
  );
});
test("absent Script capability keeps the generated host unchanged", () => {
  const text = native.nativeTestRuntimeSource();
  assert.equal(text, native.nativeTestRuntimeSource(undefined));
  assert.ok(!text.includes('from "@tint/js-engine/script-evaluation"'));
  assert.match(
    text,
    /const evaluateScript=[\s\S]*?rejectUnsupportedExecution\(realm\)/,
  );
  const runtime = native.prepareNativeBatch([
    {
      scripts: [
        {
          id: "sample",
          module: { start: 0, end: 0, imports: [], statements: [] },
          dependencies: new Map(),
        },
      ],
      asynchronous: false,
    },
  ])[0]!;
  // Frozen pre-service host AST, excluding spans and the deliberately enlarged arena.
  const canonical = JSON.stringify(runtime.module, (key, value) => {
    if (key === "start" || key === "end" || key === "sourceStart")
      return undefined;
    if (
      value?.kind === "call" &&
      value.callee?.kind === "identifier" &&
      value.callee.name === "createEngineCodeStorage"
    )
      return {
        ...value,
        arguments: value.arguments.map((argument: unknown, index: number) =>
          index === 1
            ? { ...(argument as object), value: 1048576, raw: "1048576" }
            : argument,
        ),
      };
    return value;
  });
  assert.equal(
    createHash("sha256").update(canonical).digest("hex"),
    "5a4f83fd3dad89301378123d05cf844e2f89acae579b53697c2e801e8983c139",
  );
});
test("Script service uses realm-local evaluators and one shared arena", () => {
  const text = native.nativeTestRuntimeSource(evaluation);
  assert.equal(
    text.split("createScriptEvaluator({realm,global}").length - 1,
    1,
  );
  assert.match(text, /return host.evaluate\(args\[0\]\)/);
  assert.match(text, /storage:executableStorage/);
  assert.match(text, /scriptState.started=true/);
  assert.match(text, /SCRIPT_COMPILER_POISONED/);
  assert.ok(
    text.indexOf("scriptState.started=true") <
      text.indexOf("const exported=bindScript()"),
  );
  const run = text.slice(text.indexOf("export function runNativeScripts"));
  assert.ok(
    run.indexOf("scriptFaultExit()") <
      run.indexOf('result.error==="unsupported"'),
  );
  assert.ok(
    run.indexOf("scriptFaultExit()", run.indexOf("drainScriptJobs")) <
      run.indexOf("active.unsupported", run.indexOf("drainScriptJobs")),
  );
});
test("Script service generated modules use captured source bytes", () => {
  const snapshot = workspaceSources(),
    modules = native.nativeScriptServiceModules(snapshot);
  assert.deepEqual(
    modules.map((x) => x.id),
    ["test262-script-host", "test262-script-sources"],
  );
  const data = modules[1]!;
  const declaration = data.module.statements.find((x) => x.kind === "variable");
  assert.ok(declaration);
  assert.ok(data.module.statements.length >= 3);
  const host = modules[0]!;
  assert.ok(host.dependencies.has("frame"));
  assert.equal(
    host.module.statements.filter((x) => x.kind === "function").length,
    3,
  );
  function strings(value: unknown): string[] {
    if (value === null || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(strings);
    const node = value as Record<string, unknown>;
    return [
      ...(node.kind === "string" && typeof node.value === "string"
        ? [node.value]
        : []),
      ...Object.values(node).flatMap(strings),
    ];
  }
  const literals = strings(data.module);
  const texts = snapshot.inputs.filter((input) =>
    literals.includes(new TextDecoder().decode(input.bytes)),
  );
  assert.equal(texts.length, 22);
  const first = texts[0]!;
  const changed = {
    ...snapshot,
    inputs: snapshot.inputs.map((input) =>
      input === first
        ? {
            ...input,
            bytes: new TextEncoder().encode(
              new TextDecoder().decode(input.bytes) +
                "\n// captured-runtime-probe\n",
            ),
          }
        : input,
    ),
  };
  const restored = strings(
    native.nativeScriptServiceModules(changed)[1]!.module,
  );
  assert.ok(
    restored.includes(
      new TextDecoder().decode(first.bytes) + "\n// captured-runtime-probe\n",
    ),
  );
});
test("Script service budgets reserve space for multiple compilations", () => {
  assert.equal(native.nativeTestResources.maxScriptCodeBytes, 2097152);
  assert.equal(native.nativeTestResources.managedBytes, 268435456);
  assert.equal(native.nativeTestResources.stackBytes, 16777216);
  assert.equal(native.nativeTestResources.allocationCapacity, 8388608);
  assert.equal(native.nativeTestResources.rootCapacity, 16384);
  assert.ok(
    native.nativeTestResources.executableMemoryBytes >=
      8 * native.nativeTestResources.maxScriptCodeBytes,
  );
  assert.ok(
    native.nativeTestResources.maxScriptCodeBytes >
      native.nativeTestResources.maxDynamicCodeBytes,
  );
});
test("surface request accepts an explicit captured snapshot", () => {
  const bind = { module: "test262-script-host", name: "bindScript" };
  assert.deepEqual(
    createScriptRuntimeRequest(bind, true, workspaceSources()),
    createScriptRuntimeRequest(bind),
  );
});
test("Script host builder can capture the live service", () =>
  assert.equal(
    typeof native.createNativeBatchBuilder(workspaceSources()),
    "function",
  ));
test("Script adapter identity follows captured indirect evaluation capability", () => {
  assert.equal(
    native.nativeScriptAdapter(evaluation),
    "native-script-v6-eval-script",
  );
  assert.equal(
    native.nativeScriptAdapter({ ...evaluation, indirectEval: true }),
    "native-script-v7-indirect-eval",
  );
  const source = readFileSync(
    new URL("./test262-native-run.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /engine = nativeScriptAdapter\(\s*scriptEvaluation,\s*moduleExecution,\s*dynamicImport,\s*topLevelAwait,\s*jsonModules,\s*sourcePhases,\s*deferredModules,\s*assetModules,?\s*\)/,
  );
  assert.match(source, /adapter: engine/);
  assert.equal(source.split("process.env.TINT_TEST262_MODULES").length, 2);
  assert.equal(source.split("nativeModuleCapability(").length, 2);
  assert.match(source, /createNativeBatchBuilder\(snapshot, moduleExecution\)/);
  assert.match(
    source,
    /nativeVariantRoute\(metadata, variant, moduleExecution\)/,
  );
  const resume = source.indexOf("sameNativeObservationInput(prior, input)");
  assert.ok(source.indexOf("prepareNativeModuleProgram(") < resume);
  assert.ok(source.indexOf("prepareNativeScripts(") > resume);
  assert.match(
    source,
    /moduleExecution\s*\?\s*" Module variants load sibling fixtures/,
  );
});

test("indirect eval capture requires the runtime marker and evaluator as a pair", () => {
  const live = workspaceSources();
  const snapshot = {
    ...live,
    inputs: live.inputs.map((input) => {
      const text = new TextDecoder().decode(input.bytes);
      const stripped =
        input.id === evaluation.evaluation
          ? text.replace(
              "export function createDirectEvaluator",
              "function createDirectEvaluator",
            )
          : input.id === "packages/js-runtime/src/objects/index.ts"
            ? text.replace("  installDirectEvalCompiler,\n", "")
            : text;
      return stripped === text
        ? input
        : { ...input, bytes: new TextEncoder().encode(stripped) };
    }),
  };
  assert.equal(native.capturedScriptEvaluation(snapshot)?.indirectEval, true);
  const removeExport = (id: string, name: string, source = snapshot) => ({
    ...source,
    inputs: source.inputs.map((input) =>
      input.id !== id
        ? input
        : {
            ...input,
            bytes: new TextEncoder().encode(
              new TextDecoder()
                .decode(input.bytes)
                .replace(
                  new RegExp(
                    id.endsWith("/index.ts")
                      ? "  " + name + ",\\n"
                      : "export function " + name,
                  ),
                  id.endsWith("/index.ts") ? "" : "function " + name,
                ),
            ),
          },
    ),
  });
  assert.deepEqual(
    native.capturedScriptEvaluation(
      removeExport(
        evaluation.evaluation,
        "createDynamicFunctionBodyCompiler",
        removeExport(
          "packages/js-runtime/src/objects/index.ts",
          "installEvalCompiler",
        ),
      ),
    ),
    { ...evaluation, dynamicImport: true, templateSites: true },
  );
  assert.throws(
    () =>
      native.capturedScriptEvaluation(
        removeExport(
          "packages/js-runtime/src/objects/index.ts",
          "installEvalCompiler",
        ),
      ),
    /incomplete captured function-fallback contract/,
  );
  assert.throws(
    () =>
      native.capturedScriptEvaluation(
        removeExport(evaluation.evaluation, "createIndirectEvaluator"),
      ),
    /incomplete captured indirect-eval contract/,
  );
});

test("indirect eval uses one per-realm evaluation service with the Script evaluator", () => {
  const legacy = native.nativeTestRuntimeSource(evaluation);
  const text = native.nativeTestRuntimeSource({
    ...evaluation,
    indirectEval: true,
  });
  assert.ok(!legacy.includes("createIndirectEvaluator"));
  assert.ok(!legacy.includes("installEvalCompiler"));
  assert.match(text, /type ScriptEvaluationHost/);
  assert.match(text, /const service:ScriptEvaluationHost=/);
  assert.match(text, /createScriptEvaluator\(\{realm,global\},service\)/);
  assert.match(
    text,
    /installEvalCompiler\(realm,createIndirectEvaluator\(\{realm,global\},service\)\)/,
  );
  assert.equal(
    text.split("function scriptCompiler()").length,
    legacy.split("function scriptCompiler()").length,
  );
});

test("function fallback remains enabled under the newer direct-eval adapter", () => {
  const captured = native.capturedScriptEvaluation(workspaceSources());
  assert.equal(captured?.functionFallback, true);
  assert.equal(
    native.nativeScriptAdapter(captured),
    "native-script-v19-managed-templates",
  );
});
test("function fallback reuses the realm evaluation host before constructing the compiler", () => {
  const source = native.nativeTestRuntimeSource({
    ...evaluation,
    indirectEval: true,
    functionFallback: true,
  });
  const service = source.indexOf("const service:ScriptEvaluationHost=");
  assert.ok(
    service > 0 && service < source.indexOf("realm.dynamicFunctionCompiler="),
  );
  assert.equal(source.split("const service:ScriptEvaluationHost=").length, 2);
  assert.match(
    source,
    /createDynamicFunctionBodyCompiler\(\{realm,global\},service\)/,
  );
  const legacy = native.nativeTestRuntimeSource({
    ...evaluation,
    indirectEval: true,
  });
  assert.equal(
    createHash("sha256").update(legacy).digest("hex"),
    "48b2054cda6f1dbb2367dd645a5c47edfebe919b19ce726409cbb6248ca877de",
  );
});

test("direct eval capture requires its factory installer and checked site view", () => {
  const snapshot = workspaceSources();
  const captured = native.capturedScriptEvaluation(snapshot);
  assert.equal(captured?.directEval, true);
  assert.equal(
    native.nativeScriptAdapter(captured),
    "native-script-v19-managed-templates",
  );
  function remove(id: string, name: string, input = snapshot) {
    return {
      ...input,
      inputs: input.inputs.map((item) =>
        item.id !== id
          ? item
          : {
              ...item,
              bytes: new TextEncoder().encode(
                new TextDecoder()
                  .decode(item.bytes)
                  .replace(
                    id.endsWith("/index.ts")
                      ? "  " + name + ",\n"
                      : "export function " + name,
                    id.endsWith("/index.ts") ? "" : "function " + name,
                  ),
              ),
            },
      ),
    };
  }
  for (const [id, name] of [
    [evaluation.evaluation, "createDirectEvaluator"],
    [evaluation.evaluation, "createIndirectEvaluator"],
    ["packages/js-runtime/src/objects/index.ts", "installDirectEvalCompiler"],
    [
      "packages/js-runtime/src/environments/global/index.ts",
      "viewDirectEvalSite",
    ],
  ]) {
    assert.throws(
      () => native.capturedScriptEvaluation(remove(id!, name!)),
      /incomplete captured direct-eval contract/,
    );
  }
  const legacy = remove(
    evaluation.evaluation,
    "createDirectEvaluator",
    remove(
      "packages/js-runtime/src/objects/index.ts",
      "installDirectEvalCompiler",
    ),
  );
  assert.equal(native.capturedScriptEvaluation(legacy)?.directEval, undefined);
  assert.equal(
    native.nativeScriptAdapter(native.capturedScriptEvaluation(legacy)),
    "native-script-v19-managed-templates",
  );
});
test("direct eval shares the same per-realm service after indirect installation", () => {
  const source = native.nativeTestRuntimeSource({
    ...evaluation,
    indirectEval: true,
    functionFallback: true,
    directEval: true,
  });
  assert.match(source, /createDirectEvaluator/);
  assert.match(
    source,
    /installDirectEvalCompiler\(realm,createDirectEvaluator\(\{realm,global\},service\)\)/,
  );
  assert.ok(
    source.indexOf("installEvalCompiler(realm,") <
      source.indexOf("installDirectEvalCompiler(realm,"),
  );
  assert.equal(source.split("const service:ScriptEvaluationHost=").length, 2);
  const legacy = native.nativeTestRuntimeSource({
    ...evaluation,
    indirectEval: true,
    functionFallback: true,
  });
  assert.equal(
    createHash("sha256").update(legacy).digest("hex"),
    "e01c298502810953f54345755a060586b74a5e951026eb9373846f9adfdb93e0",
  );
});

test("a direct service cannot generate a host without indirect evaluation", () => {
  assert.throws(
    () => native.nativeTestRuntimeSource({ ...evaluation, directEval: true }),
    /direct-eval.*indirect/,
  );
});

test("managed template sites require the captured registry runtime and compiler contracts", () => {
  const snapshot = workspaceSources();
  assert.equal(native.capturedScriptEvaluation(snapshot)?.templateSites, true);
  assert.equal(
    native.nativeScriptAdapter(
      native.capturedScriptEvaluation(snapshot),
      true,
      true,
      true,
      true,
    ),
    "native-script-v19-managed-templates",
  );
  const hide = (id: string, from: string, to: string) => ({
    ...snapshot,
    inputs: snapshot.inputs.map((input) =>
      input.id !== id
        ? input
        : {
            ...input,
            bytes: new TextEncoder().encode(
              new TextDecoder().decode(input.bytes).replace(from, to),
            ),
          },
    ),
  });
  const old = hide(
    "packages/js-engine/src/lowering/index.ts",
    "  scriptRuntimeSupportsTemplateSites,\n",
    "",
  );
  assert.equal(native.capturedScriptEvaluation(old)?.templateSites, undefined);
  assert.equal(
    native.nativeScriptAdapter(
      native.capturedScriptEvaluation(old),
      true,
      true,
      true,
      true,
    ),
    "native-script-v18-managed-dynamic-import",
  );
  for (const partial of [
    hide(
      "packages/js-runtime/src/objects/index.ts",
      "  getScriptTemplateSite,\n",
      "",
    ),
    hide(
      "packages/js-engine/src/native/script-compile.ts",
      "export const scriptEntrySupportsTemplateSites = true;",
      "const scriptEntrySupportsTemplateSites = true;",
    ),
  ])
    assert.throws(
      () => native.capturedScriptEvaluation(partial),
      /incomplete captured template-site contract/,
    );
});
