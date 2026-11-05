import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";

const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => {
    throw new Error("template construction must not invoke source code");
  },
};
function realm() {
  return objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
}

test("parsed-unit carriers retain site identity without merging equal text", () => {
  assert.equal(typeof objects.getScriptTemplateSite, "function");
  const owner = realm(),
    first = objects.createScriptRecord(owner, undefined),
    second = objects.createScriptRecord(owner, first),
    recipe = { cooked: ["same"], raw: ["same"] };
  const a = objects.getScriptTemplateSite(first, 0, recipe);
  assert.equal(
    objects.getScriptTemplateSite(first, 0, {
      cooked: ["same"],
      raw: ["same"],
    }),
    a,
  );
  const b = objects.getScriptTemplateSite(first, 1, recipe);
  const c = objects.getScriptTemplateSite(second, 0, recipe);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(
    objects.getTemplateObject(a, owner, hooks),
    objects.getTemplateObject(c, owner, hooks),
  );
  assert.equal(second.hostDefined, first);
});

test("template objects are cached by site identity within one realm", () => {
  const first = realm(),
    second = realm();
  const site = { cooked: ["a", "b"], raw: ["a", "b"] };
  const value = objects.getTemplateObject(site, first, hooks);
  assert.equal(objects.getTemplateObject(site, first, hooks), value);
  assert.notEqual(
    objects.getTemplateObject(
      { cooked: ["a", "b"], raw: ["a", "b"] },
      first,
      hooks,
    ),
    value,
  );
  const other = objects.getTemplateObject(site, second, hooks);
  assert.notEqual(other, value);
  assert.equal(value.prototype, first.arrayPrototype);
  assert.equal(other.prototype, second.arrayPrototype);
});

test("template cooked and raw arrays have frozen descriptors and preserve undefined cooked entries", () => {
  const owner = realm();
  const site = { cooked: ["\n", undefined], raw: ["\\n", "\\unicode"] };
  const value = objects.getTemplateObject(site, owner, hooks);
  const descriptor = objects.getOwnProperty(value, "raw")!;
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, false);
  const raw = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.ok(objects.testIntegrityLevel(value, true, (key): number => -1));
  assert.ok(objects.testIntegrityLevel(raw, true, (key): number => -1));
  assert.equal(objects.getOwnProperty(value, "0")?.value, "\n");
  assert.equal(objects.getOwnProperty(value, "1")?.value, undefined);
  assert.ok(objects.getOwnProperty(value, "1"));
  assert.equal(objects.getOwnProperty(raw, "0")?.value, "\\n");
  assert.equal(objects.getOwnProperty(value, "length")?.value, 2);
  assert.equal(objects.getOwnProperty(raw, "length")?.value, 2);
  assert.equal(raw.prototype, owner.arrayPrototype);
});
