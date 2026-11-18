/** `tint:ffi/unsafe`: views over memory C owns (docs/native-ffi.md,
 * "Foreign memory"; packages/native-runtime/src/ffi/unsafe.ts). Reading
 * memory at an arbitrary address is the unsafe part of the FFI, so it lives
 * behind its own import; only modules on the workspace boundary check's
 * list may import it. A foreign view is an ordinary C view (or byte view)
 * whose memory C owns: never moved, freed or traced by the collector. Its
 * lifetime and extent are C's contract; creation checks the address once
 * (null or inexact: TypeError) and member accesses stay within the record. */
declare module "tint:ffi/unsafe" {
  import type { Address, Layout, View } from "tint:ffi";
  /** A view of record `T` over the `layout.size` bytes at `address`. */
  export function viewAt<T>(layout: Layout<T>, address: Address<T>): View<T>;
  /** Views of the `count` consecutive `T` records at `address` (a C array
   * `T[count]`). */
  export function arrayAt<T>(
    layout: Layout<T>,
    address: Address<T>,
    count: number,
  ): View<T>[];
  /** A byte view of the `length` bytes at `address`. */
  export function bytesAt(
    address: Address<unknown>,
    length: number,
  ): Uint8Array;
  /** A copy of the NUL-terminated UTF-8 text at `text` (`char *` results
   * and members; malformed sequences become U+FFFD). */
  export function cStringAt(text: Address<number>): string;
  /** Dynamic calls (docs/native-ffi.md, "Dynamic calls"): a C prototype
   * as data (the same shape as @tint/abi/c's CSignature). */
  export type ForeignScalar =
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
  export type ForeignType =
    | { readonly kind: "void" }
    | { readonly kind: "scalar"; readonly scalar: ForeignScalar }
    | { readonly kind: "pointer"; readonly pointee: ForeignType }
    | {
        readonly kind: "record";
        readonly name: string;
        readonly union: boolean;
        readonly packed: boolean;
        readonly alignment: number;
        readonly fields: readonly {
          readonly name: string;
          readonly type: ForeignType;
        }[];
      }
    | {
        readonly kind: "array";
        readonly element: ForeignType;
        readonly length: number;
      };
  export interface ForeignSignature {
    readonly parameters: readonly ForeignType[];
    readonly result: ForeignType;
    /** Parameters from here on are variadic (default-promoted). */
    readonly fixedParameters: number;
    readonly callClass: "leaf" | "may-callback" | "async";
    readonly errno: "none" | "negated-result";
  }
  /** A classified C function at an address with its argument state. */
  export interface ForeignFunction {
    readonly address: number;
    readonly signature: ForeignSignature;
  }
  /** Classify `signature` for a leaf call of the C function at `address`
   * (null: TypeError; over 512 stack bytes, 8 pointers or 512 bytes of
   * record copies: RangeError). */
  export function foreignFunction(
    address: Address<unknown>,
    signature: ForeignSignature,
  ): ForeignFunction;
  /** Argument setters: numbers (exact integers in range, else TypeError;
   * pointers as addresses), C bools, exact 64-bit halves, borrowed bytes
   * for pointers and record images by value. */
  export function setNumber(
    fn: ForeignFunction,
    index: number,
    value: number,
  ): void;
  export function setBoolean(
    fn: ForeignFunction,
    index: number,
    value: boolean,
  ): void;
  export function setWords(
    fn: ForeignFunction,
    index: number,
    low: number,
    high: number,
  ): void;
  export function setBytes(
    fn: ForeignFunction,
    index: number,
    bytes: Uint8Array,
  ): void;
  export function setRecord(
    fn: ForeignFunction,
    index: number,
    image: Uint8Array,
  ): void;
  /** A dynamic callback: C's arguments as numbers (bools 0 or 1), its
   * result as a number (ignored for void). */
  export type DynamicCallback = (args: number[]) => number;
  /** Pass `callback` as pointer argument `index`; C may call it with
   * prototype `signature` during this function's calls (which become
   * may-callback calls). What it throws is rethrown after the call. */
  export function setCallback(
    fn: ForeignFunction,
    index: number,
    signature: ForeignSignature,
    callback: DynamicCallback,
  ): void;
  /** One call through the universal trampoline. */
  export function invoke(fn: ForeignFunction): void;
  /** Result readers for the last call. */
  export function resultNumber(fn: ForeignFunction): number;
  export function resultBoolean(fn: ForeignFunction): boolean;
  export function resultLow(fn: ForeignFunction): number;
  export function resultHigh(fn: ForeignFunction): number;
  export function resultRecord(fn: ForeignFunction, into: Uint8Array): void;
  /** An open library: its handle's exact 64-bit word (Darwin's
   * dlopen(NULL) handle has high bits set). */
  export interface LibraryHandle {
    readonly low: number;
    readonly high: number;
  }
  /** dlopen (RTLD_LAZY), dlopen(NULL), dlsym and dlclose; failures throw
   * TypeError with dlerror's text. */
  export function openLibrary(path: string): LibraryHandle;
  export function openProgram(): LibraryHandle;
  export function findSymbol(
    handle: LibraryHandle,
    name: string,
  ): Address<void>;
  export function closeLibrary(handle: LibraryHandle): void;
  /** The address of `name` in optional library `image` (dlopen'd once, at
   * first use), or -1 when either is absent: optional libraries on ELF. */
  export function optionalSymbol(image: string, name: string): number;
}
