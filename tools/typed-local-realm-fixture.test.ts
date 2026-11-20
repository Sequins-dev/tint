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

test("a native list can flow through a direct typed call into realm storage", async () => {
  const source = `function consume(values: number[]): number { return values.length; }
export function directCallLength(): number {
  const values = [42];
  const length = consume(values);
  const object: Record<string, unknown> = { values };
  return length;
}`;
  const fixture = (await import(
    "data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source))
  )) as { directCallLength(): number };
  const length = fixture.directCallLength();
  assert.equal(length, 1);

  process.env.TINT_GENERAL_FALLBACK = "0";
  verifyHostedFixture(
    `${source}
export function run(): number { return directCallLength() === ${length} ? 42 : 1; }`,
    "local-realm-native-escape",
  );
});
