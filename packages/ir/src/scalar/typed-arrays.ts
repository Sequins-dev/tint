import {
  nativeTypedArrayKind,
  type NativeTypedArrayKind,
} from "@tint/abi/typed-array";
import type { NativeTypedArray } from "./model.ts";

/** Every typed-array kind with a native scalar representation. The BigInt
 * kinds are not among them: their elements need a BigInt representation. */
export const nativeTypedArrays: readonly NativeTypedArray[] = [
  "Uint8Array",
  "Int8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
];

/** The native typed-array kind a scalar type names, if it names one. */
export function nativeTypedArray(
  type: string | undefined,
): NativeTypedArray | undefined {
  // Optional strings cannot be switched on natively.
  if (type === undefined) return undefined;
  switch (type) {
    case "Uint8Array":
      return "Uint8Array";
    case "Int8Array":
      return "Int8Array";
    case "Uint8ClampedArray":
      return "Uint8ClampedArray";
    case "Uint16Array":
      return "Uint16Array";
    case "Int16Array":
      return "Int16Array";
    case "Uint32Array":
      return "Uint32Array";
    case "Int32Array":
      return "Int32Array";
    case "Float32Array":
      return "Float32Array";
    case "Float64Array":
      return "Float64Array";
    default:
      return undefined;
  }
}

/** Whether a scalar type is a native typed array. */
export function isNativeTypedArray(type: string | undefined): boolean {
  return nativeTypedArray(type) !== undefined;
}

/** A native typed array's layout: header marker, element bytes and element
 * representation (see @tint/abi/typed-array). */
export function typedArrayLayout(type: NativeTypedArray): NativeTypedArrayKind {
  const entry = nativeTypedArrayKind(type);
  if (entry === undefined) throw "typed array layout invariant";
  return entry;
}

/** Whether a typed array's elements are 32-bit integers (signed or
 * unsigned, never -0) rather than floating-point numbers. */
export function typedArrayIntegerElements(type: NativeTypedArray): boolean {
  return type !== "Float32Array" && type !== "Float64Array";
}

/** log2 of a typed array's element bytes (an address scale). */
export function typedArrayScale(type: string | undefined): 0 | 1 | 2 | 3 {
  const array = nativeTypedArray(type);
  if (array === undefined) throw "typed array scale invariant";
  const bytes = typedArrayLayout(array).elementBytes;
  return bytes === 1 ? 0 : bytes === 2 ? 1 : bytes === 4 ? 2 : 3;
}

/** A typed array's header marker, or 0 for any other type. */
export function typedArrayMarker(type: string | undefined): number {
  const array = nativeTypedArray(type);
  return array === undefined ? 0 : typedArrayLayout(array).marker;
}
