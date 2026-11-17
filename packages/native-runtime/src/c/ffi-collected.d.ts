/** `tint:ffi/collected` (docs/native-ffi.md, "External storage"),
 * implemented by packages/native-runtime/src/ffi/collected.ts. */
declare module "tint:ffi/collected" {
  /** External storage the collector also frees once the view is
   * unreachable, unless `release` (from `tint:ffi`) freed it first. Needs
   * weak cells: the copying and region collectors (docs/native-ffi.md). */
  export function external(byteLength: number): Uint8Array;
}
