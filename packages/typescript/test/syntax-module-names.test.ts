import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createSourceText } from "@tint/source/text";
import { parseModule, rewriteModule } from "../src/syntax/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseModule(source.value, "javascript");
}
for (const source of [
  'export * as ns from "other";',
  'export * as default from "other";',
  'export * as "x-y" from "other";',
  'import {"x-y" as x} from "other";',
  'import {"*" as x} from "other";',
  'const x=1;export {x as "x-y"};',
  'export {"x-y" as "other-name"} from "other";',
  'export {"*" as star} from "other";',
  'export * as "\\uD83D\\uDE00" from "other";',
])
  test(`module export names accept ${source}`, () => {
    const reference = spawnSync(
      process.execPath,
      ["--input-type=module", "--check"],
      { input: source, encoding: "utf8" },
    );
    assert.equal(reference.status, 0, reference.stderr);
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
  });
for (const source of [
  'const x=1;export {"x"};',
  'const x=1;export {"x" as y};',
  'import {"x"} from "other";',
  'import {"x" as "y"} from "other";',
  "export * as ns;",
  'export * as "\\uD800" from "other";',
  'export {x as "\\uDC00"} from "other";',
  'import {"\\uD800x" as x} from "other";',
])
  test(`module export names reject ${source}`, () => {
    const reference = spawnSync(
      process.execPath,
      ["--input-type=module", "--check"],
      { input: source, encoding: "utf8" },
    );
    assert.notEqual(reference.status, 0);
    const result = parse(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR");
  });
test("namespace bindings are distinct from a named star export", () => {
  const result = parse(
    'import * as ns from "a";import {"*" as star} from "a";export * as all from "a";export {"*" as one} from "a";',
  );
  assert.ok(result.ok, JSON.stringify(result));
  const flags = result.value.statements.map((s) =>
    s.kind === "import"
      ? s.declaration.bindings[0]?.namespace
      : s.kind === "export"
        ? s.declaration.bindings?.[0]?.namespace
        : undefined,
  );
  assert.deepEqual(flags, [true, false, true, false]);
});

test("import attributes retain ordered string values on imports and re-exports", () => {
  for (const text of [
    'import "x" with {type:"json", "custom":"value",};',
    'import x from "x"\nwith {type:"json", "custom":"value"};',
    'export * from "x" with {type:"json", "custom":"value"};',
    'export {x} from "x" with {type:"json", "custom":"value"};',
  ]) {
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(result.value.imports[0]?.attributes, [
      { key: "type", value: "json" },
      { key: "custom", value: "value" },
    ]);
  }
  for (const text of [
    'import "x" with {type:42};',
    'import "x" with {type:"json", "type":"json"};',
    'import "x" with {[type]:"json"};',
    'import "x" with {type};',
    'export {x} with {type:"json"};',
  ])
    assert.equal(parse(text).ok, false, text);
});

test("default exports distinguish declarations from evaluated expressions", () => {
  for (const [text, declaration] of [
    ["export default 42;", false],
    ["export default (function named(){});", false],
    ["export default function named(){}", true],
    ["export default function*(){}", true],
    ["export default async function(){}", true],
    ["export default async function* named(){}", true],
    ["export default class {}", true],
    ["export default class Named extends Base {}", true],
    ["export default await task;", false],
  ] as const) {
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
    const node = result.value.statements[0];
    assert.equal(node?.kind, "export-default");
    if (node?.kind === "export-default")
      assert.equal(node.declaration, declaration);
  }
  for (const text of [
    "export default;",
    "export default const x = 1;",
    "export default 1,2;",
  ])
    assert.equal(parse(text).ok, false, text);
});

test("default export rewriting visits its expression", () => {
  const result = parse("export default value;");
  assert.ok(result.ok);
  const names: string[] = [];
  const rewritten = rewriteModule(result.value, {
    expression(node) {
      if (node.kind === "identifier") names.push(node.name);
      return node;
    },
  });
  assert.deepEqual(names, ["value"]);
  assert.deepEqual(rewritten.statements, result.value.statements);
});
