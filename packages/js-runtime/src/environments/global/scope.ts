import {
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
  createPropertyCellCache,
  cachedPropertyCell,
  refreshPropertyCell,
  writePropertyCell,
  throwIfRuntimeError,
  type ErrorRealm,
  type PropertyCellCache,
} from "../../objects/index.ts";
import type { Descriptor } from "../../descriptors/index.ts";
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
  readonly cache: GlobalIdentifierCache<Key, Value> | undefined;
}
/** Per-site inline cache for an identifier the binder left to the global
 * record. It holds the global object's own data property cell for the name,
 * and stays valid while the global object's own property layout and the set
 * of global lexical bindings are unchanged (see internalPropertyEpoch and
 * lexicalEpoch). Enclosing declarative and with scopes are still consulted
 * first; the cache replaces only the final global-object step. */
export interface GlobalIdentifierCache<Key, Value> {
  global: GlobalEnvironment<Key, Value> | undefined;
  lexicalEpoch: number;
  readonly cell: PropertyCellCache<Key, Value>;
  /** The site's reference to the global record, reused while it names the
   * same scope; a cache belongs to one site, so name and strictness agree. */
  reference: BindingReference<Key, Value> | undefined;
}
export function createGlobalIdentifierCache<
  Key,
  Value,
>(): GlobalIdentifierCache<Key, Value> {
  return {
    global: undefined,
    lexicalEpoch: 0,
    cell: createPropertyCellCache<Key, Value>(),
    reference: undefined,
  };
}
/** The cached cell when it still is the global binding for the site's name:
 * no global lexical binding was created or deleted, and the global object's
 * own property was neither removed nor redefined. */
function cachedGlobalCell<Key, Value>(
  global: GlobalEnvironment<Key, Value>,
  cache: GlobalIdentifierCache<Key, Value>,
): Descriptor<Value> | undefined {
  return cache.global === global && cache.lexicalEpoch === global.lexicalEpoch
    ? cachedPropertyCell<Key, Value>(global.object, cache.cell)
    : undefined;
}
/** A reference to the global record for a cached site. References are
 * immutable, so one per site serves every resolution that reaches the same
 * global scope from the same Script global. */
function globalReference<Key, Value>(
  start: EnvironmentScope<Key, Value>,
  scope: EnvironmentScope<Key, Value>,
  name: string,
  strict: boolean,
  cache: GlobalIdentifierCache<Key, Value>,
): BindingReference<Key, Value> {
  const existing = cache.reference;
  if (
    existing !== undefined &&
    existing.scope === scope &&
    existing.global === start.global &&
    existing.strict === strict
  )
    return existing;
  const reference: BindingReference<Key, Value> = {
    global: start.global,
    scope,
    name,
    strict,
    cache,
  };
  cache.reference = reference;
  return reference;
}
/** Record the global object's own data property for name after a full
 * lookup, unless a global lexical binding shadows it. */
function refreshGlobalCell<Key, Value>(
  global: GlobalEnvironment<Key, Value>,
  name: string,
  cache: GlobalIdentifierCache<Key, Value>,
): void {
  if (hasBinding<Value>(global.lexical, name)) cache.global = undefined;
  else recordGlobalCell<Key, Value>(global, global.keyForName(name), cache);
}
/** Cache the global object's own data property for key; the caller has
 * established that no global lexical binding shadows it. */
function recordGlobalCell<Key, Value>(
  global: GlobalEnvironment<Key, Value>,
  key: Key,
  cache: GlobalIdentifierCache<Key, Value>,
): void {
  if (
    refreshPropertyCell<Key, Value>(global.object, key, cache.cell) ===
    undefined
  ) {
    cache.global = undefined;
    return;
  }
  cache.global = global;
  cache.lexicalEpoch = global.lexicalEpoch;
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
  cache: GlobalIdentifierCache<Key, Value> | undefined = undefined,
): BindingReference<Key, Value> {
  let scope: EnvironmentScope<Key, Value> | undefined = start;
  while (scope !== undefined) {
    const record = scope.declarative;
    if (record !== undefined) {
      if (hasBinding<Value>(record, name)) break;
    } else if (scope.object !== undefined) {
      if (hasObjectBinding<Key, Value>(scope.object, name)) break;
    } else {
      // A live cached cell is an own data property of an ordinary global
      // object, so HasBinding is true and unobservable.
      if (cache !== undefined) {
        if (cachedGlobalCell<Key, Value>(scope.global, cache) !== undefined)
          return globalReference<Key, Value>(start, scope, name, strict, cache);
      }
      if (hasGlobalBinding<Key, Value>(scope.global, name)) {
        if (cache !== undefined)
          refreshGlobalCell<Key, Value>(scope.global, name, cache);
        break;
      }
    }
    scope = scope.outer;
  }
  return { global: start.global, scope, name, strict, cache };
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
  if (record === undefined && reference.cache !== undefined) {
    const cell = cachedGlobalCell<Key, Value>(scope.global, reference.cache);
    if (cell !== undefined && !cell.accessor)
      return { error: "none", value: cell.value };
  }
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
  // A cached site still naming a live, writable global data cell (revalidated
  // here, after the right-hand side ran) takes OrdinarySet's in-place update.
  const cache = reference.cache,
    scope = reference.scope;
  if (cache !== undefined && scope !== undefined) {
    if (scope.declarative === undefined && scope.object === undefined) {
      const cell = cachedGlobalCell<Key, Value>(scope.global, cache);
      if (cell !== undefined && cell.writable) {
        writePropertyCell<Value>(cell, value);
        return "none";
      }
    }
  }
  return putReferenceValue<Key, Value>(reference, value);
}
function putReferenceValue<Key, Value>(
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
  cache: GlobalIdentifierCache<Key, Value> | undefined = undefined,
): Value {
  // A site at Script top level starts at the global scope itself: with a live
  // cell no lexical binding shadows the name, so the cell is the binding.
  if (
    cache !== undefined &&
    start.declarative === undefined &&
    start.object === undefined
  ) {
    const cell = cachedGlobalCell<Key, Value>(start.global, cache);
    if (cell !== undefined) return cell.value;
  }
  return lookupIdentifierValue<Key, Value>(
    start,
    name,
    strict,
    realm,
    forTypeof,
    cache,
  );
}
function lookupIdentifierValue<Key, Value>(
  start: EnvironmentScope<Key, Value>,
  name: string,
  strict: boolean,
  realm: ErrorRealm,
  forTypeof: boolean,
  cache: GlobalIdentifierCache<Key, Value> | undefined,
): Value {
  // Declarative records resolve and read with one lookup and no reference or
  // result record; object (with) and global scopes keep HasBinding before
  // GetBindingValue, since those lookups can run user code.
  let scope: EnvironmentScope<Key, Value> | undefined = start;
  while (scope !== undefined) {
    const record = scope.declarative;
    if (record !== undefined) {
      const binding = record.bindings.get(name);
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
      if (cache !== undefined) {
        const cell = cachedGlobalCell<Key, Value>(global, cache);
        if (cell !== undefined) return cell.value;
      }
      const lexical = global.lexical.bindings.get(name);
      if (lexical !== undefined) {
        if (lexical.initialized) return lexical.value;
        throwIfRuntimeError(realm, "reference");
        throw "IDENTIFIER_REFERENCE_INVARIANT";
      }
      if (isOrdinaryPrototypeChain<Key, Value>(global.object)) {
        const key = global.keyForName(name);
        const descriptor = findOrdinaryProperty<Key, Value>(global.object, key);
        if (descriptor !== undefined) {
          if (!descriptor.accessor) {
            // No lexical binding shadows name, so an own data property of
            // the global object is this site's binding until invalidated.
            if (cache !== undefined)
              recordGlobalCell<Key, Value>(global, key, cache);
            return descriptor.value;
          }
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
          cache: undefined,
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
        cache: undefined,
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
