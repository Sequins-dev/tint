import {
  createStringIndex,
  createKeyIndex,
} from "@tint/foundation/collections/key-index";
import type { BoundModule } from "@tint/typescript/binding";
import {
  typeParameterCount,
  rewriteModule,
  syntaxHash,
  type Module,
  type Statement,
  type TypeNode,
  type PropertySignature,
  type ObjectProperty,
  type Binding,
  type Expression,
} from "@tint/typescript/syntax";

type FunctionDeclaration = Statement & { readonly kind: "function" };
export interface ModuleInstanceExport {
  readonly name: string;
  readonly local: string;
}
export interface ModuleInstance {
  readonly module: Module;
  readonly initializer: FunctionDeclaration;
  readonly exports: readonly string[];
}
export type ModuleInstanceResult =
  | { readonly ok: true; readonly value: ModuleInstance }
  | { readonly ok: false; readonly error: string };

/** Prepare one resolved, specialized module instance. Rebind and check the returned AST. */
export function prepareModuleInstance(
  module: Module,
  bound: BoundModule,
  exports: readonly ModuleInstanceExport[],
  retained: readonly string[] = [],
): ModuleInstanceResult {
  if (module.imports.length !== 0)
    return { ok: false, error: "module instance requires resolved imports" };
  if (
    exports.length === 0 ||
    new Set(exports.map((e) => e.name)).size !== exports.length
  )
    return {
      ok: false,
      error: "module instance requires distinct selected function exports",
    };
  const keep = createStringIndex<number>();
  for (const name of retained) {
    if (name === undefined) throw "retained name invariant";
    keep.set(name, 1);
  }
  const retainedStatements: Statement[] = [];
  const functions = new Map<string, FunctionDeclaration>();
  const names = createStringIndex<number>();
  const body: Statement[] = [],
    types: Statement[] = [];
  for (const statement of module.statements) {
    if (statement === undefined) throw "missing module statement";
    switch (statement.kind) {
      case "interface":
      case "type-alias":
        names.set(statement.name, 1);
        types.push(statement);
        break;
      case "function":
        if (keep.has(statement.name)) {
          names.set(statement.name, 1);
          types.push(statement);
          retainedStatements.push(statement);
          break;
        }
        if (typeParameterCount(statement.typeParameters) !== 0)
          return {
            ok: false,
            error: "module instance requires specialized functions",
          };
        if (functions.has(statement.name))
          return { ok: false, error: "duplicate module function" };
        functions.set(statement.name, statement);
        names.set(statement.name, 1);
        body.push({ ...statement, exported: false });
        break;
      case "variable": {
        const kept: Binding[] = [],
          moved: Binding[] = [];
        for (const declaration of statement.declarations) {
          if (declaration === undefined) throw "missing retained declaration";
          if (
            declaration.kind === "object-binding" ||
            declaration.kind === "array-binding"
          )
            return {
              ok: false,
              error: "typed binding patterns are not implemented",
            };
          names.set(declaration.name, 1);
          if (keep.has(declaration.name)) kept.push(declaration);
          else moved.push(declaration);
        }
        if (kept.length > 0) {
          const saved: Statement = { ...statement, declarations: kept };
          types.push(saved);
          retainedStatements.push(saved);
        }
        if (moved.length === 0) break;
        for (const binding of statement.declarations) {
          if (binding === undefined) throw "missing declaration";
          if (
            binding.kind === "object-binding" ||
            binding.kind === "array-binding"
          )
            return {
              ok: false,
              error: "typed binding patterns are not implemented",
            };
          names.set(binding.name, 1);
          if (binding.initializer === undefined)
            return {
              ok: false,
              error: "module instance declarations require initializers",
            };
        }
        body.push({ ...statement, declarations: moved, exported: false });
        break;
      }
      case "class":
        return {
          ok: false,
          error:
            "module instance classes require scoped contract and construction lowering",
        };
      case "expression":
      case "debugger":
      case "empty":
        body.push(statement);
        break;
      default:
        return {
          ok: false,
          error:
            "module instance requires declarations and expression statements after linking",
        };
    }
  }
  // Ownership follows the actual tree, not source coordinates. Generated nodes
  // may share positions/hashes or carry synthetic declaration-only spans.
  const retainedReferences = createKeyIndex<Expression, boolean>(syntaxHash);
  rewriteModule(
    { ...module, statements: retainedStatements },
    {
      expression: (node, original) => {
        retainedReferences.set(original, true);
        return node;
      },
    },
  );
  for (const reference of bound.references) {
    if (reference === undefined) throw "retained reference invariant";
    const bindingId = reference.binding;
    if (bindingId === undefined || !retainedReferences.has(reference.node))
      continue;
    const binding = bound.bindings[bindingId];
    if (
      binding !== undefined &&
      binding.owner === undefined &&
      !keep.has(binding.name)
    )
      return {
        ok: false,
        error:
          "retained declaration depends on instance state: " + binding.name,
      };
  }
  // Avoid capturing any previously unresolved source reference with the generated name.
  rewriteModule(module, {
    expression: (node, _original) => {
      if (node.kind === "identifier") names.set(node.name, 1);
      return node;
    },
  });
  let name = "__tint_initialize";
  while (names.has(name)) name += "_";
  const properties: PropertySignature[] = [],
    values: ObjectProperty[] = [];
  for (const selected of exports) {
    if (selected === undefined) throw "missing selected export";
    const name = selected.name,
      local = selected.local;
    const fn = functions.get(local);
    if (fn === undefined)
      return {
        ok: false,
        error: "selected module export must be a function declaration",
      };
    const binding = bound.bindings.find(
      (b) => b !== undefined && b.node === fn && b.owner === undefined,
    );
    if (binding === undefined)
      return { ok: false, error: "module instance binding graph mismatch" };
    if (
      bound.references.some(
        (r) =>
          r !== undefined && r.binding === binding.id && r.access !== "read",
      )
    )
      return {
        ok: false,
        error: "reassigned module exports require live binding accessors",
      };
    if (
      fn.parameters.some((p) => p === undefined || p.type === undefined) ||
      fn.returnType === undefined
    )
      return {
        ok: false,
        error:
          "module function exports require parameter and return annotations",
      };
    const returnType = fn.returnType;
    const type: TypeNode = {
      kind: "function",
      parameters: fn.parameters.map((p) => ({
        ...p,
        initializer: undefined,
        optional: p.optional === true || p.initializer !== undefined,
      })),
      returnType,
      start: fn.start,
      end: fn.end,
    };
    properties.push({
      name,
      readonly: true,
      optional: false,
      type,
      start: fn.start,
      end: fn.end,
    });
    values.push({
      name,
      shorthand: name === local,
      value: { kind: "identifier", name: local, start: fn.start, end: fn.end },
      start: fn.start,
      end: fn.end,
    });
  }
  body.push({
    kind: "return",
    expression: {
      kind: "object",
      properties: values,
      start: module.end,
      end: module.end,
    },
    start: module.end,
    end: module.end,
  });
  const initializer: FunctionDeclaration = {
    kind: "function",
    name,
    exported: true,
    parameters: [],
    returnType: {
      kind: "object",
      properties,
      start: module.start,
      end: module.end,
    },
    body: {
      kind: "block",
      statements: body,
      start: module.start,
      end: module.end,
    },
    start: module.start,
    end: module.end,
  };
  types.push(initializer);
  return {
    ok: true,
    value: {
      module: { ...module, statements: types },
      initializer,
      exports: exports.map((e) => e.name),
    },
  };
}
