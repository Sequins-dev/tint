import { installRegExpIterator, matchAllRegExp } from "./regexp-iterator.ts";
import { splitRegExp } from "./regexp-split.ts";
import { replaceRegExp } from "./regexp-replace.ts";
import { createArrayFromList } from "./array-like.ts";
import {
  getProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  advanceStringIndex,
  regexpLength,
  regexpString,
  regexpExec,
  setRegExpLastIndex,
} from "./regexp-runtime.ts";

export function installRegExpProtocols(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
): void {
  installRegExpIterator(realm, hooks);
  builtinProperty(
    realm.regexpPrototype,
    wellKnownSymbol(realm.symbolRegistry, "matchAll"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.matchAll]",
      1,
      (receiver, args): unknown =>
        matchAllRegExp(receiver, args[0], constructor, realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.regexpPrototype,
    wellKnownSymbol(realm.symbolRegistry, "split"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.split]",
      2,
      (receiver, args): unknown =>
        splitRegExp(receiver, args[0], args[1], constructor, realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.regexpPrototype,
    wellKnownSymbol(realm.symbolRegistry, "replace"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.replace]",
      2,
      (receiver, args): unknown =>
        replaceRegExp(receiver, args[0], args[1], realm, hooks),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.regexpPrototype,
    wellKnownSymbol(realm.symbolRegistry, "match"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.match]",
      1,
      (receiver, args): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype);
        if (object === undefined) throw createRuntimeError(realm, "type");
        const input = regexpString(args[0], realm, hooks);
        const flags = regexpString(
          getProperty<ScriptPropertyKey, unknown>(
            object,
            "flags",
            object,
            hooks,
          ),
          realm,
          hooks,
        );
        if (flags.indexOf("g") < 0)
          return regexpExec(object, input, realm, hooks);
        const unicode = flags.indexOf("u") >= 0 || flags.indexOf("v") >= 0;
        setRegExpLastIndex(object, 0, realm, hooks);
        const matches: unknown[] = [];
        while (true) {
          const result = regexpExec(object, input, realm, hooks);
          if (result === null)
            return matches.length === 0
              ? null
              : createArrayFromList(
                  matches,
                  0,
                  realm.arrayPrototype,
                  realm,
                  hooks,
                );
          const matched = regexpString(
            getProperty<ScriptPropertyKey, unknown>(result, "0", result, hooks),
            realm,
            hooks,
          );
          matches.push(matched);
          if (matched === "") {
            const index = regexpLength(
              getProperty<ScriptPropertyKey, unknown>(
                object,
                "lastIndex",
                object,
                hooks,
              ),
              realm,
              hooks,
            );
            setRegExpLastIndex(
              object,
              advanceStringIndex(input, index, unicode),
              realm,
              hooks,
            );
          }
        }
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.regexpPrototype,
    wellKnownSymbol(realm.symbolRegistry, "search"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.search]",
      1,
      (receiver, args): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype);
        if (object === undefined) throw createRuntimeError(realm, "type");
        const input = regexpString(args[0], realm, hooks);
        const previous = getProperty<ScriptPropertyKey, unknown>(
          object,
          "lastIndex",
          object,
          hooks,
        );
        if (!hooks.sameValue(previous, 0))
          setRegExpLastIndex(object, 0, realm, hooks);
        const result = regexpExec(object, input, realm, hooks);
        const current = getProperty<ScriptPropertyKey, unknown>(
          object,
          "lastIndex",
          object,
          hooks,
        );
        if (!hooks.sameValue(current, previous))
          setRegExpLastIndex(object, previous, realm, hooks);
        return result === null
          ? -1
          : getProperty<ScriptPropertyKey, unknown>(
              result,
              "index",
              result,
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
