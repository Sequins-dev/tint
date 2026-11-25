import {
  createScriptMap,
  createScriptMapCursor,
  advanceScriptMapCursor,
  readScriptMapCursorKey,
  setScriptMap,
  type ScriptMap,
} from "./collection-data.ts";
import { viewObjectValue } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { exoticSlots } from "./operations.ts";
export function requireSet(receiver: unknown, realm: ErrorRealm): ScriptMap {
  const object = viewObjectValue(receiver, realm.objectPrototype);
  const data =
    object === undefined ? undefined : exoticSlots(object).internalSetData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}

export function createSetData(): ScriptMap {
  return createScriptMap();
}
export function copySetData(source: ScriptMap): ScriptMap {
  const result = createSetData(),
    cursor = createScriptMapCursor(source);
  while (advanceScriptMapCursor(cursor)) {
    const key = readScriptMapCursorKey(cursor);
    setScriptMap(result, key, key);
  }
  return result;
}
