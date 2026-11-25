import { normalizeUnicode } from "@tint/foundation/unicode/normalization";
import { installDateIntrinsics } from "./date-intrinsics.ts";
import { installNumberFormattingMethods } from "./number-format.ts";
import { installStringLocaleCompare } from "./intl-collator.ts";
import { installStringCasingMethods } from "./string-casing.ts";
import { installStringHTMLMethods } from "./string-html.ts";
import { installJSONIntrinsics } from "./json-intrinsics.ts";
import { installURIIntrinsics } from "./uri-intrinsics.ts";
import {
  createStringBuilder,
  appendString,
  finishString,
} from "@tint/foundation/text/string-builder";
import { toObjectValue } from "./boxing.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import {
  isWellFormedUTF16,
  toWellFormedUTF16,
} from "@tint/foundation/text/text-encoding";
import { numberRadixText } from "./number-radix.ts";
import { installStringRegExpMethods } from "./string-regexp.ts";
import { isRegExpValue } from "./regexp-intrinsics.ts";
import {
  parseIntegerText,
  parseFloatText,
} from "@tint/foundation/numeric/number-text";
import { scriptBoolean, viewObjectValue } from "./values.ts";
import { installBigIntIntrinsics } from "./bigint-intrinsics.ts";
import { viewBigIntValue } from "./bigints.ts";
import { toNumber } from "@tint/foundation/numeric/big-integer";
import { viewSymbolValue, symbolDescriptiveString } from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  exoticSlots,
  createConstructorObject,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";
import {
  createPrimitiveObject,
  type PrimitiveObjectKind,
} from "./boxed-primitives.ts";
import {
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { numberValue, stringValue, numericValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

export function installPrimitiveIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  installDateIntrinsics(global, realm, hooks);
  installBigIntIntrinsics(global, realm, hooks);
  installURIIntrinsics(global, realm, hooks);
  installJSONIntrinsics(global, realm, hooks);
  function numberConstructor(value: unknown): unknown {
    const converted = numericValue(value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    const bigint = viewBigIntValue(converted.value);
    return bigint === undefined ? converted.value : toNumber(bigint.integer);
  }
  function number(value: unknown): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error === "type") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  function install(
    kind: PrimitiveObjectKind,
    name: string,
    prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    function convert(args: readonly unknown[]): unknown {
      if (kind === "boolean")
        return scriptBoolean(args[0], realm.objectPrototype);
      if (kind === "number")
        return args.length === 0 ? 0 : numberConstructor(args[0]);
      if (args.length === 0) return "";
      const converted = stringValue(args[0], hooks, realm);
      if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
      if (converted.error === "type") throw createRuntimeError(realm, "type");
      return converted.value;
    }
    function extract(receiver: unknown): unknown {
      if (typeof receiver === kind) return receiver;
      const object = viewObjectValue(receiver, realm.objectPrototype);
      const data =
        object === undefined
          ? undefined
          : exoticSlots(object).internalPrimitiveData;
      if (data === undefined || data.kind !== kind)
        throw createRuntimeError(realm, "type");
      return data.value;
    }
    const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown => {
        if (kind === "string") {
          const symbol = viewSymbolValue(args[0]);
          if (symbol !== undefined) return symbolDescriptiveString(symbol);
        }
        return convert(args);
      },
      (args, target): unknown => {
        const value = convert(args);
        const parent = constructorPrototype(target, kind, realm, hooks);
        return createPrimitiveObject(kind, value, parent, hooks);
      },
    );
    builtinFunctionMetadata(constructor, name, 1, hooks);
    builtinProperty(constructor, "prototype", prototype, false, false, hooks);
    builtinProperty(prototype, "constructor", constructor, true, true, hooks);
    builtinProperty(
      prototype,
      "valueOf",
      builtinFunction(
        realm.functionPrototype,
        "valueOf",
        0,
        (receiver, args): unknown => extract(receiver),
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
        kind === "number" ? 1 : 0,
        (receiver, args): unknown => {
          const value = extract(receiver);
          if (kind === "string") return value;
          if (kind === "boolean") return value ? "true" : "false";
          if (typeof value !== "number")
            throw "NUMBER_OBJECT_PAYLOAD_INVARIANT";
          const radix =
            args[0] === undefined ? 10 : Math.trunc(number(args[0]));
          if (!(radix >= 2 && radix <= 36))
            throw createRuntimeError(realm, "range");
          // Preserve explicit unsupported outcomes until shortest fractional and
          // large non-binary-radix formatting is available.
          if (
            radix !== 10 &&
            value !== 0 &&
            value === value &&
            value !== Infinity &&
            value !== -Infinity
          ) {
            const text = numberRadixText(value, radix);
            if (text === undefined) return rejectUnsupportedExecution(realm);
            return text;
          }
          return String(value);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
    if (kind === "number")
      installNumberFormattingMethods(realm, hooks, extract);
    builtinProperty(global, name, constructor, true, true, hooks);
    return constructor;
  }
  install("boolean", "Boolean", realm.booleanPrototype);
  const constructor = install("number", "Number", realm.numberPrototype);
  realm.intrinsicFunctions.number = constructor;
  const stringConstructor = install("string", "String", realm.stringPrototype);
  function convertedString(value: unknown): string {
    const converted = stringValue(value, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error === "type") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  function globalFunction(
    name: string,
    length: number,
    call: ObjectCall<unknown>,
    numberAlias: boolean,
  ): void {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      length,
      call,
      hooks,
    );
    builtinProperty(global, name, method, true, true, hooks);
    if (numberAlias)
      builtinProperty(constructor, name, method, true, true, hooks);
  }
  globalFunction(
    "parseInt",
    2,
    (receiver, args): unknown => {
      const text = convertedString(args[0]),
        radix = number(args[1]);
      return parseIntegerText(text, radix);
    },
    true,
  );
  globalFunction(
    "parseFloat",
    1,
    (receiver, args): unknown => parseFloatText(convertedString(args[0])),
    true,
  );
  globalFunction(
    "isNaN",
    1,
    (receiver, args): unknown => {
      const value = number(args[0]);
      return value !== value;
    },
    false,
  );
  globalFunction(
    "isFinite",
    1,
    (receiver, args): unknown => finite(number(args[0])),
    false,
  );
  function stringMethod(
    name: string,
    length: number,
    operation: (value: string, args: readonly unknown[]) => unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      length,
      (receiver, args): unknown => {
        if (receiver === undefined || receiver === null)
          throw createRuntimeError(realm, "type");
        return operation(convertedString(receiver), args);
      },
      hooks,
    );
    builtinProperty(realm.stringPrototype, name, method, true, true, hooks);
    return method;
  }
  // Install hot string methods in the first eight in-object slots so
  // `s.charCodeAt`, `s.charAt`, `s.slice`, and `s.indexOf` hit property-load.
  realm.intrinsicFunctions.stringCharCodeAt = stringMethod(
    "charCodeAt",
    1,
    (value, args): unknown => value.charCodeAt(number(args[0])),
  );
  realm.intrinsicFunctions.stringCharAt = stringMethod(
    "charAt",
    1,
    (value, args): unknown => value.charAt(number(args[0])),
  );
  stringMethod("slice", 2, (value, args): unknown => {
    const start = number(args[0]);
    const end = args[1] === undefined ? value.length : number(args[1]);
    return value.slice(start, end);
  });
  stringMethod("indexOf", 1, (value, args): unknown => {
    const search = convertedString(args[0]);
    const position = number(args[1]);
    return value.indexOf(search, position);
  });
  installStringRegExpMethods(realm, hooks);
  installStringHTMLMethods(realm, hooks);
  installStringCasingMethods(realm, hooks);
  installStringLocaleCompare(realm, hooks);
  stringMethod("normalize", 0, (value, args): unknown => {
    const form = args[0] === undefined ? "NFC" : convertedString(args[0]);
    const normalized = normalizeUnicode(value, form);
    if (normalized === undefined) throw createRuntimeError(realm, "range");
    return normalized;
  });
  stringMethod("isWellFormed", 0, (value, args): unknown =>
    isWellFormedUTF16(value),
  );
  stringMethod("toWellFormed", 0, (value, args): unknown =>
    toWellFormedUTF16(value),
  );
  const trimStart = stringMethod("trimStart", 0, (value, args): unknown =>
    value.trimStart(),
  );
  const trimEnd = stringMethod("trimEnd", 0, (value, args): unknown =>
    value.trimEnd(),
  );
  stringMethod("trim", 0, (value, args): unknown => value.trim());
  builtinProperty(
    realm.stringPrototype,
    "trimLeft",
    trimStart,
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.stringPrototype,
    "trimRight",
    trimEnd,
    true,
    true,
    hooks,
  );
  stringMethod("concat", 1, (value, args): unknown => {
    let result = value;
    for (const argument of args) result += convertedString(argument);
    return result;
  });
  stringMethod("repeat", 1, (value, args): unknown => {
    const converted = number(args[0]);
    const count = converted !== converted ? 0 : Math.trunc(converted);
    if (count < 0 || count === Infinity)
      throw createRuntimeError(realm, "range");
    if (value.length === 0) return "";
    // Enforce the implementation string-size limit before allocating.
    if (count > 0x7fffffff / value.length)
      throw createRuntimeError(realm, "range");
    return value.repeat(count);
  });
  function padding(name: string, start: boolean): void {
    stringMethod(name, 1, (value, args): unknown => {
      const requested = number(args[0]);
      const length =
        requested > 0 ? Math.min(Math.floor(requested), 9007199254740991) : 0;
      if (length <= value.length) return value;
      const filler = args[1] === undefined ? " " : convertedString(args[1]);
      if (filler.length === 0) return value;
      if (length > 0x7fffffff) throw createRuntimeError(realm, "range");
      const needed = length - value.length;
      const filled =
        filler.repeat(Math.floor(needed / filler.length)) +
        filler.substring(0, needed % filler.length);
      return start ? filled + value : value + filled;
    });
  }
  padding("padStart", true);
  padding("padEnd", false);
  stringMethod("at", 1, (value, args): unknown => {
    const converted = number(args[0]);
    const relative = converted !== converted ? 0 : Math.trunc(converted);
    const index = relative >= 0 ? relative : value.length + relative;
    return index < 0 || index >= value.length ? undefined : value.charAt(index);
  });
  stringMethod("codePointAt", 1, (value, args): unknown => {
    const converted = number(args[0]);
    const index = converted !== converted ? 0 : Math.trunc(converted);
    if (index < 0 || index >= value.length) return undefined;
    const first = value.charCodeAt(index);
    if (first < 0xd800 || first > 0xdbff || index + 1 >= value.length)
      return first;
    const second = value.charCodeAt(index + 1);
    return second >= 0xdc00 && second <= 0xdfff
      ? (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000
      : first;
  });
  function stringSearch(name: string): void {
    stringMethod(name, 1, (value, args): unknown => {
      if (isRegExpValue(args[0], realm, hooks))
        throw createRuntimeError(realm, "type");
      const search = convertedString(args[0]);
      const position =
        name === "endsWith" && args[1] === undefined
          ? value.length
          : number(args[1]);
      if (name === "startsWith") return value.startsWith(search, position);
      if (name === "endsWith") return value.endsWith(search, position);
      return value.includes(search, position);
    });
  }
  stringSearch("startsWith");
  stringSearch("endsWith");
  stringSearch("includes");
  stringMethod("substr", 2, (value, args): unknown => {
    const start = Math.trunc(number(args[0])) || 0;
    const length =
      args[1] === undefined ? Infinity : Math.trunc(number(args[1])) || 0;
    const offset =
      start < 0
        ? Math.max(value.length + start, 0)
        : Math.min(start, value.length);
    const count = Math.min(Math.max(length, 0), value.length - offset);
    return value.slice(offset, offset + count);
  });
  stringMethod("substring", 2, (value, args): unknown => {
    const start = number(args[0]);
    const end = args[1] === undefined ? value.length : number(args[1]);
    return value.substring(start, end);
  });
  stringMethod("lastIndexOf", 1, (value, args): unknown => {
    const search = convertedString(args[0]);
    const position = number(args[1]);
    return value.lastIndexOf(
      search,
      position === position ? position : Infinity,
    );
  });
  builtinProperty(
    stringConstructor,
    "raw",
    builtinFunction(
      realm.functionPrototype,
      "raw",
      1,
      (receiver, args): unknown => {
        const template = toObjectValue(args[0], realm, hooks);
        const raw = toObjectValue(
          getProperty<ScriptPropertyKey, unknown>(
            template,
            "raw",
            template,
            hooks,
          ),
          realm,
          hooks,
        );
        const length = lengthOfArrayLike(raw, realm, hooks);
        const output = createStringBuilder();
        for (let index = 0; index < length; index++) {
          appendString(
            output,
            convertedString(
              getProperty<ScriptPropertyKey, unknown>(
                raw,
                String(index),
                raw,
                hooks,
              ),
            ),
          );
          if (index + 1 < length && index + 1 < args.length)
            appendString(output, convertedString(args[index + 1]));
        }
        return finishString(output);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    stringConstructor,
    "fromCharCode",
    builtinFunction(
      realm.functionPrototype,
      "fromCharCode",
      1,
      (receiver, args): unknown => {
        const output = createStringBuilder();
        for (const argument of args)
          appendString(output, String.fromCharCode(number(argument)));
        return finishString(output);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    stringConstructor,
    "fromCodePoint",
    builtinFunction(
      realm.functionPrototype,
      "fromCodePoint",
      1,
      (receiver, args): unknown => {
        const output = createStringBuilder();
        for (const argument of args) {
          const point = number(argument);
          if (!(point >= 0 && point <= 0x10ffff) || Math.floor(point) !== point)
            throw createRuntimeError(realm, "range");
          if (point <= 0xffff) appendString(output, String.fromCharCode(point));
          else {
            const offset = point - 0x10000;
            appendString(
              output,
              String.fromCharCode(0xd800 + Math.floor(offset / 0x400)),
            );
            appendString(
              output,
              String.fromCharCode(0xdc00 + (offset % 0x400)),
            );
          }
        }
        return finishString(output);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  function constant(name: string, value: number): void {
    builtinProperty(constructor, name, value, false, false, hooks);
  }
  constant("MAX_VALUE", 1.7976931348623157e308);
  constant("MIN_VALUE", 5e-324);
  constant("NaN", NaN);
  constant("POSITIVE_INFINITY", Infinity);
  constant("NEGATIVE_INFINITY", -Infinity);
  constant("MAX_SAFE_INTEGER", 9007199254740991);
  constant("MIN_SAFE_INTEGER", -9007199254740991);
  constant("EPSILON", 2.220446049250313e-16);
  function predicate(name: string, call: ObjectCall<unknown>): void {
    builtinProperty(
      constructor,
      name,
      builtinFunction(realm.functionPrototype, name, 1, call, hooks),
      true,
      true,
      hooks,
    );
  }
  function finite(value: unknown): boolean {
    return (
      typeof value === "number" &&
      value === value &&
      value !== Infinity &&
      value !== -Infinity
    );
  }
  predicate("isNaN", (receiver, args): unknown => {
    const value = args[0];
    return typeof value === "number" && value !== value;
  });
  predicate("isFinite", (receiver, args): unknown => finite(args[0]));
  predicate("isInteger", (receiver, args): unknown => {
    const value = args[0];
    return (
      typeof value === "number" && finite(value) && Math.floor(value) === value
    );
  });
  predicate("isSafeInteger", (receiver, args): unknown => {
    const value = args[0];
    return (
      typeof value === "number" &&
      finite(value) &&
      Math.floor(value) === value &&
      Math.abs(value) <= 9007199254740991
    );
  });
}
