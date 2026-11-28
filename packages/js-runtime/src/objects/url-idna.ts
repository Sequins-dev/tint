import {
  canonicalCombiningClass,
  normalizeUnicode,
} from "@tint/foundation/unicode/normalization";
import { hasUnicodeProperty } from "@tint/foundation/unicode/properties";
import {
  contextEnds,
  contextInfo,
  mappingEnds,
  mappingInfo,
  mappingText,
} from "./url-idna-data.ts";

function rangeIndex(ends: string, point: number): number {
  let low = 0,
    high = ends.length >>> 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const offset = mid << 1;
    const end = ends.charCodeAt(offset) | (ends.charCodeAt(offset + 1) << 16);
    if (point <= end) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** Nontransitional UTS #46 mapping followed by canonical composition. */
export function mapURLDomain(input: string): string | undefined {
  let mapped = "";
  for (let i = 0; i < input.length;) {
    const point = input.codePointAt(i) ?? 0;
    const start = i;
    i += point > 65535 ? 2 : 1;
    const row = rangeIndex(mappingEnds, point) << 1;
    const info = mappingInfo.charCodeAt(row);
    const status = info & 3;
    if (status === 0) return undefined;
    if (status === 1) mapped += input.slice(start, i);
    else if (status === 2) {
      const offset = mappingInfo.charCodeAt(row + 1);
      mapped += mappingText.slice(offset, offset + (info >>> 2));
    }
  }
  return normalizeUnicode(mapped, "NFC");
}

function context(point: number): number {
  return contextInfo.charCodeAt(rangeIndex(contextEnds, point));
}

/** Enforce ContextJ and the right-to-left label rules used by Node's URL parser. */
export function validURLLabel(label: string): boolean {
  if (label.length === 0) return true;
  if (
    hasUnicodeProperty(
      "General_Category",
      "Mark",
      label.codePointAt(0) ?? 0,
    ) === true
  )
    return false;
  let rtl = false,
    arabicDigits = false,
    europeanDigits = false;
  let validRTL = true,
    lastBidi = 0,
    firstBidi = -1;
  let previousPoint = -1,
    previousJoining = 0;
  for (let i = 0; i < label.length;) {
    const point = label.codePointAt(i) ?? 0;
    i += point > 65535 ? 2 : 1;
    const info = context(point);
    const bidi = info & 15,
      join = info >>> 4;
    if (firstBidi < 0) firstBidi = bidi;
    if (bidi !== 10) lastBidi = bidi; // NSM inherits the preceding direction.
    if (bidi === 1 || bidi === 2 || bidi === 4) rtl = true;
    if (bidi === 3) europeanDigits = true;
    if (bidi === 4) arabicDigits = true;
    if (bidi === 0 || bidi > 10) validRTL = false;

    if (
      (point === 8204 || point === 8205) &&
      (previousPoint < 0 || canonicalCombiningClass(previousPoint) !== 9)
    ) {
      if (point !== 8204 || (previousJoining !== 1 && previousJoining !== 3))
        return false;
      let nextJoining = 0;
      for (let j = i; j < label.length;) {
        const next = label.codePointAt(j) ?? 0;
        j += next > 65535 ? 2 : 1;
        nextJoining = context(next) >>> 4;
        if (nextJoining !== 4) break;
      }
      if (nextJoining !== 2 && nextJoining !== 3) return false;
    }
    previousPoint = point;
    if (join !== 4) previousJoining = join;
  }
  return (
    !rtl ||
    (validRTL &&
      (firstBidi === 1 || firstBidi === 2) &&
      lastBidi >= 1 &&
      lastBidi <= 4 &&
      !(europeanDigits && arabicDigits))
  );
}
