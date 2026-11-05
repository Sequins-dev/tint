import {
  fromNumber,
  formatInteger,
} from "@tint/foundation/numeric/big-integer";

/** Exact power-of-two radix formatting; other bases currently support safe integers.
 * Undefined leaves unsupported shortest non-binary rounding explicit. */
export function numberRadixText(
  value: number,
  radix: number,
): string | undefined {
  if (
    !Number.isFinite(value) ||
    radix < 2 ||
    radix > 36 ||
    Math.floor(radix) !== radix
  )
    return undefined;
  const binaryRadix =
    radix === 2 || radix === 4 || radix === 8 || radix === 16 || radix === 32;
  if (!binaryRadix && Math.abs(value) > 9007199254740991) return undefined;
  if (!binaryRadix) {
    const integer = fromNumber(value);
    return integer === undefined ? undefined : formatInteger(integer, radix);
  }
  const negative = value < 0,
    magnitude = negative ? -value : value;
  const whole = Math.floor(magnitude),
    integer = fromNumber(whole);
  if (integer === undefined) throw "RADIX_INTEGER_INVARIANT";
  const formatted = formatInteger(integer, radix);
  if (formatted === undefined) throw "RADIX_FORMAT_INVARIANT";
  let text = formatted,
    fraction = magnitude - whole;
  if (fraction !== 0) {
    text += ".";
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    // Scaling by an exact power of two consumes at least one binary digit per step.
    while (fraction !== 0) {
      fraction *= radix;
      const digit = Math.floor(fraction);
      text += alphabet.charAt(digit);
      fraction -= digit;
    }
  }
  return (negative ? "-" : "") + text;
}
