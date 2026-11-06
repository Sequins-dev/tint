import test from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  entryType,
  arrayElement,
  mapEncoding,
} from "../src/closure/lowering/records.ts";

function fixture(type: string) {
  const parsed = parseModule(
    createSourceTextView(
      `type Value=${type};type Values=Value[];type Lookup=Map<Value,Value>;function identity(value:Value):Value{return value;}`,
    ),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  return checked.value;
}
for (const type of [
  'number|"sp"|"zr"',
  "number|boolean",
  "string|boolean|undefined",
  "null|number",
  "null|undefined",
]) {
  test(`heterogeneous primitive union ${type} uses inline tag/payload storage`, () => {
    const checked = fixture(type),
      id = checked.typeNames.get("Value")!;
    assert.equal(entryType(checked, id), "general");
    assert.equal(arrayElement(checked, checked.typeNames.get("Values")!), id);
    assert.deepEqual(mapEncoding(checked, checked.typeNames.get("Lookup")!), {
      key: id,
      value: id,
    });
  });
}
for (const [type, encoding] of [
  ["number", "number"],
  ["number|undefined", "optional-number"],
  ["boolean|undefined", "optional-boolean"],
  ['"a"|"b"', "string"],
  ["string|undefined", "optional-string"],
] as const) {
  test(`homogeneous ${type} retains its specialized ${encoding} storage`, () => {
    const checked = fixture(type);
    assert.equal(entryType(checked, checked.typeNames.get("Value")!), encoding);
  });
}

test("optional mixed primitive fields retain supported record storage", () => {
  const checked = fixture("{value?:number|string}");
  assert.equal(
    entryType(checked, checked.typeNames.get("Value")!),
    "reference",
  );
});
