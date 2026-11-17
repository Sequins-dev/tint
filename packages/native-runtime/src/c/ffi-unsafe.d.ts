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
}
