/** Typed-array element kinds and their native layout markers.
 *
 * A marker's low three bits are the element-width class (2: one byte,
 * 3: two, 4: four, 5: eight) and the bits above it the kind's index within
 * that class, so the original kinds keep markers 2-5 (see
 * nativeTypedArrayMarker in ./host.ts, which collectors use). The element
 * representation decides conversions: integer kinds wrap modulo 2^bits
 * (ToInt8 ... ToUint32), the clamped kind rounds half to even and clamps
 * (ToUint8Clamp), Float32 rounds to nearest, ties to even, and the BigInt
 * kinds convert with ToBigInt64 or ToBigUint64. Their `[[ContentType]]` is
 * BigInt; every other kind's is Number. */
export type NativeTypedArrayKindName =
  | "Uint8Array"
  | "Int8Array"
  | "Uint8ClampedArray"
  | "Uint16Array"
  | "Int16Array"
  | "Uint32Array"
  | "Int32Array"
  | "Float32Array"
  | "Float64Array"
  | "BigInt64Array"
  | "BigUint64Array";

export type NativeTypedArrayElement =
  | "unsigned"
  | "signed"
  | "clamped"
  | "float"
  | "bigint-signed"
  | "bigint-unsigned";

export interface NativeTypedArrayKind {
  readonly name: NativeTypedArrayKindName;
  readonly marker: number;
  readonly elementBytes: 1 | 2 | 4 | 8;
  readonly element: NativeTypedArrayElement;
}

function kind(
  name: NativeTypedArrayKindName,
  widthClass: number,
  index: number,
  element: NativeTypedArrayElement,
): NativeTypedArrayKind {
  const elementBytes =
    widthClass === 2 ? 1 : widthClass === 3 ? 2 : widthClass === 4 ? 4 : 8;
  return { name, marker: index * 8 + widthClass, elementBytes, element };
}

/** Every native typed-array kind, by marker within each width class. */
export const nativeTypedArrayKinds: readonly NativeTypedArrayKind[] = [
  kind("Uint8Array", 2, 0, "unsigned"),
  kind("Int8Array", 2, 1, "signed"),
  kind("Uint8ClampedArray", 2, 2, "clamped"),
  kind("Uint16Array", 3, 0, "unsigned"),
  kind("Int16Array", 3, 1, "signed"),
  kind("Uint32Array", 4, 0, "unsigned"),
  kind("Int32Array", 4, 1, "signed"),
  kind("Float32Array", 4, 2, "float"),
  kind("Float64Array", 5, 0, "float"),
  kind("BigInt64Array", 5, 1, "bigint-signed"),
  kind("BigUint64Array", 5, 2, "bigint-unsigned"),
];

/** The kind a constructor name denotes, if it is a native typed array. */
export function nativeTypedArrayKind(
  name: string,
): NativeTypedArrayKind | undefined {
  for (const entry of nativeTypedArrayKinds) {
    if (entry === undefined) throw "typed array kind invariant";
    if (entry.name === name) return entry;
  }
  return undefined;
}

/** The kind a typed-array marker denotes. */
export function nativeTypedArrayKindOfMarker(
  marker: number,
): NativeTypedArrayKind | undefined {
  for (const entry of nativeTypedArrayKinds) {
    if (entry === undefined) throw "typed array kind invariant";
    if (entry.marker === marker) return entry;
  }
  return undefined;
}

/** Whether a kind's `[[ContentType]]` is BigInt. */
export function nativeTypedArrayBigInt(entry: NativeTypedArrayKind): boolean {
  return (
    entry.element === "bigint-signed" || entry.element === "bigint-unsigned"
  );
}
