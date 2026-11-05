import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { createPreparedBindingIndex } from "../src/runtime/bindings.ts";

test("prepared binding lookup matches identity scans without rescanning graphs", () => {
  const text = Array.from(
    { length: 80 },
    (_, i) => `function f${i}(a:number,b:string):number{return a+b.length;}`,
  ).join("");
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const result = checkClosureModule(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  const checked = result.value;
  let reads = 0;
  const bindings = new Proxy(checked.bindings.bindings, {
    get(array, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(array, key, receiver);
    },
  });
  const index = createPreparedBindingIndex({
    ...checked,
    bindings: { ...checked.bindings, bindings },
  });
  for (const fn of checked.bindings.functions) {
    const body = checked.bodies.get(fn.id)!;
    assert.equal(index.functionId(`f${fn.id}`), fn.id);
    for (let i = 0; i < body.parameters.length; i++) {
      const binding = checked.bindings.bindings.find(
        (b) => b.node === body.parameters[i],
      );
      assert.ok(binding);
      assert.equal(
        index.parameterType(fn.id, i),
        checked.bindingTypes[binding.id],
      );
    }
  }
  assert.equal(index.functionId("missing"), undefined);
  assert.equal(index.parameterType(999, 0), undefined);
  assert.equal(index.parameterType(0, 999), undefined);
  assert.ok(reads <= bindings.length * 2, `${reads} reads`);
});
