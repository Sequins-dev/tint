import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "../src/closure/lowering/index.ts";

test("semantically valid callable views require a native representation adapter", () => {
  for (const source of [
    'function run():number{const f=():number=>42;const o:{}=f;return typeof o==="function"?42:1;}',
    'function run():number{const f=():number=>42;const a:{f:()=>number}={f};const b:{readonly f:{}}=a;return typeof b.f==="function"?42:1;}',
    'function run():number{const f=():number=>42;const a:()=>()=>number=()=>f;const b:()=>{}=a;return typeof b()==="function"?42:1;}',
  ]) {
    const bytes = new TextEncoder().encode(source),
      text = createSourceText(bytes, bytes.length);
    assert.ok(text.ok);
    const parsed = parseModule(text.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
    const lowered = lowerModuleEntries(
      checked.value,
      checked.value.bindings.functions.map((f) => f.id),
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
    );
    assert.ok(!lowered.ok, source);
    assert.match(
      lowered.error,
      /callable view requires a representation adapter/,
    );
  }
});

test("callable object contracts cannot use plain native record layouts", () => {
  for (const contract of ["{():number}", "{new():{x:number}}"]) {
    const bytes = new TextEncoder().encode(
      `function run(value:${contract}):string{return typeof value;}`,
    );
    const text = createSourceText(bytes, bytes.length);
    assert.ok(text.ok);
    const parsed = parseModule(text.value);
    assert.ok(parsed.ok);
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
    const lowered = lowerModuleEntries(
      checked.value,
      [0],
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
    );
    assert.ok(!lowered.ok, contract);
  }
});

test("checked constructor calls cannot be emitted as ordinary calls or array allocation", () => {
  const bytes = new TextEncoder().encode(
    "function run(C:new(x:number)=>{value:number}):number{return new C(42).value;}",
  );
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const lowered = lowerModuleEntries(
    checked.value,
    [0],
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(!lowered.ok);
});

test("typed class declarations require class construction lowering", () => {
  const bytes = new TextEncoder().encode(
    "class C{x:number=42;m():number{return this.x;}}function run():number{return 42;}",
  );
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const lowered = lowerModuleEntries(
    checked.value,
    checked.value.bindings.functions.map((fn) => fn.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(!lowered.ok);
  assert.match(lowered.error, /class.*lowering/);
});
