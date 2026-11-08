import type { BoundModule } from "../binding/index.ts";
import type {
  Module,
  Span,
  ExportDeclaration,
  ExportBinding,
  Statement,
} from "../syntax/index.ts";
import type { SourceModule } from "./model.ts";
/** Semantic identities are opaque caller-owned keys, never runtime values or addresses. */
export interface ResolvedModuleExport {
  readonly module: string;
  readonly name: string;
  readonly namespace: ExportNamespace;
  readonly identity: string;
}
export interface ModuleExportState {
  readonly source: SourceModule;
  readonly values: ReadonlyMap<string, string>;
  readonly types: ReadonlyMap<string, string>;
  readonly exports: readonly ResolvedModuleExport[];
}
export interface ModuleExportNames {
  readonly values: ReadonlyMap<string, string>;
  readonly types: ReadonlyMap<string, string>;
}
/** Mutable collection state for callers that interleave declaration policy checks. */
export interface ModuleExportMetadata extends ModuleExportState {
  readonly values: Map<string, string>;
  readonly types: Map<string, string>;
  readonly exports: ResolvedModuleExport[];
}
/** Seed only real module-scope value bindings, excluding imported and nested names. */
export function createModuleExportMetadata(
  source: SourceModule,
  bound: BoundModule,
  names: ModuleExportNames,
  fail: (module: string, node: Span, message: string) => never,
): ModuleExportMetadata {
  const values = new Map<string, string>();
  for (const binding of bound.bindings) {
    if (binding === undefined) throw "module export binding invariant";
    if (binding.scope !== 0 || binding.kind === "import") continue;
    const identity = names.values.get(binding.name);
    if (identity === undefined)
      fail(
        source.id,
        binding.node,
        "missing module value identity: " + binding.name,
      );
    values.set(binding.name, identity);
  }
  return { source, values, types: new Map<string, string>(), exports: [] };
}
/** Collect one declaration after any caller-owned policy check, without evaluation. */
export function describeModuleExportDeclaration(
  state: ModuleExportMetadata,
  names: ModuleExportNames,
  statement: Statement,
  fail: (module: string, node: Span, message: string) => never,
): void {
  if (statement.kind === "class") {
    if (state.types.has(statement.name))
      fail(
        state.source.id,
        statement,
        "duplicate module type: " + statement.name,
      );
    const identity = state.values.get(statement.name);
    if (identity === undefined) throw "class name invariant";
    state.types.set(statement.name, identity);
    if (statement.exported) {
      state.exports.push({
        module: state.source.id,
        name: statement.name,
        namespace: "value",
        identity,
      });
      state.exports.push({
        module: state.source.id,
        name: statement.name,
        namespace: "type",
        identity,
      });
    }
  } else if (
    statement.kind === "interface" ||
    statement.kind === "type-alias"
  ) {
    if (state.types.has(statement.name))
      fail(
        state.source.id,
        statement,
        "duplicate module type: " + statement.name,
      );
    const identity = names.types.get(statement.name);
    if (identity === undefined)
      fail(
        state.source.id,
        statement,
        "missing module type identity: " + statement.name,
      );
    state.types.set(statement.name, identity);
    if (statement.exported)
      state.exports.push({
        module: state.source.id,
        name: statement.name,
        namespace: "type",
        identity,
      });
  } else if (statement.kind === "function") {
    const identity = state.values.get(statement.name);
    if (identity === undefined) throw "function name invariant";
    if (statement.exported)
      state.exports.push({
        module: state.source.id,
        name: statement.name,
        namespace: "value",
        identity,
      });
  } else if (statement.kind === "variable") {
    for (const declaration of statement.declarations) {
      if (declaration === undefined) throw "missing declaration";
      if (
        declaration.kind === "object-binding" ||
        declaration.kind === "array-binding"
      )
        fail(
          state.source.id,
          declaration,
          "typed binding patterns are not implemented",
        );
      const identity = state.values.get(declaration.name);
      if (identity === undefined) throw "constant name invariant";
      if (statement.exported)
        state.exports.push({
          module: state.source.id,
          name: declaration.name,
          namespace: "value",
          identity,
        });
    }
  }
}
/** Describe bound declarations using explicit caller identities; no native preparation. */
export function describeModuleExports(
  source: SourceModule,
  bound: BoundModule,
  names: ModuleExportNames,
  fail: (module: string, node: Span, message: string) => never,
): ModuleExportState {
  const state = createModuleExportMetadata(source, bound, names, fail);
  for (const statement of source.module.statements) {
    if (statement === undefined) throw "missing statement";
    describeModuleExportDeclaration(state, names, statement, fail);
  }
  return state;
}

export type ExportNamespace = "value" | "type";
const ambiguous: false = false;
type Resolution = string | false | undefined;
/** Resolve identities, not copied values. Cycles terminate at repeated resolve pairs. */
export function resolveModuleExports(
  states: ReadonlyMap<string, ModuleExportState>,
  fail: (module: string, node: Span, message: string) => never,
): ReadonlyMap<string, readonly ResolvedModuleExport[]> {
  const result = new Map<string, ResolvedModuleExport[]>();
  let work = 0;
  // Every exported name is resolved, so per-call scans of a module's
  // statements or explicit exports would make resolution quadratic.
  const declarationLists = new Map<Module, readonly ExportDeclaration[]>(),
    explicitExports = new Map<
      ModuleExportState,
      {
        readonly value: Map<string, string>;
        readonly type: Map<string, string>;
      }
    >();
  function declarations(module: Module): readonly ExportDeclaration[] {
    const known = declarationLists.get(module);
    if (known !== undefined) return known;
    const result: ExportDeclaration[] = [];
    for (const statement of module.statements) {
      if (statement === undefined) throw "module statement invariant";
      if (statement.kind === "export") result.push(statement.declaration);
    }
    declarationLists.set(module, result);
    return result;
  }
  /** The first explicit export of `name`, as a linear search would find it. */
  function explicitExport(
    state: ModuleExportState,
    name: string,
    namespace: ExportNamespace,
  ): string | undefined {
    let index = explicitExports.get(state);
    if (index === undefined) {
      const created = {
        value: new Map<string, string>(),
        type: new Map<string, string>(),
      };
      for (const item of state.exports) {
        if (item === undefined) throw "export invariant";
        const names = item.namespace === "value" ? created.value : created.type;
        if (!names.has(item.name)) names.set(item.name, item.identity);
      }
      explicitExports.set(state, created);
      index = created;
    }
    return (namespace === "value" ? index.value : index.type).get(name);
  }
  function dependency(
    state: ModuleExportState,
    specifier: string,
  ): ModuleExportState {
    const id = state.source.dependencies.get(specifier);
    const target = id === undefined ? undefined : states.get(id);
    if (target === undefined)
      return fail(
        state.source.id,
        state.source.module,
        "unresolved export module: " + specifier,
      );
    return target;
  }
  function binding(
    state: ModuleExportState,
    declaration: ExportDeclaration,
    item: ExportBinding,
    namespace: ExportNamespace,
    path: ReadonlySet<string>,
  ): Resolution {
    if (namespace === "value" && (declaration.typeOnly || item.typeOnly))
      return undefined;
    if (item.namespace)
      return fail(
        state.source.id,
        declaration,
        "namespace exports require module namespace objects",
      );
    if (declaration.source !== undefined)
      return resolve(
        dependency(state, declaration.source.specifier),
        item.local,
        namespace,
        path,
      );
    const own = (namespace === "value" ? state.values : state.types).get(
      item.local,
    );
    if (own !== undefined) return own;
    for (const imp of state.source.module.imports) {
      if (imp === undefined) throw "import invariant";
      const imported = imp.bindings.find(
        (b) => b !== undefined && b.local === item.local,
      );
      if (imported === undefined) continue;
      if (namespace === "value" && (imp.typeOnly || imported.typeOnly))
        return undefined;
      if (imported.namespace)
        return fail(
          state.source.id,
          declaration,
          "namespace exports require module namespace objects",
        );
      return resolve(
        dependency(state, imp.specifier),
        imported.imported,
        namespace,
        path,
      );
    }
    return undefined;
  }
  function resolve(
    state: ModuleExportState,
    name: string,
    namespace: ExportNamespace,
    path: ReadonlySet<string>,
  ): Resolution {
    if (++work > 1000000)
      return fail(
        state.source.id,
        state.source.module,
        "export resolution work limit exceeded",
      );
    const key =
      state.source.id.length +
      ":" +
      state.source.id +
      ":" +
      namespace +
      ":" +
      name;
    if (path.has(key)) return undefined;
    if (path.size >= 256)
      return fail(
        state.source.id,
        state.source.module,
        "export resolution depth exceeded",
      );
    const next = new Set(path);
    next.add(key);
    let explicit: Resolution = explicitExport(state, name, namespace);
    for (const declaration of declarations(state.source.module)) {
      if (declaration === undefined) throw "export declaration invariant";
      for (const item of declaration.bindings ?? []) {
        if (item === undefined) throw "export binding invariant";
        if (item.exported !== name) continue;
        const candidate = binding(state, declaration, item, namespace, next);
        if (candidate === undefined) continue;
        if (explicit !== undefined)
          return fail(
            state.source.id,
            declaration,
            "duplicate export: " + name,
          );
        explicit = candidate;
      }
    }
    if (explicit !== undefined) return explicit;
    if (name === "default") return undefined;
    let found: Resolution;
    for (const declaration of declarations(state.source.module)) {
      if (declaration === undefined) throw "export declaration invariant";
      if (
        declaration.bindings !== undefined ||
        declaration.source === undefined ||
        (namespace === "value" && declaration.typeOnly)
      )
        continue;
      const candidate = resolve(
        dependency(state, declaration.source.specifier),
        name,
        namespace,
        next,
      );
      if (
        candidate === ambiguous ||
        (candidate !== undefined && found !== undefined && candidate !== found)
      )
        return ambiguous;
      if (candidate !== undefined) found = candidate;
    }
    return found;
  }
  function collectNames(
    state: ModuleExportState,
    names: Set<string>,
    seen: Set<string>,
    includeDefault: boolean,
    depth: number,
  ): void {
    if (seen.has(state.source.id)) return;
    if (depth >= 256)
      fail(
        state.source.id,
        state.source.module,
        "export resolution depth exceeded",
      );
    seen.add(state.source.id);
    for (const item of state.exports) {
      if (item === undefined) throw "export invariant";
      if (includeDefault || item.name !== "default") names.add(item.name);
    }
    for (const declaration of declarations(state.source.module)) {
      if (declaration === undefined) throw "export declaration invariant";
      if (declaration.bindings !== undefined) {
        for (const item of declaration.bindings) {
          if (item === undefined) throw "export binding invariant";
          if (includeDefault || item.exported !== "default")
            names.add(item.exported);
        }
      } else if (declaration.source !== undefined) {
        collectNames(
          dependency(state, declaration.source.specifier),
          names,
          seen,
          false,
          depth + 1,
        );
      }
    }
  }
  for (const [id, state] of states) {
    const exports: ResolvedModuleExport[] = [];
    const names = new Set<string>();
    collectNames(state, names, new Set<string>(), true, 0);
    const namespaces: readonly ExportNamespace[] = ["value", "type"];
    for (const name of names)
      for (const namespace of namespaces) {
        if (namespace === undefined) throw "namespace invariant";
        const resolved = resolve(state, name, namespace, new Set<string>());
        if (typeof resolved === "string")
          exports.push({
            module: state.source.id,
            name,
            namespace,
            identity: resolved,
          });
      }
    result.set(state.source.id, exports);
  }
  // Explicit clauses must resolve even when nobody imports them. Ambiguous star names
  // are absent from the namespace; importing or explicitly forwarding one is an error.
  for (const [id, state] of states)
    for (const declaration of declarations(state.source.module)) {
      if (declaration === undefined) throw "export declaration invariant";
      for (const item of declaration.bindings ?? []) {
        if (item === undefined) throw "export binding invariant";
        const value = binding(
          state,
          declaration,
          item,
          "value",
          new Set<string>(),
        );
        const type = binding(
          state,
          declaration,
          item,
          "type",
          new Set<string>(),
        );
        if (value === ambiguous || type === ambiguous)
          fail(state.source.id, declaration, "ambiguous export: " + item.local);
        if (value === undefined && type === undefined)
          fail(state.source.id, declaration, "missing export: " + item.local);
      }
    }
  return result;
}
