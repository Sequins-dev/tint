// Typed records cross into untyped code as JavaScript views (docs/unified-pipeline.md,
// slice 2b): one view per record (identity), live fields in both
// directions, `readonly` and declared field types enforced as contracts,
// and only views (not plain objects) accepted back where the record type is
// declared. The typed module stays typed behind checked entries.
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const geometryText = `export interface Point { x: number; readonly y: number }
export function makePoint(x: number, y: number): Point { return { x, y }; }
export function sum(p: Point): number { return p.x + p.y; }
export function shift(p: Point, dx: number): Point { p.x += dx; return p; }
`;
const bytes = new TextEncoder().encode(geometryText),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));

let general: readonly string[] = [];
verifyHostedFixture(
  `import { makePoint, sum, shift } from "geometry";
function rejects(attempt) {
  try { attempt(); } catch (error) { return error instanceof TypeError; }
  return false;
}
export function run() {
  const p = makePoint(40, 2);
  const results = [
    p.x === 40 && p.y === 2,
    sum(p) === 42,
    shift(p, 1) === p,
    p.x === 41,
    ((p.x = 39), sum(p) === 41),
    Object.keys(p).join(",") === "x,y",
    ((p.extra = 1), p.extra === 1 && Object.keys(p).join(",") === "x,y,extra"),
    rejects(() => { p.x = "s"; }) && p.x === 39,
    rejects(() => { p.y = 5; }) && p.y === 2,
    rejects(() => sum({ x: 1, y: 2 })),
    rejects(() => { delete p.x; }) && p.x === 39,
  ];
  const first = results.findIndex((ok) => !ok);
  return first < 0 ? 42 : 100 + first;
}`,
  "record-views",
  [["geometry", "geometry"]],
  [{ id: "geometry", module: parsed.value, dependencies: new Map() }],
  [],
  [],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    onGeneralFallback: (modules: readonly string[]) => {
      general = modules;
    },
  },
);
// Only the untyped fixture falls back; the record's module stays typed.
assert.deepEqual(general, ["fixture"]);
