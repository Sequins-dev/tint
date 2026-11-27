import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";
test("JSON exposes a tagged ordinary object and a non-constructible stringify method", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const descriptor = objects.getOwnProperty(root, "JSON");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  const json = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(json.prototype, realm.objectPrototype);
  assert.equal(
    objects.getOwnProperty(
      json,
      objects.wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    )?.value,
    "JSON",
  );
  const stringify = objects.getOwnProperty(json, "stringify")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(stringify, "name")?.value, "stringify");
  assert.equal(objects.getOwnProperty(stringify, "length")?.value, 3);
  assert.equal(stringify.internalRareSlots?.internalConstruct, undefined);
  const parse = objects.getOwnProperty(json, "parse")
    ?.value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.ok(parse);
  assert.equal(objects.getOwnProperty(parse, "name")?.value, "parse");
  assert.equal(objects.getOwnProperty(parse, "length")?.value, 2);
  assert.equal(parse.internalRareSlots?.internalConstruct, undefined);
  for (const name of ["rawJSON", "isRawJSON"]) {
    const method = objects.getOwnProperty(json, name)
      ?.value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
    assert.ok(method, name);
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
    assert.equal(method.internalRareSlots?.internalConstruct, undefined);
  }
});
