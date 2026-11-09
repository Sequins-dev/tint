import {
  findBinding,
  hasBinding,
  getBindingValue,
  setMutableBinding,
  deleteBinding,
  type DeclarativeEnvironment,
  type BindingResult,
  type BindingError,
} from "../records/index.ts";
import {
  setProperty,
  isOrdinaryPrototypeChain,
  findOrdinaryProperty,
  throwIfRuntimeError,
  type ErrorRealm,
} from "../../objects/index.ts";
import {
  hasGlobalBinding,
  getGlobalBinding,
  setGlobalBinding,
  deleteGlobalBinding,
  type GlobalEnvironment,
} from "./record.ts";

import {
  hasObjectBinding,
  getObjectBinding,
  setObjectBinding,
  deleteObjectBinding,
  type ObjectEnvironment,
} from "./object.ts";

/** A chain of declarative and object scopes ending in one global environment. */
export interface EnvironmentScope<Key, Value> {
  readonly global: GlobalEnvironment<Key, Value>;
  readonly object: ObjectEnvironment<Key, Value> | undefined;
  readonly declarative: DeclarativeEnvironment<Value> | undefined;
  readonly outer: EnvironmentScope<Key, Value> | undefined;
}
/** Resolution precedes RHS evaluation. Keep this record rather than resolving
 * the name again after user code has run. Undefined scope means unresolvable. */
export interface BindingReference<Key, Value> {
  readonly global: GlobalEnvironment<Key, Value>;
  readonly scope: EnvironmentScope<Key, Value> | undefined;
  readonly name: string;
  readonly strict: boolean;
}
export function createGlobalScope<Key, Value>(
  global: GlobalEnvironment<Key, Value>,
): EnvironmentScope<Key, Value> {
  return {
    global,
    declarative: undefined,
    object: undefined,
    outer: undefined,
  };
}
export function createDeclarativeScope<Key, Value>(
  outer: EnvironmentScope<Key, Value>,
  declarative: DeclarativeEnvironment<Value>,
): EnvironmentScope<Key, Value> {
  return { global: outer.global, declarative, object: undefined, outer };
}
export function createObjectScope<Key, Value>(
  outer: EnvironmentScope<Key, Value>,
  object: ObjectEnvironment<Key, Value>,
): EnvironmentScope<Key, Value> {
  return { global: outer.global, declarative: undefined, object, outer };
}
export function getBindingThisValue<Key, Value>(
  reference: BindingReference<Key, Value>,
): Value {
  const scope = reference.scope;
  if (scope !== undefined) {
    const object = scope.object;
    if (object !== undefined && object.withEnvironment)
      return object.objectValue;
  }
  return reference.global.hooks.undefinedValue;
}
export function resolveBinding<Key, Value>(
  start: EnvironmentScope<Key, Value>,
  name: string,
  strict: boolean,
): BindingReference<Key, Value> {
  let scope: EnvironmentScope<Key, Value> | undefined = start;
  while (scope !== undefined) {
    const record = scope.declarative;
    if (
      record === undefined
        ? scope.object !== undefined
          ? hasObjectBinding<Key, Value>(scope.object, name)
          : hasGlobalBinding<Key, Value>(scope.global, name)
        : hasBinding<Value>(record, name)
    )
      break;
    scope = scope.outer;
  }
  return { global: start.global, scope, name, strict };
}
export function getBindingReference<Key, Value>(
  reference: BindingReference<Key, Value>,
): BindingResult<Value> {
  const scope = reference.scope;
  if (scope === undefined)
    return { error: "reference", value: reference.global.hooks.undefinedValue };
  if (scope.object !== undefined)
    return getObjectBinding<Key, Value>(
      scope.object,
      reference.name,
      reference.strict,
    );
  const record = scope.declarative;
  return record === undefined
    ? getGlobalBinding<Key, Value>(
        scope.global,
        reference.name,
        reference.strict,
      )
    : getBindingValue<Value>(record, reference.name);
}
export function putBindingReference<Key, Value>(
  reference: BindingReference<Key, Value>,
  value: Value,
): BindingError {
  const scope = reference.scope;
  if (scope === undefined) {
    if (reference.strict) return "reference";
    // An unresolvable reference writes to the global object, even if RHS
    // evaluation has since created a same-named global lexical binding.
    const global = reference.global;
    setProperty<Key, Value>(
      global.object,
      global.keyForName(reference.name),
      value,
      { value: global.objectValue, object: global.object },
      global.hooks,
    );
    return "none";
  }
  if (scope.object !== undefined)
    return setObjectBinding<Key, Value>(
      scope.object,
      reference.name,
      value,
      reference.strict,
    );
  const record = scope.declarative;
  return record === undefined
    ? setGlobalBinding<Key, Value>(
        scope.global,
        reference.name,
        value,
        reference.strict,
      )
    : setMutableBinding<Value>(record, reference.name, value, reference.strict);
}

/** typeof exempts an unresolvable reference, but not TDZ or accessor errors. */
export function getBindingReferenceForTypeof<Key, Value>(
  reference: BindingReference<Key, Value>,
): BindingResult<Value> {
  if (reference.scope === undefined)
    return { error: "none", value: reference.global.hooks.undefinedValue };
  return getBindingReference<Key, Value>(reference);
}

/** GetValue(ResolveBinding(name)) for an identifier read, in one runtime call.
 * Resolution and the read are adjacent, so no user code can run between them;
 * abrupt results complete exactly as lowered result checks do. */
export function getIdentifierValue<Key, Value>(
  start: EnvironmentScope<Key, Value>,
  name: string,
  strict: boolean,
  realm: ErrorRealm,
  forTypeof: boolean,
): Value {
  // Declarative records resolve and read with one lookup and no reference or
  // result record; object (with) and global scopes keep HasBinding before
  // GetBindingValue, since those lookups can run user code.
  let scope: EnvironmentScope<Key, Value> | undefined = start;
  while (scope !== undefined) {
    const record = scope.declarative;
    if (record !== undefined) {
      const binding = findBinding<Value>(record, name);
      if (binding !== undefined) {
        if (binding.initialized) return binding.value;
        throwIfRuntimeError(realm, "reference");
        throw "IDENTIFIER_REFERENCE_INVARIANT";
      }
    } else if (scope.object === undefined) {
      // Global record: lexical declarations, then one walk of an all-ordinary
      // global prototype chain, where HasProperty is unobservable. An exotic
      // object anywhere on the chain takes the specified two-step path.
      const global = scope.global;
      const lexical = findBinding<Value>(global.lexical, name);
      if (lexical !== undefined) {
        if (lexical.initialized) return lexical.value;
        throwIfRuntimeError(realm, "reference");
        throw "IDENTIFIER_REFERENCE_INVARIANT";
      }
      if (isOrdinaryPrototypeChain<Key, Value>(global.object)) {
        const descriptor = findOrdinaryProperty<Key, Value>(
          global.object,
          global.keyForName(name),
        );
        if (descriptor !== undefined) {
          if (!descriptor.accessor) return descriptor.value;
          const hooks = global.hooks;
          if (hooks.sameValue(descriptor.get, hooks.undefinedValue))
            return hooks.undefinedValue;
          return hooks.call(descriptor.get, global.objectValue, []);
        }
      } else if (hasGlobalBinding<Key, Value>(global, name)) {
        const result = getBindingReference<Key, Value>({
          global: start.global,
          scope,
          name,
          strict,
        });
        throwIfRuntimeError(realm, result.error);
        return result.value;
      }
    } else if (hasObjectBinding<Key, Value>(scope.object, name)) {
      const result = getBindingReference<Key, Value>({
        global: start.global,
        scope,
        name,
        strict,
      });
      throwIfRuntimeError(realm, result.error);
      return result.value;
    }
    scope = scope.outer;
  }
  if (forTypeof) return start.global.hooks.undefinedValue;
  throwIfRuntimeError(realm, "reference");
  throw "IDENTIFIER_REFERENCE_INVARIANT";
}

/** GetValue(reference) completed like a lowered result check, for
 * runtime-compiled entries (see fused-results.ts in objects). */
export function getBindingReferenceOrThrow<Key, Value>(
  reference: BindingReference<Key, Value>,
  realm: ErrorRealm,
): Value {
  const result = getBindingReference<Key, Value>(reference);
  throwIfRuntimeError(realm, result.error);
  return result.value;
}

/** PutValue(reference, value) completed like a lowered result check. */
export function putBindingReferenceOrThrow<Key, Value>(
  reference: BindingReference<Key, Value>,
  value: Value,
  realm: ErrorRealm,
): void {
  throwIfRuntimeError(realm, putBindingReference<Key, Value>(reference, value));
}

/** Delete the resolved binding without GetValue, including an uninitialized binding.
 * Strict identifier deletion is an early syntax error, handled before execution. */
export function deleteBindingReference<Key, Value>(
  reference: BindingReference<Key, Value>,
): boolean {
  const scope = reference.scope;
  if (scope === undefined) return true;
  if (scope.object !== undefined)
    return deleteObjectBinding<Key, Value>(scope.object, reference.name);
  const record = scope.declarative;
  return record === undefined
    ? deleteGlobalBinding<Key, Value>(scope.global, reference.name)
    : deleteBinding<Value>(record, reference.name);
}
