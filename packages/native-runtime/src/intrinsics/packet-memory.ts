// Raw-window bulk accesses for Worker message packets (packet-memory.ts).
// They live apart from memory.ts, which every image's collector runtime
// compiles whole: an image binds them only when it carries packets.

/** The binary64 at an eight-byte-aligned `offset` of a live authorized
 * window; NaN for invalid bounds, alignment or numeric inputs. */
export function readMemoryFloat64(
  address: number,
  byteLength: number,
  offset: number,
): number {
  throw "HOST_UNAVAILABLE";
}
/** Writes a binary64 with the readMemoryFloat64 window contract; 0, or -1
 * for invalid input. */
export function writeMemoryFloat64(
  address: number,
  byteLength: number,
  offset: number,
  value: number,
): number {
  throw "HOST_UNAVAILABLE";
}
/** Copies every UTF-16 code unit of `value` (two bytes each, native byte
 * order) to `offset` of a live authorized window; 0, or -1 when they do not
 * fit or an input is invalid. */
export function writeMemoryString(
  address: number,
  byteLength: number,
  offset: number,
  value: string,
): number {
  throw "HOST_UNAVAILABLE";
}
/** A fresh string of `units` UTF-16 code units copied from `offset` of a live
 * authorized window. Invalid input traps. */
export function readMemoryString(
  address: number,
  byteLength: number,
  offset: number,
  units: number,
): string {
  throw "HOST_UNAVAILABLE";
}
