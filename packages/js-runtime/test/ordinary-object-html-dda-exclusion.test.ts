import assert from "node:assert/strict";
import test from "node:test";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
import {
  createObject,
  excludeHTMLDDAObjects,
  markHTMLDDAObject,
} from "../src/objects/index.ts";

// Module state is per process: this file runs the exclusion first.
test("a host cannot mark IsHTMLDDA objects once lowered code excluded them", () => {
  excludeHTMLDDAObjects();
  excludeHTMLDDAObjects();
  const object = createObject<ScriptPropertyKey, unknown>(undefined);
  assert.throws(
    () => markHTMLDDAObject(object),
    (error) =>
      error === "IsHTMLDDA objects were excluded by code lowered without them",
  );
  assert.equal(object.internalIsHTMLDDA, false);
});
