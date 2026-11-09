import { nativeAgentHostSource } from "./native-agent-host.ts";
import { createHash } from "node:crypto";
import {
  nativeSyntaxVerdictSource,
  nativeSyntaxDependencies,
} from "./native-syntax-kernel.ts";
import {
  capturedModuleExports,
  capturedModuleTypeExports,
  capturedPublicEntry,
} from "./captured-module-exports.ts";
import { createSourceText } from "@tint/source/text";
import { parseModule, parseScript } from "@tint/typescript/syntax";
import { lowerScript, lowerSourceTextModule } from "@tint/js-engine/lowering";
import { createSourceTextView } from "@tint/source/text";
import {
  discoverModuleGraph,
  type ModuleGraphNode,
} from "./test262-module-graph.ts";
import { buildMacOSProgram } from "@tint/compiler/build";
import {
  projectBuildRequest,
  projectRoots,
  runtimeSources,
} from "@tint/compiler/cli";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { SyntaxVariant, TestMetadata } from "./test262.ts";
import type { ExecutionPlan, ExecutionOutcome } from "./test262-execution.ts";
import {
  workspaceModules,
  workspaceSources,
  type WorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

import {
  createScriptRuntimeRequest,
  capturedScriptDynamicImport,
  capturedScriptTemplateSites,
  capturedScriptLiteralTables,
  scriptEntryFrameModule,
  scriptRuntimeGlobals,
} from "./script-runtime-request.ts";

const nativeCompilerModule = "packages/compiler/src/native/index.ts";
const sharedServiceModule = "packages/native-runtime/src/shared-blocks.ts";
const sharedPrimitivesModule =
  "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const nativeMemoryModule = "packages/native-runtime/src/intrinsics/memory.ts";
const engineDynamicSpecifier = "@tint/js-engine/dynamic-function";
const engineDynamicModule = "packages/js-engine/src/dynamic-function.ts";
const engineStorageSpecifier = "@tint/js-engine/native/code-storage";
// Synthetic AST fixtures use this default; execution builders resolve captured exports.
const engineStorageModule = "packages/js-engine/src/native/code-storage.ts";
const syntaxModule = "packages/typescript/src/syntax/index.ts";
const bindingModule = "packages/typescript/src/binding/index.ts";
const objectModule = "packages/js-runtime/src/objects/index.ts";
const clockModule = "packages/native-runtime/src/intrinsics/clock.ts";
const randomModule = "packages/native-runtime/src/intrinsics/random.ts";
const globalModule = "packages/js-runtime/src/environments/global/index.ts";
const nativeFSModule = "packages/platform/src/darwin/fs.ts";
const fileServiceModule = "packages/platform/src/files/service.ts";
const timeZoneModule = "packages/foundation/src/chrono/tzif/index.ts";
const timeZoneIdentifiersModule =
  "packages/foundation/src/chrono/time-zone-identifiers/index.ts";
const requestedTimeZone = process.env.TZ;
const timeZoneName = requestedTimeZone?.startsWith(":")
  ? requestedTimeZone.slice(1)
  : requestedTimeZone;
export const nativeTimeZoneData = Object.freeze({
  requested: requestedTimeZone ?? null,
  path: !timeZoneName
    ? "/etc/localtime"
    : timeZoneName.startsWith("/")
      ? timeZoneName
      : "/usr/share/zoneinfo/" + timeZoneName,
});
/** Total debugger containment budget, including startup. Chosen once per run and
 * recorded with resources; never adjusted for individual tests or retried outcomes. */
export function nativeContainmentTimeout(
  requested: string | undefined,
): number {
  if (requested === undefined) return 60000;
  const value = Number(requested);
  if (
    !/^[1-9][0-9]*$/.test(requested) ||
    !Number.isSafeInteger(value) ||
    value > 0xffffffff
  )
    throw new RangeError("Invalid native containment timeout");
  return value;
}
/** Uniform execution budgets, recorded in reports rather than tailored to tests.
 * The copying collector reserves half the heap as evacuation space; large
 * generated Unicode inputs cannot fit in the former 4 MiB managed window. */
export const nativeDebuggerEntitlement = "com.apple.security.get-task-allow";
export const nativeTestResources = Object.freeze({
  collector: "copying",
  // The complete module/agent host plus the decorator runtime surface exceeds
  // the project compiler's 16K specialization budget even for a small batch.
  maxSpecializations: 32768,
  executableMemoryBytes: 16777216,
  maxDynamicCodeBytes: 65536,
  // Agent coercion/clock emission diagnostics exceed 600 KiB. Keep one uniform
  // bounded profile with room for multiple compilations in each private arena.
  maxScriptCodeBytes: 2097152,
  // Entries that differ only in abstracted string-literal values share code.
  maxSharedScriptEntries: 256,
  managedBytes: 268435456,
  arrayBufferBytes: 16777216,
  // Shared mappings remain live through engine shutdown. The conversion matrix
  // alone needs 1,120 tiny blocks, or 17.5 MiB after native page rounding.
  sharedMemoryBytes: 33554432,
  sharedMemoryBlocks: 2048,
  sharedMemoryPageBytes: 16384,
  atomicCapabilities: { lockFree1: true, lockFree2: true, lockFree8: true },
  agentLimits: { maxAgents: 256, maxWaiters: 1024 },
  allocationCapacity: 8388608,
  rootCapacity: 16384,
  stackBytes: 16777216,
  timeoutMs: nativeContainmentTimeout(process.env.TINT_TEST262_CONTAINMENT_MS),
  timeZoneDataBytes: 1048576,
  namedTimeZoneDatabase: {
    metadataPath: "/usr/share/zoneinfo/tzdata.zi",
    dataRoot: "/usr/share/zoneinfo/",
    systemLinkPath: "/etc/localtime",
  },
  timeZone: nativeTimeZoneData,
});
export function nativeExitOutcome(code: number): ExecutionOutcome {
  if (code === 42) return { kind: "completed" };
  if (code === 40)
    return {
      kind: "error",
      phase: "parse",
      type: "SyntaxError",
      message: "native parser rejected source",
    };
  if (code === 11) return { kind: "timeout" };
  if (code === 12)
    return {
      kind: "error",
      phase: "runtime",
      type: "Test262Error",
      message: "$DONE called more than once",
    };
  if (code >= 50 && code <= 59)
    return {
      kind: "error",
      phase: "runtime",
      type: [
        "Error",
        "TypeError",
        "ReferenceError",
        "SyntaxError",
        "RangeError",
        "EvalError",
        "URIError",
        "Test262Error",
        "AggregateError",
        "",
      ][code - 50]!,
      message: "native $DONE reported failure",
    };
  if (code >= 13 && code <= 17)
    return {
      kind: "crash",
      detail:
        "native Script evaluator host fault: " +
        [
          "compile-threw",
          "invoke-threw",
          "completion-view",
          "completion-kind",
          "context-leak",
        ][code - 13],
    };
  if (code === 10)
    return {
      kind: "unsupported",
      reason: "native runtime reached an unsupported operation",
    };
  const types = [
    "",
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "RangeError",
    "EvalError",
    "URIError",
    "AggregateError",
    "Test262Error",
  ];
  const harness = code >= 20 && code < 20 + types.length;
  const runtime = code >= 30 && code < 30 + types.length;
  const resolution = code >= 60 && code < 60 + types.length;
  if (harness || runtime || resolution)
    return {
      kind: "error",
      phase: harness ? "harness" : resolution ? "resolution" : "runtime",
      type: types[code - (harness ? 20 : resolution ? 60 : 30)]!,
      message: harness
        ? "native harness threw"
        : resolution
          ? "native module resolution failed"
          : "native Script threw",
    };
  if (code === 69)
    return { kind: "crash", detail: "native module host invariant" };
  return { kind: "crash", detail: "unexpected native exit status " + code };
}
export type NativeVariantRoute = "syntax" | "module" | "script";
export function nativeVariantRoute(
  metadata: TestMetadata,
  variant: SyntaxVariant,
  moduleExecution: boolean,
): NativeVariantRoute {
  if (
    metadata.negative?.phase === "parse" ||
    metadata.negative?.phase === "early"
  )
    return "syntax";
  return moduleExecution && variant === "module" ? "module" : "script";
}

export function prepareNativeScripts(
  plan: ExecutionPlan,
  variant: SyntaxVariant,
  harness: readonly { readonly filename: string; readonly source: string }[],
):
  | { readonly ok: true; readonly modules: readonly SourceModule[] }
  | { readonly ok: false; readonly outcome: ExecutionOutcome } {
  const unsupported = (reason: string) => ({
    ok: false as const,
    outcome: { kind: "unsupported" as const, reason },
  });
  if (variant === "module" || plan.goal !== "script")
    return unsupported("native module execution is not implemented");
  if (plan.harness.length !== harness.length)
    return unsupported("harness inputs do not match the execution plan");
  return prepareNativeScriptInputs([
    ...harness,
    { filename: "test", source: plan.source },
  ]);
}

function prepareNativeScriptInputs(
  inputs: readonly { readonly filename: string; readonly source: string }[],
  dynamicRootIndex?: number,
):
  | { readonly ok: true; readonly modules: readonly SourceModule[] }
  | { readonly ok: false; readonly outcome: ExecutionOutcome } {
  const unsupported = (reason: string) => ({
    ok: false as const,
    outcome: { kind: "unsupported" as const, reason },
  });
  const modules: SourceModule[] = [];
  for (const [index, input] of inputs.entries()) {
    const bytes = new TextEncoder().encode(input.source);
    const source = createSourceText(bytes, bytes.length);
    if (!source.ok)
      return unsupported(input.filename + ": source decoding failed");
    const parsed = parseScript(source.value);
    // A partial grammar's rejection is not sufficient evidence of a spec early error.
    if (!parsed.ok)
      return unsupported(input.filename + ": " + JSON.stringify(parsed.error));
    const lowered = lowerScript(parsed.value, input.source);
    if (!lowered.ok)
      return unsupported(input.filename + ": " + JSON.stringify(lowered.error));
    const dynamicImport = lowered.value.imports.some(
      (declaration) =>
        declaration.specifier === "@tint/js-runtime/modules" &&
        declaration.bindings.some(
          (binding) => binding.imported === "evaluateImportCall",
        ),
    );
    if (dynamicImport && index !== dynamicRootIndex)
      return unsupported(
        input.filename + ": Script dynamic import requires HOST-ESM M3b",
      );
    modules.push({
      id: "test262-script-" + index,
      module: lowered.value,
      dependencies: new Map([
        ["@tint/js-runtime/environments/global", globalModule],
        [
          "@tint/js-runtime/environments/records",
          "packages/js-runtime/src/environments/records/index.ts",
        ],
        ["@tint/js-runtime/objects", objectModule],
        ...(dynamicImport
          ? [
              [
                "@tint/js-runtime/modules",
                "packages/js-runtime/src/modules/index.ts",
              ] as [string, string],
            ]
          : []),
      ]),
    });
  }
  return { ok: true, modules };
}

function unsupportedNativePreparation(reason: string) {
  return {
    ok: false as const,
    outcome: { kind: "unsupported" as const, reason },
  };
}

function lowerNativeModuleEntry(
  name: string,
  text: string,
  jsonModules: boolean = false,
  assetModules: boolean = false,
):
  | { ok: true; module: SourceModule; requests: readonly string[] }
  | { ok: false; outcome: ExecutionOutcome; earlyError?: true } {
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok)
    return unsupportedNativePreparation(
      name + ": " + JSON.stringify(parsed.error),
    );
  if (
    !jsonModules &&
    parsed.value.imports.some(
      (request) => (request.attributes?.length ?? 0) > 0,
    )
  )
    return unsupportedNativePreparation(
      "import attributes require HOST-ESM M5",
    );
  if (
    jsonModules &&
    !assetModules &&
    parsed.value.imports.some((request) =>
      request.attributes?.some(
        (attribute) =>
          attribute.key === "type" &&
          (attribute.value === "text" || attribute.value === "bytes"),
      ),
    )
  )
    return unsupportedNativePreparation(
      "text and bytes modules require their proposal slices",
    );
  const lowered = lowerSourceTextModule(parsed.value, text);
  if (!lowered.ok)
    return {
      ...unsupportedNativePreparation(
        name + ": " + JSON.stringify(lowered.error),
      ),
      ...(lowered.error.code === "EARLY_ERROR"
        ? { earlyError: true as const }
        : {}),
    };
  return {
    ok: true,
    requests: parsed.value.imports.map((request) => request.specifier),
    module: {
      id: "test262-module-" + name,
      module: lowered.value,
      dependencies: new Map([
        ["@tint/js-runtime/environments/global", globalModule],
        [
          "@tint/js-runtime/environments/records",
          "packages/js-runtime/src/environments/records/index.ts",
        ],
        ["@tint/js-runtime/objects", objectModule],
        [
          "@tint/js-runtime/modules",
          "packages/js-runtime/src/modules/index.ts",
        ],
      ]),
    },
  };
}

function prepareNativeFixtureEntries(
  nodes: readonly ModuleGraphNode[],
  skip: string | undefined,
  requested: readonly string[],
  initial: readonly NativeModuleEntry[] = [],
  jsonModules: boolean = false,
  absent: readonly string[] = [],
  assetModules: boolean = false,
):
  | { ok: true; entries: NativeModuleEntry[] }
  | { ok: false; outcome: ExecutionOutcome } {
  const entries = [...initial],
    requests = [...requested];
  for (const node of nodes) {
    if (assetModules) {
      const bytes = node.bytes ?? new TextEncoder().encode(node.source);
      for (const type of ["text", "bytes"] as const) {
        const body =
          type === "text"
            ? `return {ok:true,module:createTextModule(${JSON.stringify(new TextDecoder("utf-8").decode(bytes))},realm,hostDefined)};`
            : `return createBytesModule(new Uint8Array(${JSON.stringify([...bytes])}),realm,global.hooks,hostDefined);`;
        entries.push({
          name: "\0" + type + "\0" + node.name,
          json: true,
          module: parsedNativeHost(
            "test262-resource-" + type + "-" + node.name,
            `import {createTextModule,createBytesModule,type ModuleCompletion} from "@tint/js-runtime/modules";
import type {GlobalEnvironment} from "@tint/js-runtime/environments/global";
import type {ErrorRealm,ScriptPropertyKey} from "@tint/js-runtime/objects";
export function create(global:GlobalEnvironment<ScriptPropertyKey,unknown>,realm:ErrorRealm,hostDefined:unknown):ModuleCompletion {${body}}`,
            new Map([
              [
                "@tint/js-runtime/modules",
                "packages/js-runtime/src/modules/index.ts",
              ],
              ["@tint/js-runtime/environments/global", globalModule],
              ["@tint/js-runtime/objects", objectModule],
            ]),
          ),
        });
      }
    }
    if (node.name === skip) continue;
    if (node.kind !== "javascript") {
      if (!jsonModules)
        return unsupportedNativePreparation("JSON modules require HOST-ESM M5");
      entries.push({
        name: node.name,
        json: true,
        module: parsedNativeHost(
          "test262-json-module-" + node.name,
          `import {parseJSONModule,type ModuleCompletion} from "@tint/js-runtime/modules";
import type {GlobalEnvironment} from "@tint/js-runtime/environments/global";
import type {ErrorRealm,ScriptPropertyKey} from "@tint/js-runtime/objects";
export function create(global:GlobalEnvironment<ScriptPropertyKey,unknown>,realm:ErrorRealm,hostDefined:unknown):ModuleCompletion {
 return parseJSONModule(${JSON.stringify(node.source)},realm,global.hooks,hostDefined);
}`,
          new Map([
            [
              "@tint/js-runtime/modules",
              "packages/js-runtime/src/modules/index.ts",
            ],
            ["@tint/js-runtime/environments/global", globalModule],
            ["@tint/js-runtime/objects", objectModule],
          ]),
        ),
      });
      continue;
    }
    const lowered = node.parsed
      ? lowerNativeModuleEntry(
          node.name,
          node.source,
          jsonModules,
          assetModules,
        )
      : undefined;
    if (lowered === undefined || (!lowered.ok && lowered.earlyError)) {
      // Bootstrap diagnostics select a native proof; only that proof can
      // establish a SyntaxError, and it never executes the fixture body.
      const bytes = node.bytes ?? new TextEncoder().encode(node.source);
      if (createHash("sha256").update(bytes).digest("hex") !== node.sha256)
        return unsupportedNativePreparation(
          "fixture bytes differ from discovery hash",
        );
      entries.push({
        name: node.name,
        verdict: true,
        module: parsedNativeHost(
          "test262-fixture-verdict-" + node.name,
          nativeSyntaxVerdictSource(bytes, "module"),
          new Map(nativeSyntaxDependencies),
        ),
      });
      continue;
    }
    if (!lowered.ok) return { ok: false, outcome: lowered.outcome };
    requests.push(...lowered.requests);
    entries.push({ name: node.name, module: lowered.module });
  }
  const known = new Set(entries.map((entry) => "./" + entry.name));
  for (const specifier of requests)
    if (
      specifier.startsWith("./") &&
      !known.has(specifier) &&
      !absent.includes(specifier.slice(2))
    )
      return unsupportedNativePreparation(
        "module request outside the discovered fixture graph: " + specifier,
      );
  return { ok: true, entries };
}

export interface NativeScriptRoot {
  readonly entries: readonly NativeModuleEntry[];
  readonly fixtures: readonly {
    readonly name: string;
    readonly sha256: string;
  }[];
  readonly absent: readonly string[];
}
export function prepareNativeScriptProgram(
  plan: ExecutionPlan,
  variant: SyntaxVariant,
  harness: readonly { readonly filename: string; readonly source: string }[],
  filename: string,
  discover: typeof discoverModuleGraph = discoverModuleGraph,
  jsonModules: boolean = false,
  runtimeImportCalls: boolean = false,
  assetModules: boolean = false,
  shadowRealm: boolean = false,
):
  | { ok: true; scripts: readonly SourceModule[]; root?: NativeScriptRoot }
  | {
      ok: false;
      outcome: ExecutionOutcome;
      fixtures?: NativeScriptRoot["fixtures"];
      absent?: readonly string[];
    } {
  if (variant === "module" || plan.goal !== "script")
    return unsupportedNativePreparation(
      "Script preparation requires the Script goal",
    );
  if (plan.harness.length !== harness.length)
    return unsupportedNativePreparation(
      "harness inputs do not match the execution plan",
    );
  const prepared = prepareNativeScriptInputs(
    [...harness, { filename: "test", source: plan.source }],
    harness.length,
  );
  if (!prepared.ok) return prepared;
  const test = prepared.modules[prepared.modules.length - 1];
  if (test === undefined) throw "NATIVE_TEST_ENTRY_INVARIANT";
  if (
    !(shadowRealm && /\bShadowRealm\b/.test(plan.source)) &&
    !(
      runtimeImportCalls &&
      /\bimport\s*(?:\.\s*(?:source|defer)\s*)?\(/.test(plan.source)
    ) &&
    !test.module.imports.some(
      (declaration) =>
        declaration.specifier === "@tint/js-runtime/modules" &&
        declaration.bindings.some(
          (binding) => binding.imported === "evaluateImportCall",
        ),
    )
  )
    return { ok: true, scripts: prepared.modules };
  const graph = discover(filename, plan.source, "script");
  const fixtures = graph.nodes.map((node) => ({
    name: node.name,
    sha256: node.sha256,
  }));
  const entries = prepareNativeFixtureEntries(
    graph.nodes,
    undefined,
    [],
    [],
    jsonModules,
    graph.absent,
    assetModules,
  );
  if (!entries.ok)
    return {
      ...entries,
      ...(fixtures.length === 0 ? {} : { fixtures }),
      ...(graph.absent.length === 0 ? {} : { absent: graph.absent }),
    };
  return {
    ok: true,
    scripts: prepared.modules,
    root: { entries: entries.entries, fixtures, absent: graph.absent },
  };
}

/** Prepare unchanged module sources without treating bootstrap parser limits as
 * syntax verdicts. Native fixture re-parsing is a separate capability. */
export function prepareNativeModuleProgram(
  plan: ExecutionPlan,
  harness: readonly { readonly filename: string; readonly source: string }[],
  filename: string,
  discover: typeof discoverModuleGraph = discoverModuleGraph,
  jsonModules: boolean = false,
  assetModules: boolean = false,
):
  | {
      readonly ok: true;
      readonly harness: readonly SourceModule[];
      readonly entries: readonly NativeModuleEntry[];
      readonly fixtures: readonly {
        readonly name: string;
        readonly sha256: string;
      }[];
      readonly absent?: readonly string[];
    }
  | {
      readonly ok: false;
      readonly outcome: ExecutionOutcome;
      readonly fixtures?: readonly {
        readonly name: string;
        readonly sha256: string;
      }[];
      readonly absent?: readonly string[];
    } {
  const unsupported = (reason: string) => ({
    ok: false as const,
    outcome: { kind: "unsupported" as const, reason },
  });
  if (plan.goal !== "module")
    return unsupported("module preparation requires the module goal");
  if (plan.harness.length !== harness.length)
    return unsupported("harness inputs do not match the execution plan");
  const prepared = prepareNativeScriptInputs(harness);
  if (!prepared.ok) return prepared;
  const root = lowerNativeModuleEntry(
    filename,
    plan.source,
    jsonModules,
    assetModules,
  );
  if (!root.ok) return { ok: false, outcome: root.outcome };
  const graph = discover(filename, plan.source, "module");
  const requested = [...root.requests];
  const entries: NativeModuleEntry[] = [
    { name: graph.root, module: root.module },
  ];
  const fixtures = graph.nodes
    .filter((node) => node.name !== graph.root)
    .map((node) => ({ name: node.name, sha256: node.sha256 }));
  const rejectedGraph = (failure: {
    readonly ok: false;
    readonly outcome: ExecutionOutcome;
  }) => ({
    ...failure,
    ...(fixtures.length === 0 ? {} : { fixtures }),
    ...(graph.absent.length === 0 ? {} : { absent: graph.absent }),
  });
  const preparedEntries = prepareNativeFixtureEntries(
    graph.nodes,
    graph.root,
    requested,
    entries,
    jsonModules,
    graph.absent,
    assetModules,
  );
  if (!preparedEntries.ok) return rejectedGraph(preparedEntries);
  return {
    ok: true,
    harness: prepared.modules,
    entries: preparedEntries.entries,
    fixtures,
    ...(graph.absent.length === 0 ? {} : { absent: graph.absent }),
  };
}

export interface NativeModuleEntry {
  /** A native JSON/text/bytes resource factory returns a load completion. */
  readonly json?: true;
  /** Native syntax data only; never a module factory or bootstrap verdict. */
  readonly verdict?: true;
  readonly name: string;
  readonly module: SourceModule;
}
export interface NativeTestCase {
  readonly moduleAbsent?: readonly string[];
  readonly scriptRoot?: { readonly absent: readonly string[] };
  readonly modules?: readonly NativeModuleEntry[];
  readonly scripts: readonly SourceModule[];
  readonly asynchronous: boolean;
  readonly canSuspend?: boolean;
}
export function parsedNativeHost(
  id: string,
  text: string,
  dependencies: Map<string, string>,
): SourceModule {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  if (!source.ok) throw new Error("native host source failed");
  const parsed = parseModule(source.value);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return { id, module: parsed.value, dependencies };
}
export function nativeTestRuntimeSource(
  scriptEvaluation?: NativeScriptEvaluation,
  disposal: boolean = true,
  asyncDisposal: boolean = disposal,
  sharedBuffers: boolean = false,
  atomics: boolean = false,
  spinHint?: string,
  sharedAtomics: boolean = false,
  storageProvider: string = engineStorageModule,
  dynamicProvider: string = engineDynamicModule,
  weakProvider?: string,
  weakRef: boolean = false,
  finalizationRegistry: boolean = false,
  moduleExecution: boolean = false,
  dynamicImport: boolean = false,
  scriptRoots: boolean = false,
  topLevelAwait: boolean = false,
  jsonModules: boolean = false,
  agentProvider?: string,
  sourcePhases: boolean = false,
  assetModules: boolean = false,
): string {
  const shadowRealm = scriptEvaluation?.shadowRealm === true;
  if (
    scriptEvaluation?.directEval === true &&
    scriptEvaluation.indirectEval !== true
  )
    throw Error("direct-eval host requires indirect evaluation");
  if (moduleExecution && scriptEvaluation?.directEval !== true)
    throw Error("module host requires the v9 Script contract");
  if (dynamicImport && !moduleExecution)
    throw Error("dynamic import host requires module execution");
  if (scriptRoots && !dynamicImport)
    throw Error("Script-root host requires dynamic import");
  if (jsonModules && !moduleExecution)
    throw Error("JSON host requires module execution");
  if (topLevelAwait && !moduleExecution)
    throw Error("top-level await host requires module execution");
  const shared = scriptEvaluation?.literalTables === true;
  const evaluationHost =
    "{domain:():number=>currentContextDomain(),storage:executableStorage,table:():unknown=>scriptState.table," +
    (shared
      ? "compile:(module:Module,shape?:string):ScriptEntryCompilation=>scriptCompiler()(module,shape),"
      : "compile:(module:Module):ScriptEntryCompilation=>scriptCompiler()(module),") +
    "invoke:(address,frame):unknown=>invokeScript(address,frame),completion:(value)=>viewScriptCompletion(value),fault:(reason):void=>{if(scriptState.fault===undefined)scriptState.fault=reason;}}";
  // Script and module runners share the exact realm, harness error and job protocol.
  const runnerSetup = ` const realms:ErrorRealm[]=[];
 const host=createRealmHost(undefined,realms,canSuspend);
 const object=host.object,realm=host.realm,hooks=host.hooks,global=host.global;
 installRealmHost(host,realms);
 let completionCount=0,completion=11,jobFailure=0;
 const print=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
   const converted=stringValue(args[0],hooks,realm);
   if(converted.error==="unsupported")rejectUnsupportedExecution(realm);
   if(converted.error!=="none")throw createRuntimeError(realm,"type");
   const message=converted.value;
   if(asynchronous){
     const success=message==="Test262:AsyncTestComplete";
     const prefix="Test262:AsyncTestFailure:";
     if(success||message.startsWith(prefix)){
       completionCount++;
       if(completionCount>1)completion=12;
       else if(success)completion=42;
       else {
         const detail=message.slice(prefix.length),separator=detail.indexOf(":");
         const name=separator<0?"Test262Error":detail.slice(0,separator);
         const names=["Error","TypeError","ReferenceError","SyntaxError","RangeError","EvalError","URIError","Test262Error","AggregateError"];
         completion=59;
         for(let i=0;i<names.length;i++){if(names[i]===name)completion=50+i;}
       }
     }
   }
   return undefined;
 });
 createDataProperty<ScriptPropertyKey,unknown>(object,"print",print,hooks);
 let testErrorPrototype:OrdinaryObject<ScriptPropertyKey,unknown>|undefined=undefined;
 function captureTestErrorPrototype():void {
  const entry=getOwnProperty<ScriptPropertyKey,unknown>(object,"Test262Error");
  if(entry===undefined)return;
  const constructor=viewObjectValue(entry.value,object);
  if(constructor===undefined)return;
  const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(constructor,"prototype");
  if(descriptor===undefined)return;
  testErrorPrototype=viewObjectValue(descriptor.value,object);
 }
 function failure(value:unknown,base:number):number {
  const thrown=viewObjectValue(value,object);
  if(thrown!==undefined){
   if(testErrorPrototype!==undefined&&thrown.prototype===testErrorPrototype)return base+8;
   if(thrown.prototype===realm.prototypes.get("type"))return base+1;
   if(thrown.prototype===realm.prototypes.get("reference"))return base+2;
   if(thrown.prototype===realm.prototypes.get("syntax"))return base+3;
   if(thrown.prototype===realm.prototypes.get("range"))return base+4;
   if(thrown.prototype===realm.prototypes.get("eval"))return base+5;
   if(thrown.prototype===realm.prototypes.get("uri"))return base+6;
   if(thrown.prototype===realm.prototypes.get("aggregate"))return base+7;
  }
  return base;
 }
`;
  const runnerJobCheckpoint = ` ${agentProvider === undefined ? "drainScriptJobs(realm.agent,(error):void=>{if(jobFailure===0)jobFailure=failure(error,30);});" : "pumpNativeAgentJobs(host,(error):void=>{if(jobFailure===0)jobFailure=failure(error,30);},():boolean=>jobFailure!==0||!asynchronous||completionCount!==0);"}
 ${scriptEvaluation === undefined ? "" : "{const fe=scriptFaultExit();if(fe!==0)return fe;}"}
 for(const active of realms){if(active!==undefined&&active.unsupported)return 10;}
 if(jobFailure!==0)return jobFailure;
 ${scriptEvaluation === undefined ? "" : "{const fe=scriptFaultExit();if(fe!==0)return fe;}"}
`;
  const runnerCompletion = ` return asynchronous?completion:42;
`;
  const runnerJobs = runnerJobCheckpoint + runnerCompletion;
  const moduleJobCheckpoint = runnerJobCheckpoint.replace(
    " if(jobFailure!==0)return jobFailure;",
    " if(anyModuleFault())return 69;\n if(jobFailure!==0)return jobFailure;",
  );
  const runnerHarness = (
    condition: string,
  ) => ` for(let index=0;${condition};index++){
  const script=scripts[index];if(script===undefined)throw "NATIVE_HARNESS_ENTRY_INVARIANT";
  const result=script(global,createScriptRecord(realm,undefined));
  ${scriptEvaluation === undefined ? "" : "const fe=scriptFaultExit();if(fe!==0)return fe;"}
  if(result.error==="unsupported")return 10;
  if(result.error!=="none")return failure(result.value,20);
  captureTestErrorPrototype();
 }
`;
  const tableLoading = ` const records=new Map<string,ModuleRecord>();${
    sourcePhases
      ? `
 function hostModuleSource():ModuleRecord {
  const existing=records.get("<module source>");if(existing!==undefined)return existing;
  const module=createSyntheticModule(realm,[],(_module:ModuleRecord):void=>{},undefined);
  const prototype=createObject<ScriptPropertyKey,unknown>(realm.abstractModuleSourcePrototype);
  module.moduleSource=createModuleSourceObject(realm,prototype,"Test262ModuleSource");
  records.set("<module source>",module);return module;
 }`
      : ""
  }${
    topLevelAwait
      ? `
 const instantiated:ModuleRecord[]=[];
 function anyModuleFault():boolean {for(const module of instantiated){if(module===undefined)throw "NATIVE_MODULE_RECORD_INVARIANT";if(module.executionFault!==undefined)return true;}return false;}`
      : ""
  }
 function record(index:number):ModuleRecord {
  const name=names[index],create=creates[index];if(name===undefined||create===undefined)throw "NATIVE_MODULE_ENTRY_INVARIANT";
  const prior=records.get(name);if(prior!==undefined)return prior;
  const created=create(global,realm,undefined);records.set(name,created);${topLevelAwait ? "instantiated.push(created);" : ""}return created;
 }
 const verdictCodes=new Map<number,number>();
 function loadEntry(index:number${jsonModules ? ",request:ModuleRequest" : ""}):ModuleCompletion {${
   jsonModules
     ? `
  const createJSON=jsonCreates[index],name=names[index];if(name===undefined)throw "NATIVE_MODULE_ENTRY_INVARIANT";
  let requestedType:string|undefined=undefined;
  for(const attribute of request.attributes){if(attribute===undefined)throw "MODULE_REQUEST_INVARIANT";if(attribute.key==="type")requestedType=attribute.value;}
${assetModules ? '  const declaredType=name.startsWith("\\0text\\0")?"text":name.startsWith("\\0bytes\\0")?"bytes":createJSON===undefined?undefined:"json";\n  if(requestedType!==declaredType)return {ok:false,error:createRuntimeError(realm,"type")};' : '  if(requestedType==="text"||requestedType==="bytes")return rejectUnsupportedExecution(realm);\n  if(createJSON===undefined?requestedType!==undefined:requestedType!=="json")return {ok:false,error:createRuntimeError(realm,"type")};'}
  if(createJSON!==undefined){
   const previous=records.get(name);if(previous!==undefined)return {ok:true,module:previous};
   const completion=createJSON(global,realm,undefined);
   if(completion.ok){records.set(name,completion.module);${topLevelAwait ? "instantiated.push(completion.module);" : ""}}
   return completion;
  }`
     : ""
 }
  const verdict=verdicts[index];
  if(verdict===undefined)return {ok:true,module:record(index)};
  let code=verdictCodes.get(index);
  if(code===undefined){code=verdict();verdictCodes.set(index,code);}
  if(code===40)return {ok:false,error:createRuntimeError(realm,"syntax")};
  if(code===42||code===10)return rejectUnsupportedExecution(realm);
  throw "NATIVE_FIXTURE_VERDICT_INVARIANT";
 }
`;
  const resourceName = assetModules
    ? 'let resourceName=request.specifier.slice(2);for(const attribute of request.attributes){if(attribute===undefined)throw "MODULE_REQUEST_INVARIANT";if(attribute.key==="type"&&(attribute.value==="text"||attribute.value==="bytes"))resourceName="\\0"+attribute.value+"\\0"+resourceName;}'
    : "";
  const shadowModuleInitializer =
    shadowRealm && dynamicImport
      ? `
 function initializeModuleHost(target:RealmHost):void {
  const global=target.global,realm=target.realm,hooks=target.hooks;
${tableLoading}  realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{
   ${sourcePhases ? 'if(request.specifier==="<module source>"){finishLoadingImportedModule(referrer,request,payload,{ok:true,module:hostModuleSource()});return;}\n   ' : ""}if(referrer.realm!==realm)rejectUnsupportedExecution(realm);
   const specifier=request.specifier,name=specifier.startsWith("./")?specifier.slice(2):undefined;
   ${resourceName}const index=name===undefined?-1:names.indexOf(${assetModules ? "resourceName" : "name"});
   if(index>=0){finishLoadingImportedModule(referrer,request,payload,loadEntry(index${jsonModules ? ",request" : ""}));return;}
   finishLoadingImportedModule(referrer,request,payload,{ok:false,error:createRuntimeError(realm,"type")});
  };
  target.moduleHost=initializeModuleHost;
 }
 host.moduleHost=initializeModuleHost;
`
      : "";
  const moduleRunner = moduleExecution
    ? `
type NativeModuleFactory=(global:GlobalEnvironment<ScriptPropertyKey,unknown>,realm:ErrorRealm,hostDefined:unknown)=>ModuleRecord;${jsonModules ? "\ntype NativeJSONModuleFactory=(global:GlobalEnvironment<ScriptPropertyKey,unknown>,realm:ErrorRealm,hostDefined:unknown)=>ModuleCompletion;" : ""}
export function runNativeModuleTest(scripts:readonly NativeScript[],names:readonly string[],creates:readonly (NativeModuleFactory|undefined)[],asynchronous:boolean,canSuspend:boolean=true,verdicts:readonly ((()=>number)|undefined)[]=[]${jsonModules ? ",jsonCreates:readonly (NativeJSONModuleFactory|undefined)[]=[]" : ""}${sourcePhases ? ",absent:readonly string[]=[]" : ""}):number {
${runnerSetup}${runnerHarness("index<scripts.length")} function anyUnsupported():boolean {for(const active of realms){if(active!==undefined&&active.unsupported)return true;}return false;}
 if(names.length===0||creates.length!==names.length||creates[0]===undefined)return 69;
 if(verdicts.length!==0&&verdicts.length!==names.length)return 69;
${
  jsonModules
    ? ` if(jsonCreates.length!==0&&jsonCreates.length!==names.length)return 69;
 for(let i=0;i<names.length;i++){const count=(creates[i]===undefined?0:1)+(verdicts[i]===undefined?0:1)+(jsonCreates[i]===undefined?0:1);if(count!==1)return 69;}`
    : " for(let i=0;i<names.length;i++){if((creates[i]===undefined)===(verdicts[i]===undefined))return 69;}"
}
${tableLoading}${shadowModuleInitializer} try {
  const root=record(0);
  realm.moduleLoader=(referrer:${dynamicImport ? "ModuleReferrer" : "ModuleRecord"},request:ModuleRequest,hostDefined:unknown,payload:${dynamicImport ? "ModuleLoadPayload" : "GraphLoadingState"}):void=>{
   ${sourcePhases ? 'if(request.specifier==="<module source>"){finishLoadingImportedModule(referrer,request,payload,{ok:true,module:hostModuleSource()});return;}\n   ' : ""}${
     dynamicImport
       ? 'if(referrer.kind!=="module")rejectUnsupportedExecution(realm);\n   '
       : ""
   }${
     jsonModules
       ? 'if(!request.specifier.startsWith("./")){finishLoadingImportedModule(referrer,request,payload,{ok:false,error:createRuntimeError(realm,"type")});return;}'
       : 'if(!request.specifier.startsWith("./"))rejectUnsupportedExecution(realm);'
   }
   ${resourceName}const index=names.indexOf(${assetModules ? "resourceName" : "request.specifier.slice(2)"});${sourcePhases ? 'if(index<0){if(absent.indexOf(request.specifier.slice(2))>=0){finishLoadingImportedModule(referrer,request,payload,{ok:false,error:createRuntimeError(realm,"type")});return;}rejectUnsupportedExecution(realm);}' : "if(index<0)rejectUnsupportedExecution(realm);"}
   finishLoadingImportedModule(referrer,request,payload,loadEntry(index${jsonModules ? ",request" : ""}));
  };
  const loading=loadRequestedModules(root,hooks,undefined);
  ${scriptEvaluation === undefined ? "" : "{const fe=scriptFaultExit();if(fe!==0)return fe;}"}
  if(anyUnsupported())return 10;
  const loaded=settledModulePromise(loading,realm);
  if(loaded.kind==="pending")return 69;
  if(loaded.kind==="rejected")return failure(loaded.error,60);
  const linked=linkModule(root);
  ${scriptEvaluation === undefined ? "" : "{const fe=scriptFaultExit();if(fe!==0)return fe;}"}
  if(anyUnsupported())return 10;
  if(!linked.ok)return failure(linked.error,60);
  const evaluation=evaluateModule(root,hooks);
  ${scriptEvaluation === undefined ? "" : "{const fe=scriptFaultExit();if(fe!==0)return fe;}"}
  if(anyUnsupported())return 10;
  ${topLevelAwait ? moduleJobCheckpoint : ""}const evaluated=settledModulePromise(evaluation,realm);
  if(evaluated.kind==="pending")return ${topLevelAwait ? "asynchronous&&completionCount!==0?completion:11" : "69"};
  if(evaluated.kind==="rejected")return failure(evaluated.error,30);
 }catch(error){
  ${scriptEvaluation === undefined ? "" : "const fe=scriptFaultExit();if(fe!==0)return fe;"}
  return anyUnsupported()?10:69;
 }
${topLevelAwait ? runnerCompletion : runnerJobs}}
`
    : "";
  const scriptRunner = scriptRoots
    ? `
export function runNativeScriptRootTest(scripts:readonly NativeScript[],names:readonly string[],creates:readonly (NativeModuleFactory|undefined)[],absent:readonly string[],asynchronous:boolean,canSuspend:boolean=true,verdicts:readonly ((()=>number)|undefined)[]=[]${jsonModules ? ",jsonCreates:readonly (NativeJSONModuleFactory|undefined)[]=[]" : ""}):number {
 if(scripts.length===0)throw "EMPTY_NATIVE_SCRIPT_LIST";
${runnerSetup} if(creates.length!==names.length)return 69;
 if(verdicts.length!==0&&verdicts.length!==names.length)return 69;
${
  jsonModules
    ? ` if(jsonCreates.length!==0&&jsonCreates.length!==names.length)return 69;
 for(let i=0;i<names.length;i++){const count=(creates[i]===undefined?0:1)+(verdicts[i]===undefined?0:1)+(jsonCreates[i]===undefined?0:1);if(count!==1)return 69;}`
    : " for(let i=0;i<names.length;i++){if((creates[i]===undefined)===(verdicts[i]===undefined))return 69;}"
}
${tableLoading} realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{
  ${sourcePhases ? 'if(request.specifier==="<module source>"){finishLoadingImportedModule(referrer,request,payload,{ok:true,module:hostModuleSource()});return;}\n  ' : ""}if(referrer.realm!==realm)rejectUnsupportedExecution(realm);
  const specifier=request.specifier,name=specifier.startsWith("./")?specifier.slice(2):undefined;
  ${resourceName}const index=name===undefined?-1:names.indexOf(${assetModules ? "resourceName" : "name"});
  if(index>=0){finishLoadingImportedModule(referrer,request,payload,loadEntry(index${jsonModules ? ",request" : ""}));return;}
  ${
    jsonModules
      ? "if(name!==undefined&&absent.indexOf(name)<0)rejectUnsupportedExecution(realm);"
      : 'if(specifier!==""&&(name===undefined||absent.indexOf(name)<0))rejectUnsupportedExecution(realm);'
  }
  finishLoadingImportedModule(referrer,request,payload,{ok:false,error:createRuntimeError(realm,"type")});
 };
${shadowModuleInitializer}${runnerHarness("index+1<scripts.length")} const script=scripts[scripts.length-1];if(script===undefined)throw "NATIVE_TEST_ENTRY_INVARIANT";
 const result=script(global,createScriptRecord(realm,undefined));
 ${scriptEvaluation === undefined ? "" : "{const fe=scriptFaultExit();if(fe!==0)return fe;}"}
 for(const active of realms){if(active!==undefined&&active.unsupported)return 10;}
 if(result.error==="unsupported")return 10;
 if(result.error!=="none")return failure(result.value,30);
${topLevelAwait ? moduleJobCheckpoint + runnerCompletion : runnerJobs}}
`
    : "";
  return `${moduleExecution ? `import {${sourcePhases ? "createSyntheticModule," : ""}type ModuleRecord,type ModuleRequest,type GraphLoadingState,${dynamicImport ? "type ModuleReferrer,type ModuleLoadPayload," : ""}type ModuleCompletion,loadRequestedModules,finishLoadingImportedModule,linkModule,evaluateModule,settledModulePromise} from "modules";` : ""}
${
  scriptEvaluation === undefined
    ? ""
    : `import {${shadowRealm ? "createShadowRealmEvaluator," : ""}${scriptEvaluation.functionFallback ? "createDynamicFunctionBodyCompiler," : ""}${scriptEvaluation.directEval ? "createDirectEvaluator," : ""}${scriptEvaluation.indirectEval ? "createIndirectEvaluator,type ScriptEvaluationHost," : ""}createScriptEvaluator,type ScriptEvaluator,type ScriptEvaluationFault,type ScriptEntryCompilation} from "@tint/js-engine/script-evaluation";
import {createScriptEntryCompiler} from "@tint/js-engine/native/script-compile";
import {bindScript,invoke as invokeScript,completion as viewScriptCompletion} from "script-host";
import {scriptRuntimeTexts,scriptRuntimeSources,scriptRuntimeGlobalNames} from "script-sources";
import {readManagedSurfaceDirectory,type ManagedSurfaceLayoutRuntime} from "contracts";
import {parseModule,type Module} from "syntax";
import {createSourceTextView} from "source";
import type {SourceModule} from "module-model";`
}
${weakProvider === undefined ? "" : 'import {createWeakSlot,weakSlotKey,weakSlotValue,setWeakSlotValue,clearWeakSlot} from "weak-storage";'}
${spinHint === undefined ? "" : 'import {cpuPause} from "spin-hint";'}
${sharedBuffers ? `import {createNativeSharedBlockService,nativeSharedMemoryHost,${sharedAtomics ? "nativeSharedAtomicMemoryHost," : ""}type NativeSharedBlockService} from "shared-service";` : ""}
import {createGlobalEnvironment,type GlobalEnvironment} from "global";
import {createEngineCodeStorage} from "@tint/js-engine/native/code-storage";
import {createDynamicFunctionCompiler} from "@tint/js-engine/dynamic-function";
import {${scriptEvaluation === undefined ? "" : "nativeValueFunctionDescriptor,nativeValueFunctionSignature,"}mapExecutableMemory,writeExecutableMemory,callExecutableValue,callExecutableManagedWithIndex,nativeFunctionDescriptorWithIndex,nativeFunctionSignatureWithIndex,readMemoryWord,registerExternalMemory,currentContextDomain${scriptEvaluation?.hostGc ? ",collectGarbage" : ""}} from "memory";
import {randomNumber} from "random";
import {wallClockMilliseconds} from "clock";
import {createNativeFileHost,readlinkSync} from "native-fs";
import {readFile} from "files";
import {createTzifZone,type TzifZone} from "tzif";
import {readTimeZoneIdentifiers} from "zone-identifiers";
import {${shadowRealm ? "installShadowRealmIntrinsics," : ""}${sourcePhases ? "createModuleSourceObject," : ""}${scriptEvaluation?.directEval ? "installDirectEvalCompiler," : ""}${scriptEvaluation?.indirectEval ? "installEvalCompiler," : ""}${weakRef ? "installWeakRefIntrinsics," : ""}${finalizationRegistry ? "installFinalizationRegistryIntrinsics," : ""}${weakProvider === undefined ? "" : "installWeakCollectionIntrinsics,"}${atomics ? "installAtomicsIntrinsics," : ""}${sharedBuffers ? "installSharedArrayBufferIntrinsics," : ""}${disposal ? "installDisposableStackIntrinsics," : ""}${asyncDisposal ? "installAsyncDisposableStackIntrinsics," : ""}type ScriptRecord,createScriptRecord,primaryTimeZoneIdentifiers,installIntlIntrinsics,createNamedTimeZoneProvider,type NamedTimeZoneProvider,type NamedTimeZoneLookup,type ErrorRealm,type OrdinaryObject,type ScriptPropertyKey,createObject,createCallableObject,getOwnProperty,createDataProperty,stringValue,drainScriptJobs,createRuntimeError,rejectUnsupportedExecution,createScriptAgent,createSymbolRegistry,createErrorRealm,installDateTimeZone,installArrayBufferIntrinsics,installDataViewIntrinsics,installTypedArrayIntrinsics,detachArrayBuffer,installErrorIntrinsics,installArrayIntrinsics,installObjectIntrinsics,installFunctionIntrinsics,installPrimitiveIntrinsics,installMapIntrinsics,installSetIntrinsics,installIteratorConstructor,installRegExpIntrinsics,installSymbolIntrinsics,installMathIntrinsics,installPromiseIntrinsics,installProxyIntrinsics,installReflectIntrinsics,installGlobalProperties,installEvalIntrinsic,installTemporalIntrinsics,callObjectValue,viewObjectValue,scriptSameValue as sameValue,type ObjectHooks} from "object";
${
  sharedBuffers
    ? `let sharedBlocks:NativeSharedBlockService|undefined=undefined;
function nativeSharedBlocks(realm:ErrorRealm):NativeSharedBlockService {
 const existing=sharedBlocks;
 if(existing!==undefined)return existing;
 const created=createNativeSharedBlockService(nativeSharedMemoryHost(),{pageSize:${nativeTestResources.sharedMemoryPageBytes},maxBlocks:${nativeTestResources.sharedMemoryBlocks},maxReservedBytes:${nativeTestResources.sharedMemoryBytes}}${sharedAtomics ? ",nativeSharedAtomicMemoryHost()" : ""}${agentProvider === undefined ? "" : `,{parking:nativeWaiterParkingHost(),now:():number=>monotonicMilliseconds(),maxWaiters:${nativeTestResources.agentLimits.maxWaiters}}`});
 if(!created.ok)return rejectUnsupportedExecution(realm);
 sharedBlocks=created.value;
 return created.value;
}`
    : ""
}
${agentProvider === undefined ? "" : nativeAgentHostSource(nativeTestResources.timeoutMs, nativeTestResources.agentLimits.maxAgents) + "\n"}interface NativeScriptResult {readonly error:string;readonly value:unknown;}
type NativeScript=(global:GlobalEnvironment<ScriptPropertyKey,unknown>,script:ScriptRecord)=>NativeScriptResult;
// ${agentProvider === undefined ? "Process" : "Agent"}-owned bounded arena: never recycle code while a returned function can
// refer to it. General code ownership/GC is a separate loader integration step.
const executableStorage=createEngineCodeStorage({
 domain:():number=>currentContextDomain(),
 map:(bytes:number):number=>mapExecutableMemory(bytes),
 register:(address:number,bytes:number):number=>registerExternalMemory(address,bytes),
 write:(address:number,capacity:number,offset:number,bytes:Uint8Array):number=>writeExecutableMemory(address,capacity,offset,bytes),
},${nativeTestResources.executableMemoryBytes});
${
  scriptEvaluation === undefined
    ? ""
    : `
const scriptState:{started:boolean;compile:((module:Module${scriptEvaluation.literalTables ? ",shape?:string" : ""})=>ScriptEntryCompilation)|undefined;table:unknown;fault:ScriptEvaluationFault|undefined}={started:false,compile:undefined,table:undefined,fault:undefined};
function scriptCompiler():(module:Module${scriptEvaluation.literalTables ? ",shape?:string" : ""})=>ScriptEntryCompilation {
 const existing=scriptState.compile;if(existing!==undefined)return existing;
 if(scriptState.started)throw "SCRIPT_COMPILER_POISONED";
 scriptState.started=true;
 const exported=bindScript();
 const read=readManagedSurfaceDirectory(exported,"scriptRuntime",{domain:():number=>currentContextDomain(),descriptor:(v:unknown):number=>nativeValueFunctionDescriptor(v),signature:(v:unknown):number=>nativeValueFunctionSignature(v)});
 if(!read.ok||read.value.domain!==executableStorage.domain)throw "SCRIPT_SURFACE_READ";
 const modules:SourceModule[]=[];
 for(const source of scriptRuntimeTexts){if(source===undefined)throw "SCRIPT_RUNTIME_SOURCE";const parsed=parseModule(createSourceTextView(source.text));if(!parsed.ok)throw "SCRIPT_RUNTIME_PARSE";const dependencies=new Map<string,string>();for(const pair of source.dependencies){if(pair===undefined)throw "SCRIPT_RUNTIME_DEPENDENCY";const specifier=pair[0],target=pair[1];if(specifier===undefined||target===undefined)throw "SCRIPT_RUNTIME_DEPENDENCY";dependencies.set(specifier,target);}modules.push({id:source.id,module:parsed.value,dependencies});}
 const runtime:ManagedSurfaceLayoutRuntime={modules,runtimes:scriptRuntimeSources,globals:scriptRuntimeGlobalNames};
 const compile=createScriptEntryCompiler({read:read.value,runtime},{domain:():number=>currentContextDomain(),storage:executableStorage,readWord:(a:number,l:number,o:number):number=>readMemoryWord(a,l,o)},{maxScriptCodeBytes:${nativeTestResources.maxScriptCodeBytes}${scriptEvaluation.literalTables ? `,maxSharedEntries:${nativeTestResources.maxSharedScriptEntries}` : ""}});
 scriptState.table=exported.table;scriptState.compile=compile;return compile;
}
function scriptFaultExit():number{const f=scriptState.fault;if(f===undefined)return 0;return f==="compile-threw"?13:f==="invoke-threw"?14:f==="completion-view"?15:f==="completion-kind"?16:17;}
`
}
const timeZoneState:{loaded:boolean;zone:TzifZone|undefined}={loaded:false,zone:undefined};
function defaultTimeZone():TzifZone|undefined {
 if(timeZoneState.loaded)return timeZoneState.zone;
 timeZoneState.loaded=true;
 const bytes=readFile<number>(createNativeFileHost(),${JSON.stringify(nativeTimeZoneData.path)},${nativeTestResources.timeZoneDataBytes});
 if(!bytes.ok)return undefined;
 const zone=createTzifZone(bytes.value);
 if(zone.ok)timeZoneState.zone=zone.value;
 return timeZoneState.zone;
}
const namedZoneState:{loaded:boolean;provider:NamedTimeZoneProvider|undefined;primary:readonly string[]|undefined}={loaded:false,provider:undefined,primary:undefined};
function namedTimeZones():NamedTimeZoneProvider|undefined {
 if(namedZoneState.loaded)return namedZoneState.provider;
 namedZoneState.loaded=true;
 const host=createNativeFileHost();
 const bytes=readFile<number>(host,${JSON.stringify(nativeTestResources.namedTimeZoneDatabase.metadataPath)},${nativeTestResources.timeZoneDataBytes});
 if(!bytes.ok)return undefined;
 let text="";try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes.value);}catch(error){return undefined;}
 const identifiers=readTimeZoneIdentifiers(text);if(!identifiers.ok)return undefined;
 namedZoneState.primary=primaryTimeZoneIdentifiers(identifiers.value);
 const provider=createNamedTimeZoneProvider(identifiers.value,(identifier):Uint8Array|undefined=>{
   const data=readFile<number>(host,${JSON.stringify(nativeTestResources.namedTimeZoneDatabase.dataRoot)}+identifier,${nativeTestResources.timeZoneDataBytes});
   return data.ok?data.value:undefined;
 });
 namedZoneState.provider=provider;
 return provider;
}
const lazyNamedTimeZones:NamedTimeZoneProvider={lookup:(identifier):NamedTimeZoneLookup=>{
 const provider=namedTimeZones();
 if(provider===undefined)return {status:"unavailable",error:"MISSING_DATA"};
 return provider.lookup(identifier);
}};
function systemTimeZoneName():string|undefined {
 const requested:string|undefined=${JSON.stringify(timeZoneName) ?? "undefined"};
 if(requested!==undefined)return requested;
 let target="";try{target=readlinkSync(${JSON.stringify(nativeTestResources.namedTimeZoneDatabase.systemLinkPath)});}catch(error){return undefined;}
 const marker=target.lastIndexOf("/zoneinfo/");
 if(marker<0)return undefined;
 return target.slice(marker+10);
}
function systemTimeZoneIdentifier(realm:ErrorRealm):string {
 const name=systemTimeZoneName();if(name===undefined)return rejectUnsupportedExecution(realm);
 const lookup=lazyNamedTimeZones.lookup(name);if(lookup.status!=="available")return rejectUnsupportedExecution(realm);
 return lookup.identifier.primaryIdentifier??lookup.identifier.identifier;
}
function availableTimeZoneIdentifiers(realm:ErrorRealm):readonly string[] {
 namedTimeZones();const names=namedZoneState.primary;
 return names===undefined?rejectUnsupportedExecution(realm):names;
}
interface RealmHost {
 ${shadowRealm ? "moduleHost:((host:RealmHost)=>void)|undefined;\n " : ""}${scriptEvaluation === undefined ? "" : "readonly evaluate:ScriptEvaluator;"}
 readonly object:OrdinaryObject<ScriptPropertyKey,unknown>;
 readonly global:GlobalEnvironment<ScriptPropertyKey,unknown>;
 readonly realm:ErrorRealm;
 readonly hooks:ObjectHooks<unknown>;
}
function createRealmHost(parent:ErrorRealm|undefined,realms:ErrorRealm[],canSuspend:boolean=false):RealmHost {
 const prototype=createObject<ScriptPropertyKey,unknown>(undefined);
 const object=createObject<ScriptPropertyKey,unknown>(prototype);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>sameValue(a,b),call:(callee,receiver,args):unknown=>{
   const result=callObjectValue(callee,receiver,args,object);
   if(result.error!=="none")throw "INVALID_NATIVE_HOOK_CALL";
   return result.value;
 }};
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 installGlobalProperties(object,object,hooks);
 const realm=parent===undefined?createErrorRealm(prototype,hooks,createSymbolRegistry(),createScriptAgent(canSuspend)${jsonModules ? ',["type"]' : ""}):createErrorRealm(prototype,hooks,parent.symbolRegistry,parent.agent${jsonModules ? ',["type"]' : ""});
 ${
   weakProvider === undefined
     ? ""
     : `if(parent===undefined)realm.agent.weakStorage={
 create:(key:unknown,value:unknown,ephemeron:boolean):unknown=>createWeakSlot(key,value,ephemeron),
 key:(cell:unknown):unknown=>weakSlotKey(cell),value:(cell:unknown):unknown=>weakSlotValue(cell),
 setValue:(cell:unknown,value:unknown):void=>{setWeakSlotValue(cell,value);},clear:(cell:unknown):void=>{clearWeakSlot(cell);}
 };`
 }
 realm.bufferMaxBytes=${nativeTestResources.arrayBufferBytes};
 realms.push(realm);
 installErrorIntrinsics(object,realm,hooks);
 ${disposal ? "installDisposableStackIntrinsics(object,realm,hooks);" : ""}
 ${asyncDisposal ? "installAsyncDisposableStackIntrinsics(object,realm,hooks);" : ""}
 installArrayIntrinsics(object,realm,hooks);
 installArrayBufferIntrinsics(object,realm,hooks);
 ${atomics ? `installAtomicsIntrinsics(object,realm,hooks,${JSON.stringify(nativeTestResources.atomicCapabilities)}${spinHint === undefined ? "" : ",():void=>{cpuPause();}"});` : ""}
 ${sharedBuffers ? "installSharedArrayBufferIntrinsics(object,realm,hooks,nativeSharedBlocks(realm));" : ""}
 installDataViewIntrinsics(object,realm,hooks);
 installTypedArrayIntrinsics(object,realm,hooks,"little");
 installObjectIntrinsics(object,realm,hooks);
 installFunctionIntrinsics(object,realm,hooks);
 installEvalIntrinsic(object,realm,hooks);
 ${
   scriptEvaluation?.functionFallback
     ? `const service:ScriptEvaluationHost=${evaluationHost};
 `
     : ""
 }realm.dynamicFunctionCompiler=createDynamicFunctionCompiler({realm,global,object,hooks},{
  domain:():number=>currentContextDomain(),
  storage:executableStorage,
  invokeBorrowed:(address:number,value:unknown):unknown=>callExecutableValue(address,value),
  invokeManaged:(address:number,reader:(base:unknown,step:number)=>unknown):unknown=>callExecutableManagedWithIndex(address,reader),
  descriptor:(reader:(base:unknown,step:number)=>unknown):number=>nativeFunctionDescriptorWithIndex(reader),
  signature:(reader:(base:unknown,step:number)=>unknown):number=>nativeFunctionSignatureWithIndex(reader),
  readWord:(address:number,byteLength:number,offset:number):number=>readMemoryWord(address,byteLength,offset),
 },{maxDynamicCodeBytes:${nativeTestResources.maxDynamicCodeBytes}}${scriptEvaluation?.functionFallback ? ",createDynamicFunctionBodyCompiler({realm,global},service)" : ""});
 realm.wallClockMilliseconds=():number=>wallClockMilliseconds();
 realm.namedTimeZones=lazyNamedTimeZones;
 realm.availableTimeZoneIdentifiers=():readonly string[]=>availableTimeZoneIdentifiers(realm);
 realm.systemTimeZoneIdentifier=():string=>systemTimeZoneIdentifier(realm);
 const zone=defaultTimeZone();if(zone!==undefined)installDateTimeZone(realm,zone);
 installPrimitiveIntrinsics(object,realm,hooks);
 installIteratorConstructor(object,realm,hooks);
 installMapIntrinsics(object,realm,hooks);
 ${weakProvider === undefined ? "" : "installWeakCollectionIntrinsics(object,realm,hooks);"}
 ${weakRef ? "installWeakRefIntrinsics(object,realm,hooks);" : ""}
 ${finalizationRegistry ? "installFinalizationRegistryIntrinsics(object,realm,hooks);" : ""}
 installSetIntrinsics(object,realm,hooks);
 installRegExpIntrinsics(object,realm,hooks);
 installSymbolIntrinsics(object,realm,hooks);
 installMathIntrinsics(object,realm,hooks,():number=>randomNumber());
 installTemporalIntrinsics(object,realm,hooks);
 installIntlIntrinsics(object,realm,hooks);
 installProxyIntrinsics(object,realm,hooks);
 installReflectIntrinsics(object,realm,hooks);
 installPromiseIntrinsics(object,realm,hooks,(promise,operation):void=>{${agentProvider === undefined ? "" : "trackNativeAgentRejection(operation);"}});
 ${scriptEvaluation === undefined ? "" : scriptEvaluation.indirectEval ? `${scriptEvaluation.functionFallback ? "" : `const service:ScriptEvaluationHost=${evaluationHost};`}const evaluate=createScriptEvaluator({realm,global},service);installEvalCompiler(realm,createIndirectEvaluator({realm,global},service));${scriptEvaluation.directEval ? "installDirectEvalCompiler(realm,createDirectEvaluator({realm,global},service));" : ""}` : `const evaluate=createScriptEvaluator({realm,global},${evaluationHost});`}
 ${
   shadowRealm
     ? `const host:RealmHost={object,global,realm,hooks,evaluate,moduleHost:undefined};
 installShadowRealmIntrinsics(object,realm,hooks,()=>{
  const child=createRealmHost(realm,realms);
  const initializeModuleHost=host.moduleHost;
  if(initializeModuleHost!==undefined)initializeModuleHost(child);
  return {realm:child.realm,evaluate:createShadowRealmEvaluator({realm:child.realm,global:child.global},service)};
 });
 return host;`
     : `return {object,global,realm,hooks${scriptEvaluation === undefined ? "" : ",evaluate"}};`
 }
}
function installRealmHost(host:RealmHost,realms:ErrorRealm[]):OrdinaryObject<ScriptPropertyKey,unknown> {
 const realm=host.realm,hooks=host.hooks;
 const api=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);
 const htmlDDA=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>null);
 htmlDDA.internalIsHTMLDDA=true;
 createDataProperty<ScriptPropertyKey,unknown>(api,"IsHTMLDDA",htmlDDA,hooks);
 const create=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
   const child=createRealmHost(realm,realms);
   ${shadowRealm ? "const initializeModuleHost=host.moduleHost;if(initializeModuleHost!==undefined)initializeModuleHost(child);\n   " : ""}return installRealmHost(child,realms);
 });
 const detach=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
   detachArrayBuffer(args[0],realm);
   return undefined;
 });
 createDataProperty<ScriptPropertyKey,unknown>(api,"detachArrayBuffer",detach,hooks);${
   scriptEvaluation?.hostGc
     ? `
 // INTERPRETING.md $262.gc: a real full collection through the runtime collector.
 const gc=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
   collectGarbage();
   return undefined;
 });
 createDataProperty<ScriptPropertyKey,unknown>(api,"gc",gc,hooks);`
     : ""
 }
 createDataProperty<ScriptPropertyKey,unknown>(api,"global",host.object,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(api,"createRealm",create,hooks);
 const evaluateScript=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
   ${scriptEvaluation === undefined ? "rejectUnsupportedExecution(realm);\n   return undefined;" : "return host.evaluate(args[0]);"}
 });
 ${sourcePhases ? 'createDataProperty<ScriptPropertyKey,unknown>(api,"AbstractModuleSource",realm.abstractModuleSourceConstructor,hooks);\n ' : ""}createDataProperty<ScriptPropertyKey,unknown>(api,"evalScript",evaluateScript,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(host.object,"$262",api,hooks);
${agentProvider === undefined ? "" : " installNativeAgent(host,api);\n"} return api;
}
export function runNativeScripts(scripts:readonly NativeScript[],asynchronous:boolean,canSuspend:boolean=true):number {
 if(scripts.length===0)throw "EMPTY_NATIVE_SCRIPT_LIST";
${runnerSetup}${runnerHarness("index+1<scripts.length")} const script=scripts[scripts.length-1];if(script===undefined)throw "NATIVE_TEST_ENTRY_INVARIANT";
 const result=script(global,createScriptRecord(realm,undefined));
 ${scriptEvaluation === undefined ? "" : "{const fe=scriptFaultExit();if(fe!==0)return fe;}"}
 for(const active of realms){if(active!==undefined&&active.unsupported)return 10;}
 if(result.error==="unsupported")return 10;
 if(result.error!=="none")return failure(result.value,30);
${runnerJobs}}${moduleRunner}${scriptRunner}`;
}
function nativeTestRuntime(
  id: string,
  disposal: boolean = true,
  asyncDisposal: boolean = disposal,
  sharedBuffers: boolean = false,
  atomics: boolean = false,
  spinHint?: string,
  sharedAtomics: boolean = false,
  storageProvider: string = engineStorageModule,
  dynamicProvider: string = engineDynamicModule,
  weakProvider?: string,
  weakRef: boolean = false,
  finalizationRegistry: boolean = false,
  scriptEvaluation?: NativeScriptEvaluation,
  moduleExecution: boolean = false,
  dynamicImport: boolean = false,
  scriptRoots: boolean = false,
  topLevelAwait: boolean = false,
  jsonModules: boolean = false,
  agentProvider?: string,
  sourcePhases: boolean = false,
  assetModules: boolean = false,
): SourceModule {
  const text = nativeTestRuntimeSource(
    scriptEvaluation,
    disposal,
    asyncDisposal,
    sharedBuffers,
    atomics,
    spinHint,
    sharedAtomics,
    storageProvider,
    dynamicProvider,
    weakProvider,
    weakRef,
    finalizationRegistry,
    moduleExecution,
    dynamicImport,
    scriptRoots,
    topLevelAwait,
    jsonModules,
    agentProvider,
    sourcePhases,
    assetModules,
  );
  return parsedNativeHost(
    id,
    text,
    new Map([
      ["global", globalModule],
      ...(agentProvider === undefined
        ? []
        : [
            ["agents", agentProvider] as [string, string],
            ["shared-bytes", "packages/js-runtime/src/bytes/shared.ts"] as [
              string,
              string,
            ],
          ]),
      ...(moduleExecution
        ? [
            ["modules", "packages/js-runtime/src/modules/index.ts"] as [
              string,
              string,
            ],
          ]
        : []),
      ...(scriptEvaluation === undefined
        ? []
        : [
            [
              "@tint/js-engine/script-evaluation",
              scriptEvaluation.evaluation,
            ] as [string, string],
            [
              "@tint/js-engine/native/script-compile",
              scriptEvaluation.compile,
            ] as [string, string],
            ["script-host", "test262-script-host"] as [string, string],
            ["script-sources", "test262-script-sources"] as [string, string],
            ["contracts", nativeCompilerModule] as [string, string],
            ["syntax", syntaxModule] as [string, string],
            ["source", "packages/source/src/text.ts"] as [string, string],
            ["module-model", "packages/typescript/src/modules/model.ts"] as [
              string,
              string,
            ],
          ]),

      ["memory", nativeMemoryModule],
      ...(weakProvider === undefined
        ? []
        : [["weak-storage", weakProvider] as [string, string]]),

      [engineStorageSpecifier, storageProvider],
      [engineDynamicSpecifier, dynamicProvider],
      ["object", objectModule],
      ...(spinHint === undefined
        ? []
        : [["spin-hint", spinHint] as [string, string]]),
      ...(sharedBuffers
        ? [["shared-service", sharedServiceModule] as [string, string]]
        : []),
      ["random", randomModule],
      ["clock", clockModule],
      ["files", fileServiceModule],
      ["native-fs", nativeFSModule],
      ["tzif", timeZoneModule],
      ["zone-identifiers", timeZoneIdentifiersModule],
    ]),
  );
}

/** Each case retains its ordered Script identities and completion mode. Realm
 * setup, host capabilities and runtime source compilation share one code module;
 * selecting a case still executes in a fresh operating-system process. */
function nativeTestHost(
  scripts: readonly SourceModule[],
  asynchronous: boolean,
  id: string,
  runtime: string,
  canSuspend: boolean = true,
  moduleEntries?: readonly NativeModuleEntry[],
  scriptRoot?: { readonly absent: readonly string[] },
  threaded: boolean = false,
  moduleAbsent?: readonly string[],
  jsonModules: boolean = false,
): SourceModule {
  const header = threaded
    ? "export function run(argument:number):number{if(argument!==0)return runNativeAgent(argument);try{"
    : "export function run():number{";
  const footer = threaded ? "}finally{finishNativeAgents();}}" : "}";
  const helpers = threaded ? ",runNativeAgent,finishNativeAgents" : "";
  if (moduleEntries !== undefined || scriptRoot !== undefined) {
    const moduleInputs = moduleEntries ?? [];
    const runner =
      scriptRoot === undefined
        ? "runNativeModuleTest"
        : "runNativeScriptRootTest";
    if (moduleInputs.length === 0 && scriptRoot === undefined)
      throw Error("missing root module");
    const hasVerdicts = moduleInputs.some((entry) => entry.verdict === true);
    const hasJSON = moduleInputs.some((entry) => entry.json === true);
    const hasAbsence = moduleAbsent !== undefined;
    const imports = [
      ...scripts.map(
        (module, index) =>
          `import {execute as script${index}} from ${JSON.stringify(module.id)};`,
      ),
      ...moduleInputs.map(
        (entry, index) =>
          `import {${entry.verdict === true ? "run as verdict" : "create as module"}${index}} from ${JSON.stringify(entry.module.id)};`,
      ),
    ].join("\n");
    return parsedNativeHost(
      id,
      `${imports}
import {${runner}${helpers}} from "runtime";
${header}return ${runner}([${scripts.map((_, index) => "script" + index).join(",")}],${JSON.stringify(moduleInputs.map((entry) => entry.name))},[${moduleInputs.map((entry, index) => (entry.verdict === true || entry.json === true ? "undefined" : "module" + index)).join(",")}],${scriptRoot === undefined ? "" : JSON.stringify(scriptRoot.absent) + ","}${asynchronous ? "true" : "false"},${canSuspend ? "true" : "false"}${hasVerdicts || hasJSON || hasAbsence ? `,[${moduleInputs.map((entry, index) => (entry.verdict === true ? "verdict" + index : "undefined")).join(",")}]` : ""}${hasJSON || (hasAbsence && jsonModules) ? `,[${moduleInputs.map((entry, index) => (entry.json === true ? "module" + index : "undefined")).join(",")}]` : ""}${hasAbsence ? "," + JSON.stringify(moduleAbsent) : ""});${footer}
`,
      new Map([
        ["runtime", runtime],
        ...scripts.map((module): [string, string] => [module.id, module.id]),
        ...moduleInputs.map((entry): [string, string] => [
          entry.module.id,
          entry.module.id,
        ]),
      ]),
    );
  }
  if (scripts.length === 0) throw new Error("missing test Script");
  const imports = scripts
    .map(
      (module, index) =>
        `import {execute as script${index}} from ${JSON.stringify(module.id)};`,
    )
    .join("\n");
  const entries = scripts.map((module, index) => "script" + index).join(",");
  return parsedNativeHost(
    id,
    `${imports}
import {runNativeScripts${helpers}} from "runtime";
${header}return runNativeScripts([${entries}],${asynchronous ? "true" : "false"},${canSuspend ? "true" : "false"});${footer}
`,
    new Map([
      ["runtime", runtime],
      ...scripts.map((module): [string, string] => [module.id, module.id]),
    ]),
  );
}

/** Compilation is shared; only the selected case runs, in a fresh process. */
export function prepareNativeBatch(
  cases: readonly NativeTestCase[],
  disposal: boolean = true,
  asyncDisposal: boolean = disposal,
  sharedBuffers: boolean = false,
  atomics: boolean = false,
  spinHint?: string,
  sharedAtomics: boolean = false,
  storageProvider: string = engineStorageModule,
  dynamicProvider: string = engineDynamicModule,
  weakProvider?: string,
  weakRef: boolean = false,
  finalizationRegistry: boolean = false,
  scriptEvaluation?: NativeScriptEvaluation,
  moduleExecution: boolean = false,
  dynamicImport: boolean = false,
  topLevelAwait: boolean = false,
  jsonModules: boolean = false,
  agentProvider?: string,
  sourcePhases: boolean = false,
  assetModules: boolean = false,
): SourceModule[] {
  if (cases.length === 0) throw new Error("empty native test batch");
  const scriptRoots = cases.some((item) => item.scriptRoot !== undefined);
  if (scriptRoots && !(moduleExecution && dynamicImport))
    throw Error("Script-root case requires the dynamic import host");
  const runtime = "test262-runtime";
  const modules: SourceModule[] = [
    nativeTestRuntime(
      runtime,
      disposal,
      asyncDisposal,
      sharedBuffers,
      atomics,
      spinHint,
      sharedAtomics,
      storageProvider,
      dynamicProvider,
      weakProvider,
      weakRef,
      finalizationRegistry,
      scriptEvaluation,
      moduleExecution,
      dynamicImport,
      scriptRoots,
      topLevelAwait,
      jsonModules,
      agentProvider,
      sourcePhases,
      assetModules,
    ),
  ];
  const hosts: string[] = [];
  const shared = new Map<string, SourceModule>();
  const emitted = new Set<string>();
  for (const [index, item] of cases.entries()) {
    if (item.modules !== undefined && !moduleExecution)
      throw Error("module case requires the module host capability");
    if (!jsonModules && item.modules?.some((entry) => entry.json === true))
      throw Error("JSON case requires the JSON module host capability");
    const inputs = [
      ...item.scripts,
      ...(item.modules?.map((entry) => entry.module) ?? []),
    ];
    const localIds = new Set(inputs.map((script) => script.id));
    const canonical = inputs.map((script, inputIndex) => {
      // Lowered Scripts have only runtime imports. Do not share arbitrary
      // cross-Script graphs whose dependency IDs will be remapped below.
      if ([...script.dependencies.values()].some((id) => localIds.has(id)))
        return { ...script, id: `test262-case-${index}-${script.id}` };
      const moduleEntry =
        inputIndex < item.scripts.length
          ? undefined
          : item.modules?.[inputIndex - item.scripts.length];
      const key = JSON.stringify(
        moduleEntry === undefined
          ? [script.module, [...script.dependencies]]
          : [moduleEntry.name, script.module, [...script.dependencies]],
      );
      const previous = shared.get(key);
      if (previous !== undefined) return previous;
      const module = { ...script, id: `test262-shared-script-${shared.size}` };
      shared.set(key, module);
      return module;
    });
    const ids = new Map(
      inputs.map((script, i) => [script.id, canonical[i]!.id]),
    );
    const scripts = canonical.map((script) => ({
      ...script,
      dependencies: new Map(
        [...script.dependencies].map(([name, id]) => [name, ids.get(id) ?? id]),
      ),
    }));
    for (const script of scripts) {
      if (!emitted.has(script.id)) {
        modules.push(script);
        emitted.add(script.id);
      }
    }
    const id = `test262-case-${index}-host`;
    modules.push(
      nativeTestHost(
        scripts.slice(0, item.scripts.length),
        item.asynchronous,
        id,
        runtime,
        item.canSuspend ?? true,
        item.modules?.map((entry, i) => ({
          ...entry,
          module: scripts[item.scripts.length + i]!,
        })),
        item.scriptRoot,
        false,
        sourcePhases &&
          item.scriptRoot === undefined &&
          item.modules !== undefined
          ? (item.moduleAbsent ?? [])
          : undefined,
        jsonModules,
      ),
    );
    hosts.push(id);
  }
  modules.push(
    nativeSelectorHost(
      hosts,
      "test262-host",
      agentProvider === undefined ? undefined : runtime,
    ),
  );
  return modules;
}

export function nativeSelectorHost(
  hosts: readonly string[],
  entry: string,
  agentRuntime?: string,
): SourceModule {
  return parsedNativeHost(
    entry,
    `
${hosts.map((id, index) => `import {run as case${index}} from "${id}";`).join("\n")}
${agentRuntime === undefined ? "" : `import {runNativeAgent,finishNativeAgents} from "agent-runtime";`}
import {argumentCount,argumentByteLength,copyArgument} from "process";
export function run(${agentRuntime === undefined ? "" : "argument:number"}):number {
 ${agentRuntime === undefined ? "" : "if(argument!==0)return runNativeAgent(argument);"}
 if(argumentCount()!==2)return 99;
 const length=argumentByteLength(1);
 if(length<1||length>9)return 99;
 const bytes=new Uint8Array(length);
 if(copyArgument(1,bytes)!==length)return 99;
 let selected=0;
 for(let i=0;i<length;i++){
  const digit=bytes[i];
  if(digit===undefined||digit<48||digit>57)return 99;
  selected=selected*10+digit-48;
 }
 ${hosts.map((_, index) => `if(selected===${index})${agentRuntime === undefined ? `return case${index}();` : `{try{return case${index}();}finally{finishNativeAgents();}}`}`).join("\n")}
 return 99;
}`,
    new Map([
      ["process", "packages/native-runtime/src/intrinsics/process.ts"],
      ...(agentRuntime === undefined
        ? []
        : [["agent-runtime", agentRuntime] as [string, string]]),
      ...hosts.map((id): [string, string] => [id, id]),
    ]),
  );
}

export interface NativeRuntimeCapabilities {
  readonly agentHost?: string;
  readonly disposal: boolean;
  readonly asyncDisposal: boolean;
  readonly sharedBuffers: boolean;
  readonly atomics: boolean;
  readonly spinHint: string | undefined;
  readonly sharedAtomics: boolean;
  readonly weakStorage: string | undefined;
  readonly weakRef: boolean;
  readonly finalizationRegistry: boolean;
  readonly directEvalSiteView: boolean;
}
/** Captured public exports are the contract, independently of private file moves.
 * An advertised shared installer requires its real native service provider. */
export function capturedNativeRuntimeCapabilities(
  snapshot: WorkspaceSourceSnapshot,
): NativeRuntimeCapabilities {
  const objects = capturedModuleExports(
    workspaceModules([objectModule], snapshot),
  ).get(objectModule);
  if (objects === undefined)
    throw Error("missing captured object runtime contract");
  const sharedBuffers = objects.has("installSharedArrayBufferIntrinsics");
  let sharedAtomics = false;
  if (sharedBuffers) {
    const service = capturedModuleExports(
      workspaceModules([sharedServiceModule], snapshot),
    ).get(sharedServiceModule);
    sharedAtomics = service?.has("nativeSharedAtomicMemoryHost") === true;
    for (const name of [
      "createNativeSharedBlockService",
      "nativeSharedMemoryHost",
    ])
      if (!service?.has(name))
        throw Error("missing captured shared-memory contract: " + name);
  }
  const atomics = objects.has("installAtomicsIntrinsics");
  const spinHint = atomics
    ? capturedPublicEntry(
        snapshot.mappings,
        "@tint/native-runtime/intrinsics/spin-hint",
      )
    : undefined;
  if (
    spinHint !== undefined &&
    !capturedModuleExports(workspaceModules([spinHint], snapshot))
      .get(spinHint)
      ?.has("cpuPause")
  )
    throw Error("missing captured CPU spin-hint contract");
  const weakRef = objects.has("installWeakRefIntrinsics");
  const finalizationRegistry = objects.has(
    "installFinalizationRegistryIntrinsics",
  );
  if (finalizationRegistry && !objects.has("viewWeakRegistryOwner"))
    throw Error("missing captured weak-registry view");
  let weakStorage: string | undefined;
  if (
    objects.has("installWeakCollectionIntrinsics") ||
    weakRef ||
    finalizationRegistry
  ) {
    weakStorage = capturedPublicEntry(
      snapshot.publicEntries ?? snapshot.mappings,
      "@tint/native-runtime/intrinsics/weak",
    );
    if (weakStorage === undefined)
      throw Error("missing captured weak-storage provider");
    const exports = capturedModuleExports(
      workspaceModules([weakStorage], snapshot),
    ).get(weakStorage);
    for (const name of [
      "createWeakSlot",
      "weakSlotKey",
      "weakSlotValue",
      "setWeakSlotValue",
      "clearWeakSlot",
    ])
      if (!exports?.has(name))
        throw Error("missing captured weak-storage contract: " + name);
  }
  let agentHost: string | undefined;
  if (
    sharedBuffers &&
    sharedAtomics &&
    atomics &&
    objects.has("numberValue") &&
    objects.has("processAtomicWaitEvents")
  ) {
    agentHost = capturedPublicEntry(
      snapshot.publicEntries ?? snapshot.mappings,
      "@tint/native-runtime/agents",
    );
    if (agentHost !== undefined) {
      const contract = capturedModuleExports(
        workspaceModules([agentHost], snapshot),
      ).get(agentHost);
      for (const name of [
        "createNativeAgentCluster",
        "attachNativeAgentWorker",
      ])
        if (!contract?.has(name))
          throw Error("missing captured native agent contract: " + name);
    }
  }
  return {
    ...(agentHost === undefined ? {} : { agentHost }),
    directEvalSiteView:
      capturedModuleExports(workspaceModules([globalModule], snapshot))
        .get(globalModule)
        ?.has("viewDirectEvalSite") === true,
    weakStorage,
    weakRef,
    finalizationRegistry,
    disposal: objects.has("installDisposableStackIntrinsics"),
    asyncDisposal: objects.has("installAsyncDisposableStackIntrinsics"),
    sharedBuffers,
    atomics,
    spinHint,
    sharedAtomics,
  };
}
function capturedEngineProvider(
  snapshot: WorkspaceSourceSnapshot,
  specifier: string,
  factory: string,
): string {
  const provider = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    specifier,
  );
  if (provider === undefined)
    throw Error("missing captured engine provider: " + specifier);
  const exports = capturedModuleExports(
    workspaceModules([provider], snapshot),
  ).get(provider);
  if (!exports?.has(factory))
    throw Error("missing captured engine factory: " + factory);
  return provider;
}
export interface NativeScriptEvaluation {
  readonly evaluation: string;
  readonly compile: string;
  readonly indirectEval?: true;
  readonly functionFallback?: true;
  readonly directEval?: true;
  readonly dynamicImport?: true;
  readonly templateSites?: true;
  readonly shadowRealm?: true;
  readonly literalTables?: true;
  /** The captured memory intrinsics export collectGarbage: $262.gc is real. */
  readonly hostGc?: true;
}
export function nativeScriptAdapter(
  evaluation?: NativeScriptEvaluation,
  moduleExecution: boolean = false,
  dynamicImport: boolean = false,
  topLevelAwait: boolean = false,
  jsonModules: boolean = false,
  sourcePhases: boolean = false,
  deferredModules: boolean = false,
  assetModules: boolean = false,
): string {
  if (assetModules && !jsonModules)
    throw Error("resource modules require the captured JSON/synthetic host");
  if (sourcePhases && !moduleExecution)
    throw Error("source-phase host requires module execution");
  if (deferredModules && (!moduleExecution || !dynamicImport || !topLevelAwait))
    throw Error(
      "deferred module host requires dynamic imports and async evaluation",
    );
  if (jsonModules && !moduleExecution)
    throw Error("JSON host requires module execution");
  if (topLevelAwait && !moduleExecution)
    throw Error("top-level await host requires module execution");
  if (moduleExecution && evaluation?.directEval !== true)
    throw Error("module host requires the v9 Script contract");
  if (evaluation?.hostGc === true) return "native-script-v25-host-gc";
  if (evaluation?.literalTables === true)
    return "native-script-v24-shared-entries";
  if (evaluation?.shadowRealm === true) return "native-script-v23-shadow-realm";
  if (assetModules) return "native-script-v22-resource-modules";
  if (deferredModules) return "native-script-v21-module-phases";
  if (sourcePhases) return "native-script-v20-source-phase";
  if (evaluation?.templateSites === true)
    return "native-script-v19-managed-templates";
  if (evaluation?.dynamicImport === true)
    return "native-script-v18-managed-dynamic-import";
  if (moduleExecution) {
    if (jsonModules) return "native-script-v17-import-resolution";
    if (topLevelAwait) return "native-script-v15-top-level-await";
    return dynamicImport
      ? "native-script-v14-fixture-binding-verdicts"
      : "native-script-v11-module-fixture-syntax";
  }
  return evaluation?.directEval === true
    ? "native-script-v9-direct-eval"
    : evaluation?.functionFallback === true
      ? "native-script-v8-function-fallback"
      : evaluation?.indirectEval === true
        ? "native-script-v7-indirect-eval"
        : "native-script-v6-eval-script";
}
/** Module execution is enabled only by the complete captured public contract.
 * Earlier snapshots may expose module records without lowered-source factories. */
export function nativeModuleCapability(
  snapshot: WorkspaceSourceSnapshot,
): boolean {
  const module = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    "@tint/js-runtime/modules",
  );
  if (module === undefined) return false;
  const exports = capturedModuleExports(
    workspaceModules([module], snapshot),
  ).get(module);
  if (!exports?.has("createLoweredSourceModule")) return false;
  const required = [
    "createLoweredSourceModule",
    "loadRequestedModules",
    "finishLoadingImportedModule",
    "linkModule",
    "evaluateModule",
    "settledModulePromise",
  ];
  if (exports === undefined || required.some((name) => !exports.has(name)))
    throw Error("incomplete captured module host contract");
  return true;
}

/** The async factory is the portable contract marker; older snapshots retain
 * their synchronous module host and adapter identity. */
export function nativeTopLevelAwaitCapability(
  snapshot: WorkspaceSourceSnapshot,
): boolean {
  const module = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    "@tint/js-runtime/modules",
  );
  if (module === undefined) return false;
  const exports = capturedModuleExports(
    workspaceModules([module], snapshot),
  ).get(module);
  if (!exports?.has("createLoweredAsyncSourceModule")) return false;
  if (!nativeModuleCapability(snapshot))
    throw Error("incomplete captured top-level await contract");
  return true;
}

/** Source-phase loading is enabled only by its complete frozen runtime contract. */
export function nativeAssetModuleCapability(
  snapshot: WorkspaceSourceSnapshot,
): boolean {
  const module = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    "@tint/js-runtime/modules",
  );
  if (module === undefined) return false;
  const exports = capturedModuleExports(
    workspaceModules([module], snapshot),
  ).get(module);
  return (
    exports?.has("createTextModule") === true &&
    exports.has("createBytesModule")
  );
}

export function nativeSourcePhaseCapability(
  snapshot: WorkspaceSourceSnapshot,
): boolean {
  const module = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    "@tint/js-runtime/modules",
  );
  if (module === undefined) return false;
  const exports = capturedModuleExports(
    workspaceModules([module], snapshot),
  ).get(module);
  if (!exports?.has("getModuleSource")) return false;
  const objects = capturedModuleExports(
    workspaceModules([objectModule], snapshot),
  ).get(objectModule);
  if (
    !nativeModuleCapability(snapshot) ||
    !exports.has("createSyntheticModule") ||
    !objects?.has("createModuleSourceObject")
  )
    throw Error("incomplete captured source-phase contract");
  return true;
}

/** JSON parsing is a captured host capability; partial older synthetic support
 * does not enable JSON factories in a historical snapshot. */
export function nativeDeferredModuleCapability(
  snapshot: WorkspaceSourceSnapshot,
): boolean {
  const module = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    "@tint/js-runtime/modules",
  );
  if (module === undefined) return false;
  const exports = capturedModuleExports(
    workspaceModules([module], snapshot),
  ).get(module);
  if (!exports?.has("evaluateModuleSync")) return false;
  if (
    !exports.has("readyForSyncExecution") ||
    !exports.has("gatherAsynchronousDependencies") ||
    !nativeModuleCapability(snapshot) ||
    !nativeTopLevelAwaitCapability(snapshot)
  )
    throw Error("incomplete captured deferred module contract");
  return true;
}

/** JSON parsing and synthetic exports are frozen as one host capability. */
export function nativeJSONModuleCapability(
  snapshot: WorkspaceSourceSnapshot,
): boolean {
  const module = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    "@tint/js-runtime/modules",
  );
  if (module === undefined) return false;
  const exports = capturedModuleExports(
    workspaceModules([module], snapshot),
  ).get(module);
  if (!exports?.has("parseJSONModule")) return false;
  if (
    !nativeModuleCapability(snapshot) ||
    !exports.has("createSyntheticModule") ||
    !exports.has("setSyntheticModuleExport")
  )
    throw Error("incomplete captured JSON module contract");
  return true;
}

/** A missing marker preserves historical module hosts; a partial new contract
 * is a capture error rather than an image that will fail after publication. */
export function nativeDynamicImportCapability(
  snapshot: WorkspaceSourceSnapshot,
): boolean {
  const module = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    "@tint/js-runtime/modules",
  );
  if (module === undefined) return false;
  const modules = workspaceModules([module], snapshot);
  const exports = capturedModuleExports(modules).get(module);
  if (!exports?.has("evaluateImportCall")) return false;
  for (const name of [
    "getActiveImportMeta",
    "viewModuleRecord",
    "viewScriptRecord",
  ])
    if (!exports.has(name))
      throw Error("incomplete captured dynamic import contract: " + name);
  const types = capturedModuleTypeExports(modules).get(module);
  for (const name of ["ModuleReferrer", "ModuleLoadPayload"])
    if (!types?.has(name))
      throw Error("incomplete captured dynamic import contract: " + name);
  return true;
}

export function moduleReferrerImageContract(
  enabled: boolean,
  module: string = "packages/js-runtime/src/modules/index.ts",
) {
  const names = ["viewModuleRecord", "viewScriptRecord"];
  return {
    runtimes: enabled
      ? [{ module, namespace: "module-referrer-views", retainedExports: names }]
      : [],
    recordBindings: enabled
      ? names.map((name) => ({ module, name, operation: "view" as const }))
      : [],
  };
}

export function capturedScriptEvaluation(
  snapshot: WorkspaceSourceSnapshot,
): NativeScriptEvaluation | undefined {
  const entries = snapshot.publicEntries ?? snapshot.mappings;
  const a = "@tint/js-engine/script-evaluation",
    b = "@tint/js-engine/native/script-compile";
  const evaluation = capturedPublicEntry(entries, a),
    compile = capturedPublicEntry(entries, b);
  if (evaluation === undefined && compile === undefined) return undefined;
  if (evaluation === undefined || compile === undefined)
    throw Error("incomplete captured Script evaluation contract");
  const captured = {
    evaluation: capturedEngineProvider(snapshot, a, "createScriptEvaluator"),
    compile: capturedEngineProvider(snapshot, b, "createScriptEntryCompiler"),
    ...(capturedScriptDynamicImport(snapshot)
      ? { dynamicImport: true as const }
      : {}),
    ...(capturedScriptTemplateSites(snapshot)
      ? { templateSites: true as const }
      : {}),
    ...(capturedScriptLiteralTables(snapshot)
      ? { literalTables: true as const }
      : {}),
    ...(capturedModuleExports(workspaceModules([nativeMemoryModule], snapshot))
      .get(nativeMemoryModule)
      ?.has("collectGarbage") === true
      ? { hostGc: true as const }
      : {}),
  };
  const objects = capturedModuleExports(
    workspaceModules([objectModule], snapshot),
  ).get(objectModule);
  if (
    captured.templateSites === true &&
    (!objects?.has("getScriptTemplateSite") ||
      !capturedModuleExports(workspaceModules([captured.compile], snapshot))
        .get(captured.compile)
        ?.has("scriptEntrySupportsTemplateSites"))
  )
    throw Error("incomplete captured template-site contract");
  if (
    captured.literalTables === true &&
    (!objects?.has("getScriptLiteral") ||
      !capturedModuleExports(workspaceModules([captured.compile], snapshot))
        .get(captured.compile)
        ?.has("scriptEntrySupportsLiteralTables"))
  )
    throw Error("incomplete captured literal-table contract");
  const exports = capturedModuleExports(
    workspaceModules([captured.evaluation], snapshot),
  ).get(captured.evaluation);
  const functionFallback =
    exports?.has("createDynamicFunctionBodyCompiler") === true;
  const shadowFactory = exports?.has("createShadowRealmEvaluator") === true;
  const shadowInstaller = objects?.has("installShadowRealmIntrinsics") === true;
  if (shadowFactory !== shadowInstaller)
    throw Error("incomplete captured ShadowRealm contract");
  const directFactory = exports?.has("createDirectEvaluator") === true,
    directInstaller = objects?.has("installDirectEvalCompiler") === true;
  if (directFactory || directInstaller) {
    const globals = capturedModuleExports(
      workspaceModules([globalModule], snapshot),
    ).get(globalModule);
    if (
      !directFactory ||
      !directInstaller ||
      !exports?.has("createIndirectEvaluator") ||
      !objects?.has("installEvalCompiler") ||
      !globals?.has("viewDirectEvalSite")
    )
      throw Error("incomplete captured direct-eval contract");
  }
  if (!objects?.has("installEvalCompiler")) {
    if (functionFallback)
      throw Error("incomplete captured function-fallback contract");
    return captured;
  }
  if (!exports?.has("createIndirectEvaluator"))
    throw Error("incomplete captured indirect-eval contract");
  return {
    ...captured,
    indirectEval: true,
    ...(functionFallback ? { functionFallback: true as const } : {}),
    ...(directFactory ? { directEval: true as const } : {}),
    ...(shadowFactory ? { shadowRealm: true as const } : {}),
  };
}
export function nativeScriptServiceModules(
  snapshot: WorkspaceSourceSnapshot,
): SourceModule[] {
  const runtimes = runtimeSources();
  const texts = workspaceModules(
    runtimes.map((item) => item.module),
    snapshot,
  ).map((module) => {
    const input = snapshot.inputs.find((input) => input.id === module.id);
    if (input === undefined)
      throw Error("missing captured Script runtime: " + module.id);
    return {
      id: module.id,
      text: new TextDecoder().decode(input.bytes),
      dependencies: [...module.dependencies],
    };
  });
  return [
    parsedNativeHost(
      "test262-script-host",
      `import type {ManagedSurfaceExport} from "contracts";
import type {ScriptCompletionRecord} from "objects";
import type {ScriptEntryFrame} from "frame";
export function bindScript():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}
export function invoke(address:number,frame:ScriptEntryFrame):unknown{throw "UNBOUND_SCRIPT_INVOKE";}
export function completion(value:unknown):ScriptCompletionRecord|undefined{throw "UNBOUND_COMPLETION_VIEW";}`,
      new Map([
        ["contracts", nativeCompilerModule],
        ["objects", objectModule],
        ["frame", scriptEntryFrameModule],
      ]),
    ),
    parsedNativeHost(
      "test262-script-sources",
      `import type {RuntimeSource} from "contracts";
export const scriptRuntimeTexts:readonly {readonly id:string;readonly text:string;readonly dependencies:readonly (readonly string[])[]}[]=${JSON.stringify(texts)};
export const scriptRuntimeSources:readonly RuntimeSource[]=${JSON.stringify(runtimes)};
export const scriptRuntimeGlobalNames:readonly string[]=${JSON.stringify(scriptRuntimeGlobals)};`,
      new Map([["contracts", nativeCompilerModule]]),
    ),
  ];
}
export function createNativeTestBuilder() {
  const snapshot = workspaceSources();
  const scriptEvaluation = capturedScriptEvaluation(snapshot);
  const capabilities = capturedNativeRuntimeCapabilities(snapshot);
  const agentProvider =
    scriptEvaluation === undefined ? undefined : capabilities.agentHost;
  const storageProvider = capturedEngineProvider(
    snapshot,
    engineStorageSpecifier,
    "createEngineCodeStorage",
  );
  const dynamicProvider = capturedEngineProvider(
    snapshot,
    engineDynamicSpecifier,
    "createDynamicFunctionCompiler",
  );
  const build = createNativeImageBuilder(
    snapshot,
    capabilities.sharedBuffers,
    capabilities.spinHint,
    capabilities.sharedAtomics,
    storageProvider,
    dynamicProvider,
    capabilities.weakStorage,
    capabilities.weakRef,
    capabilities.finalizationRegistry,
    scriptEvaluation,
    capabilities.directEvalSiteView,
    false,
    false,
    agentProvider,
  );
  return (
    scripts: readonly SourceModule[],
    asynchronous: boolean = false,
    canSuspend: boolean = true,
  ) => {
    const runtime = "test262-runtime";
    return build([
      ...scripts,
      nativeTestRuntime(
        runtime,
        capabilities.disposal,
        capabilities.asyncDisposal,
        capabilities.sharedBuffers,
        capabilities.atomics,
        capabilities.spinHint,
        capabilities.sharedAtomics,
        storageProvider,
        dynamicProvider,
        capabilities.weakStorage,
        capabilities.weakRef,
        capabilities.finalizationRegistry,
        scriptEvaluation,
        false,
        false,
        false,
        false,
        false,
        agentProvider,
      ),
      nativeTestHost(
        scripts,
        asynchronous,
        "test262-host",
        runtime,
        canSuspend,
        undefined,
        undefined,
        agentProvider !== undefined,
      ),
    ]);
  };
}
export function createNativeBatchBuilder(
  snapshot: WorkspaceSourceSnapshot = workspaceSources(),
  moduleExecution: boolean = false,
) {
  if (moduleExecution && !nativeModuleCapability(snapshot))
    throw Error("captured module host capability is unavailable");
  const scriptEvaluation = capturedScriptEvaluation(snapshot);
  const dynamicImport =
    moduleExecution && nativeDynamicImportCapability(snapshot);
  const topLevelAwait =
    moduleExecution && nativeTopLevelAwaitCapability(snapshot);
  const jsonModules = moduleExecution && nativeJSONModuleCapability(snapshot);
  const sourcePhases = moduleExecution && nativeSourcePhaseCapability(snapshot);
  const assetModules = moduleExecution && nativeAssetModuleCapability(snapshot);
  const deferredModules =
    moduleExecution && nativeDeferredModuleCapability(snapshot);
  nativeScriptAdapter(
    scriptEvaluation,
    moduleExecution,
    dynamicImport,
    topLevelAwait,
    jsonModules,
    sourcePhases,
    deferredModules,
    assetModules,
  );
  const capabilities = capturedNativeRuntimeCapabilities(snapshot);
  const agentProvider =
    scriptEvaluation === undefined ? undefined : capabilities.agentHost;
  const storageProvider = capturedEngineProvider(
    snapshot,
    engineStorageSpecifier,
    "createEngineCodeStorage",
  );
  const dynamicProvider = capturedEngineProvider(
    snapshot,
    engineDynamicSpecifier,
    "createDynamicFunctionCompiler",
  );
  const build = createNativeImageBuilder(
    snapshot,
    capabilities.sharedBuffers,
    capabilities.spinHint,
    capabilities.sharedAtomics,
    storageProvider,
    dynamicProvider,
    capabilities.weakStorage,
    capabilities.weakRef,
    capabilities.finalizationRegistry,
    scriptEvaluation,
    capabilities.directEvalSiteView,
    moduleExecution,
    dynamicImport,
    agentProvider,
  );
  return (cases: readonly NativeTestCase[]) =>
    build(
      prepareNativeBatch(
        cases,
        capabilities.disposal,
        capabilities.asyncDisposal,
        capabilities.sharedBuffers,
        capabilities.atomics,
        capabilities.spinHint,
        capabilities.sharedAtomics,
        storageProvider,
        dynamicProvider,
        capabilities.weakStorage,
        capabilities.weakRef,
        capabilities.finalizationRegistry,
        scriptEvaluation,
        moduleExecution,
        dynamicImport,
        topLevelAwait,
        jsonModules,
        agentProvider,
        sourcePhases,
        assetModules,
      ),
    );
}
/** Retain only the compiler-authorized view; historical captures add no bindings. */
export function directEvalSiteImageContract(enabled: boolean) {
  return {
    runtimes: enabled
      ? [
          {
            module: globalModule,
            namespace: "global-environment",
            retainedExports: ["viewDirectEvalSite"],
          },
        ]
      : [],
    recordBindings: enabled
      ? [
          {
            module: globalModule,
            name: "viewDirectEvalSite",
            operation: "view" as const,
          },
        ]
      : [],
  };
}
function createNativeImageBuilder(
  snapshot?: WorkspaceSourceSnapshot,
  sharedBuffers: boolean = false,
  spinHint?: string,
  sharedAtomics: boolean = false,
  storageProvider: string = engineStorageModule,
  dynamicProvider: string = engineDynamicModule,
  weakProvider?: string,
  weakRef: boolean = false,
  finalizationRegistry: boolean = false,
  scriptEvaluation?: NativeScriptEvaluation,
  directEvalSiteView: boolean = false,
  moduleExecution: boolean = false,
  dynamicImport: boolean = false,
  agentProvider?: string,
) {
  if (scriptEvaluation?.directEval === true && !directEvalSiteView)
    throw Error("incomplete captured direct-eval contract: site view binding");
  let scriptModules: readonly SourceModule[] | undefined;
  let surface: ReturnType<typeof createScriptRuntimeRequest> | undefined;
  let runtimeModules: readonly SourceModule[] | undefined;
  return (
    testModules: readonly SourceModule[],
  ):
    | { readonly ok: true; readonly bytes: Uint8Array }
    | { readonly ok: false; readonly outcome: ExecutionOutcome } => {
    runtimeModules ??= workspaceModules(
      [
        ...projectRoots(),
        globalModule,
        ...(moduleExecution
          ? ["packages/js-runtime/src/modules/index.ts"]
          : []),
        syntaxModule,
        nativeCompilerModule,
        nativeMemoryModule,
        storageProvider,
        dynamicProvider,
        ...(scriptEvaluation === undefined
          ? []
          : [
              scriptEvaluation.evaluation,
              scriptEvaluation.compile,
              scriptEntryFrameModule,
              "packages/source/src/text.ts",
              "packages/typescript/src/modules/model.ts",
              ...(scriptEvaluation.dynamicImport === true
                ? ["packages/js-runtime/src/modules/index.ts"]
                : []),
            ]),
        ...(sharedBuffers ? [sharedServiceModule] : []),
        ...(agentProvider === undefined
          ? []
          : [agentProvider, "packages/js-runtime/src/bytes/shared.ts"]),
        ...(spinHint === undefined ? [] : [spinHint]),
        ...(weakProvider === undefined ? [] : [weakProvider]),
        bindingModule,
        objectModule,
        randomModule,
        clockModule,
        nativeFSModule,
        fileServiceModule,
        timeZoneModule,
      ],
      snapshot,
    );
    if (scriptEvaluation !== undefined) {
      if (snapshot === undefined) throw Error("missing Script snapshot");
      scriptModules ??= nativeScriptServiceModules(snapshot);
      surface ??= createScriptRuntimeRequest(
        { module: "test262-script-host", name: "bindScript" },
        true,
        snapshot,
      );
    }
    const modules: SourceModule[] = [
      ...runtimeModules,
      ...(scriptModules ?? []),
      ...testModules,
    ];
    const request = projectBuildRequest(modules, () => {});
    const built = buildMacOSProgram({
      ...request,
      entry: "test262-host",
      start: "run",
      identifier: "tint-test262-native",
      allowDebugger: true,
      // Profiling only: Mach-O symbols and DWARF for `sample`/LLDB attribution.
      debugSymbols: process.env.TINT_DEBUG_SYMBOLS === "1",
      threaded: agentProvider !== undefined,
      allowJit: true,
      runtimeEntry: "initializeCopyingRuntime",
      denseReferenceLists: false,
      maxSpecializations: nativeTestResources.maxSpecializations,
      managedBytes: nativeTestResources.managedBytes,
      allocationCapacity: nativeTestResources.allocationCapacity,
      rootCapacity: nativeTestResources.rootCapacity,
      stackBytes: nativeTestResources.stackBytes,
      managedSurfaces: surface === undefined ? [] : [surface],
      hostBindings: [
        ...(scriptEvaluation === undefined
          ? []
          : [
              {
                module: nativeMemoryModule,
                name: "nativeValueFunctionDescriptor",
                operation: "native-value-function-descriptor" as const,
              },
              {
                module: nativeMemoryModule,
                name: "nativeValueFunctionSignature",
                operation: "native-value-function-signature" as const,
              },
              {
                module: "test262-script-host",
                name: "invoke",
                operation: "executable-call-managed" as const,
              },
            ]),
        ...request.hostBindings,
        ...(agentProvider === undefined
          ? []
          : [
              {
                module: nativeMemoryModule,
                name: "startNativeThread",
                operation: "thread-start" as const,
              },
              {
                module: nativeMemoryModule,
                name: "joinNativeThread",
                operation: "thread-join" as const,
              },
              {
                module: nativeMemoryModule,
                name: "hostedThreadEntry",
                operation: "hosted-thread-entry" as const,
              },
              {
                module: nativeMemoryModule,
                name: "parkNativeWord",
                operation: "word-park" as const,
              },
              {
                module: nativeMemoryModule,
                name: "wakeNativeWord",
                operation: "word-wake" as const,
              },
              {
                module: clockModule,
                name: "monotonicMilliseconds",
                operation: "monotonic-time" as const,
              },
            ]),
        {
          module: nativeMemoryModule,
          name: "currentContextDomain",
          operation: "context-domain",
        },
        ...(scriptEvaluation?.hostGc === true
          ? [
              {
                module: nativeMemoryModule,
                name: "collectGarbage",
                operation: "collect-garbage" as const,
              },
            ]
          : []),
        ...(spinHint === undefined
          ? []
          : [
              {
                module: spinHint,
                name: "cpuPause",
                operation: "cpu-pause" as const,
              },
            ]),
        ...(sharedAtomics
          ? [
              {
                module: sharedPrimitivesModule,
                name: "compareExchangeSharedUnsigned",
                operation: "shared-compare-exchange-unsigned" as const,
              },
            ]
          : []),
        ...(sharedBuffers
          ? [
              {
                module: nativeMemoryModule,
                name: "mapMemory",
                operation: "memory-map" as const,
              },
              {
                module: nativeMemoryModule,
                name: "unmapMemory",
                operation: "memory-unmap" as const,
              },
              {
                module: sharedPrimitivesModule,
                name: "readSharedUnsigned",
                operation: "shared-read-unsigned" as const,
              },
              {
                module: sharedPrimitivesModule,
                name: "writeSharedUnsigned",
                operation: "shared-write-unsigned" as const,
              },
              {
                module: sharedPrimitivesModule,
                name: "readSharedWord64",
                operation: "shared-read-word64" as const,
              },
              {
                module: sharedPrimitivesModule,
                name: "writeSharedWord64",
                operation: "shared-write-word64" as const,
              },
              {
                module: sharedPrimitivesModule,
                name: "compareExchangeSharedWord64",
                operation: "shared-compare-exchange-word64" as const,
              },
            ]
          : []),
        {
          module: nativeMemoryModule,
          name: "mapExecutableMemory",
          operation: "executable-map",
        },
        {
          module: nativeMemoryModule,
          name: "writeExecutableMemory",
          operation: "executable-write",
        },
        {
          module: nativeMemoryModule,
          name: "callExecutableValue",
          operation: "executable-call-value",
        },
        {
          module: nativeMemoryModule,
          name: "registerExternalMemory",
          operation: "external-memory-register",
        },
        {
          module: nativeMemoryModule,
          name: "callExecutableManagedWithIndex",
          operation: "executable-call-managed",
        },
        {
          module: nativeMemoryModule,
          name: "nativeFunctionDescriptorWithIndex",
          operation: "native-function-descriptor",
        },
        {
          module: nativeMemoryModule,
          name: "nativeFunctionSignatureWithIndex",
          operation: "native-function-signature",
        },
        {
          module: nativeMemoryModule,
          name: "readMemoryWord",
          operation: "memory-read-word",
        },
        {
          module: clockModule,
          name: "wallClockMilliseconds",
          operation: "wall-clock-time",
        },
        {
          module: randomModule,
          name: "randomUint32",
          operation: "random-word",
        },
      ],
      runtimes: [
        ...directEvalSiteImageContract(directEvalSiteView).runtimes,
        ...moduleReferrerImageContract(
          dynamicImport || scriptEvaluation?.dynamicImport === true,
          capturedPublicEntry(
            snapshot?.publicEntries ?? snapshot?.mappings ?? [],
            "@tint/js-runtime/modules",
          ),
        ).runtimes,
        ...(scriptEvaluation === undefined
          ? []
          : [
              {
                module: "test262-script-host",
                namespace: "script-host-view",
                retainedExports: ["completion", "invoke"],
              },
            ]),
        ...request.runtimes,
        { module: nativeMemoryModule, namespace: "native-memory" },
        ...(weakProvider === undefined
          ? []
          : [
              {
                module: weakProvider,
                namespace: "native-weak-storage",
                retainedExports: [
                  "createWeakSlot",
                  "weakSlotKey",
                  "weakSlotValue",
                  "setWeakSlotValue",
                  "clearWeakSlot",
                ],
              },
            ]),
        ...(spinHint === undefined
          ? []
          : [
              {
                module: spinHint,
                namespace: "native-spin-hint",
                retainedExports: ["cpuPause"],
              },
            ]),
        ...(sharedBuffers
          ? [
              {
                module: sharedPrimitivesModule,
                namespace: "shared-memory-primitives",
                retainedExports: [
                  "readSharedUnsigned",
                  "writeSharedUnsigned",
                  "readSharedWord64",
                  "writeSharedWord64",
                  "compareExchangeSharedWord64",
                  ...(sharedAtomics ? ["compareExchangeSharedUnsigned"] : []),
                ],
              },
            ]
          : []),
        { module: clockModule, namespace: "native-clock" },
        { module: randomModule, namespace: "native-random" },
        {
          module: objectModule,
          namespace: "ordinary-object",
          retainedExports: [
            "viewObjectValue",
            "viewSymbolValue",
            "viewBigIntValue",
            ...(finalizationRegistry ? ["viewWeakRegistryOwner"] : []),
          ],
        },
      ],
      weakBindings:
        weakProvider === undefined
          ? []
          : [
              {
                module: weakProvider,
                name: "createWeakSlot",
                operation: "new",
              },
              { module: weakProvider, name: "weakSlotKey", operation: "key" },
              {
                module: weakProvider,
                name: "weakSlotValue",
                operation: "value",
              },
              {
                module: weakProvider,
                name: "setWeakSlotValue",
                operation: "set-value",
              },
              {
                module: weakProvider,
                name: "clearWeakSlot",
                operation: "clear",
              },
            ],
      recordBindings: [
        ...directEvalSiteImageContract(directEvalSiteView).recordBindings,
        ...moduleReferrerImageContract(
          dynamicImport || scriptEvaluation?.dynamicImport === true,
          capturedPublicEntry(
            snapshot?.publicEntries ?? snapshot?.mappings ?? [],
            "@tint/js-runtime/modules",
          ),
        ).recordBindings,
        ...(scriptEvaluation === undefined
          ? []
          : [
              {
                module: "test262-script-host",
                name: "completion",
                operation: "view" as const,
              },
            ]),
        { module: objectModule, name: "viewObjectValue", operation: "view" },
        { module: objectModule, name: "viewSymbolValue", operation: "view" },
        { module: objectModule, name: "viewBigIntValue", operation: "view" },
        ...(finalizationRegistry
          ? [
              {
                module: objectModule,
                name: "viewWeakRegistryOwner",
                operation: "view" as const,
              },
            ]
          : []),
      ],
    });
    if (!built.ok)
      return {
        ok: false,
        outcome: {
          kind: "unsupported",
          reason: "native compilation: " + JSON.stringify(built.error),
        },
      };
    return { ok: true, bytes: built.value };
  };
}
