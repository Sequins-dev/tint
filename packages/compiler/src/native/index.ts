export { managedDirectCallDeclarations } from "./managed-closure-uses.ts";
import type { NativeServiceBinding } from "./service-unit-link.ts";
import type { ManagedIdentityShape } from "./managed-imports.ts";
import { managedSurfaceContract } from "./managed-directory-reader.ts";
import {
  createManagedTypeContractIndex,
  managedFunctionType,
} from "./managed-contracts.ts";
export {
  linkNativeServiceModules,
  type NativeServiceBinding,
  type NativeServiceLink,
  type NativeServiceLinking,
} from "./service-unit-link.ts";
export {
  compileNativeServiceUnit,
  type NativeServiceUnit,
  type NativeServiceCompilation,
} from "./service-unit.ts";
import {
  resolveRuntimeEntryBindings,
  rejectHostRuntimeEntries,
} from "./managed-runtime-entries.ts";
import { materializeManagedRuntimeProviders } from "./managed-runtimes.ts";
import {
  validRuntimeNamespace,
  type RuntimeSource,
} from "./runtime-contracts.ts";
import {
  prepareManagedSurfaceExports,
  materializeManagedSurfaceExports,
  type ManagedSurfaceRequest,
  type ManagedSurfaceRuntimeExports,
} from "./managed-aot.ts";
import { verifyManagedSurfacePhysicalAgreement } from "./managed-directory-data.ts";
import type { ManagedSurfacePhysicalFacts } from "./managed-directory.ts";
export type { RuntimeSource } from "./runtime-contracts.ts";
import type { PosixHostABI } from "@tint/abi/host";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { bindingIdentifiers, rewriteModule } from "@tint/typescript/syntax";
import {
  optimizeModule,
  pruneClosedModule,
  lowerReferenceLists,
  referenceListWorkBudget,
  traceModuleReferences,
  type ReferenceListRuntime,
  type ReferenceListAlias,
  type PassStatistics,
} from "@tint/ir/optimization";
import {
  bindHostOperations,
  bindWeakOperations,
  type WeakOperation,
  type WeakBinding,
  type HostOperation,
  type HostBinding,
  type ModuleIR,
  type ScalarType,
  type FunctionIR,
} from "@tint/ir/scalar";
import { bindModule } from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  linkModules,
  locateSource,
  specializeModule,
  prepareModuleInstance,
  prepareModuleInvocation,
  prepareNativeGlobals,
  type NativeConstructor,
  type ModuleInstanceExport,
} from "@tint/ts-native/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import {
  prepareCollectionRuntimes,
  type RuntimeModuleTransform,
} from "@tint/ts-native/runtime";
import {
  lowerModuleEntries,
  type RecordOperation,
  type FunctionAddressBinding,
} from "@tint/ts-native/closure/lowering";
import {
  emitModule,
  type NativeModule,
  type ManagedFunctionEntryBinding,
  type EmissionFormHints,
} from "@tint/codegen/aarch64/scalar";
import type { ImportDeclaration, Statement } from "@tint/typescript/syntax";

export interface NativeHostBinding {
  readonly module: string;
  readonly name: string;
  readonly operation: HostOperation;
}
/** Explicitly authorized export; names in source alone grant no capability. */
export interface NativeRecordBinding {
  readonly module: string;
  readonly name: string;
  readonly operation: RecordOperation;
}
/** Opaque managed weak storage is available only to declared runtime exports. */
export interface NativeWeakBinding {
  readonly module: string;
  readonly name: string;
  readonly operation: WeakOperation;
}
/** Bodyless calls authorized by the compiler's native service composition. */
export interface NativeServiceImport {
  readonly module: string;
  readonly name: string;
  readonly contract: string;
  /** A managed factory must exactly match this host-owned surface frame. */
  readonly surface?: string;
}
export interface CompileRequest {
  readonly serviceImports?: readonly NativeServiceImport[];
  readonly managedSurfaces?: readonly ManagedSurfaceRequest[];
  /** Explicit target policy; this orchestration entry retains the initial Darwin default. */
  readonly hostABI?: PosixHostABI;
  readonly recordBindings?: readonly NativeRecordBinding[];
  readonly weakBindings?: readonly NativeWeakBinding[];
  /** Require the hosted context's optional linear-allocation state at byte 56. */
  readonly linearAllocation?: boolean;
  readonly generationalBarriers?: boolean;
  /** One-shot executable entry; no external calls may enter another native function. */
  readonly closedProgram?: boolean;
  /** Experimental: authorize bundled SparseList semantics for representation
   * rewriting. Requires closedProgram and a successful private-header proof. */
  readonly denseReferenceLists?: boolean;
  readonly optimization?: "none" | "basic";
  readonly debugSymbols?: boolean;
  /** Starting branch and address forms for the program's emission. */
  readonly emissionFormHints?: EmissionFormHints;
  /** The emitted code will be placed at a 4 KiB aligned address (hosted
   * images align every module), enabling two-instruction local addresses. */
  readonly pageAlignedCode?: boolean;
  /** Maximum instances in each application/runtime specialization pass. */
  readonly maxSpecializations?: number;
  /** Explicit capabilities for exports of declared trusted runtime modules. */
  readonly hostBindings?: readonly NativeHostBinding[];
  /** Parsed modules with imports already resolved to module IDs. */
  readonly modules: readonly SourceModule[];
  readonly entry: string;
  readonly exports: readonly string[];
  /** Optional one-shot export invocation after initialization. */
  readonly start?: string;
  /** Runtime templates and their dependencies remain outside application module state. */
  readonly runtimes: readonly RuntimeSource[];
}
export interface SourceLineRange {
  readonly offset: number;
  readonly byteLength: number;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
export interface CompiledProgram {
  /** Compiler-issued semantic identities in this program's permanent metadata. */
  readonly serviceIdentities?: readonly NativeServiceBinding[];
  readonly managedSurfaces?: readonly {
    readonly name: string;
    readonly digest: string;
    readonly signatures: number;
    readonly records: number;
    readonly runtimeSlots: number;
    readonly runtimeTargets: number;
    readonly runtimeSignatures: number;
  }[];
  readonly optimization: readonly PassStatistics[];
  readonly lines: readonly SourceLineRange[];
  readonly symbols: readonly {
    readonly byteLength: number;
    readonly name: string;
    readonly offset: number;
  }[];
  readonly native: NativeModule;
  /** Native function index. Calling it creates an instance and returns its export record. */
  readonly initializer: number;
  readonly entry: number | undefined;
  readonly exports: readonly string[];
}
export type Compilation =
  | { readonly ok: true; readonly value: CompiledProgram }
  | {
      readonly ok: false;
      readonly error: { readonly stage: string; readonly message: string };
    };
function failure(stage: string, message: string): Compilation {
  return { ok: false, error: { stage, message } };
}
/** Pure closed-program compilation. Source loading and executable packaging are host concerns. */
export function compileArm64Program(request: CompileRequest): Compilation {
  const globals = [
    "undefined",
    "NaN",
    "Infinity",
    "Array",
    "Boolean",
    "String",
    "Number",
    "Math",
    "Map",
    "Set",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
    "ArrayBuffer",
    "DataView",
    "TextEncoder",
    "TextDecoder",
    "TypeError",
    "RangeError",
  ];
  const modules = request.modules.slice();
  let entry = "$tint$compiler-entry";
  while (modules.some((m) => m !== undefined && m.id === entry)) entry += "$";
  const roots = [request.entry];
  for (const surface of request.managedSurfaces ?? []) {
    if (surface === undefined) throw "surface request invariant";
    const selectedModules = [surface.bind.module];
    for (const selection of surface.values) {
      if (selection === undefined) throw "surface selection invariant";
      selectedModules.push(selection.module);
    }
    for (const selection of surface.types) {
      if (selection === undefined) throw "surface type selection invariant";
      selectedModules.push(selection.module);
    }
    for (const id of selectedModules) {
      if (id === undefined) throw "surface module root invariant";
      if (!roots.includes(id)) roots.push(id);
    }
  }
  const runtimeNamespacesByModule = new Map<string, string>(),
    providersByNamespace = new Map<string, string>();
  for (const runtime of request.runtimes) {
    if (runtime === undefined) throw "runtime source invariant";
    if (runtimeNamespacesByModule.has(runtime.module))
      return failure("link", "duplicate runtime module: " + runtime.module);
    if (!validRuntimeNamespace(runtime.namespace))
      return failure("link", "invalid runtime namespace: " + runtime.namespace);
    if (providersByNamespace.has(runtime.namespace))
      return failure(
        "link",
        "duplicate runtime namespace: " + runtime.namespace,
      );
    runtimeNamespacesByModule.set(runtime.module, runtime.namespace);
    providersByNamespace.set(runtime.namespace, runtime.module);
    roots.push(runtime.module);
  }
  // Runtime implementation dependencies must remain callable before the
  // application module instance exists. This does not grant host capabilities.
  const retainedRuntimeModules = new Set<string>();
  const runtimeQueue = request.runtimes
    .filter((runtime) => runtime.retainedExports === undefined)
    .map((runtime) => runtime.module);
  for (let index = 0; index < runtimeQueue.length; index++) {
    const id = runtimeQueue[index];
    if (id === undefined || retainedRuntimeModules.has(id)) continue;
    retainedRuntimeModules.add(id);
    const source = modules.find(
      (candidate) => candidate !== undefined && candidate.id === id,
    );
    if (source === undefined) continue;
    for (const declaration of source.module.imports) {
      if (declaration === undefined) throw "runtime import invariant";
      const dependency = source.dependencies.get(declaration.specifier);
      if (dependency !== undefined) runtimeQueue.push(dependency);
    }
  }
  const imports: ImportDeclaration[] = roots.map((specifier) => ({
    specifier,
    specifierSpan: { start: 0, end: 0 },
    bindings: [],
    typeOnly: false,
    start: 0,
    end: 0,
  }));
  const statements: Statement[] = imports.map((declaration) => ({
    kind: "import",
    declaration,
    start: 0,
    end: 0,
  }));
  const dependencies = new Map<string, string>();
  for (const root of roots) {
    if (root === undefined) throw "module root invariant";
    dependencies.set(root, root);
  }
  modules.push({
    id: entry,
    module: { statements, imports, start: 0, end: 0 },
    dependencies,
  });
  const linked = linkModules(modules, entry, globals, {
    evaluation: "instance",
  });
  if (!linked.ok) return failure("link", linked.error.message);
  const retainedRuntimeExports: string[] = [];
  for (const runtime of request.runtimes) {
    if (runtime === undefined) throw "runtime source invariant";
    for (const name of runtime.retainedExports ?? []) {
      if (name === undefined) throw "retained runtime name invariant";
      const selected = linked.value.exports.find(
        (item) =>
          item !== undefined &&
          item.module === runtime.module &&
          item.namespace === "value" &&
          item.name === name,
      );
      if (selected === undefined)
        return failure(
          "runtime",
          "retained runtime export is missing: " + name,
        );
      if (!retainedRuntimeExports.includes(selected.linkedName))
        retainedRuntimeExports.push(selected.linkedName);
    }
  }
  const helpers = new Map<string, string>();
  for (const item of linked.value.exports) {
    if (item === undefined) throw "linked export invariant";
    const namespace = runtimeNamespacesByModule.get(item.module);
    if (namespace !== undefined && item.namespace === "value")
      helpers.set(namespace + ":" + item.name, item.linkedName);
  }
  const bound = bindModule(linked.value.module, globals);
  if (!bound.ok) return failure("bind", bound.error.message);
  const constructors: NativeConstructor[] = [];
  for (const name of ["TextEncoder", "TextDecoder"]) {
    if (name === undefined) throw "native constructor name invariant";
    const factory = helpers.get("text-encoding:createNative" + name);
    if (factory !== undefined) constructors.push({ global: name, factory });
  }
  const normalized = prepareNativeGlobals(
    linked.value.module,
    bound.value,
    constructors,
  );
  if (!normalized.ok) return failure("globals", normalized.error);
  const surfaces = prepareManagedSurfaceExports(
    normalized.value,
    linked.value,
    request.managedSurfaces ?? [],
    modules,
    request.runtimes,
    retainedRuntimeModules,
    globals,
    request.maxSpecializations ?? 8192,
  );
  if (!surfaces.ok) return failure("surface", surfaces.error);
  const surfacePlans = surfaces.value.plans;
  const application = surfaces.value.module;
  const rebound = bindModule(application, globals);
  if (!rebound.ok) return failure("bind", rebound.error.message);
  const specialized = specializeModule(application, rebound.value, {
    maxSpecializations: request.maxSpecializations ?? 8192,
  });
  if (!specialized.ok) return failure("specialize", specialized.error.message);
  const checked = checkClosureModule(specialized.value.module);
  if (!checked.ok) {
    const location = locateSource(linked.value, checked.error);
    return failure(
      "check",
      (location === undefined
        ? ""
        : location.module +
          ":" +
          String(location.start) +
          ":" +
          String(location.end) +
          ": ") + checked.error.message,
    );
  }
  let initializerName = "",
    entryName = "";
  const start = request.start;
  let surfaceFunctions: readonly (readonly string[])[] = [];
  let surfaceRuntimes: readonly ManagedSurfaceRuntimeExports[] = [];
  const transform: RuntimeModuleTransform = (inputModule, context) => {
    let generatedRetain: readonly string[] = [],
      generatedExclude: readonly string[] = [];
    let module = inputModule;
    if (surfacePlans.length !== 0) {
      const retainedValues = new Set<string>();
      for (const name of retainedRuntimeExports) {
        if (name === undefined) throw "retained surface value invariant";
        retainedValues.add(name);
      }
      for (const statement of module.statements) {
        if (statement === undefined || statement.kind !== "function") continue;
        const origin = locateSource(linked.value, statement);
        if (origin !== undefined && retainedRuntimeModules.has(origin.module))
          retainedValues.add(statement.name);
      }
      const materialized = materializeManagedSurfaceExports(
        module,
        surfacePlans,
        context,
        retainedValues,
      );
      if (!materialized.ok) return materialized;
      module = materialized.value.module;
      surfaceFunctions = materialized.value.functions;
      surfaceRuntimes = materialized.value.runtimes;
      generatedRetain = materialized.value.generated.retain;
      generatedExclude = materialized.value.generated.exclude;
    }
    const retained: string[] = retainedRuntimeExports.slice(),
      generatedNames = new Set<string>();
    for (const name of generatedRetain) {
      if (name === undefined) throw "surface retain invariant";
      retained.push(name);
      generatedNames.add(name);
    }
    for (const name of generatedExclude) {
      if (name === undefined) throw "surface exclude invariant";
      generatedNames.add(name);
    }
    for (const statement of module.statements) {
      if (statement === undefined) throw "module statement invariant";
      if (
        (statement.kind === "function" ||
          statement.kind === "type-alias" ||
          statement.kind === "interface" ||
          statement.kind === "class") &&
        generatedNames.has(statement.name)
      )
        continue;
      const origin = locateSource(linked.value, statement);
      if (origin === undefined || !retainedRuntimeModules.has(origin.module))
        continue;
      if (statement.kind === "function") retained.push(statement.name);
      else if (statement.kind === "variable")
        for (const declaration of statement.declarations) {
          if (declaration === undefined) throw "runtime declaration invariant";
          for (const identifier of bindingIdentifiers(declaration)) {
            if (identifier === undefined) throw "binding identifier invariant";
            retained.push(identifier.name);
          }
        }
    }
    const selected: ModuleInstanceExport[] = [];
    for (const name of request.exports) {
      if (name === undefined) throw "selected export invariant";
      const found = linked.value.exports.find(
        (item) =>
          item !== undefined &&
          item.module === request.entry &&
          item.namespace === "value" &&
          item.name === name,
      );
      if (
        found === undefined ||
        !module.statements.some(
          (s) =>
            s !== undefined &&
            s.kind === "function" &&
            s.name === found.linkedName,
        )
      )
        return {
          ok: false,
          error: "selected export is not a concrete function: " + name,
        };
      selected.push({ name, local: found.linkedName });
    }
    const bound = bindModule(module, globals);
    if (!bound.ok) return { ok: false, error: bound.error.message };
    const instance = prepareModuleInstance(
      module,
      bound.value,
      selected,
      retained,
    );
    if (!instance.ok) return instance;
    initializerName = instance.value.initializer.name;
    if (start !== undefined) {
      const invocation = prepareModuleInvocation(instance.value, start);
      if (!invocation.ok) return invocation;
      entryName = invocation.value.entry.name;
      return { ok: true, value: invocation.value.module };
    }
    return { ok: true, value: instance.value.module };
  };
  const prepared = prepareCollectionRuntimes(
    application,
    checked.value,
    helpers,
    globals,
    transform,
    request.maxSpecializations ?? 8192,
    (request.managedSurfaces?.length ?? 0) === 0
      ? undefined
      : (types) => {
          const compared = createManagedTypeContractIndex(types);
          return (left, right): boolean => {
            if (!compared.ok) return false;
            const result = compared.value.matches(left, right);
            return result.ok && result.value;
          };
        },
    undefined,
    (request.managedSurfaces?.length ?? 0) === 0 &&
      (request.serviceImports?.length ?? 0) === 0,
  );
  if (!prepared.ok) return failure("runtime", prepared.error);
  const nativeChecked = prepared.value.checked;
  const surfaceSources = new Map<string, number>();
  if (surfacePlans.length !== 0)
    rewriteModule(nativeChecked.module, {
      statement: (node, original) => {
        if (original.kind === "function") {
          const name = original.name;
          const fn = nativeChecked.bindings.functions.find(
            (fn) => fn !== undefined && fn.node === original,
          );
          if (fn !== undefined) surfaceSources.set(name, fn.id);
        }
        return node;
      },
    });
  const runtimeSources = new Map<string, number>();
  for (const statement of nativeChecked.module.statements) {
    if (statement === undefined || statement.kind !== "function") continue;
    const fn = nativeChecked.bindings.functions.find(
      (fn) =>
        fn !== undefined && fn.parent === undefined && fn.node === statement,
    );
    if (fn !== undefined) runtimeSources.set(statement.name, fn.id);
  }
  const functionAddressBindings: FunctionAddressBinding[] = [];
  for (const state of surfaceRuntimes) {
    if (state === undefined) throw "surface runtime state invariant";
    const bindings = resolveRuntimeEntryBindings(
      nativeChecked,
      state.entries.stubs,
    );
    if (!bindings.ok) return failure("surface", bindings.error);
    for (const binding of bindings.value) {
      if (binding === undefined) throw "surface address binding invariant";
      functionAddressBindings.push(binding);
    }
  }
  const initializerDeclaration = nativeChecked.module.statements.find(
    (s) =>
      s !== undefined && s.kind === "function" && s.name === initializerName,
  );
  const entryDeclaration = nativeChecked.module.statements.find(
    (s) => s !== undefined && s.kind === "function" && s.name === entryName,
  );
  const entries: number[] = [];
  let initializer = -1,
    invocation = -1;
  for (const fn of nativeChecked.bindings.functions) {
    if (fn === undefined) throw "checked function invariant";
    if (fn.parent !== undefined) continue;
    if (fn.node === initializerDeclaration) initializer = entries.length;
    if (fn.node === entryDeclaration) invocation = entries.length;
    entries.push(fn.id);
  }
  if (initializer < 0) return failure("lower", "module initializer is missing");
  if (start !== undefined && invocation < 0)
    return failure("lower", "module invocation is missing");
  const recordBindings: {
    function: number;
    operation: RecordOperation;
  }[] = [];
  for (const plan of surfacePlans) {
    if (plan === undefined) throw "surface plan invariant";
    for (const name of plan.records) {
      if (name === undefined) throw "surface identity name invariant";
      const source = surfaceSources.get(name);
      const fn =
        source === undefined
          ? undefined
          : nativeChecked.bindings.functions[source];
      if (fn === undefined)
        return failure("surface", "surface identity stub is missing: " + name);
      recordBindings.push({ function: fn.id, operation: "identity" });
    }
  }
  for (const binding of request.recordBindings ?? []) {
    if (binding === undefined) throw "record binding invariant";
    if (!runtimeNamespacesByModule.has(binding.module))
      return failure(
        "record-binding",
        "record bindings require a declared runtime module",
      );
    const module = binding.module,
      name = binding.name;
    const exported = linked.value.exports.find(
      (item) =>
        item !== undefined &&
        item.module === module &&
        item.namespace === "value" &&
        item.name === name,
    );
    if (exported === undefined)
      return failure(
        "record-binding",
        "record binding export is missing: " + name,
      );
    const linkedName = exported.linkedName;
    const declaration = nativeChecked.module.statements.find(
      (item) =>
        item !== undefined &&
        item.kind === "function" &&
        item.name === linkedName,
    );
    const fn = nativeChecked.bindings.functions.find(
      (item) =>
        item !== undefined &&
        item.node === declaration &&
        item.parent === undefined,
    );
    if (fn === undefined)
      return failure(
        "record-binding",
        "record binding requires a module function: " + name,
      );
    recordBindings.push({ function: fn.id, operation: binding.operation });
  }
  const serviceSources: {
    readonly function: number;
    readonly name: string;
    readonly contract: string;
  }[] = [];
  const serviceNames = new Set<number>();
  for (const binding of request.serviceImports ?? []) {
    if (
      binding === undefined ||
      !runtimeNamespacesByModule.has(binding.module) ||
      binding.contract.length === 0 ||
      binding.contract.includes("\0")
    )
      return failure(
        "service-import",
        "service imports require an authorized runtime export and contract",
      );
    const exported = linked.value.exports.find(
      (item) =>
        item !== undefined &&
        item.module === binding.module &&
        item.name === binding.name &&
        item.namespace === "value",
    );
    const declaration =
      exported === undefined
        ? undefined
        : nativeChecked.module.statements.find(
            (item) =>
              item !== undefined &&
              item.kind === "function" &&
              item.name === exported.linkedName,
          );
    const fn =
      declaration === undefined
        ? undefined
        : nativeChecked.bindings.functions.find(
            (item) =>
              item !== undefined &&
              item.node === declaration &&
              item.parent === undefined,
          );
    if (fn === undefined || serviceNames.has(fn.id))
      return failure("service-import", "missing or duplicate service entry");
    if (binding.surface !== undefined) {
      const plan = surfacePlans.find(
          (plan) =>
            plan !== undefined && plan.directory.name === binding.surface,
        ),
        frameName = plan?.directory.frame,
        frame =
          frameName === undefined
            ? undefined
            : plan?.surface.types.find(
                (type) => type !== undefined && type.name === frameName,
              )?.type;
      const frameType =
        frame?.kind === "named"
          ? nativeChecked.typeNames.get(frame.name)
          : undefined;
      const id = managedFunctionType(nativeChecked, fn.id),
        type = id === undefined ? undefined : nativeChecked.types[id];
      if (
        plan === undefined ||
        binding.contract !==
          "tint.service.factory.v1/" +
            plan.directory.name +
            "/" +
            plan.directory.digest ||
        frameType === undefined ||
        type?.kind !== "function" ||
        type.parameters.length !== 1 ||
        type.receiver !== undefined ||
        nativeChecked.types[type.result]?.kind !== "unknown"
      )
        return failure(
          "service-import",
          "factory differs from its host surface",
        );
      const parameter = type.parameters[0],
        compare = createManagedTypeContractIndex(nativeChecked.types);
      if (parameter === undefined || !compare.ok)
        return failure("service-import", "factory frame is unavailable");
      const match = compare.value.matches(parameter, frameType);
      if (!match.ok || !match.value)
        return failure("service-import", "factory frame contract differs");
    }
    serviceNames.add(fn.id);
    serviceSources.push({
      function: fn.id,
      name: binding.module + ":" + binding.name,
      contract: binding.contract,
    });
  }
  const lowered = lowerModuleEntries(
    nativeChecked,
    entries,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    {
      ...prepared.value.options,
      recordBindings,
      functionAddressBindings,
      importedFunctions: serviceSources.map((source) => source.function),
    },
  );
  if (!lowered.ok) {
    let message = lowered.error;
    const marker = message.lastIndexOf("(source "),
      colon = message.indexOf(":", marker),
      close = message.indexOf(")", colon);
    if (marker >= 0 && colon > marker && close > colon) {
      const start = Number(message.slice(marker + 8, colon)),
        end = Number(message.slice(colon + 1, close));
      if (
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start > 0 &&
        end >= start
      ) {
        const location = locateSource(linked.value, { start, end });
        if (location !== undefined)
          message =
            location.module +
            ":" +
            String(location.start) +
            ":" +
            String(location.end) +
            ": " +
            message;
      }
    }
    return failure("lower", message);
  }
  let serviceImports: ManagedFunctionEntryBinding[] = [];
  for (const source of serviceSources) {
    if (source === undefined) throw "service source invariant";
    const id = lowered.value.entries.indexOf(source.function),
      fn = lowered.value.module.functions[id];
    if (fn === undefined || fn.import !== true)
      return failure("service-import", "service entry is absent from lowering");
    const parameters: ScalarType[] = [];
    for (const slot of fn.parameters) {
      const type = fn.slots[slot ?? -1];
      if (type === undefined)
        return failure("service-import", "missing entry parameter");
      parameters.push(type);
    }
    serviceImports.push({
      function: id,
      name: source.name,
      contract: source.contract,
      parameters,
      returnType: fn.returnType,
    });
  }
  const surfaceRecordWitnesses: number[] = [];
  const identityPlans: {
    readonly shape: ManagedIdentityShape;
    readonly contract: string;
    record: number | undefined;
    function: number | undefined;
  }[] = [];
  if (surfacePlans.length !== 0) {
    const loweredModule = lowered.value;
    function surfaceFunction(name: string): FunctionIR | undefined {
      const source = surfaceSources.get(name);
      const index =
        source === undefined ? -1 : loweredModule.entries.indexOf(source);
      return index < 0 ? undefined : loweredModule.module.functions[index];
    }
    for (let index = 0; index < surfacePlans.length; index++) {
      const plan = surfacePlans[index],
        functions = surfaceFunctions[index];
      if (plan === undefined || functions === undefined)
        throw "surface lowering plan invariant";
      const records: ManagedSurfacePhysicalFacts["records"][number][] = [],
        signatures: ManagedSurfacePhysicalFacts["signatures"][number][] = [];
      for (
        let recordIndex = 0;
        recordIndex < plan.directory.records.length;
        recordIndex++
      ) {
        const expected = plan.directory.records[recordIndex],
          name = plan.records[recordIndex];
        if (expected === undefined || name === undefined)
          throw "surface record mapping invariant";
        const fn = surfaceFunction(name);
        // The witness that addresses this record keeps it through pruning.
        if (fn !== undefined) surfaceRecordWitnesses.push(fn.id);
        let record: number | undefined = undefined;
        for (const block of fn?.blocks ?? []) {
          if (block === undefined) throw "surface identity block invariant";
          for (const op of block.instructions) {
            if (op === undefined)
              throw "surface identity instruction invariant";
            if (op.kind === "record-descriptor-address") record = op.record;
          }
        }
        const layout =
          record === undefined
            ? undefined
            : loweredModule.module.records?.[record];
        if (layout === undefined)
          return failure("surface", "missing AOT layout: " + expected.alias);
        identityPlans.push({
          contract: managedSurfaceContract(
            plan.directory.name,
            plan.directory.digest,
            "record",
            recordIndex,
          ),
          shape: {
            role: "record",
            parameters: [],
            returnType: undefined,
            recordLayout: expected.layout,
          },
          record,
          function: undefined,
        });
        for (const alias of [expected.alias, ...expected.aliases]) {
          if (alias === undefined) throw "surface record alias invariant";
          records.push({ alias, layout });
        }
      }
      for (const expected of plan.directory.signatures) {
        if (expected === undefined) throw "surface signature invariant";
        const name = functions[expected.function],
          fn = name === undefined ? undefined : surfaceFunction(name);
        if (fn === undefined)
          return failure("surface", "missing AOT ABI: " + expected.alias);
        identityPlans.push({
          contract: managedSurfaceContract(
            plan.directory.name,
            plan.directory.digest,
            "fn",
            plan.directory.signatures.indexOf(expected),
          ),
          shape: {
            role: "signature",
            parameters: expected.parameters,
            returnType: expected.returnType,
          },
          record: undefined,
          function: fn.id,
        });
        const parameters: ScalarType[] = [];
        for (const slot of fn.parameters) {
          if (slot === undefined) throw "surface parameter invariant";
          const type = fn.slots[slot];
          if (type === undefined)
            return failure("surface", "missing AOT parameter");
          parameters.push(type);
        }
        for (const alias of [expected.alias, ...expected.aliases]) {
          if (alias === undefined) throw "surface signature alias invariant";
          signatures.push({ alias, parameters, returnType: fn.returnType });
        }
      }
      const state = surfaceRuntimes[index];
      if (state === undefined) throw "surface runtime state invariant";
      const runtimes = materializeManagedRuntimeProviders(
        state.names,
        (name: string) => {
          const source = runtimeSources.get(name),
            id =
              source === undefined ? -1 : loweredModule.entries.indexOf(source),
            fn = id < 0 ? undefined : loweredModule.module.functions[id];
          if (fn === undefined) return undefined;
          const parameters: ScalarType[] = [];
          for (const slot of fn.parameters) {
            if (slot === undefined) throw "runtime parameter invariant";
            const type = fn.slots[slot];
            if (type === undefined) return undefined;
            parameters.push(type);
          }
          return { parameters, returnType: fn.returnType };
        },
      );
      if (!runtimes.ok) return failure("surface", runtimes.error);
      const runtimeTargets: string[] = [];
      for (const provider of state.names.providers) {
        if (provider === undefined) throw "service runtime provider invariant";
        for (const name of provider.targets) {
          if (name === undefined) throw "service runtime target invariant";
          runtimeTargets.push(name);
        }
      }
      let runtimeSlot = 0;
      for (const provider of plan.directory.runtimes) {
        if (provider === undefined) throw "service provider invariant";
        for (const operation of provider.operations) {
          if (operation === undefined) throw "service operation invariant";
          const name = runtimeTargets[runtimeSlot],
            source = name === undefined ? undefined : runtimeSources.get(name),
            id =
              source === undefined ? -1 : loweredModule.entries.indexOf(source);
          if (id < 0)
            return failure("surface", "missing native service runtime entry");
          identityPlans.push({
            contract: managedSurfaceContract(
              plan.directory.name,
              plan.directory.digest,
              "runtime",
              runtimeSlot,
            ),
            shape: {
              role: "function-entry",
              parameters: operation.parameters,
              returnType: operation.returnType,
            },
            record: undefined,
            function: id,
          });
          runtimeSlot++;
        }
      }
      const agreement = verifyManagedSurfacePhysicalAgreement(plan.directory, {
        records,
        signatures,
        runtimes: runtimes.value,
      });
      if (!agreement.ok) return failure("surface", agreement.error);
    }
  }
  // Resolve by the exported declaration identity after module linking, never by
  // source spelling alone. Host and managed capabilities share this lookup.
  const runtimeExports = linked.value.exports;
  function runtimeEntry(module: string, name: string): number | undefined {
    if (!runtimeNamespacesByModule.has(module)) return undefined;
    const exported = runtimeExports.find(
      (item) =>
        item !== undefined &&
        item.module === module &&
        item.namespace === "value" &&
        item.name === name,
    );
    if (exported === undefined) return undefined;
    const linkedName = exported.linkedName;
    const declaration = nativeChecked.module.statements.find(
      (item) =>
        item !== undefined &&
        item.kind === "function" &&
        item.name === linkedName,
    );
    if (declaration === undefined) return undefined;
    const fn = nativeChecked.bindings.functions.find(
      (item) =>
        item !== undefined &&
        item.node === declaration &&
        item.parent === undefined,
    );
    if (fn === undefined) return undefined;
    const index = entries.indexOf(fn.id);
    return index < 0 ? undefined : index;
  }
  const hostBindings: HostBinding[] = [];
  for (const binding of request.hostBindings ?? []) {
    if (binding === undefined) throw "native host binding invariant";
    if (!runtimeNamespacesByModule.has(binding.module))
      return failure("host", "host bindings require a declared runtime module");
    const index = runtimeEntry(binding.module, binding.name);
    if (index === undefined)
      return failure(
        "host",
        "host bindings require a module entry exported by a declared runtime: " +
          binding.name,
      );
    hostBindings.push({ function: index, operation: binding.operation });
  }
  const weakBindings: WeakBinding[] = [];
  for (const binding of request.weakBindings ?? []) {
    if (binding === undefined) throw "native weak binding invariant";
    const index = runtimeEntry(binding.module, binding.name);
    if (index === undefined)
      return failure(
        "weak",
        "weak bindings require a module entry exported by a declared runtime: " +
          binding.name,
      );
    if (hostBindings.some((item) => item.function === index))
      return failure("weak", "function has conflicting host and weak bindings");
    weakBindings.push({ function: index, operation: binding.operation });
  }
  const hostIdentities: { readonly function: number }[] = [];
  for (const binding of hostBindings) {
    if (binding === undefined) throw "host binding invariant";
    hostIdentities.push({ function: binding.function });
  }
  for (const binding of weakBindings) {
    if (binding === undefined) throw "weak binding invariant";
    hostIdentities.push({ function: binding.function });
  }
  const authority = rejectHostRuntimeEntries(
    functionAddressBindings,
    lowered.value.entries,
    hostIdentities,
  );
  if (!authority.ok) return failure("surface", authority.error);
  const hosted = bindHostOperations(lowered.value.module, hostBindings);
  if (!hosted.ok) return failure("host", hosted.error);
  const weak = bindWeakOperations(hosted.value, weakBindings);
  if (!weak.ok) return failure("weak", weak.error);
  const passes: PassStatistics[] = [];
  let representation = weak.value;
  if (
    request.denseReferenceLists &&
    surfacePlans.length === 0 &&
    request.closedProgram &&
    invocation >= 0 &&
    request.optimization !== "none"
  ) {
    const nativeIds = new Uint32Array(nativeChecked.bindings.functions.length);
    for (let i = 0; i < entries.length; i++) {
      const id = entries[i];
      if (id === undefined) throw "list native entry invariant";
      nativeIds[id] = i + 1;
    }
    function nativeId(source: number): number {
      return (nativeIds[source] ?? 0) - 1;
    }
    const bindings: ReferenceListRuntime[] = [];
    for (const binding of prepared.value.options.lists ?? []) {
      if (binding === undefined) throw "list binding invariant";
      const runtime = binding.runtime,
        fn = nativeChecked.bindings.functions[runtime.create];
      const origin =
        fn === undefined ? undefined : locateSource(linked.value, fn.node);
      if (
        origin === undefined ||
        runtimeNamespacesByModule.get(origin.module) !== "sparse-list"
      )
        continue;
      const has = runtime.has,
        remove = runtime.delete,
        resize = runtime.resize;
      if (has === undefined || remove === undefined || resize === undefined)
        continue;
      bindings.push({
        create: nativeId(runtime.create),
        read: nativeId(runtime.read),
        write: nativeId(runtime.write),
        push: nativeId(runtime.push),
        length: nativeId(runtime.length),
        has: nativeId(has),
        delete: nativeId(remove),
        resize: nativeId(resize),
      });
    }
    const aliasKeys: (string | undefined)[] = [];
    function aliasLayout(id: number): string {
      const cached = aliasKeys[id];
      if (cached !== undefined) return cached;
      const fn = representation.functions[id];
      if (fn === undefined) return "missing";
      let key = "" + fn.returnType;
      for (const p of fn.parameters) {
        if (p === undefined) throw "list parameter invariant";
        const type = fn.slots[p];
        if (type === undefined) throw "list slot invariant";
        key = key + ":" + type;
      }
      const reachable = traceModuleReferences(representation, [id]);
      if (reachable === undefined) return "unproved:" + id;
      for (let layout = 0; layout < reachable.records.length; layout++)
        if (reachable.records[layout] === 1) key = key + ":" + layout;
      aliasKeys[id] = key;
      return key;
    }
    const aliases: ReferenceListAlias[] = [];
    const known = new Map<string, number>(),
      origins = new Set<string>();
    for (const binding of bindings) {
      if (binding === undefined) throw "list binding invariant";
      for (const id of [
        binding.create,
        binding.read,
        binding.write,
        binding.push,
        binding.length,
        binding.has,
        binding.delete,
        binding.resize,
      ]) {
        if (id === undefined) throw "list method invariant";
        const source = entries[id],
          fn =
            source === undefined
              ? undefined
              : nativeChecked.bindings.functions[source];
        const origin =
          fn === undefined ? undefined : locateSource(linked.value, fn.node);
        if (origin !== undefined) {
          origins.add(origin.module + ":" + origin.start + ":" + origin.end);
          const key =
            origin.module +
            ":" +
            origin.start +
            ":" +
            origin.end +
            ":" +
            aliasLayout(id);
          if (!known.has(key)) known.set(key, id);
        }
      }
    }
    for (let id = 0; id < entries.length; id++) {
      const source = entries[id],
        fn =
          source === undefined
            ? undefined
            : nativeChecked.bindings.functions[source];
      const origin =
        fn === undefined ? undefined : locateSource(linked.value, fn.node);
      if (origin === undefined) continue;
      if (!origins.has(origin.module + ":" + origin.start + ":" + origin.end))
        continue;
      const canonical = known.get(
        origin.module +
          ":" +
          origin.start +
          ":" +
          origin.end +
          ":" +
          aliasLayout(id),
      );
      if (canonical !== undefined && canonical !== id)
        aliases.push({ function: id, canonical });
    }
    const loweredLists = lowerReferenceLists(
      representation,
      bindings,
      [initializer, invocation],
      referenceListWorkBudget(representation),
      aliases,
    );
    if (loweredLists !== undefined) {
      representation = loweredLists.module;
      passes.push({
        phase: "scalar",
        pass: "dense-reference-lists",
        visited: loweredLists.work,
        rewritten: loweredLists.rewritten,
      });
    }
  }
  function prune(module: ModuleIR): ModuleIR {
    if (
      !request.closedProgram ||
      invocation < 0 ||
      request.optimization === "none"
    )
      return module;
    // Managed surfaces and native services let foreign code (published JIT
    // entries, service callers) enter through their identity functions, so
    // those are roots too; raw memory capabilities still decline.
    const foreign = surfacePlans.length !== 0 || serviceImports.length !== 0;
    const roots: number[] = [initializer, invocation];
    if (foreign) {
      for (const plan of identityPlans) {
        if (plan === undefined) throw "service identity plan invariant";
        const entry = plan.function;
        if (entry !== undefined) roots.push(entry);
      }
      for (const witness of surfaceRecordWitnesses) {
        if (witness === undefined) throw "surface record witness invariant";
        roots.push(witness);
      }
      for (const binding of serviceImports) {
        if (binding === undefined) throw "service import invariant";
        roots.push(binding.function);
      }
    }
    const result = pruneClosedModule(module, roots, 10000000, foreign);
    if (result === undefined) return module;
    // Every identity foreign code binds must survive; otherwise keep all.
    for (const plan of identityPlans) {
      if (plan === undefined) throw "service identity plan invariant";
      const entry = plan.function,
        record = plan.record;
      if (
        (entry !== undefined && (result.functionIds[entry] ?? 0) === 0) ||
        (record !== undefined && (result.recordIds[record] ?? 0) === 0)
      )
        return module;
    }
    const init = result.functionIds[initializer],
      entry = result.functionIds[invocation];
    if (init === undefined || init === 0 || entry === undefined || entry === 0)
      throw "closed root mapping invariant";
    initializer = init - 1;
    invocation = entry - 1;
    const mapped: ManagedFunctionEntryBinding[] = [];
    for (const binding of serviceImports) {
      if (binding === undefined) throw "service import invariant";
      const id = result.functionIds[binding.function] ?? 0;
      if (id !== 0) mapped.push({ ...binding, function: id - 1 });
    }
    serviceImports = mapped;
    for (const plan of identityPlans) {
      if (plan === undefined) throw "service identity plan invariant";
      const recordId = plan.record,
        functionId = plan.function;
      if (recordId !== undefined) {
        const id = result.recordIds[recordId] ?? 0;
        plan.record = id === 0 ? undefined : id - 1;
      }
      if (functionId !== undefined) {
        const id = result.functionIds[functionId] ?? 0;
        plan.function = id === 0 ? undefined : id - 1;
      }
    }
    passes.push({
      phase: "scalar",
      pass: "remove-unreachable",
      visited: result.work,
      rewritten: result.removedFunctions + result.removedRecords,
    });
    return result.module;
  }
  // Avoid optimizing unreachable bodies; prune again after inlining removes calls.
  const reachable = prune(representation);
  const optimized =
    request.optimization === "none" ? undefined : optimizeModule(reachable);
  if (optimized !== undefined)
    for (const pass of optimized.passes) {
      if (pass === undefined) throw "optimization pass invariant";
      passes.push(pass);
    }
  const optimizedModule = prune(
    optimized === undefined ? reachable : optimized.module,
  );
  const native = emitModule(optimizedModule, {
    maxByteLength: 0xffffffff,
    hostABI: request.hostABI ?? darwinHostABI(),
    debugSpans: request.debugSymbols ?? false,
    linearAllocation: request.linearAllocation ?? false,
    generationalBarriers: request.generationalBarriers ?? false,
    managedABI:
      serviceImports.length === 0
        ? undefined
        : { version: 1, signatures: [], functions: serviceImports },
    closedRoots:
      request.closedProgram && invocation >= 0 ? [invocation] : undefined,
    formHints: request.emissionFormHints,
    pageAlignedCode: request.pageAlignedCode ?? false,
  });
  if (!native.ok) {
    const error = native.error;
    const invalid = optimizedModule.functions.find(
      (fn) => fn !== undefined && fn.id === error.function,
    );
    const location = error.span;
    const origin =
      location === undefined ? undefined : locateSource(linked.value, location);
    return failure(
      "emit",
      (origin === undefined
        ? invalid === undefined
          ? ""
          : invalid.name + ": "
        : origin.module + ":") +
        (origin !== undefined
          ? String(origin.start) + ":" + String(origin.end) + ": "
          : location === undefined
            ? ""
            : String(location.start) + ":" + String(location.end) + ": ") +
        error.message,
    );
  }
  const serviceIdentities: NativeServiceBinding[] = [],
    brand = native.value.functionDescriptor;
  if (surfacePlans.length !== 0 && brand !== undefined)
    serviceIdentities.push({
      name: "tint.function.v1",
      contract: "tint.function.v1",
      role: "function-brand",
      parameters: [],
      returnType: undefined,
      metadataOffset: brand.offset,
    });
  for (const plan of identityPlans) {
    if (plan === undefined) throw "service identity plan invariant";
    const recordId = plan.record,
      functionId = plan.function;
    const metadata =
      plan.shape.role === "record"
        ? recordId === undefined
          ? undefined
          : native.value.records.find(
              (record) => record !== undefined && record.record === recordId,
            )
        : functionId === undefined
          ? undefined
          : native.value.signatures.find(
              (signature) =>
                signature !== undefined &&
                signature.functions.includes(functionId ?? -1),
            );
    if (metadata === undefined) continue;
    const fn =
      functionId === undefined ? undefined : native.value.functions[functionId];
    serviceIdentities.push({
      ...plan.shape,
      name: plan.contract,
      contract: plan.contract,
      metadataOffset: metadata.offset,
      ...(plan.shape.role !== "function-entry" || fn === undefined
        ? {}
        : { entryOffset: fn.offset }),
    });
  }
  const symbols: { name: string; offset: number; byteLength: number }[] = [];
  const lines: SourceLineRange[] = [];
  if (request.debugSymbols) {
    const originalNames = new Map<string, string>();
    const sourceModules = new Map<string, SourceModule>();
    for (const source of request.modules) {
      if (source === undefined) throw "debug source invariant";
      sourceModules.set(source.id, source);
      const boundSource = bindModule(source.module, globals);
      if (!boundSource.ok) return failure("debug", boundSource.error.message);
      for (const binding of boundSource.value.bindings) {
        if (binding === undefined) throw "debug binding invariant";
        if (binding.kind === "function")
          originalNames.set(
            source.id + ":" + binding.node.start + ":" + binding.node.end,
            binding.name,
          );
      }
    }
    const names = new Map<string, string>();
    for (const fn of nativeChecked.bindings.functions) {
      if (fn === undefined) throw "debug function invariant";
      const binding = nativeChecked.bindings.bindings.find(
        (b) => b !== undefined && b.kind === "function" && b.node === fn.node,
      );
      const generated =
        binding === undefined ? "closure_" + fn.id : binding.name + "$" + fn.id;
      const origin = locateSource(linked.value, fn.node);
      if (origin !== undefined) {
        const sourceName =
          originalNames.get(
            origin.module + ":" + origin.start + ":" + origin.end,
          ) ?? "closure@" + origin.start;
        names.set(
          generated,
          origin.module + ":" + sourceName + " [" + generated + "]",
        );
      }
    }
    for (const range of native.value.sourceRanges) {
      if (range === undefined) throw "debug source range invariant";
      const origin = locateSource(linked.value, range);
      if (origin === undefined) continue;
      const source = sourceModules.get(origin.module),
        positionAt = source?.sourcePosition;
      if (positionAt === undefined) continue;
      const position = positionAt(origin.start);
      if (position === undefined) continue;
      lines.push({
        offset: range.offset,
        byteLength: range.byteLength,
        file: origin.module,
        line: position.line,
        column: position.column,
      });
    }
    for (const fn of native.value.functions) {
      if (fn === undefined) throw "debug native function invariant";
      if (fn.import === true) continue;
      symbols.push({
        name: names.get(fn.name) ?? fn.name,
        offset: fn.offset,
        byteLength: fn.byteLength,
      });
    }
  }
  return {
    ok: true,
    value: {
      native: native.value,
      symbols,
      lines,
      optimization: passes,
      initializer,
      entry: invocation < 0 ? undefined : invocation,
      exports: request.exports.slice(),
      ...(serviceIdentities.length === 0 ? {} : { serviceIdentities }),
      ...(surfacePlans.length === 0
        ? {}
        : {
            managedSurfaces: surfacePlans.map((plan, index) => ({
              name: plan.directory.name,
              digest: plan.directory.digest,
              signatures: plan.directory.signatures.length,
              records: plan.directory.records.length,
              runtimeSlots: surfaceRuntimes[index]?.entries.slots.length ?? 0,
              runtimeTargets:
                surfaceRuntimes[index]?.entries.stubs.entries.length ?? 0,
              runtimeSignatures:
                (surfaceRuntimes[index]?.entries.stubs.declarations.length ??
                  0) -
                (surfaceRuntimes[index]?.entries.stubs.entries.length ?? 0),
            })),
          }),
    },
  };
}
export {
  prepareNativeFunctionEntry,
  type PreparedNativeFunctionEntry,
  type NativeEntryPreparationOptions,
  compileClosedFunction,
  compileClosedDynamicFunction,
  compileManagedGlobalAccessDynamicFunction,
  compileManagedReceiverWriteDynamicFunction,
  type ManagedReceiverWriteDynamicFunctionCode,
  type ManagedReceiverWriteDynamicFunctionCompilation,
  type ManagedGlobalAccessDynamicFunctionCode,
  type ManagedGlobalAccessDynamicFunctionCompilation,
  type ClosedFunctionCompilation,
  type ClosedDynamicFunctionCompilation,
  type ClosedDynamicFunctionCode,
  type ClosedFunctionOptions,
} from "./closed-functions.ts";
export {
  resolveManagedPointers,
  managedIdentityByteLength,
  sameManagedRecordLayout,
  type ManagedIdentityShape,
  type ManagedIdentityBinding,
  type ManagedIdentityReader,
  type ManagedPointerResolution,
} from "./managed-imports.ts";
export {
  reifyManagedSurfaceTypes,
  prepareManagedSurfaceTypes,
  createManagedSurfaceFactory,
  createManagedSurfaceReflectors,
  createManagedSurfaceWitnessFactory,
  type ManagedSurfaceWitnessFactory,
  type ManagedSurfaceReflectors,
  type ManagedSurfaceIdentityReflector,
  type ManagedSurfacePreparation,
  type ManagedSurfaceFactory,
  type ManagedSurfaceTypeDescription,
  type ManagedSurfaceTypeRequest,
  type PreparedManagedSurfaceTypes,
  type ManagedSurfaceTypeEntry,
  type ManagedSurfaceTypes,
} from "./managed-surfaces.ts";
export {
  adaptManagedSurfaceEntry,
  type ManagedSurfaceEntryAdaptation,
} from "./managed-entry.ts";
export {
  canonicalizeManagedSurfaceTypes,
  serializeManagedSurfaceTypes,
  restoreManagedSurfaceTypes,
  type SerializedManagedSurfaceTypes,
  type ManagedSurfaceSerialization,
} from "./managed-surface-text.ts";
export {
  planManagedSurfaceContracts,
  type ManagedSurfaceContractClass,
  type ManagedSurfaceContractPlan,
  type ManagedSurfaceContracts,
  createManagedTypeContractIndex,
  type ManagedTypeContractComparison,
  type ManagedTypeContractIndex,
  type ManagedTypeContracts,
  createManagedTypeContractCache,
  type ManagedTypeContractCache,
} from "./managed-contracts.ts";

export {
  planManagedSignatureGroups,
  type ManagedSignatureGroupRequest,
  type CheckedManagedSignatureGroup,
  type ManagedSignatureGroupPlan,
} from "./managed-contracts.ts";

export {
  lowerManagedSignatureGroups,
  type LoweredManagedSignatureGroups,
} from "./managed-contracts.ts";
export {
  resolveManagedSurfaceSelections,
  prepareManagedSurfaceTable,
  type ManagedSurfaceTypeArgument,
  type ManagedSurfaceSelection,
  type ManagedSurfaceSelectionPlan,
  type ManagedSurfaceSelections,
} from "./managed-selections.ts";
export {
  deriveManagedSurfacePhysicalFacts,
  type ManagedSurfaceLayoutRuntime,
  type ManagedSurfacePhysicalFacts,
  type ManagedSurfacePhysicalDerivation,
} from "./managed-directory.ts";
export {
  managedSurfaceDirectoryVersion,
  encodeManagedSurfaceDirectory,
  digestManagedSurfaceDirectory,
  createManagedSurfaceDirectory,
  verifyManagedSurfacePhysicalAgreement,
  type ManagedSurfacePhysicalAgreement,
  type ManagedSurfaceDirectoryData,
  type SerializedManagedSurfaceDirectory,
  type ManagedSurfaceExport,
  type ManagedSurfaceDirectoryEncoding,
  type ManagedSurfaceDirectoryDigest,
  type ManagedSurfaceDirectoryPreparation,
  type ManagedSurfaceDirectoryCreation,
} from "./managed-directory-data.ts";
export {
  createManagedSurfaceAnchors,
  resolveManagedSurfaceAnchors,
  materializeManagedSurfaceTable,
  type ManagedSurfaceTableMaterialization,
  type ManagedSurfaceAnchorEntry,
  type ManagedSurfaceAnchorCreation,
  type ManagedSurfaceAnchorResolution,
} from "./managed-anchors.ts";
export {
  materializeManagedSurfaceExport,
  type ManagedSurfaceExportMaterialization,
} from "./managed-export-body.ts";
export type { ManagedSurfaceRequest } from "./managed-aot.ts";
export {
  readManagedSurfaceDirectory,
  managedSurfaceContract,
  selectManagedIdentityBindings,
  linkManagedSurfaceModule,
  type ManagedIdentitySelection,
  type ManagedSurfaceDirectoryHost,
  type ManagedSurfaceDirectoryRead,
  type ManagedSurfaceDirectoryReading,
} from "./managed-directory-reader.ts";

export {
  createRuntimeEntryStubs,
  resolveRuntimeEntryBindings,
} from "./managed-runtime-entries.ts";
export type {
  RuntimeEntryPlan,
  RuntimeEntryStub,
  RuntimeEntryPlanResult,
  RuntimeEntryABI,
} from "./managed-runtime-entries.ts";

export {
  planManagedSurfaceRuntimes,
  createManagedRuntimeAnchors,
  resolveManagedCollectionNames,
  resolveManagedRuntimeNames,
  materializeManagedRuntimeProviders,
  prepareManagedRuntimeEntries,
} from "./managed-runtimes.ts";
export type {
  ManagedRuntimeTypeSource,
  ManagedSurfaceRuntimeKey,
  ManagedRuntimeProviderKey,
  ManagedSurfaceRuntimeCensus,
  ManagedRuntimeAnchorPlan,
  ManagedRuntimeNamePlan,
  ManagedRuntimeProvider,
  ManagedRuntimeEntrySlots,
  ManagedRuntimeOperationABI,
} from "./managed-runtimes.ts";

export { normalizeManagedSurfaceApplications } from "./managed-applications.ts";
export type { ManagedSurfaceApplicationNormalization } from "./managed-applications.ts";

export { declareManagedJitRuntime } from "./managed-jit-runtime.ts";
export {
  createManagedCollectionPlanCache,
  type ManagedCollectionPlanCache,
} from "./managed-jit-program.ts";
// Entries of one compiler share the surface's type declarations.
export {
  createInterfaceResolutionCache,
  type InterfaceResolutionCache,
} from "@tint/typescript/checker";
export {
  prepareManagedSurfaceEntry,
  type ManagedSurfaceEntryRequest,
  type ManagedSurfaceEntryPreparation,
  type PreparedManagedSurfaceEntry,
} from "./managed-jit-entry.ts";
