import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import * as binding from "../src/binding/index.ts";
function bind(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value, "javascript");
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(typeof binding.bindJavaScriptModule, "function");
  return binding.bindJavaScriptModule(parsed.value);
}
for (const source of [
  "unknownGlobal();",
  "const x=1;x=2;",
  'import {x} from "other";x=2;',
  "var x;var x;",
])
  test(`JavaScript module binding leaves runtime checks intact: ${source}`, () => {
    const result = bind(source);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.scopes[0]?.kind, "module");
  });
for (const source of [
  "function f(){}function f(){}",
  "var f;function f(){}",
  "let x;var x;",
  'import {x} from "other";const x=1;',
])
  test(`JavaScript module declarations reject collisions: ${source}`, () => {
    const result = bind(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DUPLICATE_NAME");
  });

for (const source of [
  "var x;export {x};export {x};",
  "export var x;export var x;",
  "export function f(){}export {f};",
  "var x,y;export {x as name,y as name};",
  'export {x as name} from "a";export {y as name} from "b";',
])
  test(`JavaScript module export names are unique: ${source}`, () => {
    const result = bind(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DUPLICATE_NAME");
  });
for (const source of ["export {missing};", "{let x;}export {x};"])
  test(`local exports require module bindings: ${source}`, () => {
    const result = bind(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_CONTEXT");
  });
for (const source of [
  "export {x};var x;",
  "var x;export {x as first,x as second};",
  'import {x} from "a";export {x};',
  'export {missing} from "a";',
  'export * from "a";export * from "a";',
  "export {x};if(true){var x;}",
])
  test(`module export checks preserve valid local and indirect names: ${source}`, () => {
    const result = bind(source);
    assert.ok(result.ok, JSON.stringify(result));
  });
for (const source of [
  "export default 1;export default 2;",
  "const x=1;export {x as default};export default 2;",
  "class F{}export default function F(){}",
  "let F;export default async function* F(){}",
  "var C;export default class C{}",
])
  test(`default exports reject declaration and export collisions: ${source}`, () => {
    const result = bind(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DUPLICATE_NAME");
  });
for (const source of [
  "export default function F(){F=1;}export {F};",
  "export default class C{}export {C};",
  "export default function(){}",
  "export default (function F(){});",
  "export default await value;",
])
  test(`default export binding preserves declaration and expression scopes: ${source}`, () => {
    const result = bind(source);
    assert.ok(result.ok, JSON.stringify(result));
  });
test("default expression names do not create module bindings", () => {
  const result = bind("export default (function F(){});export {F};");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "INVALID_CONTEXT");
});
