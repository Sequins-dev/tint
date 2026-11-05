import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { toObjectValue } from "./boxing.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  regexpString,
  regexpInteger,
  regexpLength,
  regexpExec,
  setRegExpLastIndex,
  advanceStringIndex,
} from "./regexp-runtime.ts";
import { substituteMatch } from "./substitution.ts";

/** Collect all exec results before observable replacement callbacks. */
export function replaceRegExp(
  receiver: unknown,
  value: unknown,
  replacer: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const object = viewObjectValue(receiver, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const input = regexpString(value, realm, hooks);
  const callable = viewObjectValue(replacer, realm.objectPrototype);
  const functional =
    callable !== undefined && callable.internalCall !== undefined;
  const template = functional ? "" : regexpString(replacer, realm, hooks);
  const flags = regexpString(
    getProperty<ScriptPropertyKey, unknown>(object, "flags", object, hooks),
    realm,
    hooks,
  );
  const global = flags.indexOf("g") >= 0;
  const unicode = flags.indexOf("u") >= 0 || flags.indexOf("v") >= 0;
  if (global) setRegExpLastIndex(object, 0, realm, hooks);
  const results: OrdinaryObject<ScriptPropertyKey, unknown>[] = [];
  while (true) {
    const result = regexpExec(object, input, realm, hooks);
    if (result === null) break;
    results.push(result);
    if (!global) break;
    const matched = regexpString(
      getProperty<ScriptPropertyKey, unknown>(result, "0", result, hooks),
      realm,
      hooks,
    );
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
  let output = "",
    next = 0;
  for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
    const result = results[resultIndex];
    if (result === undefined) throw "REGEXP_RESULT_INVARIANT";
    const count = Math.max(lengthOfArrayLike(result, realm, hooks) - 1, 0);
    const matched = regexpString(
      getProperty<ScriptPropertyKey, unknown>(result, "0", result, hooks),
      realm,
      hooks,
    );
    const position = Math.min(
      Math.max(
        regexpInteger(
          getProperty<ScriptPropertyKey, unknown>(
            result,
            "index",
            result,
            hooks,
          ),
          realm,
          hooks,
        ),
        0,
      ),
      input.length,
    );
    const captures: (string | undefined)[] = [];
    for (let i = 1; i <= count; i++) {
      const capture = getProperty<ScriptPropertyKey, unknown>(
        result,
        String(i),
        result,
        hooks,
      );
      captures.push(
        capture === undefined ? undefined : regexpString(capture, realm, hooks),
      );
    }
    const groups = getProperty<ScriptPropertyKey, unknown>(
      result,
      "groups",
      result,
      hooks,
    );
    let replacement: string;
    if (functional) {
      const args: unknown[] = [matched];
      for (const capture of captures) args.push(capture);
      args.push(position);
      args.push(input);
      if (groups !== undefined) args.push(groups);
      replacement = regexpString(
        hooks.call(replacer, undefined, args),
        realm,
        hooks,
      );
    } else {
      const named =
        groups === undefined ? undefined : toObjectValue(groups, realm, hooks);
      let readNamed: ((name: string) => string | undefined) | undefined =
        undefined;
      if (named !== undefined) {
        readNamed = (name): string | undefined => {
          const capture = getProperty<ScriptPropertyKey, unknown>(
            named,
            name,
            named,
            hooks,
          );
          return capture === undefined
            ? undefined
            : regexpString(capture, realm, hooks);
        };
      }
      replacement = substituteMatch(
        matched,
        input,
        position,
        captures,
        readNamed,
        template,
      );
    }
    if (position >= next) {
      output += input.slice(next, position) + replacement;
      next = position + matched.length;
    }
  }
  return next >= input.length ? output : output + input.slice(next);
}
