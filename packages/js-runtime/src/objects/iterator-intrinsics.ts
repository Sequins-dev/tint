import { typedArrayWindow } from "./typed-array-data.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createDataProperty,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  viewObjectValue,
  getObjectValueProperty,
  callObjectValue,
} from "./values.ts";
import { toObjectValue, requireObjectCoercible } from "./boxing.ts";
import { stringValue } from "./coercion.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createArrayFromList, lengthOfArrayLike } from "./array-like.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

export function createIteratorResult(
  value: unknown,
  done: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const result = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  if (
    !createDataProperty<ScriptPropertyKey, unknown>(
      result,
      "value",
      value,
      hooks,
    ) ||
    !createDataProperty<ScriptPropertyKey, unknown>(result, "done", done, hooks)
  )
    throw "ITERATOR_RESULT_INVARIANT";
  return result;
}
export function createArrayIterator(
  iterated: OrdinaryObject<ScriptPropertyKey, unknown>,
  kind: "key" | "value" | "entry",
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const iterator = createObject<ScriptPropertyKey, unknown>(
    realm.arrayIteratorPrototype,
  );
  ensureExoticSlots(iterator).internalArrayIteratorData = {
    iterated,
    index: 0,
    kind,
  };
  return iterator;
}
/** Internal slots belong to each iterator. Shared next methods validate the receiver
 * and exhausted iterators release their source rather than retaining it forever. */
export function installIteratorIntrinsics(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.iteratorPrototype,
    wellKnownSymbol(realm.symbolRegistry, "dispose"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.dispose]",
      0,
      (receiver, args): unknown => {
        const method = getObjectValueProperty(receiver, "return", hooks, realm);
        if (method.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (method.error !== "none") throw createRuntimeError(realm, "type");
        if (method.value === undefined || method.value === null)
          return undefined;
        const result = callObjectValue(
          method.value,
          receiver,
          [],
          realm.objectPrototype,
        );
        if (result.error !== "none") throw createRuntimeError(realm, "type");
        return undefined;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  const iteratorKey = wellKnownSymbol(realm.symbolRegistry, "iterator");
  const tagKey = wellKnownSymbol(realm.symbolRegistry, "toStringTag");
  builtinProperty(
    realm.iteratorPrototype,
    iteratorKey,
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.iterator]",
      0,
      (receiver, args): unknown => receiver,
      hooks,
    ),
    true,
    true,
    hooks,
  );
  function arrayMethod(
    kind: "key" | "value" | "entry",
    name: string,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    return builtinFunction(
      realm.functionPrototype,
      name,
      0,
      (receiver, args): unknown => {
        const iterated = toObjectValue(receiver, realm, hooks);
        return createArrayIterator(iterated, kind, realm);
      },
      hooks,
    );
  }
  const values = arrayMethod("value", "values");
  realm.arrayValues = values;
  builtinProperty(realm.arrayPrototype, "values", values, true, true, hooks);
  builtinProperty(realm.arrayPrototype, iteratorKey, values, true, true, hooks);
  builtinProperty(
    realm.arrayPrototype,
    "keys",
    arrayMethod("key", "keys"),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.arrayPrototype,
    "entries",
    arrayMethod("entry", "entries"),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.arrayIteratorPrototype,
    tagKey,
    "Array Iterator",
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.arrayIteratorPrototype,
    "next",
    builtinFunction(
      realm.functionPrototype,
      "next",
      0,
      (receiver, args): unknown => {
        const iterator = viewObjectValue(receiver, realm.objectPrototype);
        const state =
          iterator === undefined
            ? undefined
            : exoticSlots(iterator).internalArrayIteratorData;
        if (state === undefined) throw createRuntimeError(realm, "type");
        const source = state.iterated;
        if (source === undefined)
          return createIteratorResult(undefined, true, realm, hooks);
        // Capture the index before observable length access. Abrupt completion
        // preserves the slots; only exhaustion releases the iterated object.
        const index = state.index;
        const data = exoticSlots(source).internalTypedArrayData;
        let length: number;
        if (data === undefined)
          length = lengthOfArrayLike(source, realm, hooks);
        else {
          const window = typedArrayWindow(data);
          if (window === undefined) throw createRuntimeError(realm, "type");
          length = window.length;
        }
        if (index >= length) {
          state.iterated = undefined;
          return createIteratorResult(undefined, true, realm, hooks);
        }
        state.index = index + 1;
        if (state.kind === "key")
          return createIteratorResult(index, false, realm, hooks);
        const value = getProperty<ScriptPropertyKey, unknown>(
          source,
          String(index),
          source,
          hooks,
        );
        if (state.kind === "value")
          return createIteratorResult(value, false, realm, hooks);
        const entry = createArrayFromList(
          [index, value],
          0,
          realm.arrayPrototype,
          realm,
          hooks,
        );
        return createIteratorResult(entry, false, realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.stringIteratorPrototype,
    tagKey,
    "String Iterator",
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.stringPrototype,
    iteratorKey,
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.iterator]",
      0,
      (receiver, args): unknown => {
        requireObjectCoercible(receiver, realm);
        const converted = stringValue(receiver, hooks, realm);
        if (converted.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (converted.error !== "none") throw createRuntimeError(realm, "type");
        const iterator = createObject<ScriptPropertyKey, unknown>(
          realm.stringIteratorPrototype,
        );
        ensureExoticSlots(iterator).internalStringIteratorData = {
          text: converted.value,
          index: 0,
        };
        return iterator;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.stringIteratorPrototype,
    "next",
    builtinFunction(
      realm.functionPrototype,
      "next",
      0,
      (receiver, args): unknown => {
        const iterator = viewObjectValue(receiver, realm.objectPrototype);
        const state =
          iterator === undefined
            ? undefined
            : exoticSlots(iterator).internalStringIteratorData;
        if (state === undefined) throw createRuntimeError(realm, "type");
        const text = state.text;
        if (text === undefined)
          return createIteratorResult(undefined, true, realm, hooks);
        const index = state.index;
        if (index >= text.length) {
          state.text = undefined;
          return createIteratorResult(undefined, true, realm, hooks);
        }
        let width = 1;
        const first = text.charCodeAt(index);
        if (first >= 55296 && first <= 56319 && index + 1 < text.length) {
          const second = text.charCodeAt(index + 1);
          if (second >= 56320 && second <= 57343) width = 2;
        }
        state.index = index + width;
        return createIteratorResult(
          text.slice(index, index + width),
          false,
          realm,
          hooks,
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
