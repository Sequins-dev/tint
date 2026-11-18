/** `tint:ffi`: the marker types C binding declarations are written with
 * (docs/native-ffi.md). Tint reads them syntactically from `tint:c/...`
 * declaration modules; for the TypeScript checker they erase to the
 * ordinary values callers pass, so call sites stay plain TypeScript. The
 * module also provides external (non-moving) storage for memory C retains
 * across calls (packages/native-runtime/src/ffi/index.ts). Memory C owns
 * is reached only through `tint:ffi/unsafe` (src/c/ffi-unsafe.d.ts). */
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
  export type Ptr<T> = (T extends number | boolean | void
    ? Uint8Array
    : Uint8Array | View<T>) & {
    readonly [pointee]?: T;
  };
  const pointee: unique symbol;
  /** A C view (docs/native-ffi.md, "C views"): record `T`'s members as
   * properties over the bytes a view was made from (`R.view(bytes)`). A read
   * is one load at the member's constant offset; a write is one store after
   * the member's contract check (integers and addresses must be exact and
   * in range, else TypeError; f32 rounds). Nested records and fixed arrays
   * are views too (assigned member by member, so read-only here). Views are
   * nominal: only `R.view` makes one, and a view is a `Ptr<T>`. */
  export type View<T> = {
    -readonly [K in keyof T as T[K] extends number | boolean ? K : never]: T[K];
  } & {
    readonly [
      K in keyof T as T[K] extends number | boolean ? never : K
    ]: ViewOf<T[K]>;
  } & { readonly [viewOf]: T };
  /** A fixed array member's view: elements by index (an index must be an
   * integer below `length`, else RangeError) and the constant length. */
  export interface ArrayView<E> {
    [index: number]: ViewOf<E>;
    readonly length: number;
    readonly [viewOf]: readonly E[];
  }
  type ViewOf<M> = M extends number | boolean
    ? M
    : M extends readonly (infer E)[]
      ? ArrayView<E>
      : View<M>;
  const viewOf: unique symbol;
  /** `T *` as a raw address: pointer results, record members and arguments
   * C may retain. An exact unsigned 64-bit integer; values a number cannot
   * hold exactly trap (never round). Only non-moving memory (external
   * storage) has an address that stays valid across calls. */
  export type Address<T> = number & { readonly [pointee]?: T };
  /** Availability query marker: `(): Available<"name">` is true exactly
   * when the symbol of declared function `name` is bound. An optional
   * library's imports are weak and read as zero when it is absent; calling
   * an absent function would jump to address 0, so ask first. One load of
   * the import slot and a comparison. */
  export type Available<Name extends string> = boolean;
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
    /** A view of the record over `bytes`, which must hold `size` bytes
     * (else RangeError); the view is those same bytes. */
    view(bytes: Uint8Array): View<T>;
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
   * explicit: the owner must `release` it. */
  export function allocate(byteLength: number): Uint8Array;
  /** External storage the collector also frees once the view is
   * unreachable, unless `release` freed it first (under every collector). */
  export function external(byteLength: number): Uint8Array;
  /** Free external storage now. Its pages become inaccessible (later access
   * faults rather than reading freed memory) until the view is unreachable.
   * Throws TypeError for other arrays or a second release. */
  export function release(view: Uint8Array): void;
  /** The address of live external storage (throws TypeError for movable
   * arrays, views and released storage). */
  export function address(view: Uint8Array): Address<u8>;
  /** Whether `view`'s data never moves (external storage or foreign
   * memory): what may-callback calls take for pointer arguments. */
  export function stableBytes(view: Uint8Array): boolean;
  /** The calling mutator's callback state block (generated may-callback
   * wrappers pass it to C calls; docs/native-ffi.md, "Callbacks"). */
  export function callbackState(): Uint8Array;
  /** A C function pointer argument entering TypeScript: the callback is
   * valid for the duration of the call it is passed to. A type alias of a
   * Callback (`type alloc_func = Callback<...>`) also declares a callback
   * type whose functions can be registered for C to keep. */
  export type Callback<F> = F;
  /** Unregister the registered callback whose C function pointer is
   * `address` (docs/native-ffi.md, "Callbacks"). */
  export function releaseCallback(address: number): void;
  /** Callback views (generated adapters): the guard address, and pointing
   * a callback's view at one invocation's record or back at the guard. */
  export function callbackGuard(): number;
  export function retargetCallbackView(view: Uint8Array, address: number): void;
}
