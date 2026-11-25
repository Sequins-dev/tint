// String transfer primitives (docs/design-one-byte-strings.md, "Transfer
// contract"): isFlatString and flattenStringInto, which cross-isolate
// transfer binds. Checks that flat images are exactly a flat string's
// object (header, length, units, zero padding, nativeFlatStringExtent):
// a one-byte image literal copied verbatim, two-byte and short strings,
// and slices (on AArch64) of both kinds flattened from their parents. Bad
// windows return -1 and write nothing. `run` returns 42, or the number of
// the first failed check. tools/native-string-transfer.test.ts builds it.
export const stringTransferSource = `
import { mapMemory, unmapMemory, isFlatString, flattenStringInto } from "memory";
import { readSharedUnsigned, writeSharedUnsigned } from "shared";
import { targetArchitecture } from "process";

function abc(count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(String.fromCharCode(97 + (i % 26)));
  return parts.join("");
}
/** nativeFlatStringExtent of a flat string of the given length and kind. */
function extentOf(length: number, oneByte: boolean): number {
  const bytes = oneByte ? length : length * 2,
    used = 16 + (bytes < 8 ? 8 : bytes);
  return used + ((8 - (used % 8)) % 8);
}
/** 0 when the window at base holds text's flat image of the returned
 * extent: the flat header of its canonical kind, its length, its units
 * and zero padding; else the failed part. */
function holds(base: number, size: number, text: string, extent: number): number {
  let oneByte = true;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) oneByte = false;
  if (extent !== extentOf(text.length, oneByte)) return 1;
  if (readSharedUnsigned(base, size, 0, 4, 0) !== 1) return 2;
  if (readSharedUnsigned(base, size, 4, 4, 0) !== (oneByte ? 0x10000 : 0)) return 3;
  if (readSharedUnsigned(base, size, 8, 4, 0) !== text.length) return 4;
  if (readSharedUnsigned(base, size, 12, 4, 0) !== 0) return 5;
  const width = oneByte ? 1 : 2;
  for (let i = 0; i < text.length; i++)
    if (readSharedUnsigned(base, size, 16 + i * width, width, 0) !== text.charCodeAt(i)) return 6;
  for (let at = 16 + text.length * width; at < extent; at++)
    if (readSharedUnsigned(base, size, at, 1, 0) !== 0) return 7;
  if (readSharedUnsigned(base, size, extent, 4, 0) !== 0xa5a5a5a5) return 8;
  return 0;
}
/** Fills the window's first 512 bytes with 0xA5, so stray writes show. */
function dirty(base: number, size: number): void {
  for (let at = 0; at < 512; at += 4) writeSharedUnsigned(base, size, at, 4, 0xa5a5a5a5, 0);
}
function flattened(base: number, size: number, text: string): number {
  dirty(base, size);
  return holds(base, size, text, flattenStringInto(base, size, text));
}

export function run(): number {
  const size = 4096,
    base = mapMemory(size);
  if (base <= 0) return 1;
  // 2-3: a one-byte image literal is flat and copies verbatim.
  const literal = "Latin-1 image literal: caf\\u00e9 cr\\u00e8me br\\u00fbl\\u00e9e";
  if (isFlatString(literal) !== 1) return 2;
  if (flattened(base, size, literal) !== 0) return 3;
  // 4-6: a two-byte literal, and strings within the minimum data bytes.
  if (flattened(base, size, "two-byte \\u4e16\\u754c literal") !== 0) return 4;
  if (flattened(base, size, "") !== 0) return 5;
  if (flattened(base, size, "ab") !== 0 || flattened(base, size, "\\u4e16\\u754c") !== 0)
    return 6;
  // 7-11: AArch64 slices (9 units or more in their parent's kind) are not
  // flat; flattening copies their range in their kind. Other targets copy
  // every slice, which is flat.
  const one = abc(60) + "\\u00e9" + abc(20),
    two = abc(30) + "\\u4e16" + abc(30),
    slice = one.slice(5, 70),
    wideSlice = two.slice(25, 50),
    nested = slice.slice(3, 40),
    narrowed = two.slice(0, 29);
  const sliced = targetArchitecture() === 1 ? 0 : 1;
  if (isFlatString(one) !== 1 || isFlatString(two) !== 1) return 7;
  if (isFlatString(slice) !== sliced || isFlatString(wideSlice) !== sliced) return 8;
  if (isFlatString(nested) !== sliced || isFlatString(narrowed) !== 1) return 9;
  if (flattened(base, size, slice) !== 0 || flattened(base, size, wideSlice) !== 0) return 10;
  if (flattened(base, size, nested) !== 0 || flattened(base, size, narrowed) !== 0) return 11;
  // 12-20: bad windows return -1 and write nothing; an exact fit works.
  dirty(base, size);
  if (flattenStringInto(base, 23, "ab") !== -1) return 12;
  if (flattenStringInto(base + 4, size - 4, "ab") !== -1) return 13;
  if (flattenStringInto(0, size, "ab") !== -1) return 14;
  if (flattenStringInto(base, -8, "ab") !== -1) return 15;
  if (flattenStringInto(base, 1.5, "ab") !== -1) return 16;
  if (flattenStringInto(base, 0 / 0, "ab") !== -1) return 17;
  if (flattenStringInto(9007199254740984, 16, "ab") !== -1) return 18;
  if (readSharedUnsigned(base, size, 0, 4, 0) !== 0xa5a5a5a5) return 19;
  if (holds(base, size, "ab", flattenStringInto(base, 24, "ab")) !== 0) return 20;
  return unmapMemory(base, size) === 0 ? 42 : 21;
}
`;
