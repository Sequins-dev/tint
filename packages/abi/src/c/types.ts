/** C scalar kinds with fixed widths. `char` takes the target's signedness;
 * `isize`/`usize` are the pointer-sized integers (ssize_t, size_t). */
export type CScalar =
  | "bool"
  | "char"
  | "i8"
  | "u8"
  | "i16"
  | "u16"
  | "i32"
  | "u32"
  | "i64"
  | "u64"
  | "isize"
  | "usize"
  | "f32"
  | "f64";
export interface CField {
  readonly name: string;
  readonly type: CType;
}
/** A C type as a binding describes it. Records are structs or unions in
 * declaration order; `packed` gives every member alignment 1 (GNU packed)
 * and `alignment` raises the record's alignment (GNU aligned; 0: natural).
 * Arrays are fixed-length members only: C never passes them by value. */
export type CType =
  | { readonly kind: "void" }
  | { readonly kind: "scalar"; readonly scalar: CScalar }
  | { readonly kind: "pointer"; readonly pointee: CType }
  | {
      readonly kind: "record";
      readonly name: string;
      readonly union: boolean;
      readonly packed: boolean;
      readonly alignment: number;
      readonly fields: readonly CField[];
    }
  | {
      readonly kind: "array";
      readonly element: CType;
      readonly length: number;
    };
/** How a call may interact with the managed heap (docs/native-ffi.md):
 * leaf calls never re-enter managed code, so no collection can start while
 * they run; may-callback and async calls are later phases. */
export type CCallClass = "leaf" | "may-callback" | "async";
/** errno handling: `negated-result` returns -errno, captured immediately
 * after the call, whenever the (signed) result is negative. */
export type CErrnoPolicy = "none" | "negated-result";
/** One concrete C prototype instance. A variadic C function is described by
 * the prototype of one call shape: parameters from `fixedParameters` on are
 * the variadic arguments, already in their C default-promoted types. */
export interface CSignature {
  readonly parameters: readonly CType[];
  readonly result: CType;
  readonly fixedParameters: number;
  readonly callClass: CCallClass;
  readonly errno: CErrnoPolicy;
}
/** Target C ABI facts the classifier and layout engine depend on. */
export interface CTarget {
  readonly name: string;
  readonly charSigned: boolean;
  /** Apple arm64 passes every variadic argument on the stack; AAPCS64
   * passes them like named arguments. */
  readonly variadicArguments: "stack" | "registers";
  /** Apple packs named stack arguments at natural alignment; AAPCS64 gives
   * each at least an 8-byte slot. */
  readonly stackPacking: "natural" | "slots";
  /** Apple requires the caller to extend sub-32-bit integer arguments to 32
   * bits; AAPCS64 leaves the upper bits unspecified (the callee extends). */
  readonly narrowExtension: "caller" | "callee";
  /** AAPCS64 C.8 starts a 16-byte-aligned composite in an even X register;
   * Apple arm64 does not round (verified by the clang oracle test). */
  readonly alignedPairs: "even" | "any";
  /** The alignment that places composite arguments (C.8's even register,
   * C.14/C.16's stack rounding): AAPCS64 uses the natural alignment, the
   * largest member alignment before the record's own `aligned` attribute;
   * Apple uses the declared (adjusted) alignment. Verified by the clang
   * oracle on both targets. */
  readonly compositeAlignment: "members" | "declared";
}
export const darwinArm64CTarget: CTarget = {
  name: "darwin-arm64",
  charSigned: true,
  variadicArguments: "stack",
  stackPacking: "natural",
  narrowExtension: "caller",
  alignedPairs: "any",
  compositeAlignment: "declared",
};
export const linuxArm64CTarget: CTarget = {
  name: "linux-arm64",
  charSigned: false,
  variadicArguments: "registers",
  stackPacking: "slots",
  narrowExtension: "callee",
  alignedPairs: "even",
  compositeAlignment: "members",
};
export const linuxX86_64CTarget: CTarget = {
  name: "linux-x86_64",
  charSigned: true,
  variadicArguments: "registers",
  stackPacking: "slots",
  narrowExtension: "caller",
  alignedPairs: "any",
  compositeAlignment: "declared",
};
export function cVoid(): CType {
  return { kind: "void" };
}
export function cScalar(scalar: CScalar): CType {
  return { kind: "scalar", scalar };
}
export function cPointer(pointee: CType): CType {
  return { kind: "pointer", pointee };
}
/** Byte width of a scalar (also its natural alignment on arm64 targets). */
export function cScalarBytes(scalar: CScalar): number {
  switch (scalar) {
    case "bool":
    case "char":
    case "i8":
    case "u8":
      return 1;
    case "i16":
    case "u16":
      return 2;
    case "i32":
    case "u32":
    case "f32":
      return 4;
    case "i64":
    case "u64":
    case "isize":
    case "usize":
    case "f64":
      return 8;
  }
}
export function cScalarFloat(scalar: CScalar): boolean {
  return scalar === "f32" || scalar === "f64";
}
/** Whether an integer scalar is signed on `target` (bool is unsigned). */
export function cScalarSigned(scalar: CScalar, target: CTarget): boolean {
  switch (scalar) {
    case "char":
      return target.charSigned;
    case "i8":
    case "i16":
    case "i32":
    case "i64":
    case "isize":
      return true;
    default:
      return false;
  }
}
/** C default argument promotion for a variadic argument: integers narrower
 * than int become int (unsigned stays unsigned only from 32 bits), float
 * becomes double. Other types are unchanged. */
export function cPromoteVariadic(type: CType): CType {
  if (type.kind !== "scalar") return type;
  const scalar = type.scalar;
  if (scalar === "f32") return cScalar("f64");
  if (cScalarBytes(scalar) < 4) return cScalar("i32");
  return type;
}
