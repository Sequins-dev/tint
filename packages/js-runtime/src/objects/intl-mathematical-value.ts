import {
  decimalFromString,
  decimalFromNumber,
  stringToNumber,
  type DecimalQuantity,
} from "@tint/foundation/numeric/number-text";
import {
  bigIntFromString,
  bigIntToString,
  viewBigIntValue,
  type BigIntValue,
} from "./bigints.ts";
import { primitiveValue, numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";

function exactInteger(value: BigIntValue): DecimalQuantity {
  const text = bigIntToString(value, 10);
  if (text === undefined) throw "INTL_INTEGER_DECIMAL_INVARIANT";
  const quantity = decimalFromString(text);
  if (quantity === undefined) throw "INTL_INTEGER_QUANTITY_INVARIANT";
  return quantity;
}
/** StringIntlMV keeps exact digits, but RoundMVResult classifies underflow and
 * overflow first. This binary64 check never replaces a finite nonzero value. */
export function intlStringMathematicalValue(text: string): DecimalQuantity {
  const classified = stringToNumber(text);
  if (!Number.isFinite(classified) || classified === 0)
    return decimalFromNumber(classified);
  const normalized = text.trim();
  const decimal = decimalFromString(normalized);
  if (decimal !== undefined) return decimal;
  const integer = bigIntFromString(normalized);
  if (integer === undefined) throw "INTL_NUMERIC_LEXICAL_INVARIANT";
  return exactInteger(integer);
}
/** Shared ECMA-402 conversion: exactly one observable ToPrimitive(number).
 * Direct BigInt input deliberately bypasses string overflow/underflow policy. */
export function intlMathematicalValue(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): DecimalQuantity {
  const primitive = primitiveValue(value, "number", hooks, realm);
  if (primitive.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (primitive.error !== "none") throw createRuntimeError(realm, "type");
  const input = primitive.value;
  const bigint = viewBigIntValue(input);
  if (bigint !== undefined) return exactInteger(bigint);
  if (typeof input === "string") return intlStringMathematicalValue(input);
  const numeric = numberValue(input, hooks, realm);
  if (numeric.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (numeric.error !== "none") throw createRuntimeError(realm, "type");
  return decimalFromNumber(numeric.value);
}
