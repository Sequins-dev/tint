import { nativeTargetLayout } from "./target-layout.ts";
import {
  planManagedSurfaceRuntimes,
  createManagedRuntimeAnchors,
  resolveManagedRuntimeNames,
  materializeManagedRuntimeProviders,
  type ManagedRuntimeNamePlan,
  type ManagedRuntimeProvider,
} from "./managed-runtimes.ts";
import { bindModule } from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";
import type { SourceModule } from "@tint/typescript/modules/model";
import type {
  ImportDeclaration,
  Module,
  Statement,
} from "@tint/typescript/syntax";
import {
  linkModules,
  prepareNativeGlobals,
  specializeModule,
  type NativeConstructor,
  type LinkedExport,
} from "@tint/ts-native/modules";
import { prepareCollectionRuntimes } from "@tint/ts-native/runtime";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import type { TargetDataLayout } from "@tint/ts-native/closure/layout";
import type {
  RecordLayout,
  ScalarType,
  ReturnType,
  FunctionIR,
} from "@tint/ir/scalar";
import {
  validRuntimeNamespace,
  type RuntimeSource,
} from "./runtime-contracts.ts";
import {
  createManagedSurfaceReflectors,
  createManagedSurfaceWitnessFactory,
  type ManagedSurfaceTypeDescription,
} from "./managed-surfaces.ts";

export interface ManagedSurfaceLayoutRuntime {
  readonly modules: readonly SourceModule[];
  readonly runtimes: readonly RuntimeSource[];
  readonly globals: readonly string[];
  readonly target?: TargetDataLayout;
  readonly maxSpecializations?: number;
}
export interface ManagedSurfacePhysicalFacts {
  readonly runtimes?: readonly ManagedRuntimeProvider[];
  /** The publishing image's generational barrier policy; code linked against
   * its surface must have been compiled with the same one. */
  readonly generationalBarriers?: boolean;
  readonly records: readonly {
    readonly alias: string;
    readonly layout: RecordLayout;
  }[];
  readonly signatures: readonly {
    readonly alias: string;
    readonly parameters: readonly ScalarType[];
    readonly returnType: ReturnType;
  }[];
}
export interface ManagedSurfaceLayoutFacts extends ManagedSurfacePhysicalFacts {
  readonly runtimes: readonly ManagedRuntimeProvider[];
}
export type ManagedSurfacePhysicalDerivation =
  | { readonly ok: true; readonly value: ManagedSurfaceLayoutFacts }
  | { readonly ok: false; readonly error: string };
interface SharedLayoutRuntime {
  readonly module: Module;
  readonly exports: readonly LinkedExport[];
  readonly slot: number;
  readonly offset: number;
}
function layoutEntry(
  id: string,
  roots: readonly string[],
  typeOnly?: string,
): SourceModule {
  const imports: ImportDeclaration[] = [];
  const dependencies = new Map<string, string>();
  for (const root of roots) {
    if (root === undefined) throw "surface root invariant";
    imports.push({
      start: 0,
      end: 0,
      specifier: root,
      specifierSpan: { start: 0, end: 0 },
      bindings: [],
      typeOnly: root === typeOnly,
    });
    dependencies.set(root, root);
  }
  return {
    id,
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
  };
}
type LayoutLink =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly module: Module;
      readonly exports: readonly LinkedExport[];
    };
function linkLayout(
  modules: readonly SourceModule[],
  layout: SourceModule,
  entry: SourceModule,
  globals: readonly string[],
  shared: SharedLayoutRuntime[],
  shareRuntime: boolean,
): LayoutLink {
  function link(
    inputs: readonly SourceModule[],
    root: SourceModule,
  ): LayoutLink {
    const result = linkModules(inputs, root.id, globals, {
      evaluation: "instance",
      origins: false,
    });
    return result.ok
      ? { ok: true, module: result.value.module, exports: result.value.exports }
      : { ok: false, error: result.error.message };
  }
  function layoutInputs(source: SourceModule): SourceModule[] {
    const inputs = modules.slice();
    inputs.push(source);
    inputs.push(entry);
    return inputs;
  }
  if (!shareRuntime) return link(layoutInputs(layout), entry);
  let runtime = shared[0];
  if (runtime === undefined) {
    // The marker reserves the same module ordinal and span as the real
    // layout. Its position also accounts for type-only runtime dependencies,
    // which the linker emits before any evaluated declarations.
    const name = "$tint$layout_slot";
    const marker: Statement = {
      kind: "type-alias",
      name,
      type: { kind: "named", name: "number", start: 0, end: 0 },
      exported: true,
      start: 0,
      end: 0,
    };
    for (const source of modules) {
      if (source === undefined) throw "surface module invariant";
      for (const [_specifier, dependency] of source.dependencies)
        if (dependency === layout.id || dependency === entry.id)
          return link(layoutInputs(layout), entry);
    }
    const template = linkModules(
      layoutInputs({
        ...layout,
        module: { ...layout.module, statements: [marker] },
      }),
      entry.id,
      globals,
      { evaluation: "instance", origins: false },
    );
    if (!template.ok) return link(layoutInputs(layout), entry);
    const program = template.value;
    const exported = program.exports.find(
      (item) =>
        item !== undefined && item.module === layout.id && item.name === name,
    );
    const range = program.ranges.find(
      (item) => item !== undefined && item.module === layout.id,
    );
    const slot = program.module.statements.findIndex(
      (statement) =>
        statement !== undefined &&
        statement.kind === "type-alias" &&
        statement.name === exported?.linkedName,
    );
    if (range === undefined || slot < 0) throw "surface layout slot invariant";
    const templateRuntime: SharedLayoutRuntime = {
      module: program.module,
      exports: program.exports.filter((item) => item !== exported),
      slot,
      offset: range.offset,
    };
    shared.push(templateRuntime);
    runtime = templateRuntime;
  }
  const roots = [layout.id],
    inputs = [layout];
  let padding: string | undefined = undefined;
  if (runtime.offset > 0) {
    padding = entry.id + "$padding";
    roots.push(padding);
    inputs.push({
      id: padding,
      module: {
        start: 0,
        end: runtime.offset - 1,
        imports: [],
        statements: [],
      },
      dependencies: new Map<string, string>(),
    });
  }
  const root = layoutEntry(entry.id, roots, padding);
  inputs.push(root);
  const surface = link(inputs, root);
  if (!surface.ok) return surface;
  const runtimeModule = runtime.module,
    runtimeStatements = runtimeModule.statements,
    slot = runtime.slot,
    statements = runtimeStatements.slice(0, slot);
  const exports = runtime.exports.slice();
  for (const statement of surface.module.statements) {
    if (statement === undefined) throw "surface statement invariant";
    statements.push(statement);
  }
  for (let index = slot + 1; index < runtimeStatements.length; index++) {
    const statement = runtimeStatements[index];
    if (statement === undefined) throw "layout runtime statement invariant";
    statements.push(statement);
  }
  for (const item of surface.exports) {
    if (item === undefined) throw "surface export invariant";
    exports.push(item);
  }
  return {
    ok: true,
    module: { ...runtimeModule, statements },
    exports,
  };
}
/** Reuse the runtime link for independently checked and lowered surfaces. */
export function createManagedSurfacePhysicalDeriver(
  runtime: ManagedSurfaceLayoutRuntime,
  shareRuntime: boolean = true,
): (
  surface: ManagedSurfaceTypeDescription,
) => ManagedSurfacePhysicalDerivation {
  const shared: SharedLayoutRuntime[] = [];
  return (surface) =>
    deriveSurfacePhysicalFacts(surface, runtime, shared, shareRuntime);
}
/** Lower an inert metadata program through the real collection/runtime pipeline.
 * No helper body is copied from the application, no IR is pruned or emitted,
 * and no program initialization runs. Facts describe every reified alias. */
export function deriveManagedSurfacePhysicalFacts(
  surface: ManagedSurfaceTypeDescription,
  runtime: ManagedSurfaceLayoutRuntime,
): ManagedSurfacePhysicalDerivation {
  return deriveSurfacePhysicalFacts(surface, runtime, [], false);
}
function deriveSurfacePhysicalFacts(
  surface: ManagedSurfaceTypeDescription,
  runtime: ManagedSurfaceLayoutRuntime,
  shared: SharedLayoutRuntime[],
  shareRuntime: boolean,
): ManagedSurfacePhysicalDerivation {
  const failure = (
    stage: string,
    error: string,
  ): ManagedSurfacePhysicalDerivation => ({
    ok: false,
    error: "surface " + stage + ": " + error,
  });
  const witnesses = createManagedSurfaceWitnessFactory(
    surface,
    "$layout_witness",
  );
  if (!witnesses.ok) return failure("witnesses", witnesses.error);
  const reflectors = createManagedSurfaceReflectors(surface, "$layout_record");
  if (!reflectors.ok) return failure("identities", reflectors.error);
  const identities = reflectors.value.recordIdentities,
    identityNames = new Set<string>();
  for (const identity of identities) {
    if (identity === undefined) throw "surface identity invariant";
    identityNames.add(identity.function);
  }
  const census = planManagedSurfaceRuntimes({
    surface,
    checked: witnesses.value.checked,
  });
  if (!census.ok) return failure("runtime census", census.error);
  const anchors = createManagedRuntimeAnchors(census.value, "$layout_runtime");
  if (!anchors.ok) return failure("runtime anchors", anchors.error);
  const statements: Statement[] = surface.declarations.slice();
  for (const declaration of anchors.value.declarations) {
    if (declaration === undefined) throw "surface runtime anchor invariant";
    statements.push(declaration);
  }
  for (const statement of witnesses.value.checked.module.statements)
    if (
      statement !== undefined &&
      statement.kind === "function" &&
      statement.name !== witnesses.value.factory
    )
      statements.push({ ...statement, exported: true });
  for (const statement of reflectors.value.checked.module.statements)
    if (
      statement !== undefined &&
      statement.kind === "function" &&
      identityNames.has(statement.name)
    )
      statements.push(statement);
  const modules = runtime.modules;
  let layout = "$tint$surface-layout",
    entry = "$tint$surface-layout-entry";
  while (modules.some((module) => module !== undefined && module.id === layout))
    layout += "$";
  while (modules.some((module) => module !== undefined && module.id === entry))
    entry += "$";
  const layoutSource: SourceModule = {
    id: layout,
    module: { start: 0, end: 0, imports: [], statements },
    dependencies: new Map<string, string>(),
  };
  const namespaces = new Map<string, string>(),
    providers = new Set<string>(),
    roots = [layout];
  for (const source of runtime.runtimes) {
    if (source === undefined) throw "surface runtime invariant";
    if (source.retainedExports !== undefined) continue;
    if (!validRuntimeNamespace(source.namespace))
      return failure(
        "runtime",
        "invalid runtime namespace: " + source.namespace,
      );
    if (namespaces.has(source.module) || providers.has(source.namespace))
      return failure("runtime", "duplicate runtime module or namespace");
    namespaces.set(source.module, source.namespace);
    providers.add(source.namespace);
    roots.push(source.module);
  }
  const linkedProgram = linkLayout(
    modules,
    layoutSource,
    layoutEntry(entry, roots),
    runtime.globals,
    shared,
    shareRuntime,
  );
  if (!linkedProgram.ok) return failure("link", linkedProgram.error);
  const linkedExports = linkedProgram.exports;
  const helpers = new Map<string, string>();
  for (const exported of linkedExports) {
    if (exported === undefined) throw "surface export invariant";
    const namespace = namespaces.get(exported.module);
    if (namespace !== undefined && exported.namespace === "value")
      helpers.set(namespace + ":" + exported.name, exported.linkedName);
  }
  const bound = bindModule(linkedProgram.module, runtime.globals);
  if (!bound.ok) return failure("bind", bound.error.message);
  const constructors: NativeConstructor[] = [];
  for (const global of ["TextEncoder", "TextDecoder"]) {
    if (global === undefined) throw "surface constructor invariant";
    const factory = helpers.get("text-encoding:createNative" + global);
    if (factory !== undefined) constructors.push({ global, factory });
  }
  const normalized = prepareNativeGlobals(
    linkedProgram.module,
    bound.value,
    constructors,
  );
  if (!normalized.ok) return failure("globals", normalized.error);
  const rebound = bindModule(normalized.value, runtime.globals);
  if (!rebound.ok) return failure("bind", rebound.error.message);
  const max = runtime.maxSpecializations ?? 4096;
  const specialized = specializeModule(normalized.value, rebound.value, {
    maxSpecializations: max,
  });
  if (!specialized.ok) return failure("specialize", specialized.error.message);
  const checked = checkClosureModule(specialized.value.module);
  if (!checked.ok) return failure("check", checked.error.message);
  const runtimeSubjects: { name: string; alias: string; provider: number }[] =
    [];
  for (const anchor of anchors.value.anchors) {
    if (anchor === undefined) throw "surface runtime subject invariant";
    const exported = linkedExports.find(
      (item) =>
        item !== undefined &&
        item.module === layout &&
        item.name === anchor.name &&
        item.namespace === "value",
    );
    if (exported === undefined)
      return failure("layout", "runtime anchor export missing: " + anchor.name);
    runtimeSubjects.push({
      name: exported.linkedName,
      alias: anchor.alias,
      provider: anchor.provider,
    });
  }
  let runtimeNames: ManagedRuntimeNamePlan | undefined = undefined;
  const prepared = prepareCollectionRuntimes(
    normalized.value,
    checked.value,
    helpers,
    runtime.globals,
    (module, context) => {
      const names = resolveManagedRuntimeNames(context, census.value, {
        declarations: [],
        anchors: runtimeSubjects,
      });
      if (!names.ok) return names;
      runtimeNames = names.value;
      return { ok: true, value: module };
    },
    max,
  );
  if (!prepared.ok) return failure("runtime preparation", prepared.error);
  const graph = prepared.value.checked,
    functions = graph.bindings.functions.filter(
      (fn) => fn !== undefined && fn.parent === undefined,
    ),
    sources = new Map<string, number>();
  for (const binding of graph.bindings.bindings) {
    if (binding === undefined) throw "surface binding invariant";
    if (
      binding.kind !== "function" ||
      binding.scope !== 0 ||
      binding.owner !== undefined
    )
      continue;
    const fn = functions.find(
      (fn) => fn !== undefined && fn.node === binding.node,
    );
    if (fn !== undefined) sources.set(binding.name, fn.id);
  }
  function source(name: string): number | undefined {
    const exported = linkedExports.find(
      (item) =>
        item !== undefined &&
        item.module === layout &&
        item.name === name &&
        item.namespace === "value",
    );
    return exported === undefined
      ? undefined
      : sources.get(exported.linkedName);
  }
  const bindings: { function: number; operation: "identity" }[] = [];
  for (const identity of identities) {
    if (identity === undefined) throw "surface identity invariant";
    const id = source(identity.function);
    if (id === undefined)
      return failure("layout", "missing identity for " + identity.name);
    bindings.push({ function: id, operation: "identity" });
  }
  const lowered = lowerModuleEntries(
    graph,
    functions.map((fn) => fn.id),
    runtime.target ?? nativeTargetLayout,
    4096,
    { ...prepared.value.options, recordBindings: bindings, recordTypes: true },
  );
  if (!lowered.ok) return failure("layout lowering", lowered.error);
  const loweredModule = lowered.value;
  const selectedRuntimes = runtimeNames;
  if (selectedRuntimes === undefined)
    return failure("layout", "runtime selection missing");
  const runtimeFacts = materializeManagedRuntimeProviders(
    selectedRuntimes,
    (name: string) => {
      const id = sources.get(name),
        index = id === undefined ? -1 : loweredModule.entries.indexOf(id);
      const fn = index < 0 ? undefined : loweredModule.module.functions[index];
      if (fn === undefined) return undefined;
      const parameters: ScalarType[] = [];
      for (const slot of fn.parameters) {
        if (slot === undefined) throw "surface runtime parameter invariant";
        const type = fn.slots[slot];
        if (type === undefined) return undefined;
        parameters.push(type);
      }
      return { parameters, returnType: fn.returnType };
    },
  );
  if (!runtimeFacts.ok) return failure("runtime facts", runtimeFacts.error);
  function native(name: string): FunctionIR | undefined {
    const id = source(name),
      index = id === undefined ? -1 : loweredModule.entries.indexOf(id);
    return index < 0 ? undefined : loweredModule.module.functions[index];
  }
  const records: { alias: string; layout: RecordLayout }[] = [],
    signatures: {
      alias: string;
      parameters: readonly ScalarType[];
      returnType: ReturnType;
    }[] = [];
  for (const identity of identities) {
    if (identity === undefined) throw "surface identity invariant";
    const fn = native(identity.function);
    let record: number | undefined;
    for (const block of fn?.blocks ?? []) {
      if (block === undefined) throw "surface block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "surface instruction invariant";
        if (op.kind === "record-descriptor-address") record = op.record;
      }
    }
    const descriptor =
      record === undefined ? undefined : loweredModule.module.records?.[record];
    if (descriptor === undefined)
      return failure("layout", "no managed layout for " + identity.name);
    if (
      descriptor.fields.some(
        (field) => field !== undefined && field.stateOffset !== undefined,
      )
    )
      return failure(
        "layout",
        "environment record cannot be a surface layout: " + identity.name,
      );
    records.push({ alias: identity.name, layout: descriptor });
  }
  for (const witness of witnesses.value.entries) {
    if (witness === undefined) throw "surface witness invariant";
    const fn = native(witness.function);
    if (fn === undefined)
      return failure("layout", "missing signature for " + witness.name);
    const parameters: ScalarType[] = [];
    for (const slot of fn.parameters) {
      if (slot === undefined) throw "surface parameter invariant";
      const type = fn.slots[slot];
      if (type === undefined)
        return failure(
          "layout",
          "missing parameter encoding for " + witness.name,
        );
      parameters.push(type);
    }
    signatures.push({
      alias: witness.name,
      parameters,
      returnType: fn.returnType,
    });
  }
  return {
    ok: true,
    value: { records, signatures, runtimes: runtimeFacts.value },
  };
}
