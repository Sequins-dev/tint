import { formatNumberForLocale } from "./intl-number-format.ts";
import {
  numberToString,
  numberToFixed,
  numberToExponential,
  numberToPrecision,
} from "@tint/foundation/numeric/number-text";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";

/** Receiver extraction precedes digit coercion. Range-check order differs for fixed. */
export function installNumberFormattingMethods(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => unknown,
): void {
  function install(name: string): void {
    builtinProperty(
      realm.numberPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        name === "toLocaleString" ? 0 : 1,
        (receiver, args): unknown => {
          const value = extract(receiver);
          if (typeof value !== "number")
            throw "NUMBER_FORMAT_PAYLOAD_INVARIANT";
          if (name === "toLocaleString")
            return formatNumberForLocale(value, args[0], args[1], realm, hooks);
          if (name === "toPrecision" && args[0] === undefined)
            return numberToString(value);
          const converted = numberValue(args[0], hooks, realm);
          if (converted.error === "unsupported")
            return rejectUnsupportedExecution(realm);
          if (converted.error !== "none")
            throw createRuntimeError(realm, "type");
          const precision =
            converted.value !== converted.value
              ? 0
              : Math.trunc(converted.value);
          if (name !== "toFixed" && !Number.isFinite(value))
            return numberToString(value);
          if (precision < (name === "toPrecision" ? 1 : 0) || precision > 100)
            throw createRuntimeError(realm, "range");
          if (name === "toFixed") return numberToFixed(value, precision);
          if (name === "toPrecision")
            return numberToPrecision(value, precision);
          return numberToExponential(
            value,
            args[0] === undefined ? undefined : precision,
          );
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  install("toFixed");
  install("toExponential");
  install("toPrecision");
  install("toLocaleString");
}
