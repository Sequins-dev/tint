import {
  boundaryBoolean,
  boundaryNull,
  boundaryNumber,
  boundaryString,
  boundaryUndefined,
  boundaryUnknown,
  type GeneralLowering,
  type GeneralProgram,
  type GeneralProgramRequest,
  type NativeRecordBinding,
  type BoundaryRecord,
  type BoundaryRecordUse,
} from "@tint/compiler/native";
import { createSourceTextView } from "@tint/source/text";
import {
  eraseTypeSyntax,
  parseModule,
  typeOnlyDeclarations,
} from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import {
  lowerSourceTextModule,
  propertyCacheBindings,
  propertyCacheNames,
  activationBindings,
  activationNames,
  globalCellBindings,
  globalCellNames,
} from "../lowering/index.ts";
import { createGeneralIntrinsicPlan } from "./intrinsics.ts";
import {
  planFunctionFallback,
  planTypedCompanions,
  type FunctionFallbackPlan,
} from "./function-fallback.ts";
import { planNestedCompanions } from "./nested-fallback.ts";

/** Module IDs of the JavaScript runtime the general lowering targets. */
export interface GeneralRuntimeModules {
  readonly objects: string;
  readonly modules: string;
  readonly globalEnvironment: string;
  readonly environmentRecords: string;
}
export interface GeneralLoweringOptions {
  readonly runtime: GeneralRuntimeModules;
  readonly nativeScriptCalls?: boolean;
  /** The Annex B [[IsHTMLDDA]] host capability (B.3.6): true when the host
   * creates such objects, as Test262's `$262.IsHTMLDDA` does. General
   * program hosts create none, so by default their modules lower `x == null`
   * as a tag test without the brand check and exclude such objects when
   * they initialize: a host that marks one beside them (markHTMLDDAObject)
   * fails instead of changing loose equality. */
  readonly htmlDDAObjects?: boolean;
  /** Enables the limited function fallback route for validated fixtures. */
  readonly functionFallback?: boolean;
  /** A host function `(fd: number, bytes: Uint8Array) => number`, exposed to
   * general code as `console.log`/`console.error` and used to report
   * uncaught exceptions. Without it, console output is discarded. */
  readonly output?: { readonly module: string; readonly name: string };
  /** The Node personality and the reactor of the executable's target. */
  readonly nodeEventLoop?: {
    readonly globals: string;
    readonly driver: string;
    readonly clock: string;
    readonly reactor: string;
  };
  readonly nodeWorkers?: GeneralNodeWorkers;
}
export interface GeneralNodeWorkers {
  readonly host: string;
  readonly threadHost: string;
  readonly lifecycle: string;
  readonly shared: string;
  readonly typedBindings?: string;
  readonly stackBytes: number;
  readonly managedBytes: number;
  readonly nodeHosted?: boolean;
}
const workerExports: readonly string[] = [
  "Worker",
  "MessageChannel",
  "MessagePort",
  "isMainThread",
  "parentPort",
  "workerData",
  "threadId",
  "resourceLimits",
];

/** The general lowering used when the typed pipeline rejects a program: each
 * application module has its TypeScript syntax erased and lowers to runtime
 * helper calls with full JavaScript semantics, linked as module records by a
 * generated typed host that creates the realm, loads, links and evaluates the
 * entry, calls its start export and drains jobs. */
export function createGeneralLowering(
  options: GeneralLoweringOptions,
): GeneralLowering {
  const runtime = options.runtime;
  const runtimeModules = [
    runtime.objects,
    runtime.modules,
    runtime.globalEnvironment,
    runtime.environmentRecords,
  ];
  if (options.output !== undefined) runtimeModules.push(options.output.module);
  const eventLoop = options.nodeEventLoop;
  if (eventLoop !== undefined)
    runtimeModules.push(
      eventLoop.globals,
      eventLoop.driver,
      eventLoop.clock,
      eventLoop.reactor,
    );
  const workers = options.nodeWorkers;
  if (workers !== undefined) {
    if (eventLoop === undefined)
      throw "node:worker_threads requires a Node event loop";
    runtimeModules.push(
      workers.host,
      workers.threadHost,
      workers.lifecycle,
      workers.shared,
    );
    if (workers.typedBindings !== undefined)
      runtimeModules.push(workers.typedBindings);
  }
  const objectViews = [
      "viewObjectValue",
      "viewSymbolValue",
      "viewBigIntValue",
      "viewTypeofObject",
    ],
    referrerViews = ["viewModuleRecord", "viewScriptRecord"];
  const recordBindings: NativeRecordBinding[] = [];
  for (const name of objectViews)
    recordBindings.push({ module: runtime.objects, name, operation: "view" });
  // Generated property caches compare shapes and load and store values
  // inline.
  for (const binding of propertyCacheBindings(runtime.objects))
    recordBindings.push(binding);
  // Native script entries keep activation records in their frames.
  for (const binding of activationBindings(runtime.objects))
    recordBindings.push(binding);
  // Cached global identifier reads check epochs inline.
  for (const binding of globalCellBindings(runtime.globalEnvironment))
    recordBindings.push(binding);
  for (const name of referrerViews)
    recordBindings.push({ module: runtime.modules, name, operation: "view" });
  return {
    runtimeModules,
    recordBindings,
    ...(workers === undefined
      ? {}
      : { syntheticModules: ["node:worker_threads"] }),
    ...(workers?.typedBindings === undefined
      ? {}
      : {
          prepareTypedWorkers: (
            request: GeneralProgramRequest,
          ): GeneralProgram => lowerGeneralProgram(request, options, true),
        }),
    runtimes: [
      {
        module: runtime.modules,
        namespace: "general-module-views",
        retainedExports: referrerViews,
      },
      {
        module: runtime.globalEnvironment,
        namespace: "general-global-views",
        retainedExports: [...globalCellNames],
      },
      {
        module: runtime.objects,
        namespace: "general-object-views",
        retainedExports: [
          ...objectViews,
          ...propertyCacheNames,
          ...activationNames,
          "objectTypeof",
          "generalValueTypeof",
          "callGeneralValue",
          "realmErrorOperation",
        ],
      },
    ],
    lower: (request: GeneralProgramRequest): GeneralProgram =>
      lowerGeneralProgram(request, options),
  };
}

function lowerGeneralProgram(
  original: GeneralProgramRequest,
  options: GeneralLoweringOptions,
  typedWorkerEntry = false,
): GeneralProgram {
  const runtime = options.runtime;
  const workers = options.nodeWorkers;
  const available = new Map<string, SourceModule>();
  for (const module of original.available) {
    if (module === undefined) throw "general module invariant";
    available.set(module.id, module);
  }
  const used = new Set(original.availableIds ?? available.keys());
  function fresh(base: string): string {
    let id = base;
    while (used.has(id)) id += "$";
    used.add(id);
    return id;
  }
  const hostId = fresh("$general-host:" + original.entry);
  function applicationGraph(roots: readonly string[]): Set<string> {
    const seen = new Set<string>();
    const queue = roots.slice();
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      const source = available.get(id);
      if (source === undefined) continue;
      for (const [, dependency] of source.dependencies)
        if (!seen.has(dependency)) queue.push(dependency);
    }
    return seen;
  }
  const typedGraph = typedWorkerEntry
    ? applicationGraph([original.entry])
    : undefined;
  if (typedGraph !== undefined && !typedGraph.has("node:worker_threads"))
    return { ok: false, error: "entry graph does not use node:worker_threads" };
  // Only the modules that depend on the worker bindings need to move into
  // the checked entry's evaluation scope. Shared runtime modules such as
  // source text and syntax must remain accessible to the host too.
  const typedWorkerModules = new Set<string>();
  if (typedGraph !== undefined) {
    const importers = new Map<string, string[]>();
    for (const source of original.modules) {
      if (source === undefined || !typedGraph.has(source.id)) continue;
      for (const [, dependency] of source.dependencies) {
        const found = importers.get(dependency);
        if (found === undefined) importers.set(dependency, [source.id]);
        else found.push(source.id);
      }
    }
    const pending = ["node:worker_threads"];
    for (let index = 0; index < pending.length; index++) {
      const id = pending[index];
      if (id === undefined || typedWorkerModules.has(id)) continue;
      typedWorkerModules.add(id);
      for (const importer of importers.get(id) ?? [])
        if (importer !== undefined) pending.push(importer);
    }
  }
  const guestGraph = typedWorkerEntry
    ? applicationGraph(original.workerEntries ?? [])
    : undefined;
  const mixed =
    options.functionFallback === true && workers === undefined
      ? planFunctionFallback(
          original,
          fresh("$typed:" + original.entry),
          hostId,
          () => fresh("$general:" + original.entry),
        )
      : undefined;
  const primitive = mixed?.primitive;
  const selected = original.trigger?.owner;
  if (primitive !== undefined && mixed !== undefined && selected !== undefined)
    return {
      ok: true,
      value: {
        modules: [mixed.typed, primitive.entry, primitive.host],
        entry: primitive.host.id,
        usesRealm: false,
        functions: [
          {
            module: selected.module,
            start: selected.start,
            end: selected.end,
            name: mixed.name,
          },
        ],
      },
    };
  const companions =
    mixed === undefined &&
    options.functionFallback === true &&
    workers === undefined
      ? (planNestedCompanions(
          original,
          fresh(
            "$nested:" + (original.trigger?.owner.module ?? original.entry),
          ),
          runtime.objects,
        ) ??
        planTypedCompanions(
          original,
          fresh("$typed:" + (original.trigger?.owner.module ?? original.entry)),
        ))
      : undefined;
  const request: GeneralProgramRequest =
    guestGraph !== undefined
      ? {
          ...original,
          modules: original.modules.filter(
            (source) => source !== undefined && guestGraph.has(source.id),
          ),
        }
      : mixed === undefined
        ? companions === undefined
          ? original
          : {
              ...original,
              modules: original.modules.map((module) =>
                module.id === companions.general.id
                  ? companions.general
                  : module,
              ),
              boundaries: [...original.boundaries, companions.boundary],
            }
        : {
            ...original,
            modules: [mixed.general],
            boundaries:
              mixed.boundary.exports.length === 0 ? [] : [mixed.boundary],
          };
  const typeOnly = new Map<string, Set<string>>();
  function typeNames(id: string): Set<string> | undefined {
    const known = typeOnly.get(id);
    if (known !== undefined) return known;
    const module = available.get(id);
    if (module === undefined) return undefined;
    const names = typeOnlyDeclarations(module.module);
    // Re-exported types (export type {...} or export {T} of a type) are
    // types too; a value of the same name is not.
    for (const statement of module.module.statements) {
      if (statement === undefined || statement.kind !== "export") continue;
      const declaration = statement.declaration;
      for (const binding of declaration.bindings ?? [])
        if (binding !== undefined && (declaration.typeOnly || binding.typeOnly))
          names.add(binding.exported);
    }
    typeOnly.set(id, names);
    return names;
  }
  const runtimeDependencies = new Map<string, string>([
    ["@tint/js-runtime/objects", runtime.objects],
    ["@tint/js-runtime/modules", runtime.modules],
    ["@tint/js-runtime/environments/global", runtime.globalEnvironment],
    ["@tint/js-runtime/environments/records", runtime.environmentRecords],
  ]);
  const generated: SourceModule[] = [];
  const workerModules: string[] | undefined =
    workers === undefined ? undefined : [];
  if (mixed !== undefined) generated.push(mixed.typed);
  if (companions !== undefined) generated.push(companions.typed);
  const installers = createGeneralIntrinsicPlan();
  const typedEntry = typedWorkerEntry
    ? available.get(original.entry)
    : undefined;
  const typedBindings = typedWorkerEntry ? workers?.typedBindings : undefined;
  if (
    typedWorkerEntry &&
    (typedEntry === undefined || typedBindings === undefined)
  )
    return { ok: false, error: "missing typed Worker entry or module binding" };
  const checkMethodCalls =
    request.sourceValidated === true &&
    request.modules.some((module) =>
      module.module.statements.some(
        (statement) =>
          statement.kind === "class" &&
          statement.definition.elements.some(
            (element) =>
              element.kind === "method" &&
              (element.decorators?.length ?? 0) !== 0,
          ),
      ),
    );
  let imports = "",
    creates = "",
    edges = "";
  for (let index = 0; index < request.modules.length; index++) {
    const source = request.modules[index];
    if (source === undefined) throw "general module invariant";
    const erased = eraseTypeSyntax(source.module, {
      typeExport: (specifier: string, name: string): boolean => {
        const target = source.dependencies.get(specifier);
        if (target === undefined) return false;
        return typeNames(target)?.has(name) ?? false;
      },
    });
    const lowered = lowerSourceTextModule(
      erased,
      undefined,
      mixed?.numericCalls,
      request.sourceValidated === true &&
        (mixed === undefined || mixed.ordinaryEntries !== undefined),
      checkMethodCalls,
      source.module,
      options.nativeScriptCalls === true,
      options.htmlDDAObjects === true,
    );
    if (!lowered.ok)
      return {
        ok: false,
        error:
          source.id +
          ":" +
          String(lowered.error.start) +
          ":" +
          String(lowered.error.end) +
          ": " +
          lowered.error.message,
      };
    installers.addModule(erased);
    const id = fresh("$general:" + source.id);
    workerModules?.push(id);
    const numericImports = mixed?.numericImports;
    const dependencies =
      numericImports === undefined
        ? runtimeDependencies
        : new Map(runtimeDependencies);
    if (mixed !== undefined && numericImports !== undefined)
      dependencies.set(mixed.typed.id, mixed.typed.id);
    generated.push({
      id,
      module:
        numericImports === undefined
          ? lowered.value
          : {
              ...lowered.value,
              imports: [...numericImports.imports, ...lowered.value.imports],
              statements: [
                ...numericImports.statements,
                ...lowered.value.statements,
              ],
            },
      dependencies,
      ...(source.sourcePosition === undefined
        ? {}
        : { sourcePosition: source.sourcePosition }),
    });
    imports +=
      "import {create as create" +
      index +
      "} from " +
      JSON.stringify(id) +
      ";\n";
    creates +=
      "  case " +
      index +
      ": return create" +
      index +
      "(global,realm," +
      index +
      ");\n";
    for (const [specifier, target] of source.dependencies) {
      let targetIndex = request.modules.findIndex(
        (module) => module !== undefined && module.id === target,
      );
      if (targetIndex < 0) {
        const boundary = request.boundaries.findIndex(
          (module) => module !== undefined && module.id === target,
        );
        if (boundary >= 0) targetIndex = request.modules.length + boundary;
      }
      if (workers !== undefined && target === "node:worker_threads")
        targetIndex = request.modules.length + request.boundaries.length;
      if (targetIndex >= 0)
        edges +=
          " edges.set(" +
          JSON.stringify(index + "\u0000" + specifier) +
          "," +
          targetIndex +
          ");\n";
    }
  }
  // Typed modules used by general code: synthetic module records whose
  // functions are checked entries. Each argument is checked against its
  // declared primitive type (an explicit cast); a failed check throws a
  // TypeError instead of entering typed code with an ill-typed value.
  let boundaryImports = "";
  const viewsId = fresh("$general-views:" + request.entry);
  // Record types cross as JavaScript views (docs/unified-pipeline.md, the
  // value bridge): one view per record, cached in the record's view slot.
  const adapters = recordAdapters(request.records ?? []);
  const nodeErrorModule = "packages/native-runtime/src/node/errors.ts";
  const hasNodeErrors =
    original.availableIds?.includes(nodeErrorModule) ??
    available.has(nodeErrorModule);
  const errors = errorAdapters(request.boundaries.length !== 0, hasNodeErrors);
  boundaryImports += adapters.imports + errors.imports;
  const dynamicDeclarations = new Set<string>();
  for (let k = 0; k < request.boundaries.length; k++) {
    const boundary = request.boundaries[k];
    if (boundary === undefined) throw "general boundary invariant";
    const index = request.modules.length + k;
    const exportNames: string[] = [];
    const callableViews = new Map<string, string>();
    let body = "";
    for (let i = 0; i < boundary.exports.length; i++) {
      const item = boundary.exports[i];
      if (item === undefined) throw "general boundary invariant";
      const local = "typed" + k + "_" + i;
      boundaryImports +=
        "import {" +
        item.name +
        " as " +
        local +
        "} from " +
        JSON.stringify(boundary.id) +
        ";\n";
      exportNames.push(item.name);
      let value = "toRealmError(" + local + ")";
      if (item.kind === "function") {
        const existing = callableViews.get(item.local);
        if (existing !== undefined) {
          body +=
            "setSyntheticModuleExport(module," +
            JSON.stringify(item.name) +
            "," +
            existing +
            ");";
          continue;
        }
        const checks: string[] = [];
        for (let p = 0; p < item.parameters.length; p++) {
          const classes = item.parameters[p];
          if (classes === undefined) throw "general boundary invariant";
          const use = item.records?.parameters[p];
          if (use?.dynamic !== undefined)
            dynamicDeclarations.add(use.dynamic.declarations);
          checks.push(
            fromGeneral("args[" + p + "]", classes, use, adapters.index),
          );
        }
        value =
          "createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver:unknown,args:readonly unknown[]):unknown=>{try{return " +
          toGeneral(
            local + "(" + checks.join(",") + ")",
            item.records?.result,
            adapters.index,
          ) +
          ";}catch(error){throw toRealmError(error);}},realm.executionContext)";
        const view = "view" + i;
        body += "const " + view + ":unknown=" + value + ";";
        callableViews.set(item.local, view);
        value = view;
      }
      body +=
        "setSyntheticModuleExport(module," +
        JSON.stringify(item.name) +
        "," +
        value +
        ");";
    }
    creates +=
      "  case " +
      index +
      ": return createSyntheticModule(realm," +
      JSON.stringify(exportNames) +
      ",(module:ModuleRecord):void=>{" +
      body +
      "},undefined);\n";
  }
  imports += boundaryImports;
  if (mixed !== undefined)
    imports +=
      "import {" +
      request.start +
      " as $tintTypedStart} from " +
      JSON.stringify(mixed.typed.id) +
      ";\n";
  for (const declarations of dynamicDeclarations)
    imports += declarations + "\n";
  const entryIndex = request.modules.findIndex(
    (module) => module !== undefined && module.id === request.entry,
  );
  if (entryIndex < 0 && typedEntry === undefined)
    return { ok: false, error: "entry module is not lowered" };
  const output = options.output;
  const eventLoop = options.nodeEventLoop;
  const names = request.modules.map((module): string => module.id);
  const moduleCount = names.length + request.boundaries.length;
  if (workers !== undefined) {
    const exports = workerExports
      .map(
        (name): string =>
          "setSyntheticModuleExport(module," +
          JSON.stringify(name) +
          ",workers." +
          name +
          ");",
      )
      .join("");
    creates +=
      "  case " +
      moduleCount +
      ": return createSyntheticModule(realm," +
      JSON.stringify(workerExports) +
      ",(module:ModuleRecord):void=>{" +
      exports +
      "},undefined);\n";
  }
  const selectedInstallers = installers.installers().slice();
  if (
    workers !== undefined &&
    !selectedInstallers.includes("installPromiseIntrinsics")
  )
    selectedInstallers.push("installPromiseIntrinsics");
  if (
    typedEntry !== undefined &&
    typedBindings !== undefined &&
    typedGraph !== undefined
  ) {
    for (const source of original.modules) {
      if (source === undefined || !typedGraph.has(source.id)) continue;
      const dependencies = new Map<string, string>();
      let usesWorker = false;
      for (const [specifier, target] of source.dependencies) {
        if (target === "node:worker_threads") {
          usesWorker = true;
          dependencies.set(specifier, typedBindings);
        } else dependencies.set(specifier, target);
      }
      if (usesWorker) generated.push({ ...source, dependencies });
    }
    imports +=
      "import {" +
      request.start +
      " as typedStart} from " +
      JSON.stringify(typedEntry.id) +
      ";\n";
    imports +=
      'import {initializeWorkerThreads} from "typed-worker-bindings";\n';
  }
  const text = generalHostSource(
    imports,
    creates,
    edges,
    moduleCount + (workers === undefined ? 0 : 1),
    entryIndex,
    request.start,
    output !== undefined,
    selectedInstallers,
    adapters.functions + errors.functions,
    eventLoop !== undefined,
    workers,
    names,
    mixed,
    typedWorkerEntry,
  );
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok)
    return {
      ok: false,
      error:
        "general host: " +
        parsed.error.message +
        " at " +
        String(parsed.error.start),
    };
  const hostDependencies = new Map<string, string>([
    ["objects", runtime.objects],
    ["modules", runtime.modules],
    ["global", runtime.globalEnvironment],
  ]);
  if (output !== undefined) hostDependencies.set("output", output.module);
  if (eventLoop !== undefined) {
    hostDependencies.set("node-event-globals", eventLoop.globals);
    hostDependencies.set("node-event-driver", eventLoop.driver);
    hostDependencies.set("node-event-clock", eventLoop.clock);
    hostDependencies.set("node-event-reactor", eventLoop.reactor);
  }
  if (workers !== undefined) {
    hostDependencies.set("worker-host", workers.host);
    hostDependencies.set("worker-platform", workers.threadHost);
    hostDependencies.set("worker-lifecycle", workers.lifecycle);
    hostDependencies.set("worker-shared", workers.shared);
  }
  if (typedBindings !== undefined)
    hostDependencies.set("typed-worker-bindings", typedBindings);
  if (typedEntry !== undefined)
    hostDependencies.set(typedEntry.id, typedEntry.id);
  for (const module of generated)
    if (module !== undefined) hostDependencies.set(module.id, module.id);
  for (const boundary of request.boundaries)
    if (boundary !== undefined) hostDependencies.set(boundary.id, boundary.id);
  for (const record of request.records ?? [])
    if (record !== undefined)
      hostDependencies.set(record.module, record.module);
  if ((request.records ?? []).length !== 0 || errors.stubs !== "")
    hostDependencies.set("views", viewsId);
  generated.push({
    id: hostId,
    module: parsed.value,
    dependencies: hostDependencies,
  });
  const records = request.records ?? [];
  const owner = original.trigger?.owner;
  const unitName = mixed?.name ?? companions?.name;
  const units =
    unitName === undefined || owner === undefined
      ? {}
      : companions?.kind === "class"
        ? {
            classes: [
              {
                module: owner.module,
                name: unitName,
                start: owner.start,
                end: owner.end,
              },
            ],
          }
        : {
            functions: [
              {
                module: owner.module,
                name: unitName,
                start: owner.start,
                end: owner.end,
              },
            ],
          };
  if (records.length === 0 && errors.stubs === "")
    return {
      ok: true,
      value: {
        modules: generated,
        entry: hostId,
        ...units,
        ...(typedBindings === undefined ||
        typedGraph === undefined ||
        typedEntry === undefined
          ? {}
          : {
              workerEvaluation: {
                entry: typedEntry.id,
                start: request.start,
                modules: [...typedWorkerModules],
              },
              moduleConstructors: [
                {
                  module: typedBindings,
                  name: "Worker",
                  factory: "constructWorker",
                },
              ],
            }),
        ...(workerModules === undefined ? {} : { workerModules }),
      },
    };
  const viewsParsed = parseModule(
    createSourceTextView(adapters.stubs + errors.stubs),
  );
  if (!viewsParsed.ok)
    return {
      ok: false,
      error: "general views: " + viewsParsed.error.message,
    };
  const viewsDependencies = new Map<string, string>();
  if (hasNodeErrors) viewsDependencies.set("node-errors", nodeErrorModule);
  for (const record of records)
    if (record !== undefined)
      viewsDependencies.set(record.module, record.module);
  generated.push({
    id: viewsId,
    module: viewsParsed.value,
    dependencies: viewsDependencies,
  });
  const viewSlots: NativeRecordBinding[] = errors.bindings.map((binding) => ({
    module: viewsId,
    name: binding.name,
    operation: binding.operation,
  }));
  for (let i = 0; i < records.length; i++) {
    viewSlots.push({
      module: viewsId,
      name: "viewSlot" + i,
      operation: "view-slot",
    });
    viewSlots.push({
      module: viewsId,
      name: "setViewSlot" + i,
      operation: "set-view-slot",
    });
  }
  const retainedExports = viewSlots.map((binding) => binding.name);
  if (errors.stubs !== "") retainedExports.push("nativeErrorReceiver");
  return {
    ok: true,
    value: {
      modules: generated,
      entry: hostId,
      ...units,
      recordBindings: viewSlots,
      ...(workerModules === undefined ? {} : { workerModules }),
      runtimes: [
        { module: viewsId, namespace: "general-record-views", retainedExports },
      ],
    },
  };
}

/** The retained stubs see only native layout identities and traced slots.
 * Publication lives in the host, where the shared realm is available. */
function errorAdapters(
  enabled: boolean,
  nodeErrors: boolean,
): {
  imports: string;
  functions: string;
  stubs: string;
  bindings: Pick<NativeRecordBinding, "name" | "operation">[];
} {
  const bindings: Pick<NativeRecordBinding, "name" | "operation">[] = [];
  if (!enabled) return { imports: "", functions: "", stubs: "", bindings };
  const imports: string[] = [];
  let stubs = "",
    lookup = "",
    publish = "";
  function adapter(layout: string, suffix: string, initializer: string): void {
    const project = "project" + suffix,
      get = "get" + suffix + "View",
      set = "set" + suffix + "View";
    imports.push(project, get, set);
    stubs += `export function ${project}(value:unknown):${layout}|undefined { throw "UNBOUND_ERROR_PROJECTION"; }
export function ${get}(error:${layout}):unknown { throw "UNBOUND_ERROR_VIEW_SLOT"; }
export function ${set}(error:${layout}, view:unknown):void { throw "UNBOUND_ERROR_VIEW_SLOT"; }
`;
    bindings.push(
      { name: project, operation: "view" },
      { name: get, operation: "view-slot" },
      { name: set, operation: "set-view-slot" },
    );
    lookup += `{const native=${project}(value);if(native!==undefined){
 const cached=${get}(native);return cached===undefined?value:cached;
 }}\n`;
    publish += `{const native=${project}(value);if(native!==undefined){
 const cached=${get}(native);if(cached!==undefined)return cached;
 const program=programRealm();
 const view:unknown=${initializer};
 ${set}(native,view);return view;
 }}\n`;
  }
  for (const [kind, intrinsic] of [
    ["Error", "error"],
    ["TypeError", "type"],
    ["RangeError", "range"],
  ]) {
    if (kind === undefined || intrinsic === undefined)
      throw "native error adapter invariant";
    const layout = "Native" + kind;
    // The flag's name partitions otherwise identical physical layouts.
    const flag = "has" + kind + "Message";
    stubs += `export interface ${layout} { readonly message: string; readonly ${flag}: boolean }\n`;
    adapter(
      layout,
      kind,
      `createNativeErrorView(program.realm,program.hooks,${JSON.stringify(intrinsic)},native.message,native.${flag},value,program.object)`,
    );
  }
  let factories = "createNativeErrorView,prepareRealmErrorArgument";
  if (nodeErrors) {
    factories += ",createNativeCodedErrorView,createNativeSystemErrorView";
    stubs +=
      'import type {NativeCodedError,NativeCodedRangeError,NativeSystemError} from "node-errors";\n';
    adapter(
      "NativeCodedError",
      "NativeCodedError",
      'createNativeCodedErrorView(program.realm,program.hooks,"error",native.message,native.code,native.errno,false,value,program.object)',
    );
    adapter(
      "NativeCodedRangeError",
      "NativeCodedRangeError",
      'createNativeCodedErrorView(program.realm,program.hooks,"range",native.message,native.code,undefined,native.rangeErrorCodeFirst,value,program.object)',
    );
    adapter(
      "NativeSystemError",
      "NativeSystemError",
      "createNativeSystemErrorView(program.realm,program.hooks,native.message,native.info.errno,native.info.code,native.info.message,native.info.syscall,value,program.object)",
    );
  }
  stubs += `export function nativeErrorReceiver(value:unknown):unknown {
${lookup}return value;
}\n`;
  return {
    imports: `import {${imports.join(",")}} from "views";\nimport {${factories}} from "objects";\n`,
    functions: `function toRealmError(value:unknown):unknown {
${publish}return value;
}
function fromRealmError(value:unknown):unknown {
 const program=programRealm();
 return prepareRealmErrorArgument(value,program.realm,program.hooks,program.object);
}\n`,
    stubs,
    bindings,
  };
}

/** Generated record adapters: per boundary record i, the view-slot binding
 * stubs `viewSlot<i>`/`setViewSlot<i>` (bound by record bindings),
 * `toGeneral<i>` (the record's cached view, created on first crossing) and
 * `fromGeneral<i>` (a view's record, after a checked downcast; any other
 * value is a TypeError, since the declared type is a contract). */
function recordAdapters(records: readonly BoundaryRecord[]): {
  readonly imports: string;
  readonly functions: string;
  /** The view-slot stubs: a runtime module, since record bindings bind
   * runtime exports. */
  readonly stubs: string;
  readonly index: ReadonlyMap<string, number>;
} {
  const index = new Map<string, number>();
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === undefined) throw "boundary record invariant";
    index.set(record.key, i);
  }
  let imports = "",
    functions = "",
    stubs = "";
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === undefined) throw "boundary record invariant";
    const type = "Record" + i;
    imports +=
      "import type {" +
      record.name +
      " as " +
      type +
      "} from " +
      JSON.stringify(record.module) +
      ";\n";
    const keys: string[] = [],
      writable: string[] = [];
    let reads = "",
      writes = "";
    for (let f = 0; f < record.fields.length; f++) {
      const field = record.fields[f];
      if (field === undefined) throw "boundary field invariant";
      const access = "record." + field.name;
      keys.push(JSON.stringify(field.name));
      writable.push(String(!field.readonly));
      reads +=
        "case " + f + ":return " + toGeneral(access, field.record, index) + ";";
      if (!field.readonly)
        writes +=
          "case " +
          f +
          ":" +
          access +
          "=" +
          fromGeneral("value", field.classes, field.record, index) +
          ";return;";
    }
    const fields =
      "{keys:[" +
      keys.join(",") +
      "],writable:[" +
      writable.join(",") +
      "],read:(field:number):unknown=>{switch(field){" +
      reads +
      "}return undefined;},write:(field:number,value:unknown):void=>{switch(field){" +
      writes +
      '}throw "RECORD_VIEW_READONLY";}}';
    stubs +=
      "import type {" +
      record.name +
      " as " +
      type +
      "} from " +
      JSON.stringify(record.module) +
      ";\n" +
      "export function viewSlot" +
      i +
      "(record:" +
      type +
      '):unknown{throw "UNBOUND_VIEW_SLOT";}\n' +
      "export function setViewSlot" +
      i +
      "(record:" +
      type +
      ',view:unknown):void{throw "UNBOUND_VIEW_SLOT";}\n';
    imports +=
      "import {viewSlot" + i + ",setViewSlot" + i + '} from "views";\n';
    functions +=
      "function toGeneral" +
      i +
      "(record:" +
      type +
      "):unknown{\n" +
      " const cached=viewSlot" +
      i +
      "(record);if(cached!==undefined)return cached;\n" +
      " const realm=programRealm().realm;\n" +
      " const view:unknown=createRecordView(realm.objectPrototype,record," +
      fields +
      ");\n" +
      " setViewSlot" +
      i +
      "(record,view);return view;\n}\n" +
      "function fromGeneral" +
      i +
      "(value:unknown):" +
      type +
      "{\n" +
      " const realm=programRealm().realm;\n" +
      " const object=viewObjectValue(value,realm.objectPrototype);\n" +
      " const record=object===undefined?undefined:typedRecordOf(object);\n" +
      " if(record===undefined)return rejectArgument(realm);\n" +
      " try{return record as " +
      type +
      ";}catch(error){return rejectArgument(realm);}\n}\n";
  }
  return { imports, functions, stubs, index };
}

/** A typed value as a general one: records become their views. */
function toGeneral(
  value: string,
  record: BoundaryRecordUse | undefined,
  index: ReadonlyMap<string, number>,
): string {
  if (
    record?.error !== undefined ||
    record === undefined ||
    record.dynamic !== undefined
  )
    return "toRealmError(" + value + ")";
  const i = index.get(record.key);
  if (i === undefined) throw "boundary record index invariant";
  return record.optional
    ? "((r:Record" +
        i +
        "|undefined):unknown=>r===undefined?undefined:toGeneral" +
        i +
        "(r))(" +
        value +
        ")"
    : "toGeneral" + i + "(" + value + ")";
}

/** A general value checked into its declared type: primitives by class,
 * records from their views. */
function fromGeneral(
  value: string,
  classes: number,
  record: BoundaryRecordUse | undefined,
  index: ReadonlyMap<string, number>,
): string {
  if (record === undefined)
    return (classes & boundaryUnknown) !== 0
      ? "fromRealmError(" + value + ")"
      : checkedArgument(value, classes);
  if (record.error !== undefined)
    return (
      "(fromRealmError(" +
      value +
      ") as " +
      record.error +
      (record.optional ? "|undefined" : "") +
      ")"
    );
  const dynamic = record.dynamic;
  if (dynamic !== undefined)
    return (
      "(" +
      value +
      " as " +
      dynamic.name +
      (record.optional ? "|undefined" : "") +
      ")"
    );
  const i = index.get(record.key);
  if (i === undefined) throw "boundary record index invariant";
  return record.optional
    ? "((a:unknown):Record" +
        i +
        "|undefined=>a===undefined?undefined:fromGeneral" +
        i +
        "(a))(" +
        value +
        ")"
    : "fromGeneral" + i + "(" + value + ")";
}

/** A checked argument: the value narrowed to its declared primitive
 * classes, or a TypeError. */
function checkedArgument(value: string, classes: number): string {
  // `unknown` parameters take any value unchanged, keeping its identity.
  if ((classes & boundaryUnknown) !== 0) return value;
  let expression = "rejectArgument(realm)";
  const tests: [number, string, string][] = [
    [boundaryNull, "a===null", "null"],
    [boundaryUndefined, "a===undefined", "undefined"],
    [boundaryBoolean, 'typeof a==="boolean"', "a"],
    [boundaryString, 'typeof a==="string"', "a"],
    [boundaryNumber, 'typeof a==="number"', "a"],
  ];
  const types: string[] = [];
  for (const [bit, test, result] of tests)
    if ((classes & bit) !== 0) {
      expression = test + "?" + result + ":" + expression;
      types.push(
        bit === boundaryNull
          ? "null"
          : bit === boundaryUndefined
            ? "undefined"
            : bit === boundaryBoolean
              ? "boolean"
              : bit === boundaryString
                ? "string"
                : "number",
      );
    }
  return (
    "((a:unknown):" + types.join("|") + "=>" + expression + ")(" + value + ")"
  );
}

/** Arguments installers take after `(global object, realm, hooks)`. */
const installerArguments: ReadonlyMap<string, string> = new Map<string, string>(
  [
    ["installTypedArrayIntrinsics", ',"little"'],
    ["installMathIntrinsics", ",undefined"],
    [
      "installPromiseIntrinsics",
      ",(promise:unknown,operation:string):void=>{}",
    ],
  ],
);

/** The typed host for a general program. Module records are created on
 * first request and resolved per referrer, as the source graph resolved
 * them; the start export's result (a number, or undefined for 0) is the
 * exit status, and an uncaught exception or rejected evaluation exits 1. */
function generalHostSource(
  imports: string,
  creates: string,
  edges: string,
  count: number,
  entry: number,
  start: string,
  output: boolean,
  installers: readonly string[],
  adapters: string,
  nodeEventLoop: boolean,
  workers: GeneralNodeWorkers | undefined,
  names: readonly string[],
  mixed?: FunctionFallbackPlan,
  typedWorkerEntry = false,
): string {
  let installs = "";
  const programInstallers: string[] = [];
  for (const installer of installers) {
    if (installer === undefined) throw "general installer invariant";
    if (workers !== undefined && installer === "installPromiseIntrinsics") {
      installs += " installProgramPromiseIntrinsics(core);\n";
      programInstallers.push("installProgramPromiseIntrinsics");
      continue;
    }
    if (installer === "installObjectIntrinsics") {
      installs += " installProgramObjectIntrinsics(core);\n";
      continue;
    }
    if (installer === "installArrayIntrinsics") {
      installs += " installProgramArrayIntrinsics(core);\n";
      programInstallers.push("installProgramArrayIntrinsics");
      continue;
    }
    if (installer === "installArrayBufferIntrinsics") {
      installs += " installProgramArrayBufferIntrinsics(core);\n";
      programInstallers.push("installProgramArrayBufferIntrinsics");
      continue;
    }
    if (installer === "installTypedArrayIntrinsics") {
      installs += " installProgramTypedArrayIntrinsics(core);\n";
      programInstallers.push("installProgramTypedArrayIntrinsics");
      continue;
    }
    programInstallers.push(installer);
    installs +=
      " " +
      installer +
      "(object,realm,hooks" +
      (installerArguments.get(installer) ?? "") +
      ");\n core.installed.add(" +
      JSON.stringify(installer) +
      ");\n";
  }
  const write = output
    ? `function emit(fd:number,text:string):void{const bytes=new TextEncoder().encode(text);let offset=0;while(offset<bytes.length){const written=writeOutput(fd,bytes.subarray(offset));if(written<=0)return;offset+=written;}}`
    : `function emit(fd:number,text:string):void{}`;
  const eventImports = nodeEventLoop
    ? `import {installNodeEventLoopGlobals} from "node-event-globals";
import {createReactorEventLoop,type ReactorEventLoop} from "node-event-driver";
import {monotonicMilliseconds} from "node-event-clock";
import {createReactor${workers === undefined ? "" : ",signalReactor"}} from "node-event-reactor";`
    : "";
  const hostedByNode = workers?.nodeHosted === true;
  const threadHostFactory = hostedByNode
    ? "createNodeHostedWorkerThreadHost"
    : "createNativeWorkerThreadHost";
  const workerImports =
    workers === undefined
      ? ""
      : `
import {startNodeWorkerHost,type NodeWorkerSession} from "worker-host";
import {${threadHostFactory}} from "worker-platform";
import {runNativeWorker,type NativeWorkerTurnControl} from "worker-lifecycle";
import {nativeSharedMemoryHost,nativeWaiterParkingHost,type NativeSharedMemoryHost,type NativeWaiterParkingHost} from "worker-shared";`;
  const workerRegistry =
    workers === undefined
      ? ""
      : `
 const workerNames:readonly string[]=${JSON.stringify(names)};
 const session=startNodeWorkerHost({global:object,realm,reactor:events,
  memory,parking,threads:${threadHostFactory}(${hostedByNode ? "broker" : ""}),threadId,control,
  managedBytes:${workers.managedBytes},stackBytes:${workers.stackBytes},
  now:():number=>monotonicMilliseconds(),
  lookup:(filename:string):number|undefined=>{
   const index=workerNames.indexOf(filename);
   return index<0?undefined:index;
  }
 });
 workerHost=session;
 const workers=session.exports;
 ${typedWorkerEntry ? 'initializeWorkerThreads(workers,realm);if(threadId===0){const status=typedStart();events.loop.run("callback");return failed?1:status;}' : ""}`;
  const drainJobs =
    "drainScriptJobs(realm.agent,(error:unknown):void=>{throw error;});";
  const drainCheckpoint =
    workers === undefined
      ? drainJobs
      : `workerHost?.checkpointAtomicWaits();do{${drainJobs}}while((workerHost?.checkpointAtomicWaits()??0)>0);`;
  const eventSetup = nodeEventLoop
    ? `${workers === undefined ? "" : "let workerHost:NodeWorkerSession|undefined=undefined;"}
 const events:ReactorEventLoop=createReactorEventLoop({
  createReactor:()=>createReactor(),
  now:():number=>monotonicMilliseconds(),
  drainMicrotasks:():void=>{${drainCheckpoint}},
  onWake:():void=>{${workers === undefined ? "" : "events.loop.enqueueIO(():void=>{});"}}${workers === undefined ? "" : ",stopRequested:():boolean=>control?.stopRequested()===true"}
 });
 try {
  installNodeEventLoopGlobals(events.loop,object,realm,hooks);
  ${workerRegistry}`
    : "";
  const eventCleanup = nodeEventLoop
    ? `} catch(error){report(error);return 1;} finally{${workers === undefined ? "" : "workerHost?.close();"}events.close();}`
    : "";
  const entryWrapper =
    workers === undefined
      ? `export function ${start}():number {`
      : `export function ${start}(argument:number${hostedByNode ? ",broker:number" : ""}):number {
 const memory=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost(signalReactor);
 if(argument===0)return runIsolate(${entry},0,undefined,memory,parking${hostedByNode ? ",broker" : ""});
 return runNativeWorker(memory,parking,argument,
  (moduleId:number,threadId:number,control:NativeWorkerTurnControl):number=>
   runIsolate(moduleId,threadId,control,memory,parking${hostedByNode ? ",broker" : ""}));
}
function runIsolate(moduleId:number,threadId:number,control:NativeWorkerTurnControl|undefined,memory:NativeSharedMemoryHost,parking:NativeWaiterParkingHost${hostedByNode ? ",broker:number" : ""}):number{`;
  const workerError =
    workers === undefined
      ? ""
      : `
  if(control!==undefined){
   if(control.stopRequested())return;
   const exception=viewObjectValue(error,object);
   if(exception!==undefined){
    const message=getProperty<ScriptPropertyKey,unknown>(exception,"message",exception,hooks);
    if(typeof message==="string")throw message;
   }
   throw describe(error,hooks,realm);
  }`;
  const argumentNames = Array.from(
    { length: mixed?.arity ?? 0 },
    (_, index) => "arg" + index,
  );
  const argumentsSource =
    mixed?.rest === true
      ? "const mixedArguments:unknown[]=[undefined];"
      : argumentNames.length === 0
        ? "const mixedArguments:readonly unknown[]=[];"
        : "const mixedArguments:unknown[]=[" +
          argumentNames.map(() => "undefined").join(",") +
          "];";
  const signature =
    mixed?.rest === true
      ? "...values:number[]"
      : argumentNames.map((name) => name + ":number").join(",");
  const captureArguments =
    mixed?.rest === true
      ? "mixedArguments[0]=values.length;"
      : argumentNames
          .map((name, index) => "mixedArguments[" + index + "]=" + name + ";")
          .join("");
  const ordinaryAdapters = mixed?.ordinaryEntries?.map((entry) => {
    const arguments_ = entry.parameters.map((_, i) => "arg" + i);
    const parameters = arguments_.map(
      (name, i) => name + ":" + entry.parameters[i],
    );
    if (entry.rest !== undefined)
      parameters.push("...values:" + entry.rest + "[]");
    return `export function ${entry.adapter}(${parameters.join(",")}):${entry.result} {
 const program=programRealm();
 const args:unknown[]=[${arguments_.join(",")}];
 ${entry.rest === undefined ? "" : "for(let i=0;i<values.length;i++)args.push(values[i]);"}
 const value=callObjectValue(mixedCallable,undefined,args,program.object).value;
 ${entry.result === "unknown" ? "" : "if(typeof value!==" + JSON.stringify(entry.result) + ")rejectArgument(program.realm);"}
 return value;
}`;
  });
  const mixedAdapter =
    mixed === undefined
      ? ""
      : ordinaryAdapters !== undefined
        ? "let mixedCallable:unknown=undefined;\n" + ordinaryAdapters.join("\n")
        : `
let mixedCallable:unknown=undefined;
${argumentsSource}
export function $tintCallUnit(${signature}):number {
 const program=programRealm();
 ${captureArguments}
 const value=callObjectValue(mixedCallable,undefined,mixedArguments,program.object).value;
 if(typeof value!=="number")rejectArgument(program.realm);
 return value;
}
`;
  const invoke =
    mixed === undefined
      ? `
 const main=getProperty<ScriptPropertyKey,unknown>(namespace,${JSON.stringify(start)},namespace,hooks);
 const result=callObjectValue(main,undefined,[],object);
 if(result.error!=="none"){report(result.value);return 1;}
 ${nodeEventLoop ? 'events.loop.run("callback");' : "drainScriptJobs(realm.agent,report);"}
 if(failed)return 1;
 const value=result.value;
 if(typeof value==="number")return value;
 ${
   workers === undefined
     ? ""
     : `const promise=viewObjectValue(value,object)?.internalExoticSlots?.internalPromiseData;
 if(promise!==undefined){
  if(promise.state==="rejected"){report(promise.result);return 1;}
  if(promise.state==="pending"){emit(2,"entry promise did not settle\\n");return 1;}
  const status=promise.result;
  if(typeof status==="number")return status;
 }`
 }
 return 0;
`
      : `
 mixedCallable=getProperty<ScriptPropertyKey,unknown>(namespace,${JSON.stringify(mixed.name)},namespace,hooks);
 const code=$tintTypedStart();
 ${nodeEventLoop ? 'events.loop.run("callback");' : "drainScriptJobs(realm.agent,report);"}
 return failed?1:code;
`;
  return `${imports}import {createGlobalEnvironment,type GlobalEnvironment} from "global";
import {createSyntheticModule,setSyntheticModuleExport,loadRequestedModules,finishLoadingImportedModule,linkModule,evaluateModule,settledModulePromise,getModuleNamespace,type ModuleRecord,type ModuleRequest,type ModuleReferrer,type ModuleLoadPayload} from "modules";
import {createObject,createCallableObject,createDataProperty,programRealmCore,installProgramObjectIntrinsics,createRuntimeError,getProperty,callObjectValue,stringValue,drainScriptJobs,installGlobalProperties,createRecordView,typedRecordOf,viewObjectValue,${programInstallers.join(",")},type ErrorRealm,type ScriptPropertyKey,type ObjectHooks,type OrdinaryObject} from "objects";
${output ? 'import {write as writeOutput} from "output";' : ""}
${eventImports}
${workerImports}
${write}
function rejectArgument(realm:ErrorRealm):never{throw createRuntimeError(realm,"type");}
function describe(value:unknown,hooks:ObjectHooks<unknown>,realm:ErrorRealm):string{
 try{const converted=stringValue(value,hooks,realm);if(converted.error==="none")return converted.value;}catch(error){}
 return "<unprintable value>";
}
interface ProgramRealm{readonly global:GlobalEnvironment<ScriptPropertyKey,unknown>;readonly realm:ErrorRealm;readonly hooks:ObjectHooks<unknown>;readonly object:OrdinaryObject<ScriptPropertyKey,unknown>;}
let current:ProgramRealm|undefined=undefined;
/** The program's realm, created on first use with the intrinsics the
 * program can reach. */
export function programRealm():ProgramRealm{
 if(current!==undefined)return current;
 const core=programRealmCore(${workers === undefined ? "" : "true"}),object=core.object,hooks=core.hooks,realm=core.realm;
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 installGlobalProperties(object,object,hooks);
${installs} const console=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);
 function printer(fd:number):unknown{return createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver:unknown,args:readonly unknown[]):unknown=>{let line="";for(let i=0;i<args.length;i++){if(i>0)line+=" ";line+=describe(args[i],hooks,realm);}emit(fd,line+"\\n");return undefined;},realm.executionContext);}
 createDataProperty<ScriptPropertyKey,unknown>(console,"log",printer(1),hooks);createDataProperty<ScriptPropertyKey,unknown>(console,"error",printer(2),hooks);
 createDataProperty<ScriptPropertyKey,unknown>(object,"console",console,hooks);
 const created:ProgramRealm={global,realm,hooks,object};
 current=created;
 return created;
}
${adapters}${mixedAdapter}${entryWrapper}
 const program=programRealm();
 const global=program.global,realm=program.realm,hooks=program.hooks,object=program.object;
 let failed=false;
 function report(error:unknown):void{failed=true;${workerError}emit(2,"Uncaught "+describe(error,hooks,realm)+"\\n");}
 ${eventSetup}
 const records:(ModuleRecord|undefined)[]=[];for(let i=0;i<${count};i++)records.push(undefined);
 function create(index:number):ModuleRecord{
  switch(index){
${creates}  }
  throw "GENERAL_HOST_MODULE_INDEX";
 }
 function record(index:number):ModuleRecord{const existing=records[index];if(existing!==undefined)return existing;const created=create(index);records[index]=created;return created;}
 const edges=new Map<string,number>();
${edges} realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{
  const from=referrer.kind==="module"?referrer.hostDefined:undefined;
  const target=typeof from==="number"?edges.get(String(from)+"\\u0000"+request.specifier):undefined;
  if(target===undefined){finishLoadingImportedModule(referrer,request,payload,{ok:false,error:createRuntimeError(realm,"type")});return;}
  finishLoadingImportedModule(referrer,request,payload,{ok:true,module:record(target)});
 };
 const root=record(${workers === undefined ? entry : "moduleId"});
 const loaded=settledModulePromise(loadRequestedModules(root,hooks,undefined),realm);
 if(loaded.kind==="rejected"){report(loaded.error);return 1;}
 const linked=linkModule(root);
 if(!linked.ok){report(linked.error);return 1;}
 const evaluation=evaluateModule(root,hooks);
 ${nodeEventLoop ? 'events.loop.checkpoint("microtask");' : "drainScriptJobs(realm.agent,report);"}
 ${workers === undefined ? "const" : "let"} evaluated=settledModulePromise(evaluation,realm);
 ${workers === undefined ? "" : 'if(evaluated.kind==="pending"){events.loop.run("microtask");evaluated=settledModulePromise(evaluation,realm);}'}
 if(evaluated.kind==="rejected"){report(evaluated.error);return 1;}
 if(evaluated.kind==="pending"){emit(2,"module evaluation did not settle\\n");return 1;}
 ${workers === undefined ? "" : 'if(threadId!==0){events.loop.run("callback");return failed?1:0;}'}
 const namespace=getModuleNamespace(root);
 ${invoke}
 ${eventCleanup}
}
`;
}
