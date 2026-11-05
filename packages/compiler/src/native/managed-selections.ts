import type { LinkedProgram } from "@tint/ts-native/modules";
import type { BoundModule } from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  createManagedSurfaceFactory,
  reifyManagedSurfaceTypes,
  type ManagedSurfaceFactory,
} from "./managed-surfaces.ts";
import type { Module, Statement, TypeNode } from "@tint/typescript/syntax";

export type ManagedSurfaceTypeArgument =
  | {
      readonly kind: "keyword";
      readonly name: "unknown" | "string" | "number" | "boolean" | "undefined";
    }
  | { readonly kind: "export"; readonly name: string };
export interface ManagedSurfaceSelection {
  readonly module: string;
  readonly name: string;
  readonly typeArguments: readonly ManagedSurfaceTypeArgument[];
}
export interface ManagedSurfaceSelectionPlan {
  readonly values: readonly {
    readonly name: string;
    readonly local: string;
    readonly root: number | undefined;
  }[];
  readonly types: readonly {
    readonly name: string;
    readonly local: string;
    readonly arguments: readonly TypeNode[];
  }[];
  /** IDs belong to this bound application; pass these roots to its own specialization pass. */
  readonly roots: readonly {
    readonly function: number;
    readonly arguments: readonly TypeNode[];
  }[];
}
export type ManagedSurfaceSelections =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedSurfaceSelectionPlan };
type Declaration = Statement & {
  readonly kind: "function" | "interface" | "type-alias";
};
/** Resolve exported contracts by namespace, never by import syntax or physical ABI.
 * This plans demand only: it neither copies helpers nor grants pointer authority. */
export function resolveManagedSurfaceSelections(
  linked: LinkedProgram,
  bound: BoundModule,
  values: readonly ManagedSurfaceSelection[],
  types: readonly ManagedSurfaceSelection[],
): ManagedSurfaceSelections {
  const reject = (error: string): ManagedSurfaceSelections => ({
    ok: false,
    error,
  });
  const typeDeclarations = new Map<string, Declaration>();
  const typeNames = new Map<string, string>();
  const valueDeclarations: Declaration[] = [];
  const names = new Set<string>();
  function resolve(
    selection: ManagedSurfaceSelection,
    namespace: "value" | "type",
  ): Declaration | undefined {
    const exported = linked.exports.find(
      (item) =>
        item !== undefined &&
        item.module === selection.module &&
        item.name === selection.name &&
        item.namespace === namespace,
    );
    if (exported === undefined) return undefined;
    const declaration = linked.module.statements.find(
      (statement) =>
        statement !== undefined &&
        (statement.kind === "function" ||
          statement.kind === "interface" ||
          statement.kind === "type-alias") &&
        statement.name === exported.linkedName,
    );
    if (
      declaration === undefined ||
      (declaration.kind !== "function" &&
        declaration.kind !== "interface" &&
        declaration.kind !== "type-alias")
    )
      return undefined;
    return declaration;
  }
  for (const selection of types) {
    if (
      selection === undefined ||
      selection.name.length === 0 ||
      selection.name.includes("\0")
    )
      return reject("invalid surface type name");
    if (typeDeclarations.has(selection.name))
      return reject("duplicate surface type name: " + selection.name);
    const declaration = resolve(selection, "type");
    if (declaration === undefined || declaration.kind === "function")
      return reject("missing surface type export: " + selection.name);
    if (
      (declaration.typeParameters?.length ?? 0) !==
      selection.typeArguments.length
    )
      return reject("surface type argument count: " + selection.name);
    typeDeclarations.set(selection.name, declaration);
    typeNames.set(selection.name, declaration.name);
  }
  for (const selection of values) {
    if (
      selection === undefined ||
      selection.name.length === 0 ||
      selection.name.includes("\0")
    )
      return reject("invalid surface value name");
    if (names.has(selection.name))
      return reject("duplicate surface value name: " + selection.name);
    names.add(selection.name);
    const exported = linked.exports.find(
      (item) =>
        item !== undefined &&
        item.module === selection.module &&
        item.name === selection.name &&
        item.namespace === "value",
    );
    if (exported === undefined)
      return reject("missing surface value export: " + selection.name);
    const declaration = resolve(selection, "value");
    if (declaration === undefined || declaration.kind !== "function")
      return reject(
        "surface value export must be a top-level function: " + selection.name,
      );
    if (
      (declaration.typeParameters?.length ?? 0) !==
      selection.typeArguments.length
    )
      return reject("surface value argument count: " + selection.name);
    valueDeclarations.push(declaration);
  }
  const roots: { function: number; arguments: readonly TypeNode[] }[] = [],
    resolvedValues: {
      name: string;
      local: string;
      root: number | undefined;
    }[] = [],
    resolvedTypes: {
      name: string;
      local: string;
      arguments: readonly TypeNode[];
    }[] = [];
  function argumentsFor(
    selection: ManagedSurfaceSelection,
  ):
    | { readonly ok: true; readonly value: readonly TypeNode[] }
    | { readonly ok: false; readonly error: string } {
    const arguments_: TypeNode[] = [];
    for (const argument of selection.typeArguments) {
      if (argument === undefined)
        return { ok: false, error: "missing surface type argument" };
      let name: string;
      if (argument.kind === "keyword") {
        name = argument.name;
        if (
          !["unknown", "string", "number", "boolean", "undefined"].includes(
            name,
          )
        )
          return { ok: false, error: "invalid surface keyword type argument" };
      } else {
        const declaration = typeDeclarations.get(argument.name),
          local = typeNames.get(argument.name);
        if (declaration === undefined || local === undefined)
          return {
            ok: false,
            error: "missing surface type argument export: " + argument.name,
          };
        if ((declaration.typeParameters?.length ?? 0) !== 0)
          return {
            ok: false,
            error:
              "surface type argument export must be nongeneric: " +
              argument.name,
          };
        name = local;
      }
      arguments_.push({ start: 0, end: 0, kind: "named", name });
    }
    return { ok: true, value: arguments_ };
  }
  for (let index = 0; index < values.length; index++) {
    const selection = values[index],
      declaration = valueDeclarations[index];
    if (selection === undefined || declaration === undefined)
      throw "surface selection invariant";
    const argumentsResult = argumentsFor(selection);
    if (!argumentsResult.ok) return reject(argumentsResult.error);
    const arguments_ = argumentsResult.value;
    let root: number | undefined;
    if (arguments_.length > 0) {
      const binding = bound.bindings.find(
        (binding) =>
          binding !== undefined &&
          binding.kind === "function" &&
          binding.owner === undefined &&
          binding.scope === 0 &&
          binding.name === declaration.name,
      );
      const fn = bound.functions.find(
        (fn) =>
          fn !== undefined &&
          fn.node === binding?.node &&
          fn.parent === undefined,
      );
      if (fn === undefined)
        return reject(
          "surface function is absent from application bindings: " +
            selection.name,
        );
      root = roots.length;
      roots.push({ function: fn.id, arguments: arguments_ });
    }
    resolvedValues.push({
      name: selection.name,
      local: declaration.name,
      root,
    });
  }
  for (const selection of types) {
    if (selection === undefined) throw "surface type selection invariant";
    const local = typeNames.get(selection.name);
    if (local === undefined) throw "surface type invariant";
    const argumentsResult = argumentsFor(selection);
    if (!argumentsResult.ok) return reject(argumentsResult.error);
    const arguments_ = argumentsResult.value;
    resolvedTypes.push({ name: selection.name, local, arguments: arguments_ });
  }
  return {
    ok: true,
    value: { values: resolvedValues, types: resolvedTypes, roots },
  };
}

/** Add concrete type roots and a table of existing application closures. The
 * caller has already specialized the application with plan.roots; never run a
 * separate helper specialization here, since it could duplicate module state. */
export function prepareManagedSurfaceTable(
  module: Module,
  plan: ManagedSurfaceSelectionPlan,
  roots: readonly string[],
  prefix: string,
  factory: string,
): ManagedSurfaceFactory {
  const reject = (error: string): ManagedSurfaceFactory => ({
    ok: false,
    error,
  });
  if (roots.length !== plan.roots.length)
    return reject("surface specialization root count mismatch");
  const statements: Statement[] = module.statements.slice(),
    values: { name: string; local: string }[] = [],
    types: { name: string; local: string }[] = [];
  for (const value of plan.values) {
    if (value === undefined) throw "surface value selection invariant";
    const local = value.root === undefined ? value.local : roots[value.root];
    if (local === undefined)
      return reject("missing surface specialization root: " + value.name);
    values.push({ name: value.name, local });
  }
  const names = new Set<string>();
  for (const statement of statements)
    if (
      statement !== undefined &&
      (statement.kind === "function" ||
        statement.kind === "type-alias" ||
        statement.kind === "interface" ||
        statement.kind === "class")
    )
      names.add(statement.name);
  for (let index = 0; index < plan.types.length; index++) {
    const selected = plan.types[index];
    if (selected === undefined) throw "surface type selection invariant";
    let local = prefix + "_inst_" + String(index);
    while (names.has(local)) local += "$";
    names.add(local);
    const type: TypeNode = {
      start: 0,
      end: 0,
      kind: "named",
      name: selected.local,
      arguments: selected.arguments,
    };
    statements.push({
      start: 0,
      end: 0,
      kind: "type-alias",
      name: local,
      type,
      exported: false,
    });
    types.push({ name: selected.name, local });
  }
  const checked = checkClosureModule({ ...module, statements });
  if (!checked.ok) return reject(checked.error.message);
  const surface = reifyManagedSurfaceTypes(
    checked.value,
    values,
    prefix,
    types,
  );
  if (!surface.ok) return surface;
  return createManagedSurfaceFactory(
    { checked: checked.value, surface: surface.value },
    factory,
  );
}
