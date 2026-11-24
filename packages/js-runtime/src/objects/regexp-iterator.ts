import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { speciesConstructor } from "./species.ts";
import { constructObjectValue } from "./functions.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  regexpString,
  regexpLength,
  regexpExec,
  setRegExpLastIndex,
  advanceStringIndex,
} from "./regexp-runtime.ts";

export interface RegExpIteratorData {
  matcher: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  input: string;
  executing: boolean;
  done: boolean;
  readonly realm: ErrorRealm;
  readonly hooks: ObjectHooks<unknown>;
  readonly global: boolean;
  readonly unicode: boolean;
}
function finish(data: RegExpIteratorData): void {
  data.matcher = undefined;
  data.input = "";
}
/** Resume under the iterator's creation realm, as GeneratorResume does. */
function resumeRegExpIterator(data: RegExpIteratorData): unknown {
  const realm = data.realm,
    hooks = data.hooks;
  try {
    const matcher = data.matcher;
    if (matcher === undefined) {
      data.done = true;
      return createIteratorResult(undefined, true, realm, hooks);
    }
    const result = regexpExec(matcher, data.input, realm, hooks);
    if (result === null) {
      finish(data);
      data.done = true;
      return createIteratorResult(undefined, true, realm, hooks);
    }
    if (!data.global) finish(data);
    else {
      const matched = regexpString(
        getProperty<ScriptPropertyKey, unknown>(result, "0", result, hooks),
        realm,
        hooks,
      );
      if (matched === "") {
        const index = regexpLength(
          getProperty<ScriptPropertyKey, unknown>(
            matcher,
            "lastIndex",
            matcher,
            hooks,
          ),
          realm,
          hooks,
        );
        setRegExpLastIndex(
          matcher,
          advanceStringIndex(data.input, index, data.unicode),
          realm,
          hooks,
        );
      }
    }
    return createIteratorResult(result, false, realm, hooks);
  } catch (error) {
    finish(data);
    data.done = true;
    throw error;
  } finally {
    data.executing = false;
  }
}
export function installRegExpIterator(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.regexpStringIteratorPrototype;
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "RegExp String Iterator",
    false,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "next",
    builtinFunction(
      realm.functionPrototype,
      "next",
      0,
      (receiver, args): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype);
        const data =
          object === undefined
            ? undefined
            : exoticSlots(object).internalRegExpIteratorData;
        if (data === undefined) throw createRuntimeError(realm, "type");
        if (data.executing) throw createRuntimeError(realm, "type");
        if (data.done)
          return createIteratorResult(undefined, true, realm, hooks);
        data.executing = true;
        return data.realm.executionContext.run((): unknown =>
          resumeRegExpIterator(data),
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
export function matchAllRegExp(
  receiver: unknown,
  value: unknown,
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
  const constructed = constructObjectValue(
    constructor,
    [object, flags],
    realm.objectPrototype,
  );
  if (constructed.error !== "none") throw createRuntimeError(realm, "type");
  const matcher = viewObjectValue(constructed.value, realm.objectPrototype);
  if (matcher === undefined) throw createRuntimeError(realm, "type");
  const index = regexpLength(
    getProperty<ScriptPropertyKey, unknown>(object, "lastIndex", object, hooks),
    realm,
    hooks,
  );
  setRegExpLastIndex(matcher, index, realm, hooks);
  const iterator = createObject<ScriptPropertyKey, unknown>(
    realm.regexpStringIteratorPrototype,
  );
  ensureExoticSlots(iterator).internalRegExpIteratorData = {
    matcher,
    input,
    executing: false,
    done: false,
    realm,
    hooks,
    global: flags.indexOf("g") >= 0,
    unicode: flags.indexOf("u") >= 0 || flags.indexOf("v") >= 0,
  };
  return iterator;
}
