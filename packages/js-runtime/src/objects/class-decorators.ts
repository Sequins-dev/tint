import type { ScriptPropertyKey } from "./symbols.ts";
import type { PrivateName } from "./private-elements.ts";
import {
  createObject,
  createDataProperty,
  defineOwnProperty,
  hasProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinFunction } from "./intrinsics.ts";
import { isCallableObject } from "./call.ts";
import {
  viewObjectValue,
  callObjectValue,
  getObjectValueProperty,
  setObjectValueProperty,
} from "./values.ts";
import {
  getPrivateObjectValue,
  setPrivateObjectValue,
  hasPrivateObjectValue,
} from "./private-values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";

export interface ClassDecorator {
  readonly value: unknown;
  readonly receiver: unknown;
}
export interface ClassFieldDecoration {
  readonly initializers: unknown[];
  readonly extraInitializers: unknown[];
}
export interface ClassDecorationState {
  readonly instanceInitializers: unknown[];
  readonly staticInitializers: unknown[];
  readonly classInitializers: unknown[];
}
export interface ClassElementDecoration {
  readonly target: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly name: ScriptPropertyKey;
  readonly privateName: PrivateName | undefined;
  readonly kind: "method" | "getter" | "setter" | "field" | "accessor";
  readonly static: boolean;
  readonly decorators: readonly ClassDecorator[];
  readonly field: ClassFieldDecoration;
  value: unknown;
  get: unknown;
  set: unknown;
}
export function createClassDecorationState(): ClassDecorationState {
  return {
    instanceInitializers: [],
    staticInitializers: [],
    classInitializers: [],
  };
}
function callable(value: unknown, realm: ErrorRealm): void {
  if (!isCallableObject(viewObjectValue(value, realm.objectPrototype)))
    throw createRuntimeError(realm, "type");
}
function invoke(
  value: unknown,
  receiver: unknown,
  args: readonly unknown[],
  realm: ErrorRealm,
): unknown {
  const result = callObjectValue(value, receiver, args, realm.objectPrototype);
  if (result.error !== "none") throw createRuntimeError(realm, result.error);
  return result.value;
}
function property(
  value: unknown,
  key: ScriptPropertyKey,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const result = getObjectValueProperty(value, key, hooks, realm);
  if (result.error !== "none") throw createRuntimeError(realm, result.error);
  return result.value;
}
function data(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    !createDataProperty<ScriptPropertyKey, unknown>(object, name, value, hooks)
  )
    throw createRuntimeError(realm, "type");
}
function accessObject(
  element: ClassElementDecoration,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const access = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const key = element.name,
    privateName = element.privateName;
  data(
    access,
    "has",
    builtinFunction(
      realm.functionPrototype,
      "has",
      1,
      (receiver, args): unknown => {
        const object = viewObjectValue(args[0], realm.objectPrototype);
        if (object === undefined) throw createRuntimeError(realm, "type");
        if (privateName === undefined)
          return hasProperty<ScriptPropertyKey, unknown>(object, key);
        const result = hasPrivateObjectValue(
          args[0],
          privateName,
          hooks,
          realm.objectPrototype,
        );
        if (result.error !== "none")
          throw createRuntimeError(realm, result.error);
        return result.value;
      },
      hooks,
    ),
    realm,
    hooks,
  );
  if (element.kind !== "setter")
    data(
      access,
      "get",
      builtinFunction(
        realm.functionPrototype,
        "get",
        1,
        (receiver, args): unknown => {
          if (viewObjectValue(args[0], realm.objectPrototype) === undefined)
            throw createRuntimeError(realm, "type");
          if (privateName === undefined)
            return property(args[0], key, realm, hooks);
          const result = getPrivateObjectValue(
            args[0],
            privateName,
            hooks,
            realm.objectPrototype,
          );
          if (result.error !== "none")
            throw createRuntimeError(realm, result.error);
          return result.value;
        },
        hooks,
      ),
      realm,
      hooks,
    );
  if (
    element.kind === "setter" ||
    element.kind === "field" ||
    element.kind === "accessor"
  )
    data(
      access,
      "set",
      builtinFunction(
        realm.functionPrototype,
        "set",
        2,
        (receiver, args): unknown => {
          if (viewObjectValue(args[0], realm.objectPrototype) === undefined)
            throw createRuntimeError(realm, "type");
          const error =
            privateName === undefined
              ? setObjectValueProperty(
                  args[0],
                  key,
                  args[1],
                  true,
                  hooks,
                  realm,
                )
              : setPrivateObjectValue(
                  args[0],
                  privateName,
                  args[1],
                  hooks,
                  realm.objectPrototype,
                );
          if (error !== "none") throw createRuntimeError(realm, error);
          return undefined;
        },
        hooks,
      ),
      realm,
      hooks,
    );
  return access;
}
/** Each application receives fresh mutable context/access objects. The capability
 * closes only after a normal decorator return, including before validation. */
function context(
  kind: string,
  name: ScriptPropertyKey,
  element: ClassElementDecoration | undefined,
  initializers: unknown[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): {
  readonly value: OrdinaryObject<ScriptPropertyKey, unknown>;
  finished: boolean;
} {
  const value = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  const state = { value, finished: false };
  data(value, "kind", kind, realm, hooks);
  data(value, "name", name, realm, hooks);
  if (element !== undefined) {
    data(value, "static", element.static, realm, hooks);
    data(value, "private", element.privateName !== undefined, realm, hooks);
    data(value, "access", accessObject(element, realm, hooks), realm, hooks);
  }
  data(
    value,
    "addInitializer",
    builtinFunction(
      realm.functionPrototype,
      "addInitializer",
      1,
      (receiver, args): unknown => {
        if (state.finished) throw createRuntimeError(realm, "type");
        callable(args[0], realm);
        initializers.push(args[0]);
        return undefined;
      },
      hooks,
    ),
    realm,
    hooks,
  );
  return state;
}
export function runClassInitializers(
  initializers: readonly unknown[],
  receiver: unknown,
  realm: ErrorRealm,
): void {
  for (const initializer of initializers)
    invoke(initializer, receiver, [], realm);
}
/** Reverse decorator application, preserving field initializer composition and
 * registration order independently from method extra-initializer queues. */
export function decorateClassElement(
  element: ClassElementDecoration,
  state: ClassDecorationState,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const kind = element.kind;
  const extras =
    kind === "field" || kind === "accessor"
      ? element.field.extraInitializers
      : element.static
        ? state.staticInitializers
        : state.instanceInitializers;
  for (let index = element.decorators.length - 1; index >= 0; index--) {
    const decorator = element.decorators[index];
    if (decorator === undefined) throw "CLASS_DECORATOR_INVARIANT";
    const ctx = context(kind, element.name, element, extras, realm, hooks);
    let input = element.value;
    if (kind === "accessor") {
      const pair = createObject<ScriptPropertyKey, unknown>(
        realm.objectPrototype,
      );
      data(pair, "get", element.get, realm, hooks);
      data(pair, "set", element.set, realm, hooks);
      input = pair;
    }
    const replacement = invoke(
      decorator.value,
      decorator.receiver,
      [input, ctx.value],
      realm,
    );
    ctx.finished = true;
    if (replacement === undefined) continue;
    if (kind === "accessor") {
      if (viewObjectValue(replacement, realm.objectPrototype) === undefined)
        throw createRuntimeError(realm, "type");
      const get = property(replacement, "get", realm, hooks);
      if (get !== undefined) callable(get, realm);
      const set = property(replacement, "set", realm, hooks);
      if (set !== undefined) callable(set, realm);
      const init = property(replacement, "init", realm, hooks);
      if (init !== undefined) callable(init, realm);
      if (get !== undefined) element.get = get;
      if (set !== undefined) element.set = set;
      if (init !== undefined) element.field.initializers.unshift(init);
    } else {
      callable(replacement, realm);
      if (kind === "field") element.field.initializers.unshift(replacement);
      else element.value = replacement;
    }
  }
  if (element.privateName !== undefined || kind === "field") return;
  const method = kind === "method";
  const getter = kind === "getter",
    setter = kind === "setter";
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      element.target,
      element.name,
      {
        fields: method ? 51 : getter ? 52 : setter ? 56 : 60,
        value: element.value,
        writable: method,
        get: getter ? element.value : element.get,
        set: setter ? element.value : element.set,
        enumerable: false,
        configurable: true,
      },
      hooks,
    ) !== "accepted"
  )
    throw createRuntimeError(realm, "type");
}
export function decorateClass(
  original: OrdinaryObject<ScriptPropertyKey, unknown>,
  decorators: readonly ClassDecorator[],
  state: ClassDecorationState,
  name: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  let result = original;
  for (let index = decorators.length - 1; index >= 0; index--) {
    const decorator = decorators[index];
    if (decorator === undefined) throw "CLASS_DECORATOR_INVARIANT";
    const ctx = context(
      "class",
      name,
      undefined,
      state.classInitializers,
      realm,
      hooks,
    );
    const replacement = invoke(
      decorator.value,
      decorator.receiver,
      [result, ctx.value],
      realm,
    );
    ctx.finished = true;
    if (replacement !== undefined) {
      callable(replacement, realm);
      const object = viewObjectValue(replacement, realm.objectPrototype);
      if (object === undefined) throw "CLASS_DECORATOR_RESULT_INVARIANT";
      result = object;
    }
  }
  return result;
}
