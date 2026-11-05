import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { specializeCheckedRoots } from "../src/modules/checked-specialization.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const result = parseModule(source.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("specializes structural roots using checked graph identities and deduplicates requests", () => {
  const module = parse("export function identity<T>(value:T):T{return value;}");
  const result = specializeCheckedRoots(
    module,
    [
      { kind: "number" },
      {
        kind: "object",
        properties: [{ name: "value", type: 0, readonly: true }],
      },
    ],
    [
      { name: "identity", arguments: [1] },
      { name: "identity", arguments: [1] },
    ],
    [],
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.roots.length, 2);
  assert.equal(result.value.roots[0], result.value.roots[1]);
  assert.equal(result.value.specializations.length, 1);
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
test("supports recursive anonymous contracts without source declarations", () => {
  const module = parse("export function identity<T>(value:T):T{return value;}");
  const result = specializeCheckedRoots(
    module,
    [
      {
        kind: "object",
        properties: [{ name: "next", type: 0, readonly: true, optional: true }],
      },
    ],
    [{ name: "identity", arguments: [0] }],
    [],
  );
  assert.ok(result.ok, JSON.stringify(result));
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
test("reports invalid requests and avoids collisions with existing type names", () => {
  const module = parse(
    "type __tint_contract_0=string;export function identity<T>(value:T):T{return value;}",
  );
  const good = specializeCheckedRoots(
    module,
    [{ kind: "number" }],
    [{ name: "identity", arguments: [0] }],
    [],
  );
  assert.ok(good.ok, JSON.stringify(good));
  assert.ok(checkClosureModule(good.value.module).ok);
  assert.equal(
    specializeCheckedRoots(
      module,
      [{ kind: "number" }],
      [{ name: "missing", arguments: [0] }],
      [],
    ).ok,
    false,
  );
  assert.equal(
    specializeCheckedRoots(
      module,
      [{ kind: "number" }],
      [{ name: "identity", arguments: [4] }],
      [],
    ).ok,
    false,
  );
});
