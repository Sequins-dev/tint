import { fromNumber } from "@tint/foundation/numeric/big-integer";
import {
  createBigIntValue,
  createBigIntLiteral,
  bigIntFromString,
  viewBigIntValue,
  type BigIntValue,
} from "./bigints.ts";
import { primitiveValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
export function coerceBigInt(
  value: unknown,
  allowNumber: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): BigIntValue {
  function fail(error: string): never {
    if (error === "unsupported") return rejectUnsupportedExecution(realm);
    throw createRuntimeError(realm, error);
  }
  const primitive = primitiveValue(value, "number", hooks, realm);
  if (primitive.error !== "none") return fail(primitive.error);
  const input = primitive.value;
  const bigint = viewBigIntValue(input);
  if (bigint !== undefined) return bigint;
  if (typeof input === "number") {
    if (!allowNumber) return fail("type");
    const integer = fromNumber(input);
    if (integer === undefined) return fail("range");
    return createBigIntValue(integer);
  }
  if (typeof input === "boolean") return createBigIntLiteral(input ? "1" : "0");
  if (typeof input === "string") {
    const parsed = bigIntFromString(input);
    if (parsed === undefined) return fail("syntax");
    return parsed;
  }
  return fail("type");
}
