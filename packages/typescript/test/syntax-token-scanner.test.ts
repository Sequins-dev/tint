import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import * as syntax from "../src/syntax/index.ts";
function source(text: string) {
  const bytes = new TextEncoder().encode(text),
    s = createSourceText(bytes, bytes.length);
  assert.ok(s.ok);
  return s.value;
}
test("incremental tokens match eager scanning across templates and trivia", () => {
  const input = source("const x=`a${{b: `c${1}`}.b}d`; /*\n*/ x / 2;");
  const expected = syntax.scan(input);
  assert.ok(expected.ok);
  const scanner = syntax.createTokenScanner(input);
  for (const token of expected.value)
    assert.deepEqual(scanner.next(), { ok: true, value: token });
  assert.deepEqual(scanner.next(), { ok: true, value: expected.value.at(-1) });
});
test("incremental scanner defers later lexical errors and retains terminal failure", () => {
  const scanner = syntax.createTokenScanner(source('value; "unterminated'));
  const first = scanner.next();
  assert.ok(first.ok);
  assert.equal(first.value.value, "value");
  assert.ok(scanner.next().ok);
  const failed = scanner.next();
  assert.equal(failed.ok, false);
  assert.deepEqual(scanner.next(), failed);
});
test("incremental budget counts EOF once and rejects invalid limits", () => {
  const scanner = syntax.createTokenScanner(source("x"), 2);
  assert.ok(scanner.next().ok);
  assert.ok(scanner.next().ok);
  assert.ok(scanner.next().ok);
  const limited = syntax.createTokenScanner(source("x"), 1);
  assert.ok(limited.next().ok);
  assert.equal(limited.next().ok, false);
  for (const budget of [0, -1, 0.5, NaN, Infinity])
    assert.equal(
      syntax.createTokenScanner(source(""), budget).next().ok,
      false,
    );
});
test("parser reports a reached syntax error before an unread lexical error", () => {
  const result = syntax.parseScript(source('const = 1; "\\uZZZZ";'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "SYNTAX_ERROR");
    assert.equal(result.error.start, 6);
  }
});

test("explicit regexp lexical goal preserves body, flags and following division", () => {
  for (const literal of [
    String.raw`/a\/b[\]/]+/giu`,
    "/=/",
    "/[/*)]/",
    "/x/π2",
    "/(/",
    "/x/gg",
  ]) {
    const scanner = syntax.createTokenScanner(source(`${literal} / 2`));
    const result = scanner.next("regexp");
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.kind, "regexp");
    assert.equal(result.value.value, literal);
    assert.equal(result.value.end, literal.length);
    const division = scanner.next();
    assert.ok(division.ok);
    assert.equal(division.value.value, "/");
    assert.equal(division.value.kind, "punctuation");
  }
});
test("regexp lexical goal keeps comments, template state and line boundaries", () => {
  const scanner = syntax.createTokenScanner(
    source("`a${ /* comment */ /[}]/g }b`"),
  );
  const head = scanner.next();
  assert.ok(head.ok);
  assert.equal(head.value.kind, "template-head");
  const regexp = scanner.next("regexp");
  assert.ok(regexp.ok);
  assert.equal(regexp.value.value, "/[}]/g");
  const tail = scanner.next();
  assert.ok(tail.ok);
  assert.equal(tail.value.kind, "template-tail");
  const comment = syntax.createTokenScanner(
    source("// empty regex is a comment\n/x/"),
  );
  const token = comment.next("regexp");
  assert.ok(token.ok);
  assert.equal(token.value.value, "/x/");
  assert.equal(token.value.lineBreakBefore, true);
});
test("regexp scanner rejects unterminated literals, classes and escaped line terminators", () => {
  for (const text of [
    "/",
    "/abc",
    "/[abc/",
    "/abc\\",
    "/x\n/",
    "/[x\r]/",
    "/x\\\n/",
    "/x\u2028/",
    "/x\\\u2029/",
  ]) {
    const scanner = syntax.createTokenScanner(source(text));
    const result = scanner.next("regexp");
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.equal(result.error.code, "LEXICAL_ERROR");
    assert.deepEqual(scanner.next(), result);
  }
});

test("scanner checkpoints restore lookahead, terminal states and template depth", () => {
  const scanner = syntax.createTokenScanner(source("`a${ /\\d[}]/g }z`"));
  assert.ok(scanner.next().ok);
  const slash = scanner.next();
  assert.ok(slash.ok);
  const restore = scanner.checkpoint();
  assert.equal(scanner.next().ok, false);
  restore();
  const regexp = scanner.rescanRegExp(slash.value);
  assert.ok(regexp.ok);
  assert.equal(regexp.value.value, "/\\d[}]/g");
  const tail = scanner.next();
  assert.ok(tail.ok);
  assert.equal(tail.value.kind, "template-tail");
  const eof = scanner.next();
  assert.ok(eof.ok);
  assert.equal(eof.value.kind, "eof");
  restore();
  assert.deepEqual(scanner.rescanRegExp(slash.value), regexp);
});
test("regexp rescan preserves leading trivia and counts one token", () => {
  const scanner = syntax.createTokenScanner(source("/*\n*/ /=x/g"), 2);
  const slash = scanner.next();
  assert.ok(slash.ok);
  assert.equal(slash.value.value, "/=");
  const result = scanner.rescanRegExp(slash.value);
  assert.ok(result.ok);
  assert.equal(result.value.kind, "regexp");
  assert.equal(result.value.value, "/=x/g");
  assert.equal(result.value.lineBreakBefore, true);
  const eof = scanner.next();
  assert.ok(eof.ok);
  assert.equal(eof.value.kind, "eof");
});

test("parameter lookahead does not hide an earlier malformed parameter", () => {
  for (const text of [
    String.raw`function f(=1,a="\uZZZZ") {}`,
    String.raw`function f(=1){"\uZZZZ";}`,
  ]) {
    const result = syntax.parseScript(source(text));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "SYNTAX_ERROR");
      assert.equal(result.error.start, 11);
    }
  }
});

test("failed arrow parameter probes retain syntax-error classification", () => {
  for (const text of [
    "(a=1,a)=>0;",
    "(...a=1)=>0;",
    "(...a,)=>0;",
    "([a],a)=>0;",
    "({a},...a)=>0;",
    "([ ...a,b ])=>0;",
  ]) {
    const result = syntax.parseScript(source(text));
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR", text);
  }
});

test("HTML comments are Script-only trivia and close comments require a line boundary", () => {
  for (const text of [
    "<!-- ignored\n42;",
    "--> ignored\n42;",
    "0; <!-- ignored\n42;",
    "0; /*\n*/ /**/ --> ignored\n42;",
  ]) {
    assert.ok(syntax.parseScript(source(text)).ok, text);
    assert.ok(syntax.parseStrictScript(source(text)).ok, text);
    assert.equal(
      syntax.parseModule(source(text), "javascript").ok,
      false,
      text,
    );
  }
  const scanner = syntax.createTokenScanner(source("a --> b;"), 100, true);
  const tokens: string[] = [];
  for (let i = 0; i < 5; i++) {
    const token = scanner.next();
    assert.ok(token.ok);
    tokens.push(token.value.value);
  }
  assert.deepEqual(tokens, ["a", "--", ">", "b", ";"]);
});
