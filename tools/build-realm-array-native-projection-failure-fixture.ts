import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error(
    "realm typed-array projection fixture requires TINT_BUILD_ONLY=1",
  );

const trusted = "fixture:trusted";
const parsed = parseModule(
  createSourceTextView(`
function native(value: Uint8Array): number { return value[0] ?? 0; }
export function call(value: unknown): number {
  if (value instanceof Uint8Array) return native(value);
  return 1;
}
`),
);
assert.ok(parsed.ok, JSON.stringify(parsed));
let partition: readonly string[] | undefined;
verifyHostedFixture(
  `
import { call } from "./trusted.ts";
export function run(): number {
  // The realm buffer has no shared native view. The general caller receives
  // the projected native TypeError through the existing error bridge.
  try { call(new Proxy({}, {getPrototypeOf() {return Uint8Array.prototype;}})); }
  catch (e) {
    if (!(e instanceof TypeError)) return 2;
    if (e.message !== "Passing a realm typed array to a native typed-array parameter requires the slice 2b buffer view") return 3;
  }
  try { return call(new Uint8Array(1)); }
  catch (e) {
    return e instanceof TypeError &&
      e.message === "Passing a realm typed array to a native typed-array parameter requires the slice 2b buffer view" ? 42 : 4;
  }
}
`,
  "realm-array-native-projection-failure",
  [["./trusted.ts", trusted]],
  [{ id: trusted, module: parsed.value, dependencies: new Map() }],
  [],
  [
    {
      module: trusted,
      namespace: "trusted-array-projection",
      retainedExports: [],
    },
  ],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    onGeneralFallback(modules) {
      partition = modules;
    },
  },
);
assert.deepEqual(partition, ["fixture"]);
