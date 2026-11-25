// The UTF-8 bulk primitives (packages/foundation/src/text/utf8.ts): typed
// checks of utf8ByteLength, writeUTF8, utf8Text and utf8WholeText against
// independent per-scalar references written here, across run lengths and
// offsets that cross the native word and vector boundaries, both string
// kinds, slices (AArch64 slices: nativeStringSlicedMinimumLength units or
// more), every scalar width, surrogate pairs (whole, split by a range end,
// lone), every capacity, and invalid and truncated byte sequences. Native builds bind
// the primitives to IR instructions (tools/native-utf8-text.test.ts); Node
// runs their portable bodies (tools/utf8-text-fixture.test.ts). `run`
// returns 42, or the number of the first failed check.
export const utf8TextSource = `
import {
  utf8ByteLength,
  utf8Text,
  utf8WholeText,
  writeUTF8,
} from "@tint/foundation/text/utf8";

/** The scalar at index (a pair inside [index, limit) is one; a lone
 * surrogate is U+FFFD) and its unit count. */
function scalar(text: string, index: number, limit: number): number[] {
  const unit = text.charCodeAt(index);
  if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < limit) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff)
      return [0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00), 2];
  }
  if (unit >= 0xd800 && unit <= 0xdfff) return [0xfffd, 1];
  return [unit, 1];
}
function pushScalar(out: number[], point: number): void {
  if (point < 0x80) out.push(point);
  else if (point < 0x800) out.push(0xc0 | (point >>> 6), 0x80 | (point & 63));
  else if (point < 0x10000)
    out.push(
      0xe0 | (point >>> 12),
      0x80 | ((point >>> 6) & 63),
      0x80 | (point & 63),
    );
  else
    out.push(
      0xf0 | (point >>> 18),
      0x80 | ((point >>> 12) & 63),
      0x80 | ((point >>> 6) & 63),
      0x80 | (point & 63),
    );
}
/** UTF-8 of units [begin, limit), scalar by scalar. */
function referenceUTF8(text: string, begin: number, limit: number): number[] {
  const out: number[] = [];
  for (let index = begin; index < limit; ) {
    const [point, units] = scalar(text, index, limit);
    pushScalar(out, point ?? 0);
    index += units ?? 1;
  }
  return out;
}
/** The unit index after the scalars of [begin, limit) whose bytes fit in
 * \`capacity\`, and those bytes' count. */
function referenceFit(
  text: string,
  begin: number,
  limit: number,
  capacity: number,
): number[] {
  let index = begin,
    bytes = 0;
  while (index < limit) {
    const [point, units] = scalar(text, index, limit);
    const out: number[] = [];
    pushScalar(out, point ?? 0);
    if (bytes + out.length > capacity) break;
    bytes += out.length;
    index += units ?? 1;
  }
  return [index, bytes];
}
/** The longest valid prefix of bytes [begin, limit), decoded scalar by
 * scalar (an independent state machine). */
function referenceText(bytes: Uint8Array, begin: number, limit: number): string {
  let text = "",
    index = begin;
  while (index < limit) {
    const lead = bytes[index] ?? 0;
    let needed = -1,
      point = 0;
    if (lead < 0x80) {
      needed = 0;
      point = lead;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      point = lead & 31;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      point = lead & 15;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      point = lead & 7;
    }
    if (needed < 0 || index + needed >= limit) break;
    let ok = true;
    for (let k = 1; k <= needed; k++) {
      const byte = bytes[index + k] ?? 0;
      if (byte < 0x80 || byte > 0xbf) ok = false;
      point = (point << 6) | (byte & 63);
    }
    // Overlong forms, surrogates and points above U+10FFFF.
    if (needed === 2 && (point < 0x800 || (point >= 0xd800 && point <= 0xdfff)))
      ok = false;
    if (needed === 3 && (point < 0x10000 || point > 0x10ffff)) ok = false;
    if (!ok) break;
    text += String.fromCodePoint(point);
    index += needed + 1;
  }
  return text;
}

/** ASCII filler: printable units. */
function filler(i: number): number {
  return 0x20 + ((i * 7) % 0x5f);
}
/** count filler units with \`special\` (one or two units) at \`at\`. */
function textWith(count: number, at: number, special: string): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++)
    parts.push(i === at ? special : String.fromCharCode(filler(i)));
  return parts.join("");
}
const specials: readonly string[] = [
  "\\u007f",
  "\\u0080",
  "\\u00ff",
  "\\u0100",
  "\\u07ff",
  "\\u0800",
  "\\u4e16",
  "\\uffff",
  "\\ud83d\\ude00",
  "\\ud800",
  "\\udbff",
  "\\udc00",
  "\\ud800\\ud800",
];
function checkLength(text: string): boolean {
  for (let begin = 0; begin <= 3 && begin <= text.length; begin++)
    for (let limit = begin; limit <= text.length; limit++)
      if (utf8ByteLength(text, begin, limit) !== referenceUTF8(text, begin, limit).length)
        return false;
  return true;
}
function checkWrite(text: string, begin: number, limit: number): number {
  const whole = referenceUTF8(text, begin, limit);
  for (let capacity = 0; capacity <= whole.length + 1; capacity++) {
    const bytes = new Uint8Array(capacity + 5).fill(0xcc);
    const window = bytes.subarray(0, capacity + 3);
    const end = writeUTF8(text, begin, limit, window, 3),
      [want, written] = referenceFit(text, begin, limit, capacity);
    if (end !== want) return 1;
    for (let i = 0; i < bytes.length; i++) {
      const expected =
        i >= 3 && i < 3 + (written ?? 0) ? (whole[i - 3] ?? -1) : 0xcc;
      if (bytes[i] !== expected) return 2;
    }
  }
  return 0;
}
/** utf8Text is the reference prefix, and utf8WholeText that prefix when
 * it spans the range (its UTF-8 length), else the empty string. */
function checkText(bytes: Uint8Array): boolean {
  for (let begin = 0; begin <= 2 && begin <= bytes.length; begin++)
    for (let limit = begin; limit <= bytes.length; limit++) {
      const prefix = referenceText(bytes, begin, limit);
      if (utf8Text(bytes, begin, limit) !== prefix) return false;
      const whole =
        referenceUTF8(prefix, 0, prefix.length).length === limit - begin;
      if (utf8WholeText(bytes, begin, limit) !== (whole ? prefix : ""))
        return false;
    }
  return true;
}

export function run(): number {
  // 1-3: byte lengths around every special unit, at every position of runs
  // of 0-40 units, from begins 0-3 to every limit.
  for (let s = 0; s < specials.length; s++) {
    const special = specials[s] ?? "";
    for (let count = 0; count <= 40; count += count < 20 ? 1 : 7)
      for (let at = -1; at < count; at += count < 20 ? 1 : 3)
        if (!checkLength(textWith(count, at, special))) return 1;
  }
  const long = textWith(500, 250, "\\u00e9") + textWith(300, 7, "\\ud83d\\ude00");
  if (utf8ByteLength(long, 0, long.length) !== referenceUTF8(long, 0, long.length).length)
    return 2;
  if (utf8ByteLength("", 0, 0) !== 0) return 3;
  // 4-6: slices (long ones share their parent on AArch64) of both
  // kinds, measured whole and in part.
  const oneParent = textWith(90, 40, "\\u00e9"),
    twoParent = textWith(90, 40, "\\u4e16");
  for (let start = 0; start < 30; start += 3) {
    const one = oneParent.slice(start, start + 50),
      two = twoParent.slice(start, start + 50);
    if (!checkLength(one) || !checkLength(two)) return 4;
    if (checkWrite(one, 2, one.length) !== 0) return 5;
    if (checkWrite(two, 1, two.length - 1) !== 0) return 6;
  }
  // 7-9: writes at every capacity, around every special unit; a range end
  // splitting a pair leaves a lone surrogate.
  for (let s = 0; s < specials.length; s++) {
    const special = specials[s] ?? "";
    for (let count = 1; count <= 24; count++) {
      const text = textWith(count, count >> 1, special);
      const failed = checkWrite(text, 0, text.length);
      if (failed !== 0) return 6 + failed;
    }
  }
  const pair = "ab\\ud83d\\ude00cd";
  if (checkWrite(pair, 0, 3) !== 0 || checkWrite(pair, 3, 6) !== 0) return 9;
  // 10-13: decoding the encodings of the texts above, then with an invalid
  // or truncated byte at every position.
  for (let s = 0; s < specials.length; s++) {
    const special = specials[s] ?? "";
    for (let count = 0; count <= 24; count++) {
      const text = textWith(count, count >> 1, special);
      const encoded = new Uint8Array(referenceUTF8(text, 0, text.length));
      if (!checkText(encoded)) return 10;
      for (let at = 0; at < encoded.length; at++) {
        const broken = encoded.slice(0);
        broken[at] = at % 3 === 0 ? 0xff : at % 3 === 1 ? 0x80 : 0xc0;
        if (!checkText(broken)) return 11;
      }
    }
  }
  const longBytes = new Uint8Array(referenceUTF8(long, 0, long.length));
  if (utf8Text(longBytes, 0, longBytes.length) !== referenceText(longBytes, 0, longBytes.length))
    return 12;
  // Results take the canonical kind: Latin-1 decodes to one-byte units.
  const latin = utf8Text(new Uint8Array([0x63, 0xc3, 0xa9, 0xc2, 0x80]), 0, 5);
  if (latin !== "c\\u00e9\\u0080" || latin.charCodeAt(1) !== 0xe9) return 13;
  // 14-16: every lead's continuation bounds (overlong, surrogate and
  // beyond-U+10FFFF forms stop the prefix), for each lead byte.
  const edges = [0x00, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xff];
  for (let lead = 0x80; lead < 0x100; lead++)
    for (let b = 0; b < edges.length; b++)
      for (let c = 0; c < edges.length; c += 3) {
        const bytes = new Uint8Array([
          0x41,
          lead,
          edges[b] ?? 0,
          edges[c] ?? 0,
          0xbf,
          0x42,
        ]);
        if (!checkText(bytes)) return 14;
      }
  if (utf8Text(new Uint8Array(0), 0, 0) !== "") return 15;
  if (utf8Text(new Uint8Array([0xf0, 0x9f, 0x98]), 0, 3) !== "") return 16;
  return 42;
}
`;
