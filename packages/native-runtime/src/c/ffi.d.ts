/** `tint:ffi`: the marker types C binding declarations are written with
 * (docs/native-ffi.md). Tint reads them syntactically from `tint:c/...`
 * declaration modules; for the TypeScript checker they erase to the
 * ordinary values callers pass, so call sites stay plain TypeScript. */
declare module "tint:ffi" {
  /** C scalar widths. Integers are numbers converted exactly (inexact or
   * out-of-range values trap); 64-bit values must be exact numbers. */
  export type bool = boolean;
  export type char = number;
  export type i8 = number;
  export type u8 = number;
  export type i16 = number;
  export type u16 = number;
  export type i32 = number;
  export type u32 = number;
  export type i64 = number;
  export type u64 = number;
  export type isize = number;
  export type usize = number;
  export type f32 = number;
  export type f64 = number;
  /** `T *` as an argument: a byte view whose data the call borrows. A leaf
   * call may use (and write) it only until it returns. A record pointee
   * requires at least the record's size. */
  export type Ptr<T> = Uint8Array & { readonly [pointee]?: T };
  const pointee: unique symbol;
  /** `const char *` from a string: a NUL-terminated UTF-8 copy for the call
   * (lone surrogates become U+FFFD). */
  export type CString = string;
  /** `const char *` from bytes that already end in NUL (checked). */
  export type CStringBytes = Uint8Array;
  /** A fixed-length C array record member. */
  export type FixedArray<T, N extends number> = T[] & { readonly length: N };
  /** A record's C layout, from the same computation the compiler uses. */
  export interface Layout<T> {
    readonly size: number;
    readonly alignment: number;
    readonly offsets: { readonly [K in keyof T]: number };
  }
  /** A result that is the value when non-negative and else the negated
   * errno, captured immediately after the call. */
  export type OrErrno<T> = T;
  /** A parameter passed as a variadic argument (this and all later ones),
   * after C default promotion. */
  export type Variadic<T> = T;
  /** Call classes beyond leaf (a later phase): a call that may re-enter
   * managed code, and a call that runs off the mutator thread. */
  export type MayCallback<T> = T;
  export type Async<T> = Promise<T>;
  /** Record layout markers: `interface R extends Packed { ... }`. */
  export interface Packed {}
  export interface Union {}
  export interface Aligned<N extends number> {
    readonly [alignment]?: N;
  }
  const alignment: unique symbol;
}
