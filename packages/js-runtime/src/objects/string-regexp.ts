import { splitLimit } from "./regexp-split.ts";
import { createArrayFromList } from "./array-like.ts";
import { type ObjectHooks, type OrdinaryObject } from "./operations.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { requireObjectCoercible } from "./boxing.ts";
import { getObjectValueProperty, viewObjectValue } from "./values.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  regexpString,
  allocateRegExpObject,
  initializeRegExpObject,
} from "./regexp-runtime.ts";
import { isRegExpValue } from "./regexp-intrinsics.ts";
import { substituteMatch } from "./substitution.ts";

function protocolMethod(
  value: unknown,
  name: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const result = getObjectValueProperty(
    value,
    wellKnownSymbol(realm.symbolRegistry, name),
    hooks,
    realm,
  );
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  if (result.value === null || result.value === undefined) return undefined;
  const method = viewObjectValue(result.value, realm.objectPrototype);
  if (method === undefined || method.internalCall === undefined)
    throw createRuntimeError(realm, "type");
  return method;
}

export function installStringRegExpMethods(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.stringPrototype,
    "split",
    builtinFunction(
      realm.functionPrototype,
      "split",
      2,
      (receiver, args): unknown => {
        requireObjectCoercible(receiver, realm);
        const separator = args[0];
        if (separator !== undefined && separator !== null) {
          const method = protocolMethod(separator, "split", realm, hooks);
          if (method !== undefined)
            return hooks.call(method, separator, [receiver, args[1]]);
        }
        const input = regexpString(receiver, realm, hooks);
        const maximum = splitLimit(args[1], realm, hooks);
        const needle = regexpString(separator, realm, hooks);
        const values: unknown[] = [];
        if (maximum !== 0) {
          if (separator === undefined) values.push(input);
          else if (needle === "") {
            for (
              let index = 0;
              index < Math.min(input.length, maximum);
              index++
            )
              values.push(input.charAt(index));
          } else {
            let start = 0,
              index = input.indexOf(needle);
            while (index >= 0 && values.length < maximum) {
              values.push(input.slice(start, index));
              start = index + needle.length;
              index = input.indexOf(needle, start);
            }
            if (values.length < maximum) values.push(input.slice(start));
          }
        }
        return createArrayFromList(
          values,
          0,
          realm.arrayPrototype,
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
  function requireGlobal(pattern: unknown): void {
    if (!isRegExpValue(pattern, realm, hooks)) return;
    const flagsValue = getObjectValueProperty(pattern, "flags", hooks, realm);
    if (flagsValue.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (flagsValue.error !== "none") throw createRuntimeError(realm, "type");
    requireObjectCoercible(flagsValue.value, realm);
    if (regexpString(flagsValue.value, realm, hooks).indexOf("g") < 0)
      throw createRuntimeError(realm, "type");
  }
  function installSearch(name: string): void {
    builtinProperty(
      realm.stringPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          requireObjectCoercible(receiver, realm);
          const pattern = args[0];
          if (pattern !== null && pattern !== undefined) {
            if (name === "matchAll") requireGlobal(pattern);
            const method = protocolMethod(pattern, name, realm, hooks);
            if (method !== undefined)
              return hooks.call(method, pattern, [receiver]);
          }
          const input = regexpString(receiver, realm, hooks);
          const regexp = allocateRegExpObject(realm.regexpPrototype, hooks);
          initializeRegExpObject(
            regexp,
            pattern,
            name === "matchAll" ? "g" : undefined,
            realm,
            hooks,
            true,
          );
          const method = protocolMethod(regexp, name, realm, hooks);
          if (method === undefined) throw createRuntimeError(realm, "type");
          return hooks.call(method, regexp, [input]);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  installSearch("match");
  installSearch("search");
  installSearch("matchAll");
  function installReplace(name: string): void {
    builtinProperty(
      realm.stringPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        2,
        (receiver, args): unknown => {
          requireObjectCoercible(receiver, realm);
          const search = args[0],
            replacer = args[1],
            all = name === "replaceAll";
          if (search !== null && search !== undefined) {
            if (all) requireGlobal(search);
            const method = protocolMethod(search, "replace", realm, hooks);
            if (method !== undefined)
              return hooks.call(method, search, [receiver, replacer]);
          }
          const input = regexpString(receiver, realm, hooks);
          const needle = regexpString(search, realm, hooks);
          const callable = viewObjectValue(replacer, realm.objectPrototype);
          const functional =
            callable !== undefined && callable.internalCall !== undefined;
          const template = functional
            ? ""
            : regexpString(replacer, realm, hooks);
          let next = 0,
            output = "",
            position = input.indexOf(needle);
          while (position >= 0) {
            const replacement = functional
              ? regexpString(
                  hooks.call(replacer, undefined, [needle, position, input]),
                  realm,
                  hooks,
                )
              : substituteMatch(
                  needle,
                  input,
                  position,
                  [],
                  undefined,
                  template,
                );
            output += input.slice(next, position) + replacement;
            next = position + needle.length;
            if (!all || position + Math.max(needle.length, 1) > input.length)
              break;
            position = input.indexOf(
              needle,
              position + Math.max(needle.length, 1),
            );
          }
          return output + input.slice(next);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  installReplace("replace");
  installReplace("replaceAll");
}
