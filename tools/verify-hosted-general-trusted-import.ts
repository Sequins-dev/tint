// General (untyped) code imports a trusted runtime module (docs/unified-pipeline.md,
// slice 2a): the runtime stays typed behind checked entries. `unknown`
// parameters and results carry JavaScript values with their identity;
// annotated primitive parameters are contracts, so a foreign argument throws
// a TypeError.
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const runtimeText = `export function identity(value: unknown): unknown { return value; }
export function kind(value: unknown): string { return typeof value; }
export function twice(n: number): number { return n * 2; }
export function pick(flag: boolean, a: unknown, b: unknown): unknown { return flag ? a : b; }
`;
const bytes = new TextEncoder().encode(runtimeText),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));

verifyHostedFixture(
  `import { identity, kind, twice, pick } from "trusted";
function check() {
  const object = { a: 1 };
  const list = [object];
  const results = [
    identity(object) === object,
    identity(list)[0] === object,
    pick(false, 1, object) === object,
    identity(undefined) === undefined,
    kind(object) === "object",
    kind("s") === "string",
    // kind(() => 1) is "function" in JavaScript, but typed "typeof" on an
    // unknown object cannot tell callables apart yet (slice 4a, see the
    // gap table in docs/unified-pipeline.md).
    kind(null) === "object",
    twice(21) === 42,
  ];
  let rejected = false;
  try { twice("21"); } catch (error) { rejected = error instanceof TypeError; }
  results.push(rejected);
  return results.every((ok) => ok);
}
export function run() { return check() ? 42 : 1; }`,
  "general-trusted-import",
  [["trusted", "trusted:runtime"]],
  [{ id: "trusted:runtime", module: parsed.value, dependencies: new Map() }],
  [],
  [{ module: "trusted:runtime", namespace: "trusted-runtime" }],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
