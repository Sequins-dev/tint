import {
  createMapWithKeys,
  createMapCursor,
  advanceMapCursor,
  readMapCursorKey,
  setMap,
  type LinkedMap,
} from "@tint/foundation/collections/linked-map";
import { collectionKeyHash, collectionKeyEqual } from "./collection-keys.ts";
import { viewObjectValue } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { exoticSlots } from "./operations.ts";
export function requireSet(
  receiver: unknown,
  realm: ErrorRealm,
): LinkedMap<unknown, unknown> {
  const object = viewObjectValue(receiver, realm.objectPrototype);
  const data =
    object === undefined ? undefined : exoticSlots(object).internalSetData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}

export function createSetData(): LinkedMap<unknown, unknown> {
  return createMapWithKeys<unknown, unknown>({
    hash: collectionKeyHash,
    equals: collectionKeyEqual,
  });
}
export function copySetData(
  source: LinkedMap<unknown, unknown>,
): LinkedMap<unknown, unknown> {
  const result = createSetData(),
    cursor = createMapCursor<unknown, unknown>(source);
  while (advanceMapCursor<unknown, unknown>(cursor)) {
    const key = readMapCursorKey<unknown, unknown>(cursor);
    setMap<unknown, unknown>(result, key, key);
  }
  return result;
}
