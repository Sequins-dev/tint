import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";
function surface(prefix: string, extra = "", local = "keep", readonly = true) {
  const parsed = parseModule(
    createSourceTextView(
      `${extra}interface Link{${readonly ? "readonly " : ""}value:number;readonly next:Link|undefined;}function ${local}(value:Link):Link{return value;}`,
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const result = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [{ name: "keep", local }],
    prefix,
    [{ name: "Link", local: "Link" }],
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function canonical(value: compiler.ManagedSurfaceTypeDescription) {
  assert.equal(typeof compiler.canonicalizeManagedSurfaceTypes, "function");
  const canonical = compiler.canonicalizeManagedSurfaceTypes(value);
  assert.ok(canonical.ok, JSON.stringify(canonical));
  const serialized = compiler.serializeManagedSurfaceTypes(canonical.value);
  assert.ok(serialized.ok, JSON.stringify(serialized));
  return serialized.value;
}
test("canonical surface metadata excludes transient graph IDs and application helper names", () => {
  const first = surface("$First"),
    second = surface(
      "$Second",
      "type Unrelated={different:string};",
      "renamed",
    );
  assert.deepEqual(canonical(first), canonical(second));
  const normalized = canonical(first),
    restored = compiler.restoreManagedSurfaceTypes(normalized);
  assert.ok(restored.ok);
  assert.deepEqual(canonical(restored.value), normalized);
  assert.equal(normalized.entries[0]?.local, "$helper0");
  assert.notDeepEqual(
    canonical(surface("$Third", "", "keep", false)),
    normalized,
  );
});
test("canonical surface traversal handles recursion and rejects undeclared roots", () => {
  const original = surface("$Source");
  const wire = canonical(original);
  assert.match(wire.declarations, /\$T0/);
  const malformed = {
    ...original,
    table: { start: 0, end: 0, kind: "named", name: "missing" } as const,
  };
  const rejected = compiler.canonicalizeManagedSurfaceTypes(malformed);
  assert.equal(rejected.ok, false);
});

test("canonical contracts preserve UTF-16 property and export names without mutating executable bindings", () => {
  const parsed = parseModule(
    createSourceTextView(
      'interface Odd{readonly "\\uD800":number;}function keep(value:Odd):Odd{return value;}',
    ),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const source = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [{ name: "keep\uD800", local: "keep" }],
    "$Odd",
    [{ name: "Odd\uDFFF", local: "Odd" }],
  );
  assert.ok(source.ok, JSON.stringify(source));
  const before = JSON.stringify(source.value),
    wire = canonical(source.value);
  assert.equal(wire.entries[0]?.name, "keep\uD800");
  assert.equal(wire.types[0]?.name, "Odd\uDFFF");
  assert.match(wire.declarations, /\\ud800/i);
  const restored = compiler.restoreManagedSurfaceTypes(wire);
  assert.ok(restored.ok, JSON.stringify(restored));
  assert.deepEqual(canonical(restored.value), wire);
  assert.equal(JSON.stringify(source.value), before);
  assert.equal(source.value.entries[0]?.local, "keep");
});
