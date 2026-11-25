// The Latin-1 and ASCII text primitives (packages/foundation/src/text/latin1.ts)
// and the UTF-8 codec built on them: typed checks of their results across run
// lengths and offsets that cross the native word and vector boundaries, both
// string kinds and the 0x7F/0x80 and 0xFF/0x100 unit boundaries. Native
// builds bind the primitives to IR instructions; Node runs their portable
// bodies (tools/latin1-text-fixture.test.ts). `run` returns 42, or the
// number of the first failed check. Out-of-range indices are invariant
// failures (a trap natively), so no check passes one.
export const latin1TextSource = `
import {
  asciiEndOfBytes,
  asciiEndOfText,
  asciiLowercase,
  asciiUppercase,
  copyLatin1,
  latin1Text,
} from "@tint/foundation/text/latin1";
import {
  createUTF8Decoder,
  decodeUTF8,
  encodeUTF8,
  encodeUTF8Into,
} from "@tint/foundation/text/text-encoding";

/** count units: unit(i) = 0x20 + (i * 7) % 0x5f, ASCII and printable. */
function asciiUnit(i: number): number {
  return 0x20 + ((i * 7) % 0x5f);
}
function asciiBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = asciiUnit(i);
  return bytes;
}
/** The string of asciiUnit(0..count) with unit \`special\` at \`at\` (no
 * special unit when at < 0). */
function asciiText(count: number, at: number, special: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++)
    parts.push(String.fromCharCode(i === at ? special : asciiUnit(i)));
  return parts.join("");
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}
/** UTF-8 of a string, one code point at a time (the reference). */
function referenceUTF8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let point = text.charCodeAt(i);
    if (point >= 0xd800 && point <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else point = 0xfffd;
    } else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd;
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
  return out;
}
function matchesReference(text: string): boolean {
  const expected = referenceUTF8(text),
    actual = encodeUTF8(text);
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i]) return false;
  return true;
}
function decode(bytes: Uint8Array): string {
  return decodeUTF8(createUTF8Decoder(false, false), bytes) ?? "<fatal>";
}

export function run(): number {
  // 1-4: latin1Text over every range of 0-40 bytes at offsets 0-3.
  const ascii = asciiBytes(48);
  for (let begin = 0; begin < 4; begin++)
    for (let count = 0; count <= 40; count++) {
      const text = latin1Text(ascii, begin, begin + count);
      if (text.length !== count) return 1;
      for (let i = 0; i < count; i++)
        if (text.charCodeAt(i) !== asciiUnit(begin + i)) return 2;
      if (text !== asciiText(48, -1, 0).slice(begin, begin + count)) return 3;
    }
  if (latin1Text(ascii, 48, 48) !== "" || latin1Text(ascii, 0, 0) !== "") return 4;
  // 5-7: Latin-1 bytes become one-byte units equal to their literals.
  const latin = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x80, 0xff, 0x00]);
  const cafe = latin1Text(latin, 0, 4);
  if (cafe !== "caf\\u00e9" || cafe.charCodeAt(3) !== 0xe9) return 5;
  const high = latin1Text(latin, 4, 7);
  if (high !== "\\u0080\\u00ff\\u0000" || high === "\\u0080\\u0100\\u0000") return 6;
  if (cafe + String.fromCharCode(0x100) !== "caf\\u00e9\\u0100") return 7;

  // 8-11: asciiEndOfBytes finds the first byte at 0x80 or more, from any
  // begin and up to any limit.
  for (let count = 0; count <= 40; count++)
    for (let at = -1; at < count; at++) {
      const bytes = asciiBytes(count);
      if (at >= 0) bytes[at] = at % 2 === 0 ? 0x80 : 0xff;
      for (let begin = 0; begin <= 3 && begin <= count; begin++) {
        const expected = at >= begin ? at : count;
        if (asciiEndOfBytes(bytes, begin, count) !== expected) return 8;
        if (at > begin && asciiEndOfBytes(bytes, begin, at) !== at) return 9;
      }
    }
  if (asciiEndOfBytes(new Uint8Array(0), 0, 0) !== 0) return 10;
  if (asciiEndOfBytes(new Uint8Array([0x7f, 0x80]), 0, 2) !== 1) return 11;

  // 12-15: asciiEndOfText in one-byte strings (0x80, 0xFF) and two-byte
  // strings (0x100, 0x2603, a lone surrogate).
  const specials = [0x80, 0xff, 0x100, 0x2603, 0xd800];
  for (let s = 0; s < specials.length; s++) {
    const special = specials[s] ?? 0;
    for (let count = 1; count <= 40; count++)
      for (let at = -1; at < count; at++) {
        const text = asciiText(count, at, special);
        for (let begin = 0; begin <= 3 && begin <= count; begin++) {
          const expected = at >= begin ? at : count;
          if (asciiEndOfText(text, begin, count) !== expected) return 12;
          if (at > begin && asciiEndOfText(text, begin, at) !== at) return 13;
        }
      }
  }
  // A two-byte string whose only non-ASCII unit is outside the range.
  const tail = asciiText(20, 19, 0x100);
  if (asciiEndOfText(tail, 2, 19) !== 19 || asciiEndOfText(tail, 0, 20) !== 19)
    return 14;
  if (asciiEndOfText("", 0, 0) !== 0 || asciiEndOfText("\\u007f\\u0080", 0, 2) !== 1)
    return 15;

  // 16-21: copyLatin1 copies one-byte and narrowable two-byte units at an
  // offset, leaving the rest of the destination alone.
  for (let s = 0; s < 2; s++)
    for (let count = 0; count <= 40; count++)
      for (let begin = 0; begin <= 2; begin++) {
        // s = 1: a two-byte string (unit 0x100 at its end, outside the
        // copied range) whose copied units include Latin-1 0xE9.
        const text =
          s === 0
            ? asciiText(count + 3, begin + (count >> 1), 0xe9)
            : asciiText(count + 3, begin + (count >> 1), 0xe9) +
              String.fromCharCode(0x100);
        const bytes = new Uint8Array(count + 8).fill(0xcc);
        if (copyLatin1(text, begin, begin + count, bytes, 3) !== count) return 16;
        for (let i = 0; i < bytes.length; i++) {
          const want =
            i < 3 || i >= 3 + count ? 0xcc : text.charCodeAt(begin + i - 3);
          if (bytes[i] !== want) return 17;
        }
      }
  // A unit above 0xFF anywhere in the range gives -1 and writes nothing
  // outside the range.
  for (let count = 1; count <= 40; count++)
    for (let at = 0; at < count; at++) {
      const text = asciiText(count, at, at % 2 === 0 ? 0x100 : 0xffff);
      const bytes = new Uint8Array(count + 4).fill(0xcc);
      if (copyLatin1(text, 0, count, bytes, 2) !== -1) return 18;
      if (bytes[0] !== 0xcc || bytes[1] !== 0xcc) return 19;
      if (bytes[count + 2] !== 0xcc || bytes[count + 3] !== 0xcc) return 20;
    }
  if (copyLatin1("abc", 1, 1, new Uint8Array(0), 0) !== 0) return 21;

  // 22-27: the UTF-8 codec around ASCII runs of 0-40 units.
  const others = ["\\u00e9", "\\u2603", "\\ud83d\\ude00", "\\ud800", "\\udc00"];
  for (let o = 0; o < others.length; o++) {
    const other = others[o] ?? "";
    for (let run = 0; run <= 40; run++) {
      const prefix = asciiText(run, -1, 0),
        suffix = asciiText(run + 3, -1, 0);
      const text = prefix + other + suffix + other;
      if (!matchesReference(text)) return 22;
      const wellFormed = o < 3;
      if (wellFormed && decode(encodeUTF8(text)) !== text) return 23;
    }
  }
  const longAscii = asciiText(1000, -1, 0);
  if (!matchesReference(longAscii) || decode(encodeUTF8(longAscii)) !== longAscii)
    return 24;
  const latinRun = asciiText(100, 50, 0xe9);
  if (!matchesReference(latinRun) || decode(encodeUTF8(latinRun)) !== latinRun)
    return 25;
  // Decoding replaces invalid bytes inside and between ASCII runs.
  const broken = asciiBytes(40);
  broken[17] = 0xff;
  broken[30] = 0xc3;
  const repaired = decode(broken);
  if (repaired !== asciiText(40, 17, 0xfffd).slice(0, 30) + "\\ufffd" + asciiText(40, -1, 0).slice(31))
    return 26;
  if (decode(new Uint8Array(0)) !== "" || decode(asciiBytes(1)) !== " ") return 27;

  // 28-30: encodeUTF8Into stops inside an ASCII run at the capacity and
  // never splits a scalar.
  const mixed = asciiText(20, -1, 0) + "\\u2603" + asciiText(20, -1, 0);
  for (let capacity = 0; capacity <= 46; capacity++) {
    const into = new Uint8Array(capacity).fill(0xcc);
    const result = encodeUTF8Into(mixed, into);
    const read = capacity <= 20 ? capacity : capacity < 23 ? 20 : capacity - 2;
    const written = capacity <= 20 ? capacity : capacity < 23 ? 20 : capacity;
    if (result.read !== Math.min(read, 41) || result.written !== Math.min(written, 43))
      return 28;
    const whole = encodeUTF8(mixed);
    for (let i = 0; i < result.written; i++) if (into[i] !== whole[i]) return 29;
    for (let i = result.written; i < capacity; i++) if (into[i] !== 0xcc) return 30;
  }
  // 31-32: streamed ASCII stays exact across chunk boundaries and keeps a
  // later BOM-looking sequence as text.
  const decoder = createUTF8Decoder(false, false);
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  let streamed = "";
  for (let part = 0; part < 4; part++)
    streamed += decodeUTF8(decoder, asciiBytes(10 + part), true) ?? "";
  streamed += decodeUTF8(decoder, bom, false) ?? "";
  const expected =
    asciiText(10, -1, 0) + asciiText(11, -1, 0) + asciiText(12, -1, 0) +
    asciiText(13, -1, 0) + "\\ufeff";
  if (streamed !== expected) return 31;
  if (!sameBytes(encodeUTF8(expected), new Uint8Array(referenceUTF8(expected))))
    return 32;

  // 33-36: ASCII case mapping over 0-40 units (across the vector width and
  // its overlapping tail): ASCII, with Latin-1 0xE9, and two-byte text.
  for (let s = 0; s < 3; s++)
    for (let count = 0; count <= 40; count++) {
      const text = asciiText(count, s === 0 ? -1 : count >> 1, s === 1 ? 0xe9 : 0x101);
      const upper = asciiUppercase(text),
        lower = asciiLowercase(text);
      if (upper.length !== count || lower.length !== count) return 33;
      for (let i = 0; i < count; i++) {
        const unit = text.charCodeAt(i);
        if (upper.charCodeAt(i) !== (unit >= 97 && unit <= 122 ? unit - 32 : unit))
          return 34;
        if (lower.charCodeAt(i) !== (unit >= 65 && unit <= 90 ? unit + 32 : unit))
          return 35;
      }
    }
  // Results keep the canonical kind, so they equal their literals.
  if (asciiUppercase("abc\\u00e9z") !== "ABC\\u00e9Z" || asciiLowercase("X\\u0101Y") !== "x\\u0101y")
    return 36;
  return 42;
}
`;
