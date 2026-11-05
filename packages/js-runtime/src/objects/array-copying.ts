import { lengthOfArrayLike } from "./array-like.ts";
import { createArrayObject } from "./arrays.ts";
import { toObjectValue } from "./boxing.ts";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createDataProperty,
  getProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Change-by-copy methods always produce dense intrinsic arrays, without species. */
export function installArrayCopying(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function integer(value: unknown): number {
    const result = numberValue(value, hooks, realm);
    if (result.error === "unsupported") rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value !== result.value ? 0 : Math.trunc(result.value);
  }
  function create(length: number): OrdinaryObject<ScriptPropertyKey, unknown> {
    return createArrayObject<ScriptPropertyKey, unknown>(
      length,
      realm.arrayPrototype,
      realm.arrayHooks,
      hooks,
    );
  }
  function read(
    source: OrdinaryObject<ScriptPropertyKey, unknown>,
    index: number,
  ): unknown {
    return getProperty<ScriptPropertyKey, unknown>(
      source,
      String(index),
      source,
      hooks,
    );
  }
  function write(
    target: OrdinaryObject<ScriptPropertyKey, unknown>,
    index: number,
    value: unknown,
  ): void {
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        target,
        String(index),
        value,
        hooks,
      )
    )
      throw createRuntimeError(realm, "type");
  }
  const reversed = builtinFunction(
    realm.functionPrototype,
    "toReversed",
    0,
    (receiver, args): unknown => {
      const source = toObjectValue(receiver, realm, hooks);
      const length = lengthOfArrayLike(source, realm, hooks);
      const result = create(length);
      for (let index = 0; index < length; index++)
        write(result, index, read(source, length - index - 1));
      return result;
    },
    hooks,
  );
  builtinProperty(
    realm.arrayPrototype,
    "toReversed",
    reversed,
    true,
    true,
    hooks,
  );
  const replaced = builtinFunction(
    realm.functionPrototype,
    "with",
    2,
    (receiver, args): unknown => {
      const source = toObjectValue(receiver, realm, hooks);
      const length = lengthOfArrayLike(source, realm, hooks);
      const relative = integer(args[0]);
      const selected = relative >= 0 ? relative : length + relative;
      if (selected < 0 || selected >= length)
        throw createRuntimeError(realm, "range");
      const result = create(length);
      for (let index = 0; index < length; index++)
        write(
          result,
          index,
          index === selected ? args[1] : read(source, index),
        );
      return result;
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "with", replaced, true, true, hooks);
  const spliced = builtinFunction(
    realm.functionPrototype,
    "toSpliced",
    2,
    (receiver, args): unknown => {
      const source = toObjectValue(receiver, realm, hooks);
      const length = lengthOfArrayLike(source, realm, hooks);
      const relative = integer(args[0]);
      const start =
        relative < 0
          ? Math.max(length + relative, 0)
          : Math.min(relative, length);
      const inserted = Math.max(args.length - 2, 0);
      const removed =
        args.length === 0
          ? 0
          : args.length === 1
            ? length - start
            : Math.min(Math.max(integer(args[1]), 0), length - start);
      const count = length - removed + inserted;
      if (count > 9007199254740991) throw createRuntimeError(realm, "type");
      const result = create(count);
      let target = 0;
      for (; target < start; target++)
        write(result, target, read(source, target));
      for (let index = 0; index < inserted; index++)
        write(result, target++, args[index + 2]);
      for (let index = start + removed; index < length; index++)
        write(result, target++, read(source, index));
      return result;
    },
    hooks,
  );
  builtinProperty(
    realm.arrayPrototype,
    "toSpliced",
    spliced,
    true,
    true,
    hooks,
  );
}
