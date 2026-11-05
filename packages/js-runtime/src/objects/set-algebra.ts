import {
  hasMap,
  setMap,
  deleteMap,
  createMapCursor,
  advanceMapCursor,
  readMapCursorKey,
  type LinkedMap,
} from "@tint/foundation/collections/linked-map";
import { createObject, type ObjectHooks } from "./operations.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { callObjectValue, scriptBoolean } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { type ScriptPropertyKey } from "./symbols.ts";
import { stepScriptIterator, closeScriptIterator } from "./iteration.ts";
import {
  getScriptSetRecord,
  getScriptSetKeys,
  type ScriptSetRecord,
} from "./set-record.ts";
import { requireSet, createSetData, copySetData } from "./set-data.ts";

function setResult(
  data: LinkedMap<unknown, unknown>,
  realm: ErrorRealm,
): unknown {
  const result = createObject<ScriptPropertyKey, unknown>(realm.setPrototype);
  result.internalSetData = data;
  return result;
}
function otherHas(
  record: ScriptSetRecord,
  value: unknown,
  realm: ErrorRealm,
): boolean {
  const called = callObjectValue(
    record.has,
    record.object,
    [value],
    realm.objectPrototype,
  );
  if (called.error !== "none") throw createRuntimeError(realm, "type");
  return scriptBoolean(called.value, realm.objectPrototype);
}
export function installSetAlgebra(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  for (const name of [
    "union",
    "symmetricDifference",
    "difference",
    "intersection",
    "isSubsetOf",
    "isSupersetOf",
    "isDisjointFrom",
  ]) {
    if (name === undefined) throw "SET_ALGEBRA_NAME_INVARIANT";
    builtinProperty(
      realm.setPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const set = requireSet(receiver, realm),
            other = getScriptSetRecord(args[0], realm, hooks);
          if (name === "union" || name === "symmetricDifference") {
            const iterator = getScriptSetKeys(other, realm, hooks);
            // keys() and its next getter precede the snapshot and may mutate set.
            const result = copySetData(set);
            while (true) {
              const step = stepScriptIterator(iterator);
              if (step.done) return setResult(result, realm);
              const value = step.value === 0 ? 0 : step.value;
              if (
                name === "symmetricDifference" &&
                hasMap<unknown, unknown>(set, value)
              )
                deleteMap<unknown, unknown>(result, value);
              else setMap<unknown, unknown>(result, value, value);
            }
          }
          if (name === "isSubsetOf" && set.size > other.size) return false;
          if (name === "isSupersetOf" && set.size < other.size) return false;
          const result =
            name === "difference" ? copySetData(set) : createSetData();
          if (name !== "isSupersetOf" && set.size <= other.size) {
            // Difference traverses a snapshot; the other has-based paths stay live.
            const cursor = createMapCursor<unknown, unknown>(
              name === "difference" ? result : set,
            );
            while (advanceMapCursor<unknown, unknown>(cursor)) {
              const value = readMapCursorKey<unknown, unknown>(cursor),
                found = otherHas(other, value, realm);
              if (name === "difference" && found)
                deleteMap<unknown, unknown>(result, value);
              if (name === "intersection" && found)
                setMap<unknown, unknown>(result, value, value);
              if (
                (name === "isSubsetOf" && !found) ||
                (name === "isDisjointFrom" && found)
              )
                return false;
            }
          } else {
            const iterator = getScriptSetKeys(other, realm, hooks);
            while (true) {
              const step = stepScriptIterator(iterator);
              if (step.done) break;
              const value = step.value === 0 ? 0 : step.value;
              if (name === "difference")
                deleteMap<unknown, unknown>(result, value);
              else {
                const found = hasMap<unknown, unknown>(set, value);
                if (name === "intersection" && found)
                  setMap<unknown, unknown>(result, value, value);
                if (
                  (name === "isSupersetOf" && !found) ||
                  (name === "isDisjointFrom" && found)
                ) {
                  closeScriptIterator(iterator, false);
                  return false;
                }
              }
            }
          }
          return name === "difference" || name === "intersection"
            ? setResult(result, realm)
            : true;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
