import {
  createDeclarativeEnvironment,
  createMutableBinding,
  createImmutableBinding,
  initializeBinding,
  hasBinding,
  getBindingValue,
  setMutableBinding,
} from "../records/index.ts";
import { createDeclarativeScope, type EnvironmentScope } from "./scope.ts";

export interface BodyFunctionDeclaration<Key, Value> {
  readonly name: string;
  /** Allocate the function with this environment; do not execute its body. */
  readonly instantiate: (scope: EnvironmentScope<Key, Value>) => Value;
}
export interface FunctionBodyDeclarations<Key, Value> {
  /** True when parameter expressions require a distinct body var environment. */
  readonly separate: boolean;
  readonly variables: readonly string[];
  readonly functions: readonly BodyFunctionDeclaration<Key, Value>[];
  readonly lexical: readonly {
    readonly name: string;
    readonly constant: boolean;
  }[];
}
/** Strict function-body instantiation after all parameter initialization completes.
 * The caller must validate early errors first and establish parameter/arguments
 * bindings. This does not evaluate defaults, execute bodies or implement eval. */
export function instantiateFunctionBody<Key, Value>(
  parameters: EnvironmentScope<Key, Value>,
  plan: FunctionBodyDeclarations<Key, Value>,
): EnvironmentScope<Key, Value> {
  const source = parameters.declarative;
  if (source === undefined) throw "PARAMETER_ENVIRONMENT_INVARIANT";
  const parameterRecord = source;
  // Nothing to declare: the body shares the parameter scope unchanged.
  if (
    !plan.separate &&
    plan.variables.length === 0 &&
    plan.functions.length === 0 &&
    plan.lexical.length === 0
  )
    return parameters;
  const record = plan.separate
    ? createDeclarativeEnvironment<Value>(parameterRecord.undefinedValue)
    : parameterRecord;
  const body = plan.separate
    ? createDeclarativeScope<Key, Value>(parameters, record)
    : parameters;
  const names = new Set<string>();
  const functions: BodyFunctionDeclaration<Key, Value>[] = [];
  for (let i = plan.functions.length - 1; i >= 0; i--) {
    const declaration = plan.functions[i];
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (names.has(declaration.name)) continue;
    names.add(declaration.name);
    functions.push(declaration);
  }
  function variable(name: string): void {
    if (hasBinding<Value>(record, name)) return;
    let value = parameterRecord.undefinedValue;
    if (
      plan.separate &&
      !names.has(name) &&
      hasBinding<Value>(parameterRecord, name)
    ) {
      const parameter = getBindingValue<Value>(parameterRecord, name);
      if (parameter.error !== "none")
        throw "PARAMETER_INITIALIZATION_INVARIANT";
      value = parameter.value;
    }
    createMutableBinding<Value>(record, name, false);
    initializeBinding<Value>(record, name, value);
  }
  for (const name of plan.variables) {
    if (name === undefined) throw "DECLARATION_INVARIANT";
    variable(name);
  }
  for (const declaration of functions) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    variable(declaration.name);
  }
  for (const declaration of plan.lexical) {
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    if (declaration.constant)
      createImmutableBinding<Value>(record, declaration.name, true);
    else createMutableBinding<Value>(record, declaration.name, false);
  }
  for (let i = functions.length - 1; i >= 0; i--) {
    const declaration = functions[i];
    if (declaration === undefined) throw "DECLARATION_INVARIANT";
    const value = declaration.instantiate(body);
    if (
      setMutableBinding<Value>(record, declaration.name, value, false) !==
      "none"
    )
      throw "FUNCTION_INITIALIZATION_INVARIANT";
  }
  return body;
}
