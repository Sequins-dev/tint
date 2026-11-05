/** Annex B escape operates on UTF16 code units, not UTF8 bytes. */
export function escapeUTF16(value: string): string {
  const hex = "0123456789ABCDEF",
    pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (
      (unit >= 48 && unit <= 57) ||
      (unit >= 65 && unit <= 90) ||
      (unit >= 97 && unit <= 122) ||
      "@*_+-./".includes(value.charAt(i))
    )
      continue;
    pieces.push(value.slice(start, i));
    const low = hex.charAt((unit >>> 4) & 15) + hex.charAt(unit & 15);
    pieces.push(
      unit < 256
        ? "%" + low
        : "%u" + hex.charAt(unit >>> 12) + hex.charAt((unit >>> 8) & 15) + low,
    );
    start = i + 1;
  }
  pieces.push(value.slice(start));
  return pieces.join("");
}
function hexValue(text: string, start: number, length: number): number {
  let result = 0;
  for (let i = 0; i < length; i++) {
    const unit = text.charCodeAt(start + i);
    const digit =
      unit >= 48 && unit <= 57
        ? unit - 48
        : unit >= 65 && unit <= 70
          ? unit - 55
          : unit >= 97 && unit <= 102
            ? unit - 87
            : -1;
    if (digit < 0) return -1;
    result = result * 16 + digit;
  }
  return result;
}
/** Invalid escapes remain literal; %u is case sensitive and decoding never uses UTF8. */
export function unescapeUTF16(value: string): string {
  const pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value.charAt(i) !== "%") continue;
    let count = 0,
      decoded = -1;
    if (value.charAt(i + 1) === "u") {
      decoded = hexValue(value, i + 2, 4);
      count = 6;
    }
    if (decoded < 0) {
      decoded = hexValue(value, i + 1, 2);
      count = 3;
    }
    if (decoded < 0) continue;
    pieces.push(value.slice(start, i), String.fromCharCode(decoded));
    i += count - 1;
    start = i + 1;
  }
  pieces.push(value.slice(start));
  return pieces.join("");
}
