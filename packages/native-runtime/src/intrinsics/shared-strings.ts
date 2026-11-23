// Shared string bodies (shared-strings.ts): flat string objects in the
// process's shared string arena, outside every managed heap. They live apart
// from memory.ts, which every image's collector runtime compiles whole: an
// image binds them only when it carries Worker messages.

/** The address of a string object. */
export function stringAddress(value: string): number {
  throw "HOST_UNAVAILABLE";
}
/** The string object at `address`, which the caller proves holds a flat
 * string object that stays valid while referenced (a shared string body the
 * isolate holds). Anything but an exact, nonzero, eight-byte-aligned integer
 * traps. */
export function stringAt(address: number): string {
  throw "HOST_UNAVAILABLE";
}
/** Copies a flat string object verbatim (header, length and units), by the
 * extent its header gives, to `offset` of a live authorized window, and
 * returns that extent in bytes; -1 when the string is not flat, does not fit
 * or an input is invalid. */
export function copyString(
  address: number,
  byteLength: number,
  offset: number,
  value: string,
): number {
  throw "HOST_UNAVAILABLE";
}
