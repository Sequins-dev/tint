import {
  getIteratorFromMethod,
  iteratorStepValue,
} from "../iterators/index.ts";
import { createScriptIteratorHooks } from "./iteration.ts";
import { constructTypedArrayResult } from "./typed-array-result.ts";
import { toObjectValue } from "./boxing.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import { storeTypedArrayElement } from "./typed-array-construction.ts";
import { viewObjectValue, getObjectValueProperty } from "./values.ts";
import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
function requireConstructor(
  value: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (
    object === undefined ||
    object.internalRareSlots?.internalConstruct === undefined
  )
    throw createRuntimeError(realm, "type");
  return object;
}
export function installTypedArrayStatic(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    constructor,
    "of",
    builtinFunction(
      realm.functionPrototype,
      "of",
      0,
      (receiver, args): unknown => {
        const target = constructTypedArrayResult(
          requireConstructor(receiver, realm),
          [args.length],
          realm,
          "write",
        );
        for (let i = 0; i < args.length; i++)
          storeTypedArrayElement(target, i, args[i], hooks);
        return target;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "from",
    builtinFunction(
      realm.functionPrototype,
      "from",
      1,
      (receiver, args): unknown => {
        const selected = requireConstructor(receiver, realm),
          source = args[0],
          mapper = args[1];
        if (mapper !== undefined) {
          const callable = viewObjectValue(mapper, realm.objectPrototype);
          if (
            callable === undefined ||
            callable.internalRareSlots?.internalCall === undefined
          )
            throw createRuntimeError(realm, "type");
        }
        const iteratorHooks = createScriptIteratorHooks(realm, hooks);
        const lookup = getObjectValueProperty(
          source,
          wellKnownSymbol(realm.symbolRegistry, "iterator"),
          hooks,
          realm,
        );
        if (lookup.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (lookup.error !== "none") throw createRuntimeError(realm, "type");
        const method = lookup.value;
        if (method !== undefined && method !== null) {
          const iterator = getIteratorFromMethod<unknown>(
              source,
              method,
              iteratorHooks,
            ),
            values: unknown[] = [];
          while (true) {
            const step = iteratorStepValue<unknown>(iterator, iteratorHooks);
            if (step.done) break;
            values.push(step.value);
          }
          const target = constructTypedArrayResult(
            selected,
            [values.length],
            realm,
            "write",
          );
          for (let i = 0; i < values.length; i++) {
            const value =
              mapper === undefined
                ? values[i]
                : hooks.call(mapper, args[2], [values[i], i]);
            storeTypedArrayElement(target, i, value, hooks);
          }
          return target;
        }
        const object = toObjectValue(source, realm, hooks),
          length = lengthOfArrayLike(object, realm, hooks),
          target = constructTypedArrayResult(
            selected,
            [length],
            realm,
            "write",
          );
        for (let i = 0; i < length; i++) {
          const value = getProperty<ScriptPropertyKey, unknown>(
            object,
            String(i),
            object,
            hooks,
          );
          storeTypedArrayElement(
            target,
            i,
            mapper === undefined
              ? value
              : hooks.call(mapper, args[2], [value, i]),
            hooks,
          );
        }
        return target;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
