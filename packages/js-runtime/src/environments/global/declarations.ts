import {
  hasBinding,
  createMutableBinding,
  createImmutableBinding,
} from "../records/index.ts";
import {
  hasRestrictedGlobalProperty,
  canDeclareGlobalVar,
  canDeclareGlobalFunction,
  createGlobalVarBinding,
  createGlobalFunctionBinding,
  type GlobalEnvironment,
} from "./record.ts";
export interface GlobalLexicalDeclaration {
  readonly name: string;
  readonly constant: boolean;
}
export interface GlobalFunctionDeclaration<Value> {
  readonly name: string;
  /** Internal function-object creation, not execution of the function body or user code. */
  readonly instantiate: () => Value;
}
/** Each list preserves source order. variables contains var-bound names;
 * functions contains all var-scoped function declarations, including duplicates.
 * Annex B block-function extensions must be handled separately by the frontend. */
export interface AnnexGlobalFunction {
  readonly name: string;
  /** Admission is determined during instantiation, before any Script executes. */
  admitted: boolean;
}
export interface GlobalDeclarations<Value> {
  readonly annexFunctions?: readonly AnnexGlobalFunction[];
  readonly lexical: readonly GlobalLexicalDeclaration[];
  readonly variables: readonly string[];
  readonly functions: readonly GlobalFunctionDeclaration<Value>[];
}
/** Return a conflicting name for the frontend to report as an early SyntaxError.
 * This validation is independent of the current realm's existing bindings. */
export function validateGlobalDeclarations<Value>(
  plan: GlobalDeclarations<Value>,
): string | undefined {
  const names = new Set<string>();
  for (const declaration of plan.lexical) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (names.has(declaration.name)) return declaration.name;
    names.add(declaration.name);
  }
  for (const name of plan.variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (names.has(name)) return name;
  }
  for (const declaration of plan.functions) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (names.has(declaration.name)) return declaration.name;
  }
  return undefined;
}
/** Instantiate an early-error-validated Script plan in an ordinary global environment.
 * Conflicts with prior Scripts are runtime errors. All admission checks precede
 * mutations; function factories run only after lexical bindings have been created. */
export function instantiateGlobalDeclarations<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  plan: GlobalDeclarations<Value>,
): "none" | "syntax" | "type" {
  for (const declaration of plan.lexical) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (
      hasBinding<Value>(record.lexical, declaration.name) ||
      hasRestrictedGlobalProperty<Key, Value>(record, declaration.name)
    )
      return "syntax";
  }
  for (const name of plan.variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (hasBinding<Value>(record.lexical, name)) return "syntax";
  }
  for (const declaration of plan.functions) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (hasBinding<Value>(record.lexical, declaration.name)) return "syntax";
  }
  const functionNames = new Set<string>(),
    functions: GlobalFunctionDeclaration<Value>[] = [];
  for (let i = plan.functions.length - 1; i >= 0; i--) {
    const declaration = plan.functions[i];
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (functionNames.has(declaration.name)) continue;
    if (!canDeclareGlobalFunction<Key, Value>(record, declaration.name))
      return "type";
    functionNames.add(declaration.name);
    functions.push(declaration);
  }
  const variableNames = new Set<string>(),
    variables: string[] = [];
  for (const name of plan.variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (functionNames.has(name)) continue;
    if (!canDeclareGlobalVar<Key, Value>(record, name)) return "type";
    if (!variableNames.has(name)) {
      variableNames.add(name);
      variables.push(name);
    }
  }
  // Web legacy functions introduce optional vars after all ordinary admission
  // checks, but before lexical/function/var bindings are instantiated.
  const declared = new Set<string>();
  for (const declaration of functions) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    declared.add(declaration.name);
  }
  for (const name of variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    declared.add(name);
  }
  for (const declaration of plan.annexFunctions ?? []) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    declaration.admitted = false;
    if (
      hasBinding<Value>(record.lexical, declaration.name) ||
      !canDeclareGlobalVar<Key, Value>(record, declaration.name)
    )
      continue;
    if (!declared.has(declaration.name)) {
      createGlobalVarBinding<Key, Value>(record, declaration.name, false);
      declared.add(declaration.name);
    }
    declaration.admitted = true;
  }
  for (const declaration of plan.lexical) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (declaration.constant)
      createImmutableBinding<Value>(record.lexical, declaration.name, true);
    else createMutableBinding<Value>(record.lexical, declaration.name, false);
  }
  for (let i = functions.length - 1; i >= 0; i--) {
    const declaration = functions[i];
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    const value = declaration.instantiate();
    if (
      createGlobalFunctionBinding<Key, Value>(
        record,
        declaration.name,
        value,
        false,
      ) !== "none"
    )
      return "type";
  }
  for (const name of variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (createGlobalVarBinding<Key, Value>(record, name, false) !== "none")
      return "type";
  }
  return "none";
}
