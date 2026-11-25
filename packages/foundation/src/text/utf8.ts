// UTF-8 bulk transcoding (docs/design-one-byte-strings.md). Native builds
// bind each function to the IR instruction its comment names, replacing the
// portable body, as latin1.ts's functions are bound: whole ranges move in
// one leaf loop instead of a call per code unit or byte. Each function
// keeps its exact signature and result. Callers pass integer indices in
// range; anything else is an invariant failure (a thrown string here, a
// trap in native code).
//
// Scalars: a surrogate pair inside the range is one scalar; a lone
// surrogate encodes as U+FFFD (three bytes), as TextEncoder does.

function checkRange(begin: number, limit: number, length: number): void {
  if (
    begin >>> 0 !== begin ||
    limit >>> 0 !== limit ||
    begin > limit ||
    limit > length
  )
    throw "UTF8_RANGE_INVARIANT";
}

/** The scalar starting with unit `unit` at `index` (index < limit): a
 * surrogate pair's code point, U+FFFD for a lone surrogate, else the unit. */
function scalarAt(
  text: string,
  index: number,
  limit: number,
  unit: number,
): number {
  if (unit < 0xd800 || unit > 0xdfff) return unit;
  if (unit <= 0xdbff && index + 1 < limit) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff)
      return 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00);
  }
  return 0xfffd;
}

/** The UTF-8 byte length of code units [begin, limit) of `text`
 * (`string-utf8-length`). */
export function utf8ByteLength(
  text: string,
  begin: number,
  limit: number,
): number {
  checkRange(begin, limit, text.length);
  let bytes = 0;
  for (let index = begin; index < limit; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (scalarAt(text, index, limit, unit) > 0xffff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

/** Encodes code units [begin, limit) of `text` as UTF-8 into `bytes` from
 * `offset`, scalar by scalar while the next one fits, and returns the index
 * after the last unit encoded: limit when everything fit
 * (`string-write-utf8`). */
export function writeUTF8(
  text: string,
  begin: number,
  limit: number,
  bytes: Uint8Array,
  offset: number,
): number {
  checkRange(begin, limit, text.length);
  const capacity = bytes.length;
  if (offset >>> 0 !== offset || offset > capacity)
    throw "UTF8_RANGE_INVARIANT";
  let index = begin,
    at = offset;
  while (index < limit) {
    const point = scalarAt(text, index, limit, text.charCodeAt(index));
    if (point < 0x80) {
      if (at === capacity) break;
      bytes[at] = point;
      at += 1;
    } else if (point < 0x800) {
      if (capacity - at < 2) break;
      bytes[at] = 0xc0 | (point >>> 6);
      bytes[at + 1] = 0x80 | (point & 63);
      at += 2;
    } else if (point < 0x10000) {
      if (capacity - at < 3) break;
      bytes[at] = 0xe0 | (point >>> 12);
      bytes[at + 1] = 0x80 | ((point >>> 6) & 63);
      bytes[at + 2] = 0x80 | (point & 63);
      at += 3;
    } else {
      if (capacity - at < 4) break;
      bytes[at] = 0xf0 | (point >>> 18);
      bytes[at + 1] = 0x80 | ((point >>> 12) & 63);
      bytes[at + 2] = 0x80 | ((point >>> 6) & 63);
      bytes[at + 3] = 0x80 | (point & 63);
      at += 4;
    }
    index += point > 0xffff ? 2 : 1;
  }
  return index;
}

/** The string decoded from the longest prefix of bytes [begin, limit) that
 * is a sequence of complete, valid UTF-8 encodings of scalars: it stops
 * before an invalid or truncated sequence (`string-from-utf8`). Valid
 * UTF-8 is canonical, so the prefix's length is the result's
 * utf8ByteLength. */
export function utf8Text(
  bytes: Uint8Array,
  begin: number,
  limit: number,
): string {
  return decodePrefix(bytes, begin, limit).text;
}

/** utf8Text's string when the whole range is valid UTF-8, otherwise the
 * empty string, which a nonempty valid range never decodes to
 * (`string-from-utf8` with `whole`). */
export function utf8WholeText(
  bytes: Uint8Array,
  begin: number,
  limit: number,
): string {
  const prefix = decodePrefix(bytes, begin, limit);
  return prefix.end === limit ? prefix.text : "";
}

interface DecodedPrefix {
  readonly text: string;
  /** The index after the prefix's last byte. */
  readonly end: number;
}
function decodePrefix(
  bytes: Uint8Array,
  begin: number,
  limit: number,
): DecodedPrefix {
  checkRange(begin, limit, bytes.length);
  const parts: string[] = [];
  let index = begin;
  while (index < limit) {
    const lead = bytes[index] ?? 0;
    if (lead < 0x80) {
      parts.push(String.fromCharCode(lead));
      index++;
      continue;
    }
    // The continuation count, the lead's payload bits and the first
    // continuation's range (narrower after E0, ED, F0 and F4: no overlong
    // forms, surrogates or points above U+10FFFF).
    let needed = 0,
      point = 0,
      lower = 0x80,
      upper = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      point = lead & 31;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      point = lead & 15;
      if (lead === 0xe0) lower = 0xa0;
      if (lead === 0xed) upper = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      point = lead & 7;
      if (lead === 0xf0) lower = 0x90;
      if (lead === 0xf4) upper = 0x8f;
    } else break;
    if (limit - index <= needed) break;
    let valid = true;
    for (let next = 1; next <= needed; next++) {
      const byte = bytes[index + next] ?? 0;
      if (byte < lower || byte > upper) {
        valid = false;
        break;
      }
      lower = 0x80;
      upper = 0xbf;
      point = (point << 6) | (byte & 63);
    }
    if (!valid) break;
    if (point > 0xffff)
      parts.push(
        String.fromCharCode(
          0xd800 + ((point - 0x10000) >> 10),
          0xdc00 + ((point - 0x10000) & 0x3ff),
        ),
      );
    else parts.push(String.fromCharCode(point));
    index += needed + 1;
  }
  return { text: parts.join(""), end: index };
}
