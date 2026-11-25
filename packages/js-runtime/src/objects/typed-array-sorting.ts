import {
  sortIndexed,
  type IndexedAccess,
} from "@tint/foundation/collections/indexed-sort";
import { constructTypedArrayResult } from "./typed-array-result.ts";
import {
  requireTypedArray,
  typedArrayWindow,
  readTypedArrayElement,
  writeTypedArrayNumber,
  setTypedArrayElement,
  type TypedArrayElementKind,
} from "./typed-array-data.ts";
import {
  compareTypedArrayNumbers,
  sortTypedArrayNumbers,
  countingSortIntegers,
} from "./typed-array-sort-kernels.ts";
import { numberValue } from "./coercion.ts";
import { viewBigIntValue, compareBigIntValues } from "./bigints.ts";
import { viewObjectValue } from "./values.ts";
import { isCallableObject } from "./call.ts";
import type { ObjectHooks, OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { exoticSlots } from "./operations.ts";

/** Value count of an 8- or 16-bit integer element kind; 0 for other kinds. */
function integerElementRange(kind: TypedArrayElementKind): number {
  if (kind === "Int8" || kind === "Uint8" || kind === "Uint8Clamped")
    return 256;
  return kind === "Int16" || kind === "Uint16" ? 65536 : 0;
}
function integerElementMinimum(kind: TypedArrayElementKind): number {
  return kind === "Int8" ? -128 : kind === "Int16" ? -32768 : 0;
}
/** Comparator sorts share stable indexed sorting with Array; the default
 * numeric order sorts unboxed element values directly. */
export function installTypedArraySorting(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  constructors: Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>,
): void {
  function install(name: string, copying: boolean): void {
    builtinProperty(
      realm.typedArrayPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const comparator = args[0];
          if (
            comparator !== undefined &&
            !isCallableObject<ScriptPropertyKey, unknown>(
              viewObjectValue(comparator, realm.objectPrototype),
            )
          )
            throw createRuntimeError(realm, "type");
          const data = requireTypedArray(
              receiver,
              realm,
              copying ? "read" : "write",
            ),
            window = typedArrayWindow(data, copying ? "read" : "write");
          if (window === undefined) throw createRuntimeError(realm, "type");
          const source = viewObjectValue(receiver, realm.objectPrototype),
            constructor = constructors.get(data.kind);
          if (source === undefined || constructor === undefined)
            throw "TYPED_ARRAY_SORT_INVARIANT";
          const length = window.length,
            target = copying
              ? constructTypedArrayResult(constructor, [length], realm, "write")
              : source;
          const targetData = exoticSlots(target).internalTypedArrayData;
          if (targetData === undefined) throw "TYPED_ARRAY_SORT_INVARIANT";
          // SortIndexedProperties reads every element before any comparison,
          // and nothing observable runs between the window capture and here.
          const elements = typedArrayWindow(data, "read", "unordered");
          if (elements === undefined || elements.length < length)
            throw "TYPED_ARRAY_SORT_INVARIANT";
          const kind = data.kind;
          if (
            comparator === undefined &&
            kind !== "BigInt64" &&
            kind !== "BigUint64"
          ) {
            // Default numeric order runs no user code: sort unboxed numbers
            // and store them straight back into the (unchanged) storage.
            const values: number[] = [];
            for (let index = 0; index < length; index++) {
              const value = readTypedArrayElement(data, index, elements);
              if (typeof value !== "number")
                throw "TYPED_ARRAY_SORT_VALUE_INVARIANT";
              values.push(value);
            }
            const range = integerElementRange(kind);
            if (range !== 0 && (range <= 256 || length * 16 >= range))
              countingSortIntegers(values, integerElementMinimum(kind), range);
            else sortTypedArrayNumbers(values);
            const stores = typedArrayWindow(targetData, "write", "unordered");
            if (stores === undefined || stores.length < length)
              throw "TYPED_ARRAY_SORT_INVARIANT";
            for (let index = 0; index < length; index++) {
              const value = values[index];
              if (value === undefined) throw "TYPED_ARRAY_SORT_VALUE_INVARIANT";
              writeTypedArrayNumber(targetData, index, value, stores);
            }
            return target;
          }
          const values: unknown[] = [];
          for (let index = 0; index < length; index++)
            values.push(readTypedArrayElement(data, index, elements));
          const access: IndexedAccess<unknown> = {
            length: (): number => length,
            has: (index): boolean => true,
            read: (index): unknown => values[index],
            // A comparator may have resized or detached the storage, so each
            // store is TypedArraySetElement with its own validity check.
            write: (index, value): void => {
              setTypedArrayElement(targetData, index, value, realm, hooks);
            },
            remove: (index): void => {
              throw "TYPED_ARRAY_SORT_HOLE_INVARIANT";
            },
          };
          sortIndexed<unknown>(access, (left, right): number => {
            if (comparator !== undefined) {
              const converted = numberValue(
                hooks.call(comparator, undefined, [left, right]),
                hooks,
                realm,
              );
              if (converted.error === "unsupported")
                return rejectUnsupportedExecution(realm);
              if (converted.error !== "none")
                throw createRuntimeError(realm, "type");
              return converted.value !== converted.value ? 0 : converted.value;
            }
            if (typeof left === "number" && typeof right === "number")
              return compareTypedArrayNumbers(left, right);
            const a = viewBigIntValue(left),
              b = viewBigIntValue(right);
            if (a === undefined || b === undefined)
              throw "TYPED_ARRAY_SORT_VALUE_INVARIANT";
            return compareBigIntValues(a, b);
          });
          return target;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  install("sort", false);
  install("toSorted", true);
}
