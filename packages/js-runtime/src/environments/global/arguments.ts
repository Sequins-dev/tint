import { wellKnownSymbol } from "../../objects/index.ts";
import type { ScriptPropertyKey } from "../../objects/index.ts";
import {
  createMutableBinding,
  createImmutableBinding,
  initializeBinding,
  getBindingValue,
  setMutableBinding,
  type DeclarativeEnvironment,
} from "../records/index.ts";
import {
  createArgumentsObject,
  type ArgumentsIntrinsics,
  type ArgumentsParameterMap,
  type OrdinaryObject,
  type ObjectHooks,
  type DataAlias,
  type ErrorRealm,
} from "../../objects/index.ts";

/** Validated function declaration facts. simple excludes defaults, patterns and
 * rest; parameterExpressions also includes expressions nested inside patterns. */
export interface FunctionArgumentsPlan {
  readonly arrow: boolean;
  readonly strict: boolean;
  readonly simple: boolean;
  readonly parameterExpressions: boolean;
  readonly parameters: readonly string[];
  readonly functions: readonly string[];
  readonly lexical: readonly string[];
}
/** After parameter bindings are created, before evaluating parameter defaults.
 * Returns undefined when no implicit binding is needed. The embedding's box
 * operation publishes an object identity without running source-level code. */
export function instantiateFunctionArguments<Key, Value>(
  record: DeclarativeEnvironment<Value>,
  args: readonly Value[],
  callee: Value,
  plan: FunctionArgumentsPlan,
  intrinsics: ArgumentsIntrinsics<Key, Value>,
  hooks: ObjectHooks<Value>,
  box: (object: OrdinaryObject<Key, Value>) => Value,
): OrdinaryObject<Key, Value> | undefined {
  if (plan.arrow || plan.parameters.includes("arguments")) return undefined;
  if (
    !plan.parameterExpressions &&
    (plan.functions.includes("arguments") || plan.lexical.includes("arguments"))
  )
    return undefined;
  let mapping: ArgumentsParameterMap<Value> | undefined = undefined;
  if (!plan.strict && plan.simple) {
    mapping = {
      names: plan.parameters,
      callee,
      binding: (name): DataAlias<Value> => ({
        get: (): Value => {
          const result = getBindingValue<Value>(record, name);
          if (result.error !== "none") throw "ARGUMENTS_BINDING_INVARIANT";
          return result.value;
        },
        set: (value): void => {
          if (setMutableBinding<Value>(record, name, value, false) !== "none")
            throw "ARGUMENTS_BINDING_INVARIANT";
        },
      }),
    };
  }
  const object = createArgumentsObject<Key, Value>(
    args,
    mapping,
    intrinsics,
    hooks,
  );
  if (plan.strict) createImmutableBinding<Value>(record, "arguments", false);
  else createMutableBinding<Value>(record, "arguments", false);
  initializeBinding<Value>(record, "arguments", box(object));
  return object;
}

/** Arguments retain the realm intrinsic values iterator even if user code changes Array.prototype. */
export function instantiateScriptArguments(
  record: DeclarativeEnvironment<unknown>,
  args: readonly unknown[],
  callee: unknown,
  plan: FunctionArgumentsPlan,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const values = realm.arrayValues;
  if (values === undefined) throw "ARGUMENTS_ITERATOR_INTRINSIC_INVARIANT";
  instantiateFunctionArguments<ScriptPropertyKey, unknown>(
    record,
    args,
    callee,
    plan,
    {
      prototype: realm.objectPrototype,
      lengthKey: "length",
      calleeKey: "callee",
      iteratorKey: wellKnownSymbol(realm.symbolRegistry, "iterator"),
      values,
      throwTypeError: realm.throwTypeError,
      indexKey: (index): ScriptPropertyKey => String(index),
      numberValue: (value): unknown => value,
    },
    hooks,
    (object): unknown => object,
  );
}
