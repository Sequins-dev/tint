import { joinIndexedProperties } from "./join-indexed-properties.ts";
import { appendPackedElement, popPackedElement } from "./array-append.ts";
import { installArraySorting } from "./array-sorting.ts";
import { scriptBoolean, scriptStrictEqual } from "./values.ts";
import { installArrayCopying } from "./array-copying.ts";
import { installArrayComposition } from "./array-composition.ts";
import { arraySpeciesCreate } from "./array-species.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { isCallableObject } from "./call.ts";
import { objectValueTag } from "./object-prototype.ts";
import { viewObjectValue } from "./values.ts";
import {
  createObject,
  getProperty,
  createDataProperty,
  hasProperty,
  setProperty,
  deleteProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { stringValue, numberValue } from "./coercion.ts";
import { toObjectValue } from "./boxing.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

/** Generic array algorithms use the same property capabilities as source access. */
export function installArrayPrototype(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  installArrayComposition(realm, hooks);
  installArrayCopying(realm, hooks);
  installArraySorting(realm, hooks);
  const unscopables = createObject<ScriptPropertyKey, unknown>(undefined);
  for (const name of [
    "at",
    "copyWithin",
    "entries",
    "fill",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "flat",
    "flatMap",
    "includes",
    "keys",
    "toReversed",
    "toSorted",
    "toSpliced",
    "values",
  ]) {
    if (name === undefined) throw "ARRAY_UNSCOPABLES_INVARIANT";
    createDataProperty<ScriptPropertyKey, unknown>(
      unscopables,
      name,
      true,
      hooks,
    );
  }
  builtinProperty(
    realm.arrayPrototype,
    wellKnownSymbol(realm.symbolRegistry, "unscopables"),
    unscopables,
    false,
    true,
    hooks,
  );
  function toObject(
    receiver: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    return toObjectValue(receiver, realm, hooks);
  }
  function lengthOf(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): number {
    return lengthOfArrayLike(object, realm, hooks);
  }
  function integer(value: unknown): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    return converted.value !== converted.value
      ? 0
      : Math.trunc(converted.value);
  }
  function clampedIndex(value: unknown, length: number): number {
    const index = integer(value);
    return index < 0 ? Math.max(length + index, 0) : Math.min(index, length);
  }
  function set(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: ScriptPropertyKey,
    value: unknown,
  ): void {
    if (
      !setProperty<ScriptPropertyKey, unknown>(
        object,
        key,
        value,
        { object, value: object },
        hooks,
      )
    )
      throw createRuntimeError(realm, "type");
  }
  function remove(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: ScriptPropertyKey,
  ): void {
    if (!deleteProperty<ScriptPropertyKey, unknown>(object, key))
      throw createRuntimeError(realm, "type");
  }
  function string(value: unknown): string {
    const converted = stringValue(value, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error === "type") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  const toString = builtinFunction(
    realm.functionPrototype,
    "toString",
    0,
    (receiver, args): unknown => {
      const object = toObject(receiver);
      const method = getProperty<ScriptPropertyKey, unknown>(
        object,
        "join",
        object,
        hooks,
      );
      const callable = viewObjectValue(method, realm.objectPrototype);
      if (isCallableObject<ScriptPropertyKey, unknown>(callable))
        return hooks.call(method, object, []);
      return objectValueTag(object, realm, hooks);
    },
    hooks,
  );
  builtinProperty(
    realm.arrayPrototype,
    "toString",
    toString,
    true,
    true,
    hooks,
  );
  const push = builtinFunction(
    realm.functionPrototype,
    "push",
    1,
    (receiver, args): unknown => {
      const object = toObject(receiver);
      // A packed array's own append, when nothing else can observe it.
      if (args.length === 1) {
        const elements = object.internalArrayElements;
        if (
          elements !== undefined &&
          appendPackedElement(object, args[0], realm)
        )
          return elements.length;
      }
      let length = lengthOf(object);
      if (args.length > 9007199254740991 - length)
        throw createRuntimeError(realm, "type");
      const value: unknown = object;
      const target = { object, value };
      for (let index = 0; index < args.length; index++) {
        if (
          !setProperty<ScriptPropertyKey, unknown>(
            object,
            String(length),
            args[index],
            target,
            hooks,
          )
        )
          throw createRuntimeError(realm, "type");
        length++;
      }
      // Even an empty push performs Set(length), including any setter or rejection.
      if (
        !setProperty<ScriptPropertyKey, unknown>(
          object,
          "length",
          length,
          target,
          hooks,
        )
      )
        throw createRuntimeError(realm, "type");
      return length;
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "push", push, true, true, hooks);
  // Generated calls append to a packed array inline (scriptArrayPush).
  realm.intrinsicFunctions.arrayPush = push;
  function removalMethod(name: string, front: boolean): void {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      0,
      (receiver, args): unknown => {
        const object = toObject(receiver);
        if (!front) {
          const popped = popPackedElement(object, realm);
          if (popped !== realm.arrayPopMiss) return popped;
        }
        const length = lengthOf(object);
        if (length === 0) {
          set(object, "length", 0);
          return undefined;
        }
        const result = getProperty<ScriptPropertyKey, unknown>(
          object,
          String(front ? 0 : length - 1),
          object,
          hooks,
        );
        if (front) {
          for (let index = 1; index < length; index++) {
            const from = String(index),
              to = String(index - 1);
            if (hasProperty<ScriptPropertyKey, unknown>(object, from))
              set(
                object,
                to,
                getProperty<ScriptPropertyKey, unknown>(
                  object,
                  from,
                  object,
                  hooks,
                ),
              );
            else remove(object, to);
          }
        }
        remove(object, String(length - 1));
        set(object, "length", length - 1);
        return result;
      },
      hooks,
    );
    builtinProperty(realm.arrayPrototype, name, method, true, true, hooks);
    if (!front) realm.intrinsicFunctions.arrayPop = method;
  }
  removalMethod("pop", false);
  removalMethod("shift", true);
  const unshift = builtinFunction(
    realm.functionPrototype,
    "unshift",
    1,
    (receiver, args): unknown => {
      const object = toObject(receiver),
        length = lengthOf(object),
        count = args.length;
      if (count > 9007199254740991 - length)
        throw createRuntimeError(realm, "type");
      if (count > 0) {
        for (let index = length; index > 0; index--) {
          const from = String(index - 1),
            to = String(index + count - 1);
          if (hasProperty<ScriptPropertyKey, unknown>(object, from))
            set(
              object,
              to,
              getProperty<ScriptPropertyKey, unknown>(
                object,
                from,
                object,
                hooks,
              ),
            );
          else remove(object, to);
        }
        for (let index = 0; index < count; index++)
          set(object, String(index), args[index]);
      }
      set(object, "length", length + count);
      return length + count;
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "unshift", unshift, true, true, hooks);
  const splice = builtinFunction(
    realm.functionPrototype,
    "splice",
    2,
    (receiver, args): unknown => {
      const object = toObject(receiver);
      const length = lengthOf(object);
      const start = clampedIndex(args[0], length);
      const itemCount = Math.max(args.length - 2, 0);
      const deleted =
        args.length === 0
          ? 0
          : args.length === 1
            ? length - start
            : Math.min(Math.max(integer(args[1]), 0), length - start);
      if (itemCount > 9007199254740991 - length + deleted)
        throw createRuntimeError(realm, "type");
      const result = arraySpeciesCreate(object, deleted, realm, hooks);
      for (let index = 0; index < deleted; index++) {
        const key = String(start + index);
        if (hasProperty<ScriptPropertyKey, unknown>(object, key)) {
          const value = getProperty<ScriptPropertyKey, unknown>(
            object,
            key,
            object,
            hooks,
          );
          if (
            !createDataProperty<ScriptPropertyKey, unknown>(
              result,
              String(index),
              value,
              hooks,
            )
          )
            throw createRuntimeError(realm, "type");
        }
      }
      set(result, "length", deleted);
      function move(from: number, to: number): void {
        const key = String(from);
        if (hasProperty<ScriptPropertyKey, unknown>(object, key))
          set(
            object,
            String(to),
            getProperty<ScriptPropertyKey, unknown>(object, key, object, hooks),
          );
        else remove(object, String(to));
      }
      if (itemCount < deleted) {
        for (let index = start; index < length - deleted; index++)
          move(index + deleted, index + itemCount);
        for (let index = length; index > length - deleted + itemCount; index--)
          remove(object, String(index - 1));
      } else if (itemCount > deleted) {
        for (let index = length - deleted; index > start; index--)
          move(index + deleted - 1, index + itemCount - 1);
      }
      for (let index = 0; index < itemCount; index++)
        set(object, String(start + index), args[index + 2]);
      set(object, "length", length - deleted + itemCount);
      return result;
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "splice", splice, true, true, hooks);
  const at = builtinFunction(
    realm.functionPrototype,
    "at",
    1,
    (receiver, args): unknown => {
      const object = toObject(receiver),
        length = lengthOf(object),
        relative = integer(args[0]);
      const index = relative < 0 ? length + relative : relative;
      if (index < 0 || index >= length) return undefined;
      return getProperty<ScriptPropertyKey, unknown>(
        object,
        String(index),
        object,
        hooks,
      );
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "at", at, true, true, hooks);
  const slice = builtinFunction(
    realm.functionPrototype,
    "slice",
    2,
    (receiver, args): unknown => {
      const object = toObject(receiver),
        length = lengthOf(object);
      const start = clampedIndex(args[0], length);
      const end =
        args[1] === undefined ? length : clampedIndex(args[1], length);
      const count = Math.max(end - start, 0),
        result = arraySpeciesCreate(object, count, realm, hooks);
      for (let index = 0; index < count; index++) {
        const key = String(start + index);
        if (hasProperty<ScriptPropertyKey, unknown>(object, key)) {
          const value = getProperty<ScriptPropertyKey, unknown>(
            object,
            key,
            object,
            hooks,
          );
          if (
            !createDataProperty<ScriptPropertyKey, unknown>(
              result,
              String(index),
              value,
              hooks,
            )
          )
            throw createRuntimeError(realm, "type");
        }
      }
      set(result, "length", count);
      return result;
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "slice", slice, true, true, hooks);
  const fill = builtinFunction(
    realm.functionPrototype,
    "fill",
    1,
    (receiver, args): unknown => {
      const object = toObject(receiver),
        length = lengthOf(object);
      const start = clampedIndex(args[1], length);
      const end =
        args[2] === undefined ? length : clampedIndex(args[2], length);
      for (let index = start; index < end; index++)
        set(object, String(index), args[0]);
      return object;
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "fill", fill, true, true, hooks);
  const copyWithin = builtinFunction(
    realm.functionPrototype,
    "copyWithin",
    2,
    (receiver, args): unknown => {
      const object = toObject(receiver),
        length = lengthOf(object);
      let target = clampedIndex(args[0], length);
      let source = clampedIndex(args[1], length);
      const end =
        args[2] === undefined ? length : clampedIndex(args[2], length);
      let count = Math.min(end - source, length - target);
      let direction = 1;
      if (source < target && target < source + count) {
        direction = -1;
        source += count - 1;
        target += count - 1;
      }
      while (count > 0) {
        const from = String(source),
          to = String(target);
        if (hasProperty<ScriptPropertyKey, unknown>(object, from))
          set(
            object,
            to,
            getProperty<ScriptPropertyKey, unknown>(
              object,
              from,
              object,
              hooks,
            ),
          );
        else remove(object, to);
        source += direction;
        target += direction;
        count--;
      }
      return object;
    },
    hooks,
  );
  builtinProperty(
    realm.arrayPrototype,
    "copyWithin",
    copyWithin,
    true,
    true,
    hooks,
  );
  const reverse = builtinFunction(
    realm.functionPrototype,
    "reverse",
    0,
    (receiver, args): unknown => {
      const object = toObject(receiver),
        length = lengthOf(object),
        middle = Math.floor(length / 2);
      for (let index = 0; index < middle; index++) {
        const lower = String(index),
          upper = String(length - index - 1);
        const lowerPresent = hasProperty<ScriptPropertyKey, unknown>(
          object,
          lower,
        );
        const lowerValue = lowerPresent
          ? getProperty<ScriptPropertyKey, unknown>(
              object,
              lower,
              object,
              hooks,
            )
          : undefined;
        const upperPresent = hasProperty<ScriptPropertyKey, unknown>(
          object,
          upper,
        );
        const upperValue = upperPresent
          ? getProperty<ScriptPropertyKey, unknown>(
              object,
              upper,
              object,
              hooks,
            )
          : undefined;
        if (lowerPresent && upperPresent) {
          set(object, lower, upperValue);
          set(object, upper, lowerValue);
        } else if (upperPresent) {
          set(object, lower, upperValue);
          remove(object, upper);
        } else if (lowerPresent) {
          remove(object, lower);
          set(object, upper, lowerValue);
        }
      }
      return object;
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "reverse", reverse, true, true, hooks);
  function requireCallback(callback: unknown): void {
    if (
      !isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(callback, realm.objectPrototype),
      )
    )
      throw createRuntimeError(realm, "type");
  }
  function iterationMethod(name: string): void {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      1,
      (receiver, args): unknown => {
        const object = toObject(receiver);
        const length = lengthOf(object);
        const callback = args[0];
        requireCallback(callback);
        // Capture length once, but observe presence and value at each iteration.
        for (let index = 0; index < length; index++) {
          const key = String(index);
          if (hasProperty<ScriptPropertyKey, unknown>(object, key)) {
            const value = getProperty<ScriptPropertyKey, unknown>(
              object,
              key,
              object,
              hooks,
            );
            const result = hooks.call(callback, args[1], [
              value,
              index,
              object,
            ]);
            if (
              name === "every" &&
              !scriptBoolean(result, realm.objectPrototype)
            )
              return false;
            if (name === "some" && scriptBoolean(result, realm.objectPrototype))
              return true;
          }
        }
        if (name === "every") return true;
        if (name === "some") return false;
        return undefined;
      },
      hooks,
    );
    builtinProperty(realm.arrayPrototype, name, method, true, true, hooks);
  }
  iterationMethod("forEach");
  iterationMethod("every");
  iterationMethod("some");
  // FindViaPredicate reads every index, including holes. Unlike every/some,
  // presence checks would change observable getter and callback behavior.
  function searchMethod(
    name: string,
    reverse: boolean,
    returnIndex: boolean,
  ): void {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      1,
      (receiver, args): unknown => {
        const object = toObject(receiver);
        const length = lengthOf(object);
        const callback = args[0];
        requireCallback(callback);
        let index = reverse ? length - 1 : 0;
        while (index >= 0 && index < length) {
          const value = getProperty<ScriptPropertyKey, unknown>(
            object,
            String(index),
            object,
            hooks,
          );
          if (
            scriptBoolean(
              hooks.call(callback, args[1], [value, index, object]),
              realm.objectPrototype,
            )
          )
            return returnIndex ? index : value;
          index += reverse ? -1 : 1;
        }
        return returnIndex ? -1 : undefined;
      },
      hooks,
    );
    builtinProperty(realm.arrayPrototype, name, method, true, true, hooks);
  }
  searchMethod("find", false, false);
  searchMethod("findIndex", false, true);
  searchMethod("findLast", true, false);
  searchMethod("findLastIndex", true, true);
  function reductionMethod(name: string, reverse: boolean): void {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      1,
      (receiver, args): unknown => {
        const object = toObject(receiver);
        const length = lengthOf(object);
        const callback = args[0];
        requireCallback(callback);
        const step = reverse ? -1 : 1;
        let index = reverse ? length - 1 : 0;
        let accumulator = args[1];
        let initialized = args.length > 1;
        while (index >= 0 && index < length) {
          const key = String(index);
          if (hasProperty<ScriptPropertyKey, unknown>(object, key)) {
            const value = getProperty<ScriptPropertyKey, unknown>(
              object,
              key,
              object,
              hooks,
            );
            if (initialized)
              accumulator = hooks.call(callback, undefined, [
                accumulator,
                value,
                index,
                object,
              ]);
            else {
              accumulator = value;
              initialized = true;
            }
          }
          index += step;
        }
        if (!initialized) throw createRuntimeError(realm, "type");
        return accumulator;
      },
      hooks,
    );
    builtinProperty(realm.arrayPrototype, name, method, true, true, hooks);
  }
  reductionMethod("reduce", false);
  reductionMethod("reduceRight", true);
  function valueSearchMethod(
    name: string,
    reverse: boolean,
    includes: boolean,
  ): void {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      1,
      (receiver, args): unknown => {
        const object = toObject(receiver);
        const length = lengthOf(object);
        if (length === 0) return includes ? false : -1;
        let from = reverse ? length - 1 : 0;
        if (args.length > 1) from = integer(args[1]);
        let index = reverse
          ? from >= 0
            ? Math.min(from, length - 1)
            : length + from
          : from >= 0
            ? from
            : Math.max(length + from, 0);
        while (index >= 0 && index < length) {
          const key = String(index);
          if (
            includes ||
            hasProperty<ScriptPropertyKey, unknown>(object, key)
          ) {
            const value = getProperty<ScriptPropertyKey, unknown>(
              object,
              key,
              object,
              hooks,
            );
            const search = args[0];
            const equal =
              scriptStrictEqual(value, search) ||
              (includes &&
                typeof value === "number" &&
                typeof search === "number" &&
                value !== value &&
                search !== search);
            if (equal) return includes ? true : index === 0 ? 0 : index;
          }
          index += reverse ? -1 : 1;
        }
        return includes ? false : -1;
      },
      hooks,
    );
    builtinProperty(realm.arrayPrototype, name, method, true, true, hooks);
  }
  valueSearchMethod("indexOf", false, false);
  valueSearchMethod("lastIndexOf", true, false);
  valueSearchMethod("includes", false, true);
  function selectionMethod(name: string, map: boolean): void {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      1,
      (receiver, args): unknown => {
        const object = toObject(receiver);
        const length = lengthOf(object);
        const callback = args[0];
        requireCallback(callback);
        const result = arraySpeciesCreate(
          object,
          map ? length : 0,
          realm,
          hooks,
        );
        let selected = 0;
        for (let index = 0; index < length; index++) {
          const key = String(index);
          if (hasProperty<ScriptPropertyKey, unknown>(object, key)) {
            const value = getProperty<ScriptPropertyKey, unknown>(
              object,
              key,
              object,
              hooks,
            );
            const selectedValue = hooks.call(callback, args[1], [
              value,
              index,
              object,
            ]);
            if (map || scriptBoolean(selectedValue, realm.objectPrototype)) {
              if (
                !createDataProperty<ScriptPropertyKey, unknown>(
                  result,
                  String(map ? index : selected),
                  map ? selectedValue : value,
                  hooks,
                )
              )
                throw createRuntimeError(realm, "type");
              selected++;
            }
          }
        }
        return result;
      },
      hooks,
    );
    builtinProperty(realm.arrayPrototype, name, method, true, true, hooks);
  }
  selectionMethod("filter", false);
  selectionMethod("map", true);
  const join = builtinFunction(
    realm.functionPrototype,
    "join",
    1,
    (receiver, args): unknown => {
      const object = toObject(receiver),
        length = lengthOf(object);
      const separator = args[0] === undefined ? "," : string(args[0]);
      return joinIndexedProperties(
        object,
        length,
        separator,
        undefined,
        [],
        realm,
        hooks,
      );
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "join", join, true, true, hooks);
  builtinProperty(
    realm.arrayPrototype,
    "toLocaleString",
    builtinFunction(
      realm.functionPrototype,
      "toLocaleString",
      0,
      (receiver, args): unknown => {
        const object = toObject(receiver),
          length = lengthOf(object);
        // LocalizedListSeparator's initial implementation-defined policy is comma.
        return joinIndexedProperties(
          object,
          length,
          ",",
          "toLocaleString",
          [args[0], args[1]],
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
