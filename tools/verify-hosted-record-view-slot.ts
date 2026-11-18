// A viewed record type's hidden view slot (docs/unified-pipeline.md, the
// value bridge): absent until set, an ordinary traced reference field that
// keeps its value across collections (records move), and unreachable from
// source property access.
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const runtimeText = `export interface Point { x: number; readonly y: number }
export function viewOf(record: Point): unknown { throw "UNBOUND_VIEW_SLOT"; }
export function setViewOf(record: Point, view: unknown): void { throw "UNBOUND_VIEW_SLOT"; }
`;
const bytes = new TextEncoder().encode(runtimeText),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));

verifyHostedFixture(
  `import { viewOf, setViewOf, type Point } from "views";
interface Tag { readonly tag: number }
function churn(rounds: number): number {
  let sink = 0;
  for (let round = 0; round < rounds; round++) {
    const values: Point[] = [];
    for (let i = 0; i < 256; i++) values.push({ x: i, y: round });
    sink += values.length;
  }
  return sink;
}
export function run(): number {
  const point: Point = { x: 40, y: 2 };
  if (viewOf(point) !== undefined) return 1;
  const tag: Tag = { tag: 7 };
  setViewOf(point, tag);
  if (viewOf(point) !== tag) return 2;
  churn(512);
  const held = viewOf(point) as Tag;
  if (held !== tag || held.tag !== 7) return 3;
  return point.x + point.y;
}`,
  "record-view-slot",
  [["views", "views:runtime"]],
  [{ id: "views:runtime", module: parsed.value, dependencies: new Map() }],
  [
    { module: "views:runtime", name: "viewOf", operation: "view-slot" },
    { module: "views:runtime", name: "setViewOf", operation: "set-view-slot" },
  ],
  [{ module: "views:runtime", namespace: "views-runtime" }],
  {
    managedBytes: 8388608,
    allocationCapacity: 65536,
    runtimeEntry: "initializeGenerationalRuntime",
    requireTyped: true,
  },
);
