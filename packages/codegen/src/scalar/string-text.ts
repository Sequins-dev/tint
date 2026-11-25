/** Canonical string kinds of compile-time text (docs/design-one-byte-strings.md):
 * a string is one-byte exactly when every code unit is at most 0xFF. */
export function isOneByteText(text: string): boolean {
  for (let unit = 0; unit < text.length; unit++)
    if (text.charCodeAt(unit) > 0xff) return false;
  return true;
}
/** Data bytes of a string with this text in its canonical kind. */
export function stringTextBytes(text: string): number {
  return isOneByteText(text) ? text.length : text.length * 2;
}
