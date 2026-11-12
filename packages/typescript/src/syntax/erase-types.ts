import type {
  ExportBinding,
  Expression,
  ImportBinding,
  Module,
  Statement,
} from "./model.ts";
import { bindingIdentifiers } from "./bindings.ts";
import { rewriteModule } from "./rewrite.ts";

/** Top-level names a module declares only as types (interfaces and type
 * aliases without a value declaration of the same name). Exports of these
 * names have no runtime binding. */
export function typeOnlyDeclarations(module: Module): Set<string> {
  const types = new Set<string>(),
    values = new Set<string>();
  for (const statement of module.statements) {
    if (statement === undefined) throw "type erasure statement invariant";
    switch (statement.kind) {
      case "interface":
      case "type-alias":
        types.add(statement.name);
        break;
      case "function":
      case "class":
        values.add(statement.name);
        break;
      case "variable":
        for (const declaration of statement.declarations) {
          if (declaration === undefined) throw "type erasure binding invariant";
          for (const identifier of bindingIdentifiers(declaration))
            if (identifier !== undefined) values.add(identifier.name);
        }
        break;
      case "import":
        for (const binding of statement.declaration.bindings)
          if (binding !== undefined && !binding.typeOnly)
            values.add(binding.local);
        break;
      default:
        break;
    }
  }
  const result = new Set<string>();
  for (const name of types) if (!values.has(name)) result.add(name);
  return result;
}

export interface TypeErasureOptions {
  /** True when the module that `specifier` resolves to exports `name` only
   * as a type. Unknown modules return false: the binding is kept. */
  readonly typeExport?: (specifier: string, name: string) => boolean;
}

/** Erases TypeScript-only syntax, leaving a JavaScript module with the same
 * runtime semantics as TypeScript's emit: interfaces and type aliases are
 * removed, `satisfies` keeps its operand, type-only imports and exports are
 * dropped, and import bindings used only as types are elided (an import
 * declaration whose bindings are all elided is removed, as TypeScript does).
 * Annotations, type parameters and type arguments remain on the syntax; the
 * general lowering does not read them. */
export function eraseTypeSyntax(
  module: Module,
  options: TypeErasureOptions = {},
): Module {
  const referenced = new Set<string>();
  // Value references: every identifier expression. Shadowing makes this
  // conservative (an import may be kept when only a shadowing local is
  // used), which TypeScript also does for names it cannot resolve.
  rewriteModule(module, {
    expression: (mapped: Expression, original: Expression): Expression => {
      if (mapped.kind === "identifier") referenced.add(mapped.name);
      return mapped;
    },
  });
  for (const statement of module.statements) {
    if (statement === undefined) throw "type erasure statement invariant";
    if (
      statement.kind === "export" &&
      statement.declaration.source === undefined
    )
      for (const binding of statement.declaration.bindings ?? [])
        if (binding !== undefined && !binding.typeOnly)
          referenced.add(binding.local);
    if (statement.kind === "export-default" && !statement.declaration) {
      const value = statement.value;
      if (value.kind === "identifier") referenced.add(value.name);
    }
  }
  const localTypes = typeOnlyDeclarations(module),
    elided = new Set<string>();
  const typeExport = options.typeExport;
  function typeImport(specifier: string, binding: ImportBinding): boolean {
    return (
      binding.typeOnly ||
      !referenced.has(binding.local) ||
      (!binding.namespace &&
        typeExport !== undefined &&
        typeExport(specifier, binding.imported))
    );
  }
  for (const statement of module.statements) {
    if (statement === undefined || statement.kind !== "import") continue;
    const declaration = statement.declaration;
    for (const binding of declaration.bindings)
      if (
        binding !== undefined &&
        (declaration.typeOnly || typeImport(declaration.specifier, binding))
      )
        elided.add(binding.local);
  }
  return rewriteModule(module, {
    expression: (mapped: Expression, original: Expression): Expression =>
      mapped.kind === "satisfies" ? mapped.expression : mapped,
    statement: (mapped: Statement, original: Statement): Statement => {
      const empty: Statement = {
        kind: "empty",
        start: mapped.start,
        end: mapped.end,
      };
      switch (mapped.kind) {
        case "interface":
        case "type-alias":
          return empty;
        case "import": {
          const declaration = mapped.declaration;
          if (declaration.typeOnly) return empty;
          if (declaration.bindings.length === 0) return mapped;
          const kept: ImportBinding[] = [];
          for (const binding of declaration.bindings) {
            if (binding === undefined) throw "type erasure import invariant";
            if (!elided.has(binding.local)) kept.push(binding);
          }
          if (kept.length === 0) return empty;
          if (kept.length === declaration.bindings.length) return mapped;
          return {
            ...mapped,
            declaration: { ...declaration, bindings: kept },
          };
        }
        case "export": {
          const declaration = mapped.declaration;
          if (declaration.typeOnly) return empty;
          const bindings = declaration.bindings;
          if (bindings === undefined) return mapped;
          const source = declaration.source;
          const kept: ExportBinding[] = [];
          for (const binding of bindings) {
            if (binding === undefined) throw "type erasure export invariant";
            const typeBinding =
              binding.typeOnly ||
              (source === undefined
                ? localTypes.has(binding.local) || elided.has(binding.local)
                : !binding.namespace &&
                  typeExport !== undefined &&
                  typeExport(source.specifier, binding.local));
            if (!typeBinding) kept.push(binding);
          }
          if (kept.length === bindings.length) return mapped;
          if (kept.length === 0 && bindings.length !== 0) return empty;
          return {
            ...mapped,
            declaration: { ...declaration, bindings: kept },
          };
        }
        default:
          return mapped;
      }
    },
  });
}
