import {
  hasBinding,
  createMutableBinding,
  createImmutableBinding,
  initializeBinding,
  setMutableBinding,
  type DeclarativeEnvironment,
} from "../records/index.ts";
import {
  canDeclareGlobalFunction,
  canDeclareGlobalVar,
  createGlobalFunctionBinding,
  createGlobalVarBinding,
  type GlobalEnvironment,
} from "./record.ts";
import type {
  GlobalDeclarations,
  GlobalFunctionDeclaration,
  GlobalLexicalDeclaration,
  AnnexGlobalFunction,
} from "./declarations.ts";
import type { EnvironmentScope } from "./scope.ts";
import type { DirectEvalCatch } from "./direct-eval.ts";

function createEvalLexicals<Value>(
  lexical: DeclarativeEnvironment<Value>,
  declarations: readonly GlobalLexicalDeclaration[],
): void {
  for (const declaration of declarations) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (declaration.constant)
      createImmutableBinding<Value>(lexical, declaration.name, true);
    else createMutableBinding<Value>(lexical, declaration.name, false);
  }
}

/** EvalDeclarationInstantiation for a global variable environment (sloppy eval)
 * or a fresh declarative variable environment (strict eval). The frontend must
 * validate within-source early errors and filter Annex B candidates beforehand.
 * Direct eval's intervening lexical environments require a separate admission
 * walk before calling this global-environment slice.
 * https://tc39.es/ecma262/#sec-evaldeclarationinstantiation */
export function instantiateEvalDeclarations<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  lexical: DeclarativeEnvironment<Value>,
  plan: GlobalDeclarations<Value>,
  strict: boolean,
): "none" | "syntax" | "type" {
  if (strict && (plan.annexFunctions?.length ?? 0) !== 0)
    throw "DECLARATION_INVARIANT";
  if (!strict) {
    for (const name of plan.variables) {
      if (name === undefined) throw "DECLARATION_INVARIANT";
      if (hasBinding<Value>(record.lexical, name)) return "syntax";
    }
    for (const declaration of plan.functions) {
      if (declaration === undefined) throw "DECLARATION_INVARIANT";
      if (hasBinding<Value>(record.lexical, declaration.name)) return "syntax";
    }
  }
  const functionNames = new Set<string>(),
    functions: GlobalFunctionDeclaration<Value>[] = [];
  for (let index = plan.functions.length - 1; index >= 0; index--) {
    const declaration = plan.functions[index];
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (functionNames.has(declaration.name)) continue;
    if (
      !strict &&
      !canDeclareGlobalFunction<Key, Value>(record, declaration.name)
    )
      return "type";
    functionNames.add(declaration.name);
    functions.push(declaration);
  }
  const variableNames = new Set<string>(),
    variables: string[] = [];
  for (const name of plan.variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (functionNames.has(name)) continue;
    if (!strict && !canDeclareGlobalVar<Key, Value>(record, name))
      return "type";
    if (!variableNames.has(name)) {
      variableNames.add(name);
      variables.push(name);
    }
  }
  if (!strict) {
    const declared = new Set<string>();
    for (const name of functionNames) {
      if (name === undefined) throw "DECLARATION_INVARIANT";
      declared.add(name);
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
        if (
          createGlobalVarBinding<Key, Value>(record, declaration.name, true) !==
          "none"
        )
          return "type";
        declared.add(declaration.name);
      }
      declaration.admitted = true;
    }
  }
  createEvalLexicals<Value>(lexical, plan.lexical);
  for (let index = functions.length - 1; index >= 0; index--) {
    const declaration = functions[index];
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    const value = declaration.instantiate();
    if (!strict) {
      if (
        createGlobalFunctionBinding<Key, Value>(
          record,
          declaration.name,
          value,
          true,
        ) !== "none"
      )
        return "type";
    } else if (hasBinding<Value>(lexical, declaration.name)) {
      if (
        setMutableBinding<Value>(lexical, declaration.name, value, false) !==
        "none"
      )
        throw "DECLARATION_INVARIANT";
    } else {
      createMutableBinding<Value>(lexical, declaration.name, true);
      initializeBinding<Value>(lexical, declaration.name, value);
    }
  }
  for (const name of variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (!strict) {
      if (createGlobalVarBinding<Key, Value>(record, name, true) !== "none")
        return "type";
    } else if (!hasBinding<Value>(lexical, name)) {
      createMutableBinding<Value>(lexical, name, true);
      initializeBinding<Value>(lexical, name, lexical.undefinedValue);
    }
  }
  return "none";
}

function catchRecord<Value>(
  record: DeclarativeEnvironment<Value>,
  catches: DirectEvalCatch<Value> | undefined,
): boolean {
  let cursor = catches;
  while (cursor !== undefined) {
    if (cursor.record === record) return true;
    cursor = cursor.outer;
  }
  return false;
}
/** Undefined name validates the variable boundary without testing bindings. */
function interveningEvalBinding<Key, Value>(
  lexical: EnvironmentScope<Key, Value>,
  variables: EnvironmentScope<Key, Value>,
  catches: DirectEvalCatch<Value> | undefined,
  name: string | undefined,
): boolean {
  let cursor = lexical.outer;
  const bindingName = name;
  const target = variables.declarative;
  while (cursor !== undefined) {
    const record = cursor.declarative;
    if (cursor.object === undefined && record === undefined) {
      if (target === undefined) return false;
      throw "DIRECT_EVAL_ENVIRONMENT_INVARIANT";
    }
    if (target !== undefined && record === target) return false;
    if (
      record !== undefined &&
      bindingName !== undefined &&
      !catchRecord<Value>(record, catches) &&
      hasBinding<Value>(record, bindingName)
    )
      return true;
    cursor = cursor.outer;
  }
  throw "DIRECT_EVAL_ENVIRONMENT_INVARIANT";
}

/** Direct EvalDeclarationInstantiation. The caller supplies the fresh lexical
 * scope, the running variable environment and Catch-clause exemptions. Source
 * early errors are checked by the frontend before any runtime mutation. */
export function instantiateDirectEvalDeclarations<Key, Value>(
  lexical: EnvironmentScope<Key, Value>,
  variables: EnvironmentScope<Key, Value>,
  catches: DirectEvalCatch<Value> | undefined,
  plan: GlobalDeclarations<Value>,
  strict: boolean,
): "none" | "syntax" | "type" {
  const fresh = lexical.declarative;
  if (
    fresh === undefined ||
    variables.object !== undefined ||
    lexical.global !== variables.global
  )
    throw "DIRECT_EVAL_ENVIRONMENT_INVARIANT";
  if (strict)
    return instantiateEvalDeclarations<Key, Value>(
      lexical.global,
      fresh,
      plan,
      true,
    );
  interveningEvalBinding<Key, Value>(lexical, variables, catches, undefined);
  for (const name of plan.variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (interveningEvalBinding<Key, Value>(lexical, variables, catches, name))
      return "syntax";
  }
  for (const declaration of plan.functions) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (
      interveningEvalBinding<Key, Value>(
        lexical,
        variables,
        catches,
        declaration.name,
      )
    )
      return "syntax";
  }
  const annex: AnnexGlobalFunction[] = [];
  for (const declaration of plan.annexFunctions ?? []) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (
      interveningEvalBinding<Key, Value>(
        lexical,
        variables,
        catches,
        declaration.name,
      )
    )
      declaration.admitted = false;
    else annex.push(declaration);
  }
  const target = variables.declarative;
  if (target === undefined) {
    const globalPlan: GlobalDeclarations<Value> = {
      lexical: plan.lexical,
      variables: plan.variables,
      functions: plan.functions,
      annexFunctions: annex,
    };
    return instantiateEvalDeclarations<Key, Value>(
      variables.global,
      fresh,
      globalPlan,
      false,
    );
  }
  const names = new Set<string>(),
    functions: GlobalFunctionDeclaration<Value>[] = [];
  for (let index = plan.functions.length - 1; index >= 0; index--) {
    const declaration = plan.functions[index];
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (names.has(declaration.name)) continue;
    names.add(declaration.name);
    functions.push(declaration);
  }
  const declared = new Set<string>(),
    ordinary: string[] = [];
  for (const name of names) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    declared.add(name);
  }
  for (const name of plan.variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (declared.has(name)) continue;
    declared.add(name);
    ordinary.push(name);
  }
  for (const declaration of annex) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (!declared.has(declaration.name)) {
      if (!hasBinding<Value>(target, declaration.name)) {
        createMutableBinding<Value>(target, declaration.name, true);
        initializeBinding<Value>(
          target,
          declaration.name,
          target.undefinedValue,
        );
      }
      declared.add(declaration.name);
    }
    declaration.admitted = true;
  }
  createEvalLexicals<Value>(fresh, plan.lexical);
  for (let index = functions.length - 1; index >= 0; index--) {
    const declaration = functions[index];
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    const value = declaration.instantiate();
    if (hasBinding<Value>(target, declaration.name)) {
      if (
        setMutableBinding<Value>(target, declaration.name, value, false) !==
        "none"
      )
        throw "DECLARATION_INVARIANT";
    } else {
      createMutableBinding<Value>(target, declaration.name, true);
      initializeBinding<Value>(target, declaration.name, value);
    }
  }
  for (const name of ordinary) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    if (hasBinding<Value>(target, name)) continue;
    createMutableBinding<Value>(target, name, true);
    initializeBinding<Value>(target, name, target.undefinedValue);
  }
  return "none";
}
