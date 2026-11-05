/** Baseline managed representation for heterogeneous primitive unions.
 * Inactive payloads are initialized; the optional text field is always safe to trace.
 * Only the constructors establish this representation's tag/payload invariant.
 */
export interface PrimitiveValue {
  readonly tag: number;
  readonly numeric: number;
  readonly logical: boolean;
  readonly text: string | undefined;
}
export function fromNull(): PrimitiveValue {
  return { tag: 4, numeric: 0, logical: false, text: undefined };
}
export function isNullish(value: PrimitiveValue): boolean {
  return value.tag === 0 || value.tag === 4;
}
export function fromUndefined(): PrimitiveValue {
  return { tag: 0, numeric: 0, logical: false, text: undefined };
}
export function fromNumber(value: number): PrimitiveValue {
  return { tag: 1, numeric: value, logical: false, text: undefined };
}
export function fromBoolean(value: boolean): PrimitiveValue {
  return { tag: 2, numeric: 0, logical: value, text: undefined };
}
export function fromString(value: string): PrimitiveValue {
  return { tag: 3, numeric: 0, logical: false, text: value };
}
export function fromOptionalNumber(value: number | undefined): PrimitiveValue {
  if (value === undefined) return fromUndefined();
  return fromNumber(value);
}
export function fromOptionalString(value: string | undefined): PrimitiveValue {
  if (value === undefined) return fromUndefined();
  return fromString(value);
}
export function fromOptionalBoolean(
  value: boolean | undefined,
): PrimitiveValue {
  if (value === undefined) return fromUndefined();
  return fromBoolean(value);
}
export function fromOptionalBox(
  value: PrimitiveValue | undefined,
): PrimitiveValue {
  if (value === undefined) return fromUndefined();
  return value;
}
export function kindOf(value: PrimitiveValue): string {
  if (value.tag === 0) return "undefined";
  if (value.tag === 1) return "number";
  if (value.tag === 2) return "boolean";
  if (value.tag === 3) return "string";
  if (value.tag === 4) return "object";
  throw "INVALID_PRIMITIVE_TAG";
}
export function readNumber(value: PrimitiveValue): number {
  if (value.tag !== 1) throw "PRIMITIVE_TYPE_MISMATCH";
  return value.numeric;
}
export function readBoolean(value: PrimitiveValue): boolean {
  if (value.tag !== 2) throw "PRIMITIVE_TYPE_MISMATCH";
  return value.logical;
}
export function readString(value: PrimitiveValue): string {
  if (value.tag !== 3) throw "PRIMITIVE_TYPE_MISMATCH";
  const text = value.text;
  if (text === undefined) throw "INVALID_PRIMITIVE_PAYLOAD";
  return text;
}
export function readOptionalNumber(value: PrimitiveValue): number | undefined {
  if (value.tag === 0) return undefined;
  return readNumber(value);
}
export function readOptionalString(value: PrimitiveValue): string | undefined {
  if (value.tag === 0) return undefined;
  return readString(value);
}
export function readOptionalBoolean(
  value: PrimitiveValue,
): boolean | undefined {
  if (value.tag === 0) return undefined;
  return readBoolean(value);
}
export function truthy(value: PrimitiveValue): boolean {
  if (value.tag === 0 || value.tag === 4) return false;
  if (value.tag === 1)
    return value.numeric !== 0 && value.numeric === value.numeric;
  if (value.tag === 2) return value.logical;
  if (value.tag === 3) return readString(value).length !== 0;
  throw "INVALID_PRIMITIVE_TAG";
}
/** ECMAScript Map/Set insertion preserves +0 when the incoming key is -0. */
export function canonicalKey(value: PrimitiveValue): PrimitiveValue {
  if (value.tag === 1 && value.numeric === 0 && 1 / value.numeric < 0)
    return fromNumber(0);
  return value;
}
export function canonicalOptionalNumber(
  value: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  return value + 0;
}
/** ECMAScript strict equality; separately allocated equal values remain equal. */
export function strictEqual(
  left: PrimitiveValue,
  right: PrimitiveValue,
): boolean {
  if (left.tag !== right.tag) return false;
  if (left.tag === 0 || left.tag === 4) return true;
  if (left.tag === 1) return left.numeric === right.numeric;
  if (left.tag === 2) return left.logical === right.logical;
  if (left.tag === 3) return readString(left) === readString(right);
  throw "INVALID_PRIMITIVE_TAG";
}
/** Collection-key equality adds NaN equivalence while preserving signed-zero equivalence. */
export function sameValueZero(
  left: PrimitiveValue,
  right: PrimitiveValue,
): boolean {
  if (left.tag === 1 && right.tag === 1) {
    const a = left.numeric,
      b = right.numeric;
    return a === b || (a !== a && b !== b);
  }
  return strictEqual(left, right);
}
