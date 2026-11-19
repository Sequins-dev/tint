import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("dynamic object mixed fixture requires TINT_BUILD_ONLY=1");

function module(
  id: string,
  text: string,
  dependencies: [string, string][] = [],
): SourceModule {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}
const types = module(
  "fixture:types",
  `
export interface Counters {
  [key: string]: number;
  count: number;
}
export type Dictionary = Counters;
`,
);
const typed = module(
  "fixture:typed",
  `
import type { Dictionary } from "./types";
export function identity(value: Dictionary): Dictionary {
  value.count = value.count + 1;
  return value;
}
export function make(): Record<string, number> { return { first: 42 }; }
export function optional(value?: Dictionary): Dictionary | undefined { return value; }
export const constant: Record<string, number> = {};
export function copy(value: Record<string, number>): Record<string, number> {
  return { ...value };
}
export function keys(value: Record<string, number>): unknown {
  return Object.keys(value);
}
export function inheritedKeys(value: Record<string, number>): string {
  let result: string = "";
  for (const key in value) result += key;
  return result;
}
`,
  [["./types", "fixture:types"]],
);
const caller = `
import { identity, make, optional, constant, copy, keys, inheritedKeys } from "./typed";
export function run() {
  const source = { count: 6 };
  if (identity(source) !== source || source.count !== 7) return 1;
  let rejected = false;
  try { source.count = "bad"; } catch (error) { rejected = error instanceof TypeError; }
  if (!rejected || source.count !== 7) return 2;
  if (identity(source) !== source || source.count !== 8) return 3;
  const result = make();
  if (Object.getPrototypeOf(result) !== Object.prototype || result.first !== 42) return 4;
  if (optional() !== undefined || optional(source) !== source) return 5;
  constant.fromGeneral = 17;
  if (constant.fromGeneral !== 17) return 6;
  let rejectedArgument = false;
  try { identity({ count: "bad" }); } catch (error) {
    rejectedArgument = error instanceof TypeError;
  }
  if (!rejectedArgument) return 7;
  const ancestor = { hidden: 1, visible: 2 };
  const descendant = Object.create(ancestor, { hidden: { value: 3 } });
  if (inheritedKeys(descendant) !== "visible") return 8;
  const first = Symbol("first"), second = Symbol("second");
  const symbols = {
    value: 1,
    get [first]() { delete this[second]; return 2; },
    [second]: 3,
  };
  const spread = copy(symbols);
  if (spread[first] !== 2 || second in spread || spread.value !== 1) return 9;
  const marker = {};
  Object.defineProperty(symbols, first, { get() { throw marker; } });
  try { copy(symbols); return 10; } catch (error) {
    if (error !== marker) return 10;
  }
  const sentinel = ["overridden"];
  const original = Object.keys;
  Object.keys = function (value) {
    if (this !== Object || value !== source) throw marker;
    return sentinel;
  };
  try {
    if (keys(source) !== sentinel || !Array.isArray(keys(source))) return 11;
  } finally {
    Object.keys = original;
  }
  return 42;
}
`;
let fallback = false;
verifyHostedFixture(
  caller,
  "dynamic-object-mixed-c1",
  [["./typed", "fixture:typed"]],
  [types, typed],
  [],
  [],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    onGeneralFallback(modules) {
      assert.deepEqual(modules, ["fixture"]);
      fallback = true;
    },
  },
);
assert.ok(fallback);
