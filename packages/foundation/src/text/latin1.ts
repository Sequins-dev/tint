// Latin-1 and ASCII bulk text operations (docs/design-one-byte-strings.md).
// Native builds bind each function to the IR instruction its comment names,
// replacing the portable body: one allocation and copy, or a scan a word at
// a time. So this module stays a state-free declared runtime, and each
// function keeps its exact signature and result. Callers pass integer
// indices in range; anything else is an invariant failure (a thrown string
// here, a trap in native code).

function checkRange(begin: number, limit: number, length: number): void {
  if (
    begin >>> 0 !== begin ||
    limit >>> 0 !== limit ||
    begin > limit ||
    limit > length
  )
    throw "LATIN1_RANGE_INVARIANT";
}

/** The string whose code units are bytes [begin, limit), one each
 * (`string-from-latin1`). */
export function latin1Text(
  bytes: Uint8Array,
  begin: number,
  limit: number,
): string {
  checkRange(begin, limit, bytes.length);
  let text = "",
    index = begin;
  for (; index + 4 <= limit; index += 4)
    text += String.fromCharCode(
      bytes[index] ?? 0,
      bytes[index + 1] ?? 0,
      bytes[index + 2] ?? 0,
      bytes[index + 3] ?? 0,
    );
  for (; index < limit; index++) text += String.fromCharCode(bytes[index] ?? 0);
  return text;
}

/** Copies code units [begin, limit) of `text` into `bytes` from `offset`,
 * one byte each: limit - begin when every unit is at most 0xFF, else -1,
 * with the bytes then partly written (`string-copy-latin1`). */
export function copyLatin1(
  text: string,
  begin: number,
  limit: number,
  bytes: Uint8Array,
  offset: number,
): number {
  checkRange(begin, limit, text.length);
  if (offset >>> 0 !== offset || limit - begin > bytes.length - offset)
    throw "LATIN1_RANGE_INVARIANT";
  for (let index = begin; index < limit; index++) {
    const unit = text.charCodeAt(index);
    if (unit > 0xff) return -1;
    bytes[offset + index - begin] = unit;
  }
  return limit - begin;
}

/** The first index in [begin, limit) whose code unit is 0x80 or more, else
 * limit (`string-ascii-prefix`). */
export function asciiEndOfText(
  text: string,
  begin: number,
  limit: number,
): number {
  checkRange(begin, limit, text.length);
  let index = begin;
  while (index < limit && text.charCodeAt(index) < 0x80) index++;
  return index;
}

/** The first index in [begin, limit) whose byte is 0x80 or more, else
 * limit (`bytes-ascii-prefix`). */
export function asciiEndOfBytes(
  bytes: Uint8Array,
  begin: number,
  limit: number,
): number {
  checkRange(begin, limit, bytes.length);
  let index = begin;
  while (index < limit && (bytes[index] ?? 0) < 0x80) index++;
  return index;
}

/** `text` with each unit in [first, first + 26) moved 32 toward the other
 * case and every other unit unchanged. */
function asciiCase(text: string, first: number, delta: number): string {
  const parts: string[] = [];
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    parts.push(
      String.fromCharCode(
        unit >= first && unit < first + 26 ? unit + delta : unit,
      ),
    );
  }
  return parts.join("");
}
/** `text` with each ASCII lower-case letter in upper case, every other unit
 * unchanged (`string-ascii-case`). */
export function asciiUppercase(text: string): string {
  return asciiCase(text, 97, -32);
}
/** `text` with each ASCII upper-case letter in lower case, every other unit
 * unchanged (`string-ascii-case`). */
export function asciiLowercase(text: string): string {
  return asciiCase(text, 65, 32);
}
