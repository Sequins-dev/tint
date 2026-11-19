import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { typedDynamicObjectSource } from "./typed-dynamic-object-fixture-source.ts";

test("dynamic-key fixture matches Node for 22 checks", async () => {
  const source = stripTypeScriptTypes(typedDynamicObjectSource, {
    mode: "strip",
  });
  const fixture = (await import(
    "data:text/javascript," + encodeURIComponent(source)
  )) as { run(): number };
  assert.equal(fixture.run(), 42);
});
