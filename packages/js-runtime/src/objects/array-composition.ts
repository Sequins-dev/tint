import { lengthOfArrayLike } from "./array-like.ts";
import { arraySpeciesCreate } from "./array-species.ts";
import { isCallableObject } from "./call.ts";
import { numberValue } from "./coercion.ts";
import { toObjectValue } from "./boxing.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createDataProperty,
  getProperty,
  hasProperty,
  setProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { isArrayValue, scriptBoolean, viewObjectValue } from "./values.ts";

interface FlattenFrame {
  readonly source: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly length: number;
  readonly depth: number;
  index: number;
}

/** Array composition preserves sparse properties and species construction. */
export function installArrayComposition(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const concat = builtinFunction(
    realm.functionPrototype,
    "concat",
    1,
    (receiver, args): unknown => {
      const original = toObjectValue(receiver, realm, hooks);
      const result = arraySpeciesCreate(original, 0, realm, hooks);
      let nextIndex = 0;
      function append(value: unknown): void {
        if (
          !createDataProperty<ScriptPropertyKey, unknown>(
            result,
            String(nextIndex),
            value,
            hooks,
          )
        )
          throw createRuntimeError(realm, "type");
      }
      // Include the boxed receiver before the argument list, without consulting
      // an iterator or copying the inputs into a new list.
      for (let itemIndex = -1; itemIndex < args.length; itemIndex++) {
        const item = itemIndex < 0 ? original : args[itemIndex];
        const object = viewObjectValue(item, realm.objectPrototype);
        let spread = false;
        if (object !== undefined) {
          const flag = getProperty<ScriptPropertyKey, unknown>(
            object,
            wellKnownSymbol(realm.symbolRegistry, "isConcatSpreadable"),
            item,
            hooks,
          );
          spread =
            flag === undefined
              ? isArrayValue(item, realm)
              : scriptBoolean(flag, realm.objectPrototype);
        }
        if (spread && object !== undefined) {
          const length = lengthOfArrayLike(object, realm, hooks);
          if (nextIndex + length > 9007199254740991)
            throw createRuntimeError(realm, "type");
          for (let index = 0; index < length; index++) {
            const key = String(index);
            if (hasProperty<ScriptPropertyKey, unknown>(object, key))
              append(
                getProperty<ScriptPropertyKey, unknown>(
                  object,
                  key,
                  item,
                  hooks,
                ),
              );
            nextIndex++;
          }
        } else {
          if (nextIndex >= 9007199254740991)
            throw createRuntimeError(realm, "type");
          append(item);
          nextIndex++;
        }
      }
      if (
        !setProperty<ScriptPropertyKey, unknown>(
          result,
          "length",
          nextIndex,
          { object: result, value: result },
          hooks,
        )
      )
        throw createRuntimeError(realm, "type");
      return result;
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "concat", concat, true, true, hooks);

  function flatten(
    source: OrdinaryObject<ScriptPropertyKey, unknown>,
    length: number,
    depth: number,
    mapper: unknown,
    thisArg: unknown,
  ): unknown {
    const result = arraySpeciesCreate(source, 0, realm, hooks);
    const frames: FlattenFrame[] = [{ source, length, depth, index: 0 }];
    let targetIndex = 0;
    // Model recursive specification traversal explicitly so deeply nested
    // input does not consume the native call stack.
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) throw "ARRAY_FLATTEN_FRAME_INVARIANT";
      if (frame.index >= frame.length) {
        frames.pop();
        continue;
      }
      const index = frame.index++,
        key = String(index);
      if (!hasProperty<ScriptPropertyKey, unknown>(frame.source, key)) continue;
      let value = getProperty<ScriptPropertyKey, unknown>(
        frame.source,
        key,
        frame.source,
        hooks,
      );
      if (frames.length === 1 && mapper !== undefined)
        value = hooks.call(mapper, thisArg, [value, index, source]);
      const object = viewObjectValue(value, realm.objectPrototype);
      if (
        frame.depth > 0 &&
        object !== undefined &&
        isArrayValue(value, realm)
      ) {
        frames.push({
          source: object,
          length: lengthOfArrayLike(object, realm, hooks),
          depth: frame.depth - 1,
          index: 0,
        });
        continue;
      }
      if (
        targetIndex >= 9007199254740991 ||
        !createDataProperty<ScriptPropertyKey, unknown>(
          result,
          String(targetIndex),
          value,
          hooks,
        )
      )
        throw createRuntimeError(realm, "type");
      targetIndex++;
    }
    return result;
  }
  const flat = builtinFunction(
    realm.functionPrototype,
    "flat",
    0,
    (receiver, args): unknown => {
      const source = toObjectValue(receiver, realm, hooks);
      const length = lengthOfArrayLike(source, realm, hooks);
      let depth = 1;
      if (args[0] !== undefined) {
        const converted = numberValue(args[0], hooks, realm);
        if (converted.error === "unsupported")
          rejectUnsupportedExecution(realm);
        if (converted.error !== "none") throw createRuntimeError(realm, "type");
        depth =
          converted.value !== converted.value
            ? 0
            : Math.max(0, Math.trunc(converted.value));
      }
      return flatten(source, length, depth, undefined, undefined);
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "flat", flat, true, true, hooks);
  const flatMap = builtinFunction(
    realm.functionPrototype,
    "flatMap",
    1,
    (receiver, args): unknown => {
      const source = toObjectValue(receiver, realm, hooks);
      const length = lengthOfArrayLike(source, realm, hooks);
      if (
        !isCallableObject<ScriptPropertyKey, unknown>(
          viewObjectValue(args[0], realm.objectPrototype),
        )
      )
        throw createRuntimeError(realm, "type");
      return flatten(source, length, 1, args[0], args[1]);
    },
    hooks,
  );
  builtinProperty(realm.arrayPrototype, "flatMap", flatMap, true, true, hooks);
}
