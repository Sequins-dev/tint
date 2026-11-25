import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJSONText, type JSONNode } from "../src/text/json-syntax.ts";
function materialize(node: JSONNode): unknown {
  switch (node.kind) {
    case "null":
      return null;
    case "boolean":
      return node.value;
    case "number":
      return Number(node.text);
    case "string":
      return node.value;
    case "array":
      return node.elements.map(materialize);
    case "object":
      return Object.fromEntries(
        node.entries.map((entry) => [entry.key, materialize(entry.value)]),
      );
  }
}
test("strict JSON syntax retains values, duplicate entries and exact source spans", () => {
  for (const source of [
    "null",
    " true ",
    "false",
    "-0",
    "1.25e+12",
    "1e999",
    String.raw`"a\n\uD800😀"`,
    '[1, null, {"x":true}]',
    '{"__proto__":1,"__proto__":2,"a":1,"a":2}',
    '"\u2028\u2029"',
  ]) {
    const parsed = parseJSONText(source);
    assert.ok(parsed.node, source);
    assert.deepEqual(materialize(parsed.node), JSON.parse(source));
    assert.equal(
      source.slice(parsed.node.start, parsed.node.end),
      source.trim(),
    );
  }
  const parsed = parseJSONText(' {"a": 1.00e2, "a": "x"} ');
  assert.equal(parsed.node?.kind, "object");
  if (parsed.node?.kind === "object") {
    assert.equal(parsed.node.entries.length, 2);
    assert.equal(parsed.node.entries[0]?.value.kind, "number");
    assert.equal(parsed.node.entries[0]?.value.start, 7);
    assert.equal(parsed.node.entries[0]?.value.end, 13);
  }
});
test("JSON rejects JavaScript extensions and malformed tokens without accepting prefixes", () => {
  for (const source of [
    "",
    " ",
    "undefined",
    "NaN",
    "Infinity",
    "+1",
    "01",
    "-01",
    ".1",
    "1.",
    "1e",
    "1e+",
    "0x10",
    "1_0",
    "1n",
    "true false",
    "[1,]",
    "[,1]",
    '{"a":1,}',
    "{a:1}",
    "'x'",
    '"a\nb"',
    String.raw`"\x41"`,
    String.raw`"\v"`,
    String.raw`"\u0X00"`,
    String.raw`"\u{41}"`,
    '"',
    "/*x*/1",
    "\ufeff1",
    "\u00a01",
    "[",
    "{",
    '{"a"}',
    '{"a":}',
    "[1 2]",
  ]) {
    assert.throws(() => JSON.parse(source), SyntaxError, source);
    assert.equal(parseJSONText(source).node, undefined, source);
  }
});

test("bounded grammar mutations agree with the reference parser", () => {
  const alphabet = '{}[]:,"\\-+e.0129tfrunalse \t\n';
  let seed = 2026;
  for (let sample = 0; sample < 5000; sample++) {
    let source = "";
    for (let i = 0; i < sample % 13; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      source += alphabet.charAt(seed % alphabet.length);
    }
    let expected: unknown,
      accepted = true;
    try {
      expected = JSON.parse(source);
    } catch {
      accepted = false;
    }
    const parsed = parseJSONText(source);
    assert.equal(parsed.node !== undefined, accepted, JSON.stringify(source));
    if (parsed.node !== undefined)
      assert.deepEqual(materialize(parsed.node), expected);
  }
});
test("strings, punctuation and literals parse like JSON.parse wherever escapes fall", () => {
  const valid = [
    '"plain"',
    '""',
    '"a\\"b"',
    '"\\n tail"',
    '"head \\u00e9"',
    '"head \\uD83D\\uDE00 tail"',
    '{"key": [true, false, null, -0.5e+3, 12E-2, 0]}',
    '[ "x" , "y\\\\" ,{"z":"\\t"} ]',
    "null",
    " true ",
    "false",
  ];
  for (const text of valid) {
    const result = parseJSONText(text);
    assert.ok(result.node !== undefined, text);
    assert.deepEqual(materialize(result.node), JSON.parse(text), text);
  }
  for (const text of [
    '"unterminated',
    '"tab\there"',
    '"bad \\x escape"',
    "tru",
    "nul",
    "falsey",
    '{"a" 1}',
    "[1,]",
    "-",
    "1.",
    "1e",
  ])
    assert.equal(parseJSONText(text).node, undefined, text);
});
