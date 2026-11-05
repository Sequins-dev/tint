import {
  bindingIdentifiers,
  rewriteModule,
  type Module,
  type TypeNode,
  type Statement,
  type Expression,
  type IdentifierParameter,
} from "@tint/typescript/syntax";
import {
  generatedIdentifier,
  managedSurfaceFactoryDeclaration,
  type ManagedSurfaceTypeDescription,
  type ManagedSurfaceTypeEntry,
} from "./managed-surfaces.ts";
import type { ManagedSurfaceSelectionPlan } from "./managed-selections.ts";
export interface ManagedSurfaceAnchorEntry {
  readonly name: string;
  readonly local: string;
  readonly anchor: string | undefined;
}
export type ManagedSurfaceAnchorCreation =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: {
        readonly module: Module;
        readonly entries: readonly ManagedSurfaceAnchorEntry[];
      };
    };
export type ManagedSurfaceAnchorResolution =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: readonly ManagedSurfaceTypeEntry[] };
/** Demand through ordinary nongeneric functions, so every collection-runtime
 * specialization pass rediscovers the same application instances. These anchors
 * are compile-time scaffolding; remove them after resolving the final table. */
export function createManagedSurfaceAnchors(
  module: Module,
  plan: ManagedSurfaceSelectionPlan,
  surface: ManagedSurfaceTypeDescription,
  prefix: string,
): ManagedSurfaceAnchorCreation {
  const failure = (error: string): ManagedSurfaceAnchorCreation => ({
    ok: false,
    error,
  });
  if (!generatedIdentifier(prefix))
    return failure("surface anchor prefix must be a generated identifier");
  if (module.imports.length !== 0)
    return failure("surface anchors require a linked module");
  if (plan.values.length !== surface.entries.length)
    return failure("surface anchor helper count mismatch");
  const names = new Set<string>(),
    aliases = new Map<string, TypeNode>(),
    statements: Statement[] = module.statements.slice(),
    entries: ManagedSurfaceAnchorEntry[] = [];
  for (const statement of statements) {
    if (statement === undefined) throw "surface anchor statement invariant";
    if (
      statement.kind === "function" ||
      statement.kind === "interface" ||
      statement.kind === "type-alias" ||
      statement.kind === "class"
    )
      names.add(statement.name);
    if (statement.kind === "variable")
      for (const declaration of statement.declarations) {
        if (declaration === undefined)
          throw "surface anchor declaration invariant";
        for (const identifier of bindingIdentifiers(declaration)) {
          if (identifier === undefined)
            throw "surface anchor binding invariant";
          names.add(identifier.name);
        }
      }
  }
  rewriteModule(module, {
    expression: (node, original) => {
      if (original.kind === "identifier") names.add(original.name);
      return node;
    },
  });
  for (const declaration of surface.declarations) {
    if (
      declaration === undefined ||
      declaration.kind !== "type-alias" ||
      (declaration.typeParameters?.length ?? 0) !== 0
    )
      return failure("surface anchors require concrete reified aliases");
    if (names.has(declaration.name))
      return failure(
        "surface anchor type collides with application: " + declaration.name,
      );
    names.add(declaration.name);
    aliases.set(declaration.name, declaration.type);
    statements.push(declaration);
  }
  function resolve(type: TypeNode): TypeNode | undefined {
    const seen = new Set<string>();
    let result = type;
    for (;;) {
      if (result.kind === "group") {
        result = result.type;
        continue;
      }
      if (result.kind !== "named") return result;
      const alias = aliases.get(result.name);
      if (alias === undefined) return result;
      if ((result.arguments?.length ?? 0) !== 0 || seen.has(result.name))
        return undefined;
      seen.add(result.name);
      result = alias;
    }
  }
  for (let index = 0; index < plan.values.length; index++) {
    const value = plan.values[index],
      description = surface.entries[index];
    if (value === undefined || description === undefined)
      throw "surface anchor selection invariant";
    if (value.name !== description.name)
      return failure("surface anchor helper order mismatch");
    if (value.root === undefined) {
      entries.push({ name: value.name, local: value.local, anchor: undefined });
      continue;
    }
    const root = plan.roots[value.root],
      type = resolve(description.type);
    if (root === undefined)
      return failure("missing surface generic root: " + value.name);
    if (
      type === undefined ||
      type.kind !== "function" ||
      type.async ||
      type.receiver !== undefined
    )
      return failure(
        "surface anchor requires a synchronous receiver-free function: " +
          value.name,
      );
    let name = prefix + "_anchor_" + String(index);
    while (names.has(name)) name += "$";
    names.add(name);
    const parameters: IdentifierParameter[] = [],
      arguments_: Expression[] = [];
    for (const parameter of type.parameters) {
      if (
        parameter === undefined ||
        parameter.kind === "pattern-parameter" ||
        parameter.rest ||
        parameter.initializer !== undefined
      )
        return failure("surface anchor parameters must be concrete bindings");
      parameters.push({ ...parameter });
      arguments_.push({
        start: 0,
        end: 0,
        kind: "identifier",
        name: parameter.name,
      });
    }
    const call: Expression = {
      start: 0,
      end: 0,
      kind: "call",
      callee: { start: 0, end: 0, kind: "identifier", name: value.local },
      typeArguments: root.arguments,
      arguments: arguments_,
    };
    const result = resolve(type.returnType);
    if (result === undefined)
      return failure("invalid surface anchor result alias");
    const noValue =
      result.kind === "named" &&
      (result.name === "void" || result.name === "never");
    const body: Statement[] = noValue
      ? [{ start: 0, end: 0, kind: "expression", expression: call }]
      : [{ start: 0, end: 0, kind: "return", expression: call }];
    if (result.kind === "named" && result.name === "never")
      body.push({
        start: 0,
        end: 0,
        kind: "throw",
        expression: {
          start: 0,
          end: 0,
          kind: "string",
          value: "MANAGED_SURFACE_ANCHOR_UNREACHABLE",
        },
      });
    statements.push({
      start: 0,
      end: 0,
      kind: "function",
      name,
      exported: false,
      parameters,
      returnType: type.returnType,
      body: { start: 0, end: 0, kind: "block", statements: body },
    });
    entries.push({ name: value.name, local: value.local, anchor: name });
  }
  return { ok: true, value: { module: { ...module, statements }, entries } };
}
/** Resolve from each pass's actual rewritten call, never from earlier temporary
 * instance names or source-function IDs. The caller removes these declarations. */
export function resolveManagedSurfaceAnchors(
  module: Module,
  entries: readonly ManagedSurfaceAnchorEntry[],
): ManagedSurfaceAnchorResolution {
  const result: ManagedSurfaceTypeEntry[] = [];
  for (const entry of entries) {
    if (entry === undefined) throw "surface anchor entry invariant";
    if (entry.anchor === undefined) {
      result.push({ name: entry.name, local: entry.local });
      continue;
    }
    const name = entry.anchor,
      anchor = module.statements.find(
        (statement) =>
          statement !== undefined &&
          statement.kind === "function" &&
          statement.name === name,
      );
    if (anchor === undefined || anchor.kind !== "function")
      return { ok: false, error: "missing surface anchor: " + name };
    const body = anchor.body;
    if (body.kind !== "block")
      return {
        ok: false,
        error: "surface anchor must have a block body: " + name,
      };
    const first = body.statements[0];
    let expression: Expression | undefined = undefined;
    if (first !== undefined) {
      if (first.kind === "return") expression = first.expression;
      else if (first.kind === "expression") expression = first.expression;
    }
    if (
      expression === undefined ||
      expression.kind !== "call" ||
      (expression.typeArguments?.length ?? 0) !== 0
    )
      return {
        ok: false,
        error: "surface anchor has not been specialized: " + name,
      };
    const callee = expression.callee;
    if (callee.kind !== "identifier" || callee.name === entry.local)
      return {
        ok: false,
        error: "surface anchor has not been specialized: " + name,
      };
    result.push({ name: entry.name, local: callee.name });
  }
  return { ok: true, value: result };
}

export type ManagedSurfaceTableMaterialization =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: { readonly module: Module; readonly factory: string };
    };
/** Run inside the collection-runtime transform, after its final specialization.
 * Only syntax is composed here; the transform's normal check validates it. Each
 * invocation starts from its input, so runtime-demand retries cannot accumulate
 * tables or capture instance names from an earlier pass. */
export function materializeManagedSurfaceTable(
  module: Module,
  entries: readonly ManagedSurfaceAnchorEntry[],
  surface: ManagedSurfaceTypeDescription,
  factory: string,
  forwarded: ReadonlyMap<string, string> = new Map<string, string>(),
): ManagedSurfaceTableMaterialization {
  if (module.imports.length !== 0)
    return { ok: false, error: "surface tables require a linked module" };
  if (entries.length !== surface.entries.length)
    return { ok: false, error: "surface table helper count mismatch" };
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index],
      description = surface.entries[index];
    if (entry === undefined || description === undefined)
      throw "surface table entry invariant";
    if (entry.name !== description.name)
      return { ok: false, error: "surface table helper order mismatch" };
  }
  const resolved = resolveManagedSurfaceAnchors(module, entries);
  if (!resolved.ok) return resolved;
  const names = new Set<string>(),
    anchors = new Set<string>();
  for (const entry of entries) {
    if (entry === undefined) throw "surface table anchor invariant";
    const anchor = entry.anchor;
    if (anchor !== undefined) {
      if (anchors.has(anchor))
        return { ok: false, error: "duplicate surface table anchor" };
      anchors.add(anchor);
    }
  }
  for (const statement of module.statements) {
    if (statement === undefined) throw "surface table statement invariant";
    if (
      statement.kind === "function" ||
      statement.kind === "interface" ||
      statement.kind === "type-alias" ||
      statement.kind === "class"
    )
      names.add(statement.name);
    if (statement.kind === "variable")
      for (const declaration of statement.declarations) {
        if (declaration === undefined)
          throw "surface table declaration invariant";
        for (const identifier of bindingIdentifiers(declaration)) {
          if (identifier === undefined) throw "surface table binding invariant";
          names.add(identifier.name);
        }
      }
  }
  rewriteModule(module, {
    expression: (node, original) => {
      if (original.kind === "identifier") names.add(original.name);
      return node;
    },
  });
  if (names.has(factory))
    return {
      ok: false,
      error: "surface table factory collides with application",
    };
  const descriptions: {
    readonly name: string;
    readonly local: string;
    readonly type: TypeNode;
  }[] = [];
  for (let index = 0; index < resolved.value.length; index++) {
    const entry = resolved.value[index],
      description = surface.entries[index];
    if (entry === undefined || description === undefined)
      throw "surface table helper invariant";
    const local = entry.local;
    if (
      anchors.has(local) ||
      !module.statements.some(
        (statement) =>
          statement !== undefined &&
          statement.kind === "function" &&
          statement.name === local,
      )
    )
      return {
        ok: false,
        error: "surface table helper is not a concrete function: " + local,
      };
    descriptions.push({ ...description, local: forwarded.get(local) ?? local });
  }
  const declaration = managedSurfaceFactoryDeclaration(
    { ...surface, entries: descriptions },
    factory,
  );
  if (!declaration.ok) return declaration;
  const statements = module.statements.filter(
    (statement) =>
      statement === undefined ||
      statement.kind !== "function" ||
      !anchors.has(statement.name),
  );
  statements.push(declaration.value);
  return { ok: true, value: { module: { ...module, statements }, factory } };
}
