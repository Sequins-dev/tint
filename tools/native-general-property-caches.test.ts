// Generated property caches compare the receiver's shared shape (per-
// prototype transition trees), and for method calls the prototype's, with
// the site's inline entry and load the cached cell in place (IR
// property-cell natively). These sections drive one read site through
// shared and diverging shapes, offsets past the in-place slots, inherited
// methods, redefinitions, deletions, prototype changes and accessors, so a
// stale shape, slot or cell changes an observation. Node computes the
// expected observations from the same source; the native image runs under
// LLDB through the general path.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const source = `function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
function readX(p) { return p.x; }
function readK(o) { return o.k9; }
function readSum(p) { return p.sum(); }
function wide(base) {
  const o = {};
  for (let i = 0; i < 12; i++) o["k" + i] = base + i;
  return o;
}
function sharedShapes() {
  let s = 0;
  for (let i = 0; i < 20; i++) s += readX(new Point(i, 1));
  return s;
}
function divergingShapes() {
  const readX = (p) => p.x;
  const out = [];
  const a = { x: 1, y: 2 }, b = { y: 3, x: 4 }, c = { z: 0, x: 5 };
  const d = Object.create({ x: 6 });
  for (const o of [a, b, c, d, a, d, b]) out.push(readX(o));
  return out.join(",");
}
function pastSlots() {
  const readK = (o) => o.k9;
  const readK2 = (o) => o.k2;
  const out = [];
  const early = wide(5);
  out.push(readK2(early));
  Object.defineProperty(early, "k2", { value: "redefined" });
  out.push(readK2(early));
  for (let i = 0; i < 3; i++) out.push(readK(wide(i * 10)));
  const o = wide(100);
  o.k9 = "changed";
  out.push(readK(o));
  delete o.k9;
  out.push(String(readK(o)));
  o.k9 = "again";
  out.push(readK(o));
  return out.join(",");
}
function inherited() {
  const readSum = (p) => p.sum();
  const out = [];
  const p = new Point(1, 2);
  out.push(readSum(p));
  Point.prototype.sum = function () { return this.x * this.y; };
  out.push(readSum(p));
  p.sum = function () { return "own"; };
  out.push(readSum(p));
  delete p.sum;
  out.push(readSum(p));
  Object.setPrototypeOf(p, { sum() { return "swapped"; } });
  out.push(readSum(p));
  return out.join(",");
}
function redefinitions() {
  const readX = (p) => p.x;
  const out = [];
  const o = { x: 1, y: 2 };
  out.push(readX(o));
  Object.defineProperty(o, "x", { value: 7, writable: false });
  out.push(readX(o));
  let reads = 0;
  Object.defineProperty(o, "x", { get() { reads++; return "getter"; }, configurable: true });
  out.push(readX(o), reads);
  Object.defineProperty(o, "x", { value: 9 });
  out.push(readX(o), reads);
  const q = { y: 1 };
  Object.defineProperty(q, "x", { get() { return "accessor"; } });
  out.push(readX(q));
  // A replaced data descriptor at an in-place slot offset.
  const readB = (p) => p.b;
  const r = { a: 1, b: 2, c: 3 };
  out.push(readB(r));
  Object.defineProperty(r, "b", { value: 20, enumerable: false });
  out.push(readB(r));
  Object.defineProperty(r, "b", { value: 21, writable: true });
  r.b = 22;
  out.push(readB(r));
  return out.join(",");
}
function prototypes() {
  const readX = (p) => p.x;
  const out = [];
  const protoA = { x: "a" }, protoB = { x: "b" };
  const o = Object.create(protoA);
  out.push(readX(o));
  Object.setPrototypeOf(o, protoB);
  out.push(readX(o));
  protoB.x = "b2";
  out.push(readX(o));
  o.x = "own";
  out.push(readX(o));
  const bare = Object.create(null);
  bare.x = "null-proto";
  out.push(readX(bare));
  return out.join(",");
}
function megamorphic() {
  // One site sees more shapes than its entries hold, so later shapes go
  // through the shared (shape, name) stub cache.
  const readV = (o) => o.v;
  const callM = (o) => o.m();
  const objects = [];
  for (let i = 0; i < 12; i++) {
    const proto = { m() { return "m" + i; } };
    const o = Object.create(i % 2 ? proto : Object.prototype);
    for (let k = 0; k < i % 5; k++) o["p" + k] = k;
    o.v = i;
    if (i % 2 === 0) o.m = function () { return "own" + i; };
    objects.push(o);
  }
  const out = [];
  for (let round = 0; round < 3; round++)
    for (const o of objects) out.push(readV(o), callM(o));
  objects[3].v = "changed";
  delete objects[5].v;
  Object.getPrototypeOf(objects[7]).m = function () { return "replaced"; };
  for (const o of objects) out.push(String(readV(o)), callM(o));
  return out.join(",");
}
export function sections() {
  return [
    String(sharedShapes()),
    divergingShapes(),
    pastSlots(),
    inherited(),
    redefinitions(),
    prototypes(),
    megamorphic(),
  ];
}
`;

test("property caches keep JavaScript lookups across shapes and redefinitions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-property-caches-"));
  let expected: string[];
  try {
    const file = join(directory, "fixture.mjs");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      sections(): string[];
    };
    expected = module.sections();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(expected.length, 7);
  // Exit status 42 when every section matches, else 10 + the first
  // mismatching section's index.
  let general = false;
  verifyHostedFixture(
    source +
      `export function run() {
  const actual = sections();
  const expected = ${JSON.stringify(expected)};
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i]) return 10 + i;
  return 42;
}\n`,
    "general-property-caches",
    [],
    [],
    [],
    [],
    {
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      onGeneralFallback: () => {
        general = true;
      },
    },
  );
  assert.ok(general, "expected the general path");
});
