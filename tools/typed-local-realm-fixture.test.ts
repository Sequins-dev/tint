import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { typedLocalRealmSource } from "./typed-local-realm-fixture-source.ts";

test("local realm allocation fixture matches Node for seven checks", async () => {
  const source = stripTypeScriptTypes(typedLocalRealmSource, { mode: "strip" });
  const fixture = (await import(
    "data:text/javascript," + encodeURIComponent(source)
  )) as { run(): number };
  assert.equal(fixture.run(), 42);
});

test("compiled storage of an aggregate that escaped into a typed call keeps its diagnostic", () => {
  assert.throws(
    () =>
      verifyHostedFixture(
        `function consume(values: number[]): number { return values.length; }
export function run(): number {
  const values = [42];
  const length = consume(values);
  const object: Record<string, unknown> = { values };
  return length;
}`,
        "local-realm-native-escape",
      ),
    /UNSUPPORTED: native list values in dynamic-key objects need slice 2b list\/record views/,
  );
});
