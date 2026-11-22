import assert from "node:assert/strict";
import test from "node:test";
import {
  createObject,
  createCallableObject,
  excludeHTMLDDAObjects,
  markHTMLDDAObject,
} from "../src/objects/index.ts";

test("IsHTMLDDA is a host-only internal slot, not inherited state", () => {
  const host = createCallableObject<string, unknown>(undefined, () => null);
  assert.equal(host.internalIsHTMLDDA, false);
  markHTMLDDAObject(host);
  assert.equal(host.internalIsHTMLDDA, true);
  const child = createObject<string, unknown>(host);
  assert.equal(child.internalIsHTMLDDA, false);
  assert.equal(child.properties.has("internalIsHTMLDDA"), false);
});

test("code lowered without IsHTMLDDA objects cannot run beside a marked one", () => {
  // The previous test marked an object in this process.
  assert.throws(
    () => excludeHTMLDDAObjects(),
    (error) =>
      error === "code lowered without IsHTMLDDA objects runs beside one",
  );
  markHTMLDDAObject(createObject<string, unknown>(undefined));
});
