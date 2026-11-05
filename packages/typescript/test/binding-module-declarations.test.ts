import assert from "node:assert/strict";
import test from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import * as binding from "../src/binding/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
test("module declarations collect nested vars and hoisted functions while skipping import/export entries", () => {
  assert.equal(typeof binding.collectModuleDeclarations, "function");
  const result = binding.collectModuleDeclarations(
    parse(
      'import x from "x"; export var a; {var b;} for(var c=0;c<1;c++) {var d;} function f(){} export function g(){} export {a};',
    ),
  );
  assert.deepEqual(result.variables, ["a", "b", "c", "d"]);
  assert.deepEqual(
    result.functions.map((fn) => fn.name),
    ["f", "g"],
  );
  assert.deepEqual(result.lexical, []);
  assert.equal(result.defaultFunction, undefined);
});
test("default function declarations preserve named and anonymous async/generator identities", () => {
  for (const [source, name, async, generator] of [
    ["export default function f(){}", "f", false, false],
    ["export default function(){}", "*default*", false, false],
    ["export default function*(){}", "*default*", false, true],
    ["export default async function(){}", "*default*", true, false],
    ["export default async function*(){}", "*default*", true, true],
  ] as const) {
    const result = binding.collectModuleDeclarations(parse(source));
    assert.equal(result.defaultFunction?.name, name);
    assert.equal(result.defaultFunction?.value.async === true, async);
    assert.equal(result.defaultFunction?.value.generator === true, generator);
    assert.deepEqual(result.variables, []);
    assert.deepEqual(result.lexical, []);
    assert.deepEqual(result.functions, []);
  }
});
test("default classes and expressions remain in the lexical TDZ until evaluation", () => {
  for (const [source, name] of [
    ["export default class C{}", "C"],
    ["export default class {}", "*default*"],
    ["export default 42", "*default*"],
    ["export default (function(){})", "*default*"],
  ] as const) {
    const result = binding.collectModuleDeclarations(parse(source));
    assert.deepEqual(
      result.lexical.map(({ name, constant }) => ({ name, constant })),
      [{ name, constant: false }],
    );
    assert.equal(result.defaultFunction, undefined);
  }
  const result = binding.collectModuleDeclarations(
    parse(
      "export let l; export const c=1; export class C{}; using r = resource;",
    ),
  );
  assert.deepEqual(
    result.lexical.map(({ name, constant }) => ({ name, constant })),
    [
      { name: "l", constant: false },
      { name: "c", constant: true },
      { name: "C", constant: false },
      { name: "r", constant: true },
    ],
  );
});
test("the module collector does not enter nested functions and the Script collector retains its input invariant", () => {
  const module = parse(
    'import "x"; export let a; function f(){var hidden;let alsoHidden;} {function block(){}}',
  );
  assert.deepEqual(binding.collectModuleDeclarations(module).variables, []);
  assert.deepEqual(
    binding.collectModuleDeclarations(module).functions.map((fn) => fn.name),
    ["f"],
  );
  assert.throws(
    () => binding.collectScriptDeclarations(module),
    (error) => error === "STRICT_SCRIPT_INPUT_INVARIANT",
  );
});
