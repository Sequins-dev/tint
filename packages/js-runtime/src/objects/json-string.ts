import {
  createStringBuilder,
  appendString,
  finishString,
} from "@tint/foundation/text/string-builder";

/** JSON's well-formed string quoting preserves paired UTF16 and escapes lone surrogates. */
export function quoteJSONString(value: string): string {
  // A string with no unit to escape (and no surrogate to check) is quoted
  // whole, in one allocation.
  let first = 0;
  const length = value.length;
  for (; first < length; first++) {
    const unit = value.charCodeAt(first);
    if (
      unit < 32 ||
      unit === 34 ||
      unit === 92 ||
      (unit >= 0xd800 && unit <= 0xdfff)
    )
      break;
  }
  if (first === length) return '"' + value + '"';
  const output = createStringBuilder(),
    hex = "0123456789abcdef";
  appendString(output, '"');
  let start = 0;
  for (let i = first; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    let escape = "";
    if (unit === 34) escape = '\\"';
    else if (unit === 92) escape = "\\\\";
    else if (unit === 8) escape = "\\b";
    else if (unit === 9) escape = "\\t";
    else if (unit === 10) escape = "\\n";
    else if (unit === 12) escape = "\\f";
    else if (unit === 13) escape = "\\r";
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      i++;
      continue;
    } else if (unit < 32 || (unit >= 0xd800 && unit <= 0xdfff))
      escape =
        "\\u" +
        hex.charAt(unit >>> 12) +
        hex.charAt((unit >>> 8) & 15) +
        hex.charAt((unit >>> 4) & 15) +
        hex.charAt(unit & 15);
    if (escape !== "") {
      appendString(output, value.slice(start, i));
      appendString(output, escape);
      start = i + 1;
    }
  }
  appendString(output, value.slice(start));
  appendString(output, '"');
  return finishString(output);
}
