import { test } from "node:test";
import assert from "node:assert/strict";
import { regexpSource } from "../src/objects/regexp-runtime.ts";

/** EscapeRegExpPattern as originally written: one character at a time. */
function reference(source: string): string {
  if (source === "") return "(?:)";
  let result = "",
    inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source.charAt(i);
    if (c === "\\") {
      const next = source.charAt(i + 1);
      if (next === "\n" || next === "\r" || next === " " || next === " ")
        continue;
      result += c;
      if (i + 1 < source.length) {
        result += next;
        i++;
      }
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    if (c === "/" && !inClass) result += "\\/";
    else if (c === "\n") result += "\\n";
    else if (c === "\r") result += "\\r";
    else if (c === " ") result += "\\u2028";
    else if (c === " ") result += "\\u2029";
    else result += c;
  }
  return result;
}

test("RegExp source escaping matches EscapeRegExpPattern across mixes", () => {
  const alphabet = [
    "a",
    "/",
    "\\",
    "[",
    "]",
    "\n",
    "\r",
    " ",
    " ",
    "x",
    "\ud83d",
  ];
  let seed = 99;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let trial = 0; trial < 5000; trial++) {
    let source = "";
    const length = next() % 14;
    for (let k = 0; k < length; k++)
      source += alphabet[next() % alphabet.length];
    assert.equal(
      regexpSource(source),
      reference(source),
      JSON.stringify(source),
    );
  }
});

test("RegExp sources without escapes are returned unchanged", () => {
  const source = "[a-z/]+\\d*(?:x|y)";
  assert.equal(regexpSource(source), source);
  assert.equal(regexpSource(""), "(?:)");
});

test("long RegExp sources escape in linear time", () => {
  const source = "a/b\n".repeat(50000);
  const escaped = regexpSource(source);
  assert.equal(escaped.length, 50000 * 6);
  assert.equal(escaped.slice(0, 6), "a\\/b\\n");
});
