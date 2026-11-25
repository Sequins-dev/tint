import { formatNumberForLocale } from "./intl-number-format.ts";
import { coerceBigInt } from "./bigint-coercion.ts";
import { truncateInteger } from "@tint/foundation/numeric/big-integer";
import {
  createBigIntValue,
  bigIntToString,
  viewBigIntValue,
  type BigIntValue,
} from "./bigints.ts";
import { numberValue } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import {
  exoticSlots,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";

/** BigInt has a throwing [[Construct]] and an ordinary, unbranded prototype. */
export function installBigIntIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function fail(error: string): never {
    if (error === "unsupported") return rejectUnsupportedExecution(realm);
    throw createRuntimeError(realm, error);
  }
  function extract(value: unknown): BigIntValue {
    const direct = viewBigIntValue(value);
    if (direct !== undefined) return direct;
    const object = viewObjectValue(value, realm.objectPrototype);
    const data =
      object === undefined
        ? undefined
        : exoticSlots(object).internalPrimitiveData;
    if (data !== undefined && data.kind === "bigint") {
      const bigint = viewBigIntValue(data.value);
      if (bigint !== undefined) return bigint;
    }
    return fail("type");
  }
  const prototype = realm.bigIntPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => coerceBigInt(args[0], true, realm, hooks),
    (args, newTarget): unknown => fail("type"),
  );
  builtinFunctionMetadata(constructor, "BigInt", 1, hooks);
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
      0,
      (receiver, args): unknown => {
        const value = extract(receiver);
        let radix = 10;
        if (args[0] !== undefined) {
          const converted = numberValue(args[0], hooks, realm);
          if (converted.error !== "none") return fail(converted.error);
          radix = Math.trunc(converted.value);
        }
        const text = bigIntToString(value, radix);
        if (text === undefined) return fail("range");
        return text;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "BigInt",
    false,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "toLocaleString",
    builtinFunction(
      realm.functionPrototype,
      "toLocaleString",
      0,
      (receiver, args): unknown => {
        return formatNumberForLocale(
          extract(receiver),
          args[0],
          args[1],
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
  function installWidthConversion(name: string, signed: boolean): void {
    builtinProperty(
      constructor,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        2,
        (receiver, args): unknown => {
          const number = numberValue(args[0], hooks, realm);
          if (number.error !== "none") return fail(number.error);
          // ToIndex maps NaN/undefined to zero and truncates before range checking.
          const bits =
            number.value !== number.value ? 0 : Math.trunc(number.value);
          if (!(bits >= 0 && bits <= 9007199254740991)) return fail("range");
          const value = coerceBigInt(args[1], false, realm, hooks);
          const result = truncateInteger(
            value.integer,
            bits,
            signed,
            realm.bigIntMaxDigits,
          );
          if (result === undefined) return fail("range");
          return createBigIntValue(result);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  installWidthConversion("asIntN", true);
  installWidthConversion("asUintN", false);
  builtinProperty(global, "BigInt", constructor, true, true, hooks);
}
