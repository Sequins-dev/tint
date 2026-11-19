import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createSourceText } from "@tint/source/text";
import { scan } from "@tint/typescript/syntax";
export function source(text: string) {
  const bytes = new TextEncoder().encode(text),
    r = createSourceText(bytes, bytes.length);
  assert.equal(r.ok, true);
  return r.value;
}
test("tokens match TypeScript spans and string/number values for supported forms", () => {
  const text =
    '\ufeff// head\r\nexport function f(x: number): number { /*\n*/ return x >= 0x2a ? 1_000.5e-2 : .5; }\nimport {x} from "./a\\u002ets";';
  const r = scan(source(text));
  assert.equal(r.ok, true);
  const oracle = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    text,
  );
  for (const token of r.value) {
    let kind = oracle.scan();
    if (kind === ts.SyntaxKind.GreaterThanToken)
      kind = oracle.reScanGreaterToken();
    assert.equal(token.start, oracle.getTokenPos());
    assert.equal(token.end, oracle.getTextPos());
    if (token.kind === "string")
      assert.equal(token.value, oracle.getTokenValue());
    if (token.kind === "number")
      assert.equal(
        Number(token.value.split("_").join("")),
        Number(oracle.getTokenValue()),
      );
    if (token.kind === "eof") assert.equal(kind, ts.SyntaxKind.EndOfFileToken);
  }
  assert.equal(
    r.value.find((t) => t.value === "return")?.lineBreakBefore,
    true,
  );
});
test("strings decode standard escapes and line continuation without evaluating code", () => {
  const text = '"a\\n\\x41\\u0042\\u{1f642}\\\r\nz"';
  const r = scan(source(text));
  assert.equal(r.ok, true);
  assert.equal(r.value[0]?.value, "a\nAB🙂z");
});
test("quoted tokens preserve long raw runs and cook escapes and template line endings", () => {
  const raw = "β🙂a".repeat(32768);
  const text = '"' + raw + "\\n\\\r\n" + raw + '"';
  const quoted = scan(source(text));
  assert.ok(quoted.ok);
  assert.equal(quoted.value[0]?.value, raw + "\n" + raw);
  assert.equal(quoted.value[0]?.end, text.length);

  const template = scan(source("`" + raw + "\r\n\$x${1}\\u0041`"));
  assert.ok(template.ok);
  assert.equal(template.value[0]?.value, raw + "\n$x");
  assert.equal(template.value[0]?.kind, "template-head");
  assert.equal(template.value[2]?.value, "A");
  assert.equal(template.value[2]?.kind, "template-tail");
});
test("malformed and unsupported lexical forms fail without partial token output", () => {
  for (const text of [
    "/*",
    '"x',
    '"x\n"',
    '"\\xG0"',
    '"\\u{110000}"',
    "1__2",
    "0_1",
    "0x",
    "1e+",
    "0b2",
    "123abc",
    "42.0n",
  ]) {
    const r = scan(source(text));
    assert.equal(r.ok, false, text);
    assert.equal("value" in r, false);
  }
  assert.equal(scan(source("a b"), 1).ok, false);
  assert.equal(scan(source(""), NaN).ok, false);
});
test("Unicode whitespace after numbers and decimal conditional arms match TypeScript", () => {
  const r = scan(
    source("1\u00a0+ 2\u2028; a?.3:0; x &&= y; x ||= y; x ??= y;"),
  );
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.value.map((t) => t.value),
    [
      "1",
      "+",
      "2",
      ";",
      "a",
      "?",
      ".3",
      ":",
      "0",
      ";",
      "x",
      "&&=",
      "y",
      ";",
      "x",
      "||=",
      "y",
      ";",
      "x",
      "??=",
      "y",
      ";",
      "",
    ],
  );
});

test("invalid lexical syntax has no unsupported-feature classification", () => {
  const text = '"unterminated';
  const invalid = scan(source(text));
  assert.ok(!invalid.ok);
  assert.equal(invalid.error.feature, undefined);
  assert.equal(invalid.error.start, 0);
  assert.equal(invalid.error.end, text.length);
});

test("ASCII Unicode escapes decode identifier names without becoming keyword tokens", () => {
  for (const [text, value] of [
    ["\\u0061bc", "abc"],
    ["a\\u{62}c", "abc"],
    ["\\u0024x", "$x"],
    ["a\\u0030", "a0"],
    ["\\u0069f", "if"],
  ]) {
    const r = scan(source(text!));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.value[0]?.kind, "identifier");
    assert.equal(r.value[0]?.value, value);
    assert.equal(r.value[0]?.escaped, true);
  }
  for (const text of [
    "\\u0030abc",
    "x\\u0020",
    "\\x61",
    "\\u{}",
    "\\u{110000}",
    "\\u00GG",
  ])
    assert.equal(scan(source(text)).ok, false, text);
});

test("Unicode identifier names decode code points without normalization", () => {
  for (const [text, value] of [
    ["café", "café"],
    ["π", "π"],
    ["变量", "变量"],
    ["𐐀x", "𐐀x"],
    ["a\u0301", "a\u0301"],
    ["a\u200cb\u200d", "a\u200cb\u200d"],
    ["\\u03c0", "π"],
    ["a\\u0301", "a\u0301"],
    ["\\u{10400}x", "𐐀x"],
  ]) {
    const result = scan(source(text!));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value[0]?.value, value);
    assert.equal(result.value[0]?.end, text!.length);
  }
  for (const text of [
    "\u0301a",
    "\u200ca",
    "😀",
    "\\u{1f600}",
    "\\uD801\\uDC00",
    "a\\u{20}",
  ]) {
    const result = scan(source(text));
    assert.ok(!result.ok, text);
    assert.equal(result.error.code, "LEXICAL_ERROR", text);
  }
});

test("private identifiers retain identity spelling, Unicode escapes and source spans", () => {
  const text = "#x #\\u0078 #π #𐐀 #constructor #default";
  const result = scan(source(text));
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.value.slice(0, -1).map((token) => [token.kind, token.value]),
    [
      ["private-identifier", "#x"],
      ["private-identifier", "#x"],
      ["private-identifier", "#π"],
      ["private-identifier", "#𐐀"],
      ["private-identifier", "#constructor"],
      ["private-identifier", "#default"],
    ],
  );
  assert.equal(result.value[1]?.escaped, true);
  assert.equal(
    text.slice(result.value[1]!.start, result.value[1]!.end),
    "#\\u0078",
  );
  for (const invalid of ["#", "# x", "#1", "#\\u0030", "#\\n", "#😀"]) {
    const scanned = scan(source(invalid));
    assert.equal(scanned.ok, false, invalid);
    if (!scanned.ok) assert.equal(scanned.error.code, "LEXICAL_ERROR", invalid);
  }
});
