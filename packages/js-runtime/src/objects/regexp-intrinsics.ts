import { installRegExpLegacyAccessors } from "./regexp-legacy-intrinsics.ts";
import { escapeRegExpText } from "./regexp-escape.ts";
import { installRegExpProtocols } from "./regexp-protocols.ts";
import {
  createConstructorObject,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue, scriptBoolean } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  builtinAccessor,
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import {
  regexpString,
  regexpSource,
  allocateRegExpObject,
  initializeRegExpObject,
  executeRegExpObject,
  regexpExec,
  setRegExpLastIndex,
} from "./regexp-runtime.ts";
/** IsRegExp observes @@match before inspecting the internal brand. */
export function isRegExpValue(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): boolean {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) return false;
  const matcher = getProperty<ScriptPropertyKey, unknown>(
    object,
    wellKnownSymbol(realm.symbolRegistry, "match"),
    value,
    hooks,
  );
  return matcher === undefined
    ? object.internalRegExpData !== undefined
    : scriptBoolean(matcher, realm.objectPrototype);
}
export function installRegExpIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function requireObject(
    value: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = viewObjectValue(value, realm.objectPrototype);
    if (object === undefined) throw createRuntimeError(realm, "type");
    return object;
  }
  function accessor(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: ScriptPropertyKey,
    name: string,
    call: ObjectCall<unknown>,
  ): void {
    const getter = builtinFunction(
      realm.functionPrototype,
      "get " + name,
      0,
      call,
      hooks,
    );
    builtinAccessor(object, key, getter, undefined, hooks);
  }
  function construct(
    pattern: unknown,
    flags: unknown,
    newTarget: unknown,
    called: boolean,
  ): unknown {
    const isRegex = isRegExpValue(pattern, realm, hooks),
      original = viewObjectValue(pattern, realm.objectPrototype);
    if (called && isRegex && flags === undefined && original !== undefined) {
      const selected = getProperty<ScriptPropertyKey, unknown>(
        original,
        "constructor",
        pattern,
        hooks,
      );
      if (selected === constructor) return pattern;
    }
    let source = pattern,
      selectedFlags = flags;
    const data =
      original === undefined ? undefined : original.internalRegExpData;
    if (data !== undefined) {
      source = data.originalSource;
      if (flags === undefined) selectedFlags = data.originalFlags;
    } else if (isRegex && original !== undefined) {
      source = getProperty<ScriptPropertyKey, unknown>(
        original,
        "source",
        pattern,
        hooks,
      );
      if (flags === undefined)
        selectedFlags = getProperty<ScriptPropertyKey, unknown>(
          original,
          "flags",
          pattern,
          hooks,
        );
    }
    const parent = constructorPrototype(newTarget, "regexp", realm, hooks);
    const object = allocateRegExpObject(parent, hooks);
    initializeRegExpObject(
      object,
      source,
      selectedFlags,
      realm,
      hooks,
      newTarget === constructor,
    );
    return object;
  }
  const constructor: OrdinaryObject<ScriptPropertyKey, unknown> =
    createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown =>
        construct(args[0], args[1], constructor, true),
      (args, target): unknown => construct(args[0], args[1], target, false),
    );
  installRegExpLegacyAccessors(constructor, realm, hooks);
  installRegExpProtocols(realm, hooks, constructor);
  const prototype = realm.regexpPrototype;
  builtinFunctionMetadata(constructor, "RegExp", 2, hooks);
  builtinProperty(
    constructor,
    "escape",
    builtinFunction(
      realm.functionPrototype,
      "escape",
      1,
      (receiver, args): unknown => {
        const input = args[0];
        if (typeof input !== "string") throw createRuntimeError(realm, "type");
        return escapeRegExpText(input);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  accessor(
    constructor,
    wellKnownSymbol(realm.symbolRegistry, "species"),
    "[Symbol.species]",
    (receiver, args): unknown => receiver,
  );
  const names = [
    "hasIndices",
    "global",
    "ignoreCase",
    "multiline",
    "dotAll",
    "unicode",
    "unicodeSets",
    "sticky",
  ];
  const flags = ["d", "g", "i", "m", "s", "u", "v", "y"];
  for (let index = 0; index < names.length; index++) {
    const name = names[index],
      flag = flags[index];
    if (name === undefined || flag === undefined) throw "REGEXP_FLAG_INVARIANT";
    accessor(prototype, name, name, (receiver, args): unknown => {
      const object = requireObject(receiver),
        data = object.internalRegExpData;
      if (data !== undefined) return data.originalFlags.includes(flag);
      if (object === prototype) return undefined;
      throw createRuntimeError(realm, "type");
    });
  }
  accessor(prototype, "flags", "flags", (receiver, args): unknown => {
    const object = requireObject(receiver);
    let result = "";
    for (let index = 0; index < names.length; index++) {
      const name = names[index],
        flag = flags[index];
      if (name === undefined || flag === undefined)
        throw "REGEXP_FLAG_INVARIANT";
      if (
        scriptBoolean(
          getProperty<ScriptPropertyKey, unknown>(
            object,
            name,
            receiver,
            hooks,
          ),
          realm.objectPrototype,
        )
      )
        result += flag;
    }
    return result;
  });
  accessor(prototype, "source", "source", (receiver, args): unknown => {
    const object = requireObject(receiver),
      data = object.internalRegExpData;
    if (data !== undefined) return regexpSource(data.originalSource);
    if (object === prototype) return "(?:)";
    throw createRuntimeError(realm, "type");
  });
  builtinProperty(
    prototype,
    "compile",
    builtinFunction(
      realm.functionPrototype,
      "compile",
      2,
      (receiver, args): unknown => {
        const object = requireObject(receiver),
          data = object.internalRegExpData;
        if (
          data === undefined ||
          data.legacyState !== realm.regexpLegacyState ||
          !data.legacyEnabled
        )
          throw createRuntimeError(realm, "type");
        const pattern = viewObjectValue(args[0], realm.objectPrototype);
        const original =
          pattern === undefined ? undefined : pattern.internalRegExpData;
        if (original !== undefined) {
          if (args[1] !== undefined) throw createRuntimeError(realm, "type");
          initializeRegExpObject(
            object,
            original.originalSource,
            original.originalFlags,
            realm,
            hooks,
            data.legacyEnabled,
          );
        } else
          initializeRegExpObject(
            object,
            args[0],
            args[1],
            realm,
            hooks,
            data.legacyEnabled,
          );
        setRegExpLastIndex(object, 0, realm, hooks);
        return object;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "exec",
    builtinFunction(
      realm.functionPrototype,
      "exec",
      1,
      (receiver, args): unknown => {
        const object = requireObject(receiver);
        if (object.internalRegExpData === undefined)
          throw createRuntimeError(realm, "type");
        return executeRegExpObject(
          object,
          regexpString(args[0], realm, hooks),
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
  builtinProperty(
    prototype,
    "test",
    builtinFunction(
      realm.functionPrototype,
      "test",
      1,
      (receiver, args): unknown => {
        const object = requireObject(receiver),
          input = regexpString(args[0], realm, hooks);
        const result = regexpExec(object, input, realm, hooks);
        return result !== null;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "toString",
    builtinFunction(
      realm.functionPrototype,
      "toString",
      0,
      (receiver, args): unknown => {
        const object = requireObject(receiver);
        const source = regexpString(
          getProperty<ScriptPropertyKey, unknown>(
            object,
            "source",
            receiver,
            hooks,
          ),
          realm,
          hooks,
        );
        const flags = regexpString(
          getProperty<ScriptPropertyKey, unknown>(
            object,
            "flags",
            receiver,
            hooks,
          ),
          realm,
          hooks,
        );
        return "/" + source + "/" + flags;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(global, "RegExp", constructor, true, true, hooks);
}
