import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import {
  typedRealmAggregateFlow,
  typedRealmOperations,
  typedVoidCallbackResults,
} from "./typed-realm-operations-fixture-source.ts";

for (const [name, source] of [
  ["realm property updates, array methods and spread", typedRealmOperations],
  ["realm aggregate identity through typed flows", typedRealmAggregateFlow],
  ["void callback return values", typedVoidCallbackResults],
] as const) {
  test(name + " matches Node", async () => {
    const fixture = (await import(
      "data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source))
    )) as { run(): number };
    assert.equal(fixture.run(), 42);
  });
}
