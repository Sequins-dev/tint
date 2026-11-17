/** `tint:ffi`: the marker types C binding declarations are written with
 * (docs/native-ffi.md). Tint reads them syntactically from `tint:c/...`
 * declaration modules; for the TypeScript checker they erase to the
 * ordinary values callers pass, so call sites stay plain TypeScript. The
 * module also provides external (non-moving) storage for memory C retains
 * across calls (packages/native-runtime/src/ffi/index.ts). */
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
  /** `T *` as a raw address: pointer results, record members and arguments
   * C may retain. An exact unsigned 64-bit integer; values a number cannot
   * hold exactly trap (never round). Only non-moving memory (external
   * storage) has an address that stays valid across calls. */
  export type Address<T> = number & { readonly [pointee]?: T };
  /** Accessor marker: member `K` of record `R` through a `Ptr<R>`, as a
   * getter result (`(record: Ptr<R>): Field<R, "k">`) or setter value
   * (`(record: Ptr<R>, value: Field<R, "k">): void`). Each accessor
   * compiles to one constant-offset load or store. */
  export type Field<R, K extends keyof R> = R[K];
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
  /** A type or integer constant that differs between targets, keyed by
   * target name (`"darwin-arm64"`, `"linux-arm64"`): Tint reads the
   * build target's choice; a target without one cannot use the declaration.
   * For the TypeScript checker it is any of the choices. */
  export type ByTarget<Choices> = Choices[keyof Choices];
  /** External storage (docs/native-ffi.md, "External storage"): a byte view
   * over `byteLength` zero-filled bytes outside the managed heap, which never
   * move, so C may retain their address across calls. Its lifetime is
   * explicit: the owner must `release` it (collector-registered storage is
   * `external` from `tint:ffi/collected`). */
  export function allocate(byteLength: number): Uint8Array;
  /** Free external storage now. Its pages become inaccessible (later access
   * faults rather than reading freed memory) until the view is unreachable.
   * Throws TypeError for other arrays or a second release. */
  export function release(view: Uint8Array): void;
  /** The address of live external storage (throws TypeError for movable
   * arrays, views and released storage). */
  export function address(view: Uint8Array): Address<u8>;
  /** A copy of the NUL-terminated UTF-8 text at `text` (malformed sequences
   * become U+FFFD). */
  export function cString(text: Address<char>): string;
}
