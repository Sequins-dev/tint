import assert from "node:assert/strict";
import test from "node:test";
import { createObject, createCallableObject } from "../src/objects/index.ts";

test("IsHTMLDDA is a host-only internal slot, not inherited state", () => {
  const host = createCallableObject<string, unknown>(undefined, () => null);
  assert.equal(host.internalIsHTMLDDA, false);
  host.internalIsHTMLDDA = true;
  const child = createObject<string, unknown>(host);
  assert.equal(child.internalIsHTMLDDA, false);
  assert.equal(child.properties.has("internalIsHTMLDDA"), false);
});
