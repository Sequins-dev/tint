import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { primitiveUnionFixture } from "./primitive-union-fixture.ts";
test("mixed primitive unions use inline native storage and narrow before use", () => {
  for (const reverse of [false, true]) {
    const { module } = primitiveUnionFixture(reverse);
    const native = emitModule(module);
    assert.ok(native.ok, JSON.stringify(native));
    assert.ok(module.functions.some((f) => f.slots.includes("general")));
  }
});
test("primitive runtime bindings reject narrower scalar contracts and mismatched box shapes", () => {
  const source = readFileSync(
    "packages/native-runtime/src/values/index.ts",
    "utf8",
  );
  assert.throws(
    () =>
      primitiveUnionFixture(
        false,
        source.replaceAll("fromBoolean", "originalFromBoolean") +
          "export function fromBoolean(value:true):PrimitiveValue{return {tag:2,numeric:0,logical:value,text:undefined};}",
      ),
    /runtime parameter contract mismatch/,
  );
  const start = source.indexOf("export function readNumber(");
  const end = source.indexOf("export function readBoolean(", start);
  assert.ok(start >= 0 && end > start);
  const changed =
    source.slice(0, start) +
    "export function readNumber(value:{readonly numeric:number}):number{return value.numeric;}\n" +
    source.slice(end);
  assert.throws(
    () => primitiveUnionFixture(false, changed),
    /runtime representation mismatch/,
  );
});
