import assert from "node:assert/strict";
import test from "node:test";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
import {
  createObject,
  createCallableObject,
  excludeHTMLDDAObjects,
  markHTMLDDAObject,
} from "../src/objects/index.ts";
import { exoticSlots } from "../src/objects/operations.ts";

test("IsHTMLDDA is a host-only internal slot, not inherited state", () => {
  const host = createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    () => null,
  );
  assert.equal(exoticSlots(host).internalIsHTMLDDA, false);
  markHTMLDDAObject(host);
  assert.equal(exoticSlots(host).internalIsHTMLDDA, true);
  const child = createObject<ScriptPropertyKey, unknown>(host);
  assert.equal(exoticSlots(child).internalIsHTMLDDA, false);
  assert.equal(
    child.internalRareSlots?.properties?.has("internalIsHTMLDDA") ?? false,
    false,
  );
});

test("code lowered without IsHTMLDDA objects cannot run beside a marked one", () => {
  // The previous test marked an object in this process.
  assert.throws(
    () => excludeHTMLDDAObjects(),
    (error) =>
      error === "code lowered without IsHTMLDDA objects runs beside one",
  );
  markHTMLDDAObject(createObject<ScriptPropertyKey, unknown>(undefined));
});
