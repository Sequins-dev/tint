import type { ScriptPropertyKey } from "./symbols.ts";
import {
  ensureExoticSlots,
  createCallableObject,
  defineOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";

/** Standard non-enumerable intrinsic property on an embedding-owned object. */
export function builtinProperty(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: ScriptPropertyKey,
  value: unknown,
  writable: boolean,
  configurable: boolean,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      object,
      name,
      {
        fields: 51,
        value,
        writable,
        enumerable: false,
        configurable,
        get: undefined,
        set: undefined,
      },
      hooks,
    ) !== "accepted"
  )
    throw "INTRINSIC_PROPERTY_INVARIANT";
}
/** Built-in function metadata has observable insertion order: length, then name. */
export function functionMetadata(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  length: number,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(object, "length", length, false, true, hooks);
  builtinProperty(object, "name", name, false, true, hooks);
}
/** Built-ins retain their original name for Function.prototype.toString. */
export function builtinFunctionMetadata(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  length: number,
  hooks: ObjectHooks<unknown>,
): void {
  ensureExoticSlots(object).internalInitialName = name;
  functionMetadata(object, name, length, hooks);
}
export function builtinFunction(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  length: number,
  implementation: ObjectCall<unknown>,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const fn = createCallableObject<ScriptPropertyKey, unknown>(
    prototype,
    implementation,
  );
  builtinFunctionMetadata(fn, name, length, hooks);
  return fn;
}

/** Standard configurable, non-enumerable intrinsic accessor descriptor. */
export function builtinAccessor(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  key: ScriptPropertyKey,
  getter: unknown,
  setter: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      object,
      key,
      {
        fields: 60,
        value: undefined,
        writable: false,
        get: getter,
        set: setter,
        enumerable: false,
        configurable: true,
      },
      hooks,
    ) !== "accepted"
  )
    throw "INTRINSIC_ACCESSOR_INVARIANT";
}
