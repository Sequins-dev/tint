export function validByteWindow(
  bytes: Uint8Array,
  offset: number,
  length: number,
): boolean {
  return (
    Number.isInteger(offset) &&
    offset >= 0 &&
    Number.isInteger(length) &&
    length >= 0 &&
    offset <= bytes.length &&
    length <= bytes.length - offset
  );
}
