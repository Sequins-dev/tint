import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { speciesConstructor } from "./species.ts";
import { constructObjectValue } from "./functions.ts";
import { lengthOfArrayLike, createArrayFromList } from "./array-like.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  regexpString,
  regexpInteger,
  regexpLength,
  regexpExec,
  setRegExpLastIndex,
  advanceStringIndex,
} from "./regexp-runtime.ts";

export function splitLimit(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  if (value === undefined) return 4294967295;
  const integer = regexpInteger(value, realm, hooks);
  if (integer === Infinity || integer === -Infinity) return 0;
  const remainder = integer % 4294967296;
  return remainder < 0 ? remainder + 4294967296 : remainder;
}
export function splitRegExp(
  receiver: unknown,
  value: unknown,
  limit: unknown,
  intrinsic: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = viewObjectValue(receiver, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const input = regexpString(value, realm, hooks);
  const constructor = speciesConstructor(object, intrinsic, realm, hooks);
  const flags = regexpString(
    getProperty<ScriptPropertyKey, unknown>(object, "flags", object, hooks),
    realm,
    hooks,
  );
  const unicode = flags.indexOf("u") >= 0 || flags.indexOf("v") >= 0;
  const newFlags = flags.indexOf("y") >= 0 ? flags : flags + "y";
  const constructed = constructObjectValue(
    constructor,
    [object, newFlags],
    realm.objectPrototype,
  );
  if (constructed.error !== "none") throw createRuntimeError(realm, "type");
  const splitter = viewObjectValue(constructed.value, realm.objectPrototype);
  if (splitter === undefined) throw createRuntimeError(realm, "type");
  const values: unknown[] = [];
  function finish(): OrdinaryObject<ScriptPropertyKey, unknown> {
    return createArrayFromList(values, 0, realm.arrayPrototype, realm, hooks);
  }
  const maximum = splitLimit(limit, realm, hooks);
  if (maximum === 0) return finish();
  if (input === "") {
    if (regexpExec(splitter, input, realm, hooks) === null) values.push(input);
    return finish();
  }
  let previous = 0,
    index = 0;
  while (index < input.length) {
    setRegExpLastIndex(splitter, index, realm, hooks);
    const result = regexpExec(splitter, input, realm, hooks);
    if (result === null) {
      index = advanceStringIndex(input, index, unicode);
      continue;
    }
    const end = Math.min(
      regexpLength(
        getProperty<ScriptPropertyKey, unknown>(
          splitter,
          "lastIndex",
          splitter,
          hooks,
        ),
        realm,
        hooks,
      ),
      input.length,
    );
    if (end === previous) {
      index = advanceStringIndex(input, index, unicode);
      continue;
    }
    values.push(input.slice(previous, index));
    if (values.length === maximum) return finish();
    previous = end;
    const captures = Math.max(lengthOfArrayLike(result, realm, hooks) - 1, 0);
    for (let i = 1; i <= captures; i++) {
      values.push(
        getProperty<ScriptPropertyKey, unknown>(
          result,
          String(i),
          result,
          hooks,
        ),
      );
      if (values.length === maximum) return finish();
    }
    index = previous;
  }
  values.push(input.slice(previous));
  return finish();
}
