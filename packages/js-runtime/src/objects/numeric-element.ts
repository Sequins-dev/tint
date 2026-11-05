import {
  readSigned,
  readUnsigned,
  readFloat,
  writeUnsigned,
  writeFloat,
  type Endian,
  type Width,
  type FloatWidth,
} from "@tint/foundation/binary/bytes";
export type NumericElementKind =
  | "Int8"
  | "Uint8"
  | "Uint8Clamped"
  | "Int16"
  | "Uint16"
  | "Int32"
  | "Uint32"
  | "Float16"
  | "Float32"
  | "Float64";
export function numericElementWidth(kind: NumericElementKind): number {
  if (kind === "Int8" || kind === "Uint8" || kind === "Uint8Clamped") return 1;
  if (kind === "Int16" || kind === "Uint16" || kind === "Float16") return 2;
  return kind === "Float64" ? 8 : 4;
}
function integerWidth(kind: NumericElementKind): Width {
  if (kind === "Int8" || kind === "Uint8" || kind === "Uint8Clamped") return 1;
  return kind === "Int16" || kind === "Uint16" ? 2 : 4;
}
function floatWidth(kind: NumericElementKind): FloatWidth {
  return kind === "Float16" ? 2 : kind === "Float32" ? 4 : 8;
}
export function readNumericElement(
  bytes: Uint8Array,
  offset: number,
  kind: NumericElementKind,
  endian: Endian,
): number {
  const result =
    kind === "Float16" || kind === "Float32" || kind === "Float64"
      ? readFloat(bytes, offset, floatWidth(kind), endian)
      : kind === "Int8" || kind === "Int16" || kind === "Int32"
        ? readSigned(bytes, offset, integerWidth(kind), endian)
        : readUnsigned(bytes, offset, integerWidth(kind), endian);
  if (!result.ok) throw "NUMERIC_ELEMENT_READ_BOUNDS";
  return result.value;
}
/** Pure ToUint8Clamp; value coercion belongs to the caller and can execute user code. */
export function clampUint8(value: number): number {
  if (value !== value || value <= 0) return 0;
  if (value >= 255) return 255;
  const floor = Math.floor(value),
    fraction = value - floor;
  return fraction > 0.5 || (fraction === 0.5 && floor % 2 !== 0)
    ? floor + 1
    : floor;
}
export function writeNumericElement(
  bytes: Uint8Array,
  offset: number,
  kind: NumericElementKind,
  value: number,
  endian: Endian,
): void {
  if (kind === "Float16" || kind === "Float32" || kind === "Float64") {
    if (!writeFloat(bytes, offset, floatWidth(kind), value, endian).ok)
      throw "NUMERIC_ELEMENT_WRITE_BOUNDS";
    return;
  }
  const width = integerWidth(kind);
  if (kind === "Uint8Clamped") value = clampUint8(value);
  else {
    const limit = width === 1 ? 256 : width === 2 ? 65536 : 4294967296;
    value =
      value !== value || value === 1 / 0 || value === -1 / 0
        ? 0
        : Math.trunc(value) % limit;
    if (value < 0) value += limit;
  }
  if (!writeUnsigned(bytes, offset, width, value, endian).ok)
    throw "NUMERIC_ELEMENT_WRITE_BOUNDS";
}
