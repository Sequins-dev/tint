function hex(value: number, width: number): string {
  let result = "";
  for (let digit = 0; digit < width; digit++) {
    result = "0123456789abcdef".charAt(value % 16) + result;
    value = Math.floor(value / 16);
  }
  return result;
}
/** Escape literal text for embedding in a RegExp pattern, preserving code points. */
export function escapeRegExpText(input: string): string {
  let output = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i),
      c = input.charAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        output += c + input.charAt(++i);
        continue;
      }
    }
    if (
      i === 0 &&
      ((code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122))
    )
      output += "\\x" + hex(code, 2);
    else if ("^$\\.*+?()[]{}|/".indexOf(c) >= 0) output += "\\" + c;
    else if (code === 9) output += "\\t";
    else if (code === 10) output += "\\n";
    else if (code === 11) output += "\\v";
    else if (code === 12) output += "\\f";
    else if (code === 13) output += "\\r";
    else if (
      ",-=<>#&!%:;@~'`\"".indexOf(c) >= 0 ||
      code === 32 ||
      code === 0xa0 ||
      code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200a) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0x202f ||
      code === 0x205f ||
      code === 0x3000 ||
      code === 0xfeff ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      output += code <= 255 ? "\\x" + hex(code, 2) : "\\u" + hex(code, 4);
    else output += c;
  }
  return output;
}
