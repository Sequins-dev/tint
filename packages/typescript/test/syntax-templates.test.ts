import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { scan, parseModule } from "@tint/typescript/syntax";
function source(text: string) {
  const bytes = new TextEncoder().encode(text);
  const result = createSourceText(bytes, bytes.length);
  assert.ok(result.ok);
  return result.value;
}
test("no-substitution templates preserve cooked UTF-16 and normalize line endings", () => {
  for (const text of [
    "``",
    "`hello`",
    "`a\r\nb\rc\nd`",
    "`a\u2028b\u2029c`",
    "`\\`\\${literal}\\n\\t\\0\\x41\\u0042\\u{1f600}`",
    "`a\\\r\nb`",
    "`a\\\nb`",
    "`\\q`",
    "`\\uD800`",
  ]) {
    const result = scan(source(text));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value[0]?.kind, "template");
    assert.equal(result.value[0]?.value, Function(`return ${text}`)());
    const parsed = parseModule(source(`const text=${text};`));
    assert.ok(parsed.ok, JSON.stringify(parsed));
  }
});
test("template delimiters remain distinct from quoted grammar tokens", () => {
  for (const text of [
    "import x from `m`;",
    "const o={`x`:1};",
    "interface O {`x`:number}",
  ])
    assert.equal(parseModule(source(text)).ok, false, text);
  assert.ok(parseModule(source("tag`text`;")).ok);
});
test("templates reject invalid escapes", () => {
  for (const text of [
    "`",
    "`\\1`",
    "`\\8`",
    "`\\01`",
    "`\\xG0`",
    "`\\u{110000}`",
    "`\\u{}`",
  ])
    assert.equal(parseModule(source(text)).ok, false, text);
});

test("tagged templates retain raw invalid escapes with undefined cooked segments", () => {
  for (const escape of [
    "\\1",
    "\\8",
    "\\01",
    "\\xG0",
    "\\u{110000}",
    "\\u{}",
    "\\u00",
    "\\x",
  ]) {
    const parsed = parseModule(
      source("tag`" + escape + "${1}valid${2}" + escape + "`;"),
    );
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const statement = parsed.value.statements[0];
    assert.ok(
      statement?.kind === "expression" &&
        statement.expression.kind === "tagged-template",
    );
    assert.deepEqual(statement.expression.template.parts, [
      undefined,
      "valid",
      undefined,
    ]);
    assert.deepEqual(statement.expression.template.raw, [
      escape,
      "valid",
      escape,
    ]);
  }
  for (const text of ["tag`", "tag`\\", "`ok${1}\\x`", "'\\x'"])
    assert.equal(parseModule(source(text)).ok, false, text);
});

test("template scanning separates substitutions while tracking nested lexical braces", () => {
  const result = scan(source("`a${{x:1}.x}b${`c${2}d`}e`"));
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.value
      .filter((t) => t.kind.startsWith("template"))
      .map((t) => [t.kind, t.value]),
    [
      ["template-head", "a"],
      ["template-middle", "b"],
      ["template-head", "c"],
      ["template-tail", "d"],
      ["template-tail", "e"],
    ],
  );
  for (const text of [
    "`a${'}'}b`",
    "`a${/* } */ 1}b`",
    "`a${()=>{return 1;}}b`",
  ]) {
    const result = scan(source(text));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.at(-2)?.kind, "template-tail");
  }
  for (const text of ["`a${1", "`a${{x:1}", "`a${1}b"])
    assert.equal(scan(source(text)).ok, false, text);
});

test("template expressions retain ordered cooked parts and substitution expressions", () => {
  const result = parseModule(source("const text=`a${1}b${`c${2}`}d`;"));
  assert.ok(result.ok, JSON.stringify(result));
  const statement = result.value.statements[0];
  assert.equal(statement?.kind, "variable");
  if (statement?.kind !== "variable") return;
  const template = statement.declarations[0]?.initializer;
  assert.equal(template?.kind, "template-expression");
  if (template?.kind === "template-expression") {
    assert.deepEqual(template.parts, ["a", "b", "d"]);
    assert.equal(template.substitutions.length, 2);
    assert.equal(template.substitutions[1]?.kind, "template-expression");
  }
});

test("tagged templates retain raw strings and the tag reference", () => {
  const result = parseModule(source("object.tag`a\\nb${42}c`;"));
  assert.ok(result.ok, JSON.stringify(result));
  const statement = result.value.statements[0];
  assert.equal(statement?.kind, "expression");
  if (statement?.kind !== "expression") return;
  const tag = statement.expression;
  assert.equal(tag.kind, "tagged-template");
  if (tag.kind !== "tagged-template") return;
  assert.equal(tag.tag.kind, "member");
  assert.deepEqual(tag.template.parts, ["a\nb", "c"]);
  assert.deepEqual(tag.template.raw, ["a\\nb", "c"]);
  assert.equal(tag.template.substitutions.length, 1);
  assert.ok(parseModule(source("tag``;")).ok);
  assert.ok(parseModule(source("(object?.tag)`x`;")).ok);
  assert.equal(parseModule(source("object?.tag`x`;")).ok, false);
});
