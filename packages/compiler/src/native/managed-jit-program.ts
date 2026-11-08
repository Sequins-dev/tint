import {
  createManagedTypeContractIndex,
  createManagedTypeContractCache,
  type ManagedTypeContractCache,
  managedFunctionType,
} from "./managed-contracts.ts";
import { pruneClosedModule, optimizeModule } from "@tint/ir/optimization";
import type { ModuleIR } from "@tint/ir/scalar";
import type { TargetDataLayout } from "@tint/ts-native/closure/layout";
import { finalFunctionSources } from "./managed-runtime-selection.ts";
import type {
  Module,
  Statement,
  ImportDeclaration,
} from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import {
  checkClosureModule,
  type CheckedClosures,
} from "@tint/typescript/checker";
import {
  linkModules,
  prepareNativeGlobals,
  specializeModule,
  type LinkedProgram,
  type NativeConstructor,
} from "@tint/ts-native/modules";
import {
  prepareCollectionRuntimes,
  runtimeFunctionIds,
} from "@tint/ts-native/runtime";
import {
  lowerModuleEntries,
  type ModuleEntryOptions,
  type RecordBinding,
} from "@tint/ts-native/closure/lowering";
import type { ManagedSurfaceLayoutRuntime } from "./managed-directory.ts";
import { validRuntimeNamespace } from "./runtime-contracts.ts";

export interface ManagedJitProgram {
  readonly typeContracts?: ManagedTypeContractCache;
  readonly checked: CheckedClosures;
  readonly options: ModuleEntryOptions;
  readonly linked: LinkedProgram;
  readonly entry: number;
  readonly view: number;
  readonly aliasTypes: ReadonlyMap<string, number>;
}
export type ManagedJitProgramPreparation =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedJitProgram };
/** Prepare declarations in one graph; identities below belong only to the final
 * collection pass. Lowering, escape checks and publication remain the caller's
 * responsibility. No runtime body is emitted or executed here. */
export function prepareManagedJitProgram(
  module: Module,
  entryName: string,
  viewName: string,
  aliases: readonly string[],
  runtime: ManagedSurfaceLayoutRuntime,
  typeContracts?: ManagedTypeContractCache,
): ManagedJitProgramPreparation {
  const reject = (error: string): ManagedJitProgramPreparation => ({
    ok: false,
    error: "managed JIT " + error,
  });
  for (const name of [entryName, viewName]) {
    if (name === undefined) return reject("entry invariant");
    if (
      !module.statements.some(
        (statement) =>
          statement !== undefined &&
          statement.kind === "function" &&
          statement.name === name,
      )
    )
      return reject("entry function is missing: " + name);
  }
  if (entryName === viewName) return reject("entry and view must differ");
  const namespaces = new Map<string, string>(),
    providers = new Set<string>();
  const roots: string[] = [];
  for (const source of runtime.runtimes) {
    if (source === undefined) return reject("missing runtime source");
    if (source.retainedExports !== undefined)
      return reject("retained runtime providers are not supported");
    if (!validRuntimeNamespace(source.namespace))
      return reject("invalid runtime namespace: " + source.namespace);
    if (namespaces.has(source.module) || providers.has(source.namespace))
      return reject("duplicate runtime module or namespace");
    namespaces.set(source.module, source.namespace);
    providers.add(source.namespace);
    roots.push(source.module);
  }
  const modules = runtime.modules.slice();
  let jit = "$tint$managed-jit",
    root = "$tint$managed-jit-root";
  while (modules.some((source) => source !== undefined && source.id === jit))
    jit += "$";
  while (modules.some((source) => source !== undefined && source.id === root))
    root += "$";
  const statements: Statement[] = [];
  for (const statement of module.statements) {
    if (statement === undefined) return reject("missing statement");
    statements.push(
      statement.kind === "function" &&
        (statement.name === entryName || statement.name === viewName)
        ? { ...statement, exported: true }
        : statement,
    );
  }
  modules.push({
    id: jit,
    module: { ...module, statements },
    dependencies: new Map<string, string>(),
  });
  roots.unshift(jit);
  const imports: ImportDeclaration[] = [],
    dependencies = new Map<string, string>();
  for (const name of roots) {
    if (name === undefined) return reject("missing root");
    imports.push({
      start: 0,
      end: 0,
      specifier: name,
      specifierSpan: { start: 0, end: 0 },
      bindings: [],
      typeOnly: false,
    });
    dependencies.set(name, name);
  }
  modules.push({
    id: root,
    module: {
      start: 0,
      end: 0,
      imports,
      statements: imports.map((declaration) => ({
        start: 0,
        end: 0,
        kind: "import",
        declaration,
      })),
    },
    dependencies,
  });
  const linked = linkModules(modules, root, runtime.globals, {
    evaluation: "instance",
  });
  if (!linked.ok) return reject("link: " + linked.error.message);
  const helpers = new Map<string, string>();
  for (const exported of linked.value.exports) {
    if (exported === undefined) return reject("missing linked export");
    const namespace = namespaces.get(exported.module);
    if (namespace !== undefined && exported.namespace === "value")
      helpers.set(namespace + ":" + exported.name, exported.linkedName);
  }
  const bound = bindModule(linked.value.module, runtime.globals);
  if (!bound.ok) return reject("bind: " + bound.error.message);
  const constructors: NativeConstructor[] = [];
  for (const global of ["TextEncoder", "TextDecoder"]) {
    if (global === undefined) return reject("missing constructor name");
    const factory = helpers.get("text-encoding:createNative" + global);
    if (factory !== undefined) constructors.push({ global, factory });
  }
  const normalized = prepareNativeGlobals(
    linked.value.module,
    bound.value,
    constructors,
  );
  if (!normalized.ok) return reject("globals: " + normalized.error);
  const rebound = bindModule(normalized.value, runtime.globals);
  if (!rebound.ok) return reject("bind: " + rebound.error.message);
  const max = runtime.maxSpecializations ?? 4096;
  const specialized = specializeModule(normalized.value, rebound.value, {
    maxSpecializations: max,
  });
  if (!specialized.ok)
    return reject("specialize: " + specialized.error.message);
  const checked = checkClosureModule(specialized.value.module);
  if (!checked.ok) return reject("check: " + checked.error.message);
  const prepared = prepareCollectionRuntimes(
    normalized.value,
    checked.value,
    helpers,
    runtime.globals,
    undefined,
    max,
  );
  if (!prepared.ok) return reject("runtime preparation: " + prepared.error);
  const graph = prepared.value.checked;
  function exportedName(
    name: string,
    namespace: "type" | "value",
  ): string | undefined {
    return linked.ok
      ? linked.value.exports.find(
          (item) =>
            item !== undefined &&
            item.module === jit &&
            item.name === name &&
            item.namespace === namespace,
        )?.linkedName
      : undefined;
  }
  function functionId(name: string): number | undefined {
    const linkedName = exportedName(name, "value");
    if (linkedName === undefined) return undefined;
    const declaration = graph.module.statements.find(
      (statement) =>
        statement !== undefined &&
        statement.kind === "function" &&
        statement.name === linkedName,
    );
    return graph.bindings.functions.find(
      (fn) =>
        fn !== undefined && fn.node === declaration && fn.parent === undefined,
    )?.id;
  }
  const entry = functionId(entryName),
    view = functionId(viewName);
  if (entry === undefined || view === undefined)
    return reject("prepared entry binding is missing");
  const aliasTypes = new Map<string, number>();
  for (const alias of aliases) {
    if (alias === undefined) return reject("missing alias");
    const name = exportedName(alias, "type"),
      type = name === undefined ? undefined : graph.typeNames.get(name);
    if (type === undefined) return reject("surface alias is missing: " + alias);
    if (aliasTypes.has(alias))
      return reject("duplicate surface alias: " + alias);
    aliasTypes.set(alias, type);
  }
  return {
    ok: true,
    value: {
      checked: graph,
      options: prepared.value.options,
      linked: linked.value,
      entry,
      view,
      aliasTypes,
      typeContracts: typeContracts ?? createManagedTypeContractCache(),
    },
  };
}

export interface LoweredManagedJitProgram {
  readonly module: ModuleIR;
  readonly entry: number;
  readonly sources: readonly (number | undefined)[];
  readonly entries: readonly number[];
  readonly recordTypes: readonly (number | undefined)[] | undefined;
  readonly signatureTypes: Uint32Array | undefined;
  readonly functionMaps: readonly Uint32Array[];
  readonly recordMaps: readonly Uint32Array[];
}
export type ManagedJitLowering =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: LoweredManagedJitProgram };
/** Keep runtime functions opaque and preserve every identity map for subsequent
 * semantic contract checks. Returning IR is not permission to publish it. */
export function lowerManagedJitProgram(
  program: ManagedJitProgram,
  target: TargetDataLayout = {
    pointerSize: 8,
    wordSize: 8,
    allocationAlignment: 16,
    frameAlignment: 16,
    maxAlignment: 16,
  },
): ManagedJitLowering {
  const reject = (error: string): ManagedJitLowering => ({
    ok: false,
    error: "managed JIT " + error,
  });
  const recordBindings: RecordBinding[] = [];
  for (const binding of program.options.recordBindings ?? []) {
    if (binding === undefined) return reject("missing record binding");
    recordBindings.push(binding);
  }
  recordBindings.push({ function: program.view, operation: "view" });
  const comparisons =
    program.typeContracts?.get(program.checked.types) ??
    createManagedTypeContractIndex(program.checked.types);
  if (!comparisons.ok) return reject(comparisons.error);
  const comparison = comparisons.value;
  const aliases: number[] = [];
  for (const [name, type] of program.aliasTypes) {
    if (
      program.checked.types[type]?.kind === "object" &&
      !aliases.includes(type)
    )
      aliases.push(type);
  }
  const identities = new Map<number, number>();
  function recordIdentity(
    type: number,
  ):
    | { readonly ok: false; readonly error: string }
    | { readonly ok: true; readonly value: number | undefined } {
    const cached = identities.get(type);
    if (cached !== undefined)
      return { ok: true, value: cached < 0 ? undefined : cached };
    for (const alias of aliases) {
      if (alias === undefined)
        return { ok: false, error: "missing managed record identity alias" };
      const same = comparison.matches(type, alias);
      if (!same.ok) return same;
      if (same.value) {
        identities.set(type, alias);
        return { ok: true, value: alias };
      }
    }
    identities.set(type, -1);
    return { ok: true, value: undefined };
  }
  const lowered = lowerModuleEntries(
    program.checked,
    [program.entry, program.view],
    target,
    4096,
    {
      ...program.options,
      recordTypes: true,
      recordIdentity,
      signatureTypes: true,
      recordBindings,
      importedFunctions: runtimeFunctionIds(program.options),
    },
  );
  if (!lowered.ok) return reject("lower: " + lowered.error);
  const sourceEntry = lowered.value.entries.indexOf(program.entry);
  if (sourceEntry < 0) return reject("lowered entry is missing");
  const first = pruneClosedModule(lowered.value.module, [sourceEntry]);
  if (first === undefined)
    return reject("entry reachability proof is unavailable");
  const firstEntry = (first.functionIds[sourceEntry] ?? 0) - 1;
  if (firstEntry < 0) return reject("entry was removed");
  const optimized = optimizeModule(first.module),
    second = pruneClosedModule(optimized.module, [firstEntry]);
  if (second === undefined)
    return reject("optimized entry reachability proof is unavailable");
  const entry = (second.functionIds[firstEntry] ?? 0) - 1,
    fn = second.module.functions[entry];
  if (
    fn === undefined ||
    fn.environment !== undefined ||
    fn.closureEnvironment !== undefined ||
    fn.receiverSlot !== undefined ||
    fn.parameters.length !== 1 ||
    fn.slots[fn.parameters[0] ?? -1] !== "reference" ||
    fn.returnType !== "general"
  )
    return reject("profile: managed entry ABI differs");
  const functionMaps = [first.functionIds, second.functionIds],
    sources = finalFunctionSources(
      lowered.value.entries,
      functionMaps,
      second.module.functions.length,
    );
  const witnesses = new Set<number>();
  const signatureTypes = lowered.value.signatureTypes;
  if (signatureTypes !== undefined) {
    for (const source of signatureTypes) {
      if (source === 0) continue;
      const intermediate = first.functionIds[source - 1] ?? 0;
      const final =
        intermediate === 0 ? 0 : (second.functionIds[intermediate - 1] ?? 0);
      if (final !== 0) witnesses.add(final - 1);
    }
  }
  for (let index = 0; index < second.module.functions.length; index++) {
    const body = second.module.functions[index];
    if (body === undefined) return reject("missing function body");
    if (body.import || witnesses.has(index)) continue;
    let source = sources[index];
    while (
      source !== undefined &&
      source !== program.entry &&
      source !== program.view
    ) {
      const binding = program.checked.bindings.functions[source];
      source = binding?.parent;
    }
    if (source === undefined)
      return reject("profile: runtime body entered the JIT module");
  }
  return {
    ok: true,
    value: {
      module: second.module,
      entry,
      sources,
      entries: lowered.value.entries,
      recordTypes: lowered.value.recordTypes,
      signatureTypes: lowered.value.signatureTypes,
      functionMaps,
      recordMaps: [first.recordIds, second.recordIds],
    },
  };
}

export type ManagedJitFrameAgreement =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: { readonly type: number; readonly callee: number };
    };
/** Argument assignability is insufficient at the boundary: the image frame and
 * the selected source entry must describe exactly the same parameter contracts. */
export function verifyManagedJitFrame(
  program: ManagedJitProgram,
  frameAlias: string,
): ManagedJitFrameAgreement {
  const reject = (error: string): ManagedJitFrameAgreement => ({
    ok: false,
    error: "profile: " + error,
  });
  const graph = program.checked,
    frameId = program.aliasTypes.get(frameAlias);
  const frame = frameId === undefined ? undefined : graph.types[frameId];
  if (frameId === undefined || frame === undefined || frame.kind !== "object")
    return reject("surface frame is missing");
  const wrapper = graph.bindings.functions[program.entry];
  const declaration = graph.module.statements.find(
    (statement) =>
      statement !== undefined &&
      statement.kind === "function" &&
      statement === wrapper?.node,
  );
  if (declaration === undefined || declaration.kind !== "function")
    return reject("entry declaration is missing");
  const body = declaration.body;
  if (body.kind !== "block") return reject("entry declaration is missing");
  const returned = body.statements[body.statements.length - 1];
  if (returned === undefined || returned.kind !== "return")
    return reject("source entry call is missing");
  const call = returned.expression;
  if (call === undefined || call.kind !== "call")
    return reject("source entry call is missing");
  const calleeNode = call.callee;
  if (calleeNode.kind !== "identifier")
    return reject("source entry call is missing");
  const reference = graph.bindings.references.find(
    (reference) =>
      reference !== undefined &&
      reference.node === calleeNode &&
      reference.access === "read",
  );
  const referenceBinding = reference?.binding;
  const target =
    referenceBinding === undefined
      ? undefined
      : graph.bindings.bindings[referenceBinding];
  const targetNode = target?.node;
  const callee =
    target === undefined
      ? undefined
      : graph.bindings.functions.find(
          (fn) =>
            fn !== undefined &&
            fn.parent === program.entry &&
            fn.node === targetNode,
        );
  if (callee === undefined)
    return reject("source entry declaration is missing");

  const wrapperType = managedFunctionType(graph, program.entry),
    calleeType = managedFunctionType(graph, callee.id);
  const outer =
      wrapperType === undefined ? undefined : graph.types[wrapperType],
    inner = calleeType === undefined ? undefined : graph.types[calleeType];
  if (
    outer === undefined ||
    outer.kind !== "function" ||
    outer.parameters.length !== 1 ||
    inner === undefined ||
    inner.kind !== "function" ||
    frame.properties.length !== inner.parameters.length + 1
  )
    return reject("entry parameter differs from surface frame");
  const contracts =
    program.typeContracts?.get(graph.types) ??
    createManagedTypeContractIndex(graph.types);
  if (!contracts.ok) return reject(contracts.error);
  const rootType = outer.parameters[0];
  if (rootType === undefined)
    return reject("entry parameter differs from surface frame");
  const wrapperMatches = contracts.value.matches(rootType, frameId);
  if (!wrapperMatches.ok) return reject(wrapperMatches.error);
  if (!wrapperMatches.value)
    return reject("entry parameter differs from surface frame");
  for (let index = 0; index < frame.properties.length; index++) {
    const property = frame.properties[index];
    if (
      property === undefined ||
      !property.readonly ||
      property.optional ||
      property.name !==
        (index === 0 ? "$imports" : "$argument" + String(index - 1))
    )
      return reject("entry parameter differs from surface frame");
    if (index === 0) {
      if (graph.types[property.type]?.kind !== "unknown")
        return reject("surface frame imports must be unknown");
      continue;
    }
    const parameter = inner.parameters[index - 1];
    if (parameter === undefined)
      return reject("entry parameter differs from surface frame");
    const match = contracts.value.matches(property.type, parameter);
    if (!match.ok) return reject(match.error);
    if (!match.value)
      return reject("entry parameter differs from surface frame");
  }
  return { ok: true, value: { type: frameId, callee: callee.id } };
}
