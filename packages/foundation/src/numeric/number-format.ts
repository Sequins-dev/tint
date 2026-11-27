import {
  numberToString,
  numberToFixed,
  numberToExponential,
  numberToPrecision,
} from "./number-text/index.ts";
import { fromNumber, formatInteger } from "./big-integer.ts";

const radixAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Number.prototype.toFixed(fractionDigits?): ES2024 range check precedes finite check. */
export function formatNumberFixed(
  value: number,
  fractionDigits?: number,
): string {
  const digits =
    fractionDigits === undefined
      ? 0
      : fractionDigits !== fractionDigits
        ? 0
        : Math.trunc(fractionDigits);
  if (digits < 0 || digits > 100)
    throw new RangeError("toFixed() digits argument must be between 0 and 100");
  return numberToFixed(value, digits);
}

/** Number.prototype.toExponential(fractionDigits?): non-finite precedes range check. */
export function formatNumberExponential(
  value: number,
  fractionDigits?: number,
): string {
  if (fractionDigits === undefined)
    return numberToExponential(value, undefined);
  const digits =
    fractionDigits !== fractionDigits ? 0 : Math.trunc(fractionDigits);
  if (!Number.isFinite(value)) return numberToString(value);
  if (digits < 0 || digits > 100)
    throw new RangeError("toExponential() argument must be between 0 and 100");
  return numberToExponential(value, digits);
}

/** Number.prototype.toPrecision(precision?): non-finite precedes range check. */
export function formatNumberPrecision(
  value: number,
  precision?: number,
): string {
  if (precision === undefined) return numberToString(value);
  const digits = precision !== precision ? 0 : Math.trunc(precision);
  if (!Number.isFinite(value)) return numberToString(value);
  if (digits < 1 || digits > 100)
    throw new RangeError("toPrecision() argument must be between 1 and 100");
  return numberToPrecision(value, digits);
}

/** Number.prototype.toString(radix?): ES2024 radix check precedes finite/zero checks. */
export function formatNumberToString(value: number, radix?: number): string {
  if (radix === undefined) return numberToString(value);
  const r = radix !== radix ? 0 : Math.trunc(radix);
  if (r < 2 || r > 36)
    throw new RangeError("toString() radix argument must be between 2 and 36");
  if (r === 10 || !Number.isFinite(value) || value === 0)
    return numberToString(value);
  const negative = value < 0;
  const magnitude = negative ? -value : value;
  const whole = Math.floor(magnitude);
  const wholeInt = fromNumber(whole);
  if (wholeInt === undefined) throw "RADIX_INTEGER_INVARIANT";
  const wholeText = formatInteger(wholeInt, r);
  if (wholeText === undefined) throw "RADIX_FORMAT_INVARIANT";
  let fraction = magnitude - whole;
  if (fraction === 0) return (negative ? "-" : "") + wholeText;
  let digits = "";
  if (r === 2 || r === 4 || r === 8 || r === 16 || r === 32) {
    while (fraction !== 0) {
      fraction *= r;
      const digit = Math.floor(fraction);
      digits += radixAlphabet.charAt(digit);
      fraction -= digit;
    }
    return (negative ? "-" : "") + wholeText + "." + digits;
  }
  let exp = 0;
  let scaled = magnitude;
  while (scaled >= 2) {
    scaled *= 0.5;
    exp++;
  }
  while (scaled < 1) {
    scaled *= 2;
    exp--;
  }
  let ulpExp = exp - 52;
  if (ulpExp < -1074) ulpExp = -1074;
  let delta = 0.5;
  if (ulpExp > 0) {
    for (let i = 0; i < ulpExp; i++) delta *= 2;
  } else {
    for (let i = 0; i < -ulpExp; i++) delta *= 0.5;
  }
  let rem = fraction;
  while (rem > delta && 1 - rem > delta && digits.length < 1100) {
    rem *= r;
    delta *= r;
    const digit = Math.floor(rem);
    rem -= digit;
    if (rem < delta || 1 - rem < delta) {
      const finalDigit = rem >= 0.5 ? digit + 1 : digit;
      if (finalDigit < r) {
        digits += radixAlphabet.charAt(finalDigit);
      } else {
        let carry = 1;
        let carried = "";
        for (let i = digits.length - 1; i >= 0; i--) {
          const idx = radixAlphabet.indexOf(digits.charAt(i)) + carry;
          if (idx >= r) {
            carried = "0" + carried;
            carry = 1;
          } else {
            carried = radixAlphabet.charAt(idx) + carried;
            carry = 0;
          }
        }
        if (carry !== 0) {
          const nextWhole = fromNumber(whole + 1);
          if (nextWhole === undefined) throw "RADIX_INTEGER_INVARIANT";
          const nextText = formatInteger(nextWhole, r);
          if (nextText === undefined) throw "RADIX_FORMAT_INVARIANT";
          return (negative ? "-" : "") + nextText;
        }
        digits = carried;
      }
      break;
    }
    digits += radixAlphabet.charAt(digit);
  }
  return (
    (negative ? "-" : "") + wholeText + (digits.length > 0 ? "." + digits : "")
  );
}
