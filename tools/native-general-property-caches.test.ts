// Generated property caches compare the receiver's shared shape (per-
// prototype transition trees) with the site's inline entry and load the
// cached value in place (IR property-load natively); a method's holder may
// be any prototype up the chain while the prototype epoch is unchanged.
// Named stores go through the site's store cache (IR property-store),
// which also adds properties by cached transitions. These sections drive
// read and write sites through shared and diverging shapes, offsets past
// the in-place slots, inherited methods (also two and three prototypes
// up), own methods at method sites, redefinitions, deletions, prototype
// changes, accessors, symbols, non-extensible receivers and builtin
// objects, so a stale shape, slot or transition changes an observation. Object literals of static-key data
// definitions take the shape their site recorded, beside Object.prototype
// setters, duplicate and index keys, keys past the in-place slots, named
// function values, abrupt values, __proto__ forms and literal prototypes. Node computes the expected
// observations from the same source; the native image runs under LLDB
// through the general path.
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
function stores() {
  const out = [];
  function P(a, b) { this.a = a; this.b = b; }
  const ps = [];
  for (let i = 0; i < 6; i++) ps.push(new P(i, i * 2));
  out.push(ps.map((p) => p.a + p.b).join(" "));
  out.push(Object.keys(ps[5]).join());
  // A setter appears on the prototype after the transition was cached.
  let seen = "none";
  Object.defineProperty(P.prototype, "b", {
    set(v) { seen = "set " + v; },
    get() { return "g"; },
    configurable: true,
  });
  const q = new P(1, 2);
  out.push(seen, q.b, Object.keys(q).join());
  delete P.prototype.b;
  // Module code is strict: rejected stores throw.
  const attempt = (f) => {
    try {
      return String(f());
    } catch (e) {
      return e instanceof TypeError ? "TypeError" : "other";
    }
  };
  // A read-only inherited property rejects the add.
  Object.defineProperty(P.prototype, "a", { value: "ro", writable: false, configurable: true });
  out.push(attempt(() => new P(3, 4).a));
  delete P.prototype.a;
  out.push(Object.keys(new P(3, 4)).join());
  // Existing writable stores, frozen and non-extensible receivers.
  const write = (o, v) => { o.a = v; o.c = v; };
  const s = new P(5, 6);
  write(s, 7);
  write(s, 8);
  const f = Object.freeze(new P(9, 10));
  out.push(attempt(() => write(f, 11)));
  const n = Object.preventExtensions(new P(12, 13));
  out.push(attempt(() => write(n, 14)));
  out.push(s.a, s.c, f.a, String(f.c), n.a, String(n.c));
  // Many keys spill past the in-place values, then use descriptors.
  const big = {};
  for (let i = 0; i < 140; i++) big["k" + i] = i;
  out.push(Object.keys(big).length, big.k3, big.k139, Object.keys(big)[100]);
  // Prototype objects keep accepting stores.
  const proto = {};
  const child = Object.create(proto);
  const put = (o, v) => { o.shared = v; };
  put(proto, "p1");
  put(child, "c1");
  put(proto, "p2");
  out.push(proto.shared, child.shared);
  // Symbols and accessors stay ordinary properties.
  const sym = Symbol("s");
  const acc = { a: 1, get b() { return this.a + 1; }, [sym]: "sym", c: 3 };
  out.push(acc.b, acc[sym], Object.keys(acc).join(), Object.getOwnPropertySymbols(acc).length);
  acc.a = 10;
  out.push(acc.b);
  return out.join(",");
}
function builtins() {
  const out = [];
  const max = (a, b) => Math.max(a, b);
  for (let i = 0; i < 3; i++) out.push(max(i, 1));
  const num = (x) => Number(x);
  out.push(num("12"), num(true));
  const m = new Map();
  const put = (k, v) => m.set(k, v);
  for (let i = 0; i < 3; i++) put("k" + i, i);
  out.push(m.size, m.get("k2"));
  const d = new Date(0);
  const year = (x) => x.getUTCFullYear();
  out.push(year(d), year(d));
  const arr = [];
  const push = (a, v) => a.push(v);
  push(arr, 1);
  push(arr, 2);
  out.push(arr.length);
  return out.join(",");
}
function deepChains() {
  // Methods two and three prototypes up: each read site warms on the
  // holder, then a change in the middle of the chain (which leaves the
  // receiver's and the holder's shapes alone) must be observed.
  function Base() {}
  Base.prototype.name = function () { return "base"; };
  Base.prototype.depth = 0;
  function Mid() {}
  Mid.prototype = Object.create(Base.prototype);
  Mid.prototype.mid = 1;
  function Leaf() { this.own = 1; }
  Leaf.prototype = Object.create(Mid.prototype);
  const call = (o) => o.name();
  const read = (o) => o.depth;
  const out = [];
  const leaf = new Leaf(), mid = new Mid();
  for (let i = 0; i < 3; i++) out.push(call(leaf), call(mid), read(leaf));
  Mid.prototype.name = function () { return "mid"; };
  out.push(call(leaf), call(mid));
  Leaf.prototype.depth = 2;
  out.push(read(leaf), read(mid));
  delete Mid.prototype.name;
  out.push(call(leaf));
  Object.defineProperty(Mid.prototype, "depth", { get() { return "getter"; }, configurable: true });
  out.push(read(leaf), read(mid));
  delete Leaf.prototype.depth;
  out.push(read(leaf));
  Object.setPrototypeOf(Mid.prototype, { name() { return "swapped"; }, depth: 9 });
  out.push(call(leaf), call(mid));
  Base.prototype.name = function () { return "unreached"; };
  out.push(call(leaf));
  // Three levels: a value on the root of an Object.create chain.
  const root = { v: "root" };
  const a = Object.create(root), b = Object.create(a), c = Object.create(b);
  const v = (o) => o.v;
  for (let i = 0; i < 3; i++) out.push(v(c));
  root.v = "changed";
  out.push(v(c));
  a.v = "shadow";
  out.push(v(c), v(b));
  return out.join(",");
}
function polymorphic() {
  // Read sites with two to five receiver shapes and method sites over four
  // classes: entries fill, rotate past four, and go stale when a value,
  // a key or a prototype changes.
  const readX = (o) => o.x;
  const out = [];
  const shapes = [
    { x: 1 },
    { a: 0, x: 2 },
    { b: 0, c: 0, x: 3 },
    { d: 0, x: 4 },
    { e: 0, f: 0, g: 0, x: 5 },
  ];
  for (let round = 0; round < 3; round++)
    for (const o of shapes) out.push(readX(o));
  shapes[1].x = 20;
  delete shapes[2].x;
  out.push(readX(shapes[1]), String(readX(shapes[2])), readX(shapes[0]));
  class A { m() { return "A"; } }
  class B { m() { return "B"; } }
  class C extends A {}
  class D extends C { m() { return "D" + super.m(); } }
  const call = (o) => o.m();
  const objects = [new A(), new B(), new C(), new D()];
  for (let round = 0; round < 3; round++)
    for (const o of objects) out.push(call(o));
  A.prototype.m = function () { return "A2"; };
  for (const o of objects) out.push(call(o));
  Object.setPrototypeOf(C.prototype, B.prototype);
  for (const o of objects) out.push(call(o));
  objects[2].m = function () { return "own"; };
  for (const o of objects) out.push(call(o));
  return out.join(",");
}
function ownMethods() {
  // A method site over object literals with their own methods, beside
  // receivers that inherit theirs: own methods share the site's entries
  // with no holder, and stay correct when replaced, deleted, shadowed,
  // read through accessors or held past the in-place slots.
  const call = (o) => o.m();
  const proto = { m() { return "proto"; } };
  class K { m() { return "K"; } }
  const objects = [
    { m() { return "a"; } },
    { x: 1, m() { return "b" + this.x; } },
    new K(),
    { __proto__: proto, m() { return "c"; } },
    { __proto__: proto, y: 2 },
  ];
  const out = [];
  for (let round = 0; round < 3; round++)
    for (const o of objects) out.push(call(o));
  objects[0].m = function () { return "a2"; };
  delete objects[3].m;
  for (const o of objects) out.push(call(o));
  // A prototype's structural change clears the site's entries.
  proto.z = 1;
  K.prototype.n = 1;
  for (const o of objects) out.push(call(o));
  // More shapes than entries, an accessor and a method past the in-place
  // slots.
  const many = [
    { p: 0, m() { return "p"; } },
    { q: 0, m() { return "q"; } },
    { r: 0, m() { return "r"; } },
    { get m() { return () => "getter"; } },
    { k0: 0, k1: 0, k2: 0, k3: 0, k4: 0, k5: 0, k6: 0, k7: 0, k8: 0, m() { return "far"; } },
  ];
  for (let round = 0; round < 2; round++)
    for (const o of [...objects, ...many]) out.push(call(o));
  return out.join(",");
}
function literals() {
  const out = [];
  const make = (a, b) => ({ left: a, right: b });
  const made = [];
  for (let i = 0; i < 4; i++) made.push(make(i, "r" + i));
  out.push(made.map((o) => o.left + ":" + o.right).join("/"));
  const d = Object.getOwnPropertyDescriptor(made[3], "right");
  out.push(Object.keys(made[3]).join("/"), d.writable, d.enumerable, d.configurable);
  made[0].extra = 1;
  delete made[1].left;
  out.push(Object.keys(make(5, 6)).join("/"), made[2].left, readX({ x: 7 }), readX({ x: 8 }));
  let seen = "";
  Object.defineProperty(Object.prototype, "left", {
    set(v) { seen += "set " + v; },
    get() { return "inherited"; },
    configurable: true,
  });
  const after = make(9, 10);
  out.push(after.left, Object.hasOwn(after, "left"), seen, ({ right: 1 }).left);
  delete Object.prototype.left;
  const dup = () => ({ a: 1, b: 2, a: 3 });
  for (let i = 0; i < 2; i++) out.push(Object.keys(dup()).join("/") + "=" + dup().a);
  const indexed = () => ({ x: 1, 1: "one", 0: "zero" });
  for (let i = 0; i < 2; i++) out.push(Object.keys(indexed()).join("/"));
  const many = (b) => ({ k0: b, k1: b + 1, k2: b + 2, k3: b + 3, k4: b + 4, k5: b + 5,
    k6: b + 6, k7: b + 7, k8: b + 8, k9: b + 9, k10: b + 10 });
  for (let i = 0; i < 3; i++) out.push(readK(many(i * 100)), many(i).k10);
  const named = () => ({ f: function () {}, g: () => 1, h: class {} });
  const n1 = named(), n2 = named();
  out.push(n1.f.name, n1.g.name, n1.h.name, n1.f !== n2.f);
  const log = [];
  const at = (k, v) => { log.push(k); return v; };
  try {
    ({ a: at("a", 1), b: (() => { throw new RangeError("b"); })(), c: at("c", 3) });
  } catch (e) {
    out.push(e.constructor.name, log.join(""));
  }
  const ordered = () => ({ p: at("p", 1), q: at("q", 2) });
  ordered();
  ordered();
  out.push(log.join(""));
  const __proto__ = 5;
  const own = () => ({ __proto__ });
  out.push(own().__proto__, Object.getPrototypeOf(own()) === Object.prototype);
  const setter = () => ({ __proto__: null, z: 1 });
  out.push(Object.getPrototypeOf(setter()) === null, setter().z);
  const base = make(1, 2);
  const child = Object.create(base);
  out.push(child.left + child.right, make(3, 4).right, Object.keys(base).join("/"));
  base.left = 40;
  out.push(child.left, make(5, 6).left);
  const sealed = Object.freeze(make(7, 8));
  out.push(Object.isFrozen(sealed), Object.isFrozen(make(7, 8)));
  const stored = make(1, 1);
  stored.left = "s";
  stored.more = "m";
  out.push(stored.left, stored.more, make(2, 2).more === undefined);
  return out.join(",");
}
function deepSpilledAndBuiltins() {
  const out = [];
  // Depth 5 prototype chain + prototype method past slot 8 + prototype overwrite.
  const p0 = {};
  for (let i = 0; i < 12; i++) p0["m" + i] = function () { return "p0:" + i + ":" + this.id; };
  const p1 = Object.create(p0);
  const p2 = Object.create(p1);
  const p3 = Object.create(p2);
  const p4 = Object.create(p3);
  const leaf = Object.create(p4);
  leaf.id = 7;
  const callFar = (o) => o.m10();
  for (let i = 0; i < 3; i++) out.push(callFar(leaf));
  p0.m10 = function () { return "p0-new:" + this.id; };
  out.push(callFar(leaf));
  p2.m10 = function () { return "p2-mid:" + this.id; };
  out.push(callFar(leaf));
  delete p2.m10;
  out.push(callFar(leaf));
  // Dictionary-mode prototype (deleted key forces dictionary mode) + overwrite.
  const dictProto = { a: 1, b: 2, run() { return "dict1:" + this.id; } };
  delete dictProto.a;
  const dObj = Object.create(dictProto);
  dObj.id = 9;
  const callDict = (o) => o.run();
  for (let i = 0; i < 3; i++) out.push(callDict(dObj));
  dictProto.run = function () { return "dict2:" + this.id; };
  out.push(callDict(dObj));
  // Own spilled properties across chunk 0 (offset 10) and chunk 1 (offset 26).
  const makeSpilled = (base) => {
    const o = {};
    for (let i = 0; i < 30; i++) o["s" + i] = base + i;
    return o;
  };
  const readS10 = (o) => o.s10;
  const readS26 = (o) => o.s26;
  const s1 = makeSpilled(100), s2 = makeSpilled(200);
  for (let i = 0; i < 3; i++) out.push(readS10(s1), readS26(s1), readS10(s2), readS26(s2));
  s1.s10 = "mut10";
  s2.s26 = "mut26";
  out.push(readS10(s1), readS26(s1), readS10(s2), readS26(s2));
  // Spilled builtin own properties (Math.floor, Math.sqrt, Math.abs).
  const mathOp = (x) => Math.floor(Math.sqrt(Math.abs(x)));
  for (let i = 0; i < 3; i++) out.push(mathOp(-16 - i * 9));
  // Packed array inherited methods, expando invalidation, and Array.prototype mutation.
  const pushAndPop = (a, v) => { a.push(v); return a.pop(); };
  const a1 = [1, 2], a2 = [3];
  for (let i = 0; i < 3; i++) out.push(pushAndPop(a1, 10 + i), pushAndPop(a2, 20 + i));
  a1.push = function (v) { return this.unshift(v); };
  out.push(pushAndPop(a1, 99), a1[0], pushAndPop(a2, 30));
  const origJoin = Array.prototype.join;
  const joinIt = (a) => a.join("-");
  out.push(joinIt([1, 2, 3]), joinIt([4, 5]));
  Array.prototype.join = function () { return "custom:" + this.length; };
  out.push(joinIt([1, 2, 3]), joinIt([4, 5]));
  Array.prototype.join = origJoin;
  out.push(joinIt([1, 2, 3]));
  // String primitive inherited method caching & String.prototype mutation.
  const code0 = (s) => s.charCodeAt(0);
  for (let i = 0; i < 3; i++) out.push(code0("abc"), code0("XYZ"));
  const origCharCodeAt = String.prototype.charCodeAt;
  String.prototype.charCodeAt = function () { return 999; };
  out.push(code0("abc"));
  String.prototype.charCodeAt = origCharCodeAt;
  out.push(code0("abc"));
  // Module-level global identifier caching + globalThis write/delete invalidation.
  const readMath = () => Math.abs(-42);
  for (let i = 0; i < 3; i++) out.push(readMath());
  globalThis.__tintA5Global = 11;
  const readG = () => __tintA5Global;
  out.push(readG(), readG());
  globalThis.__tintA5Global = 22;
  out.push(readG());
  delete globalThis.__tintA5Global;
  try {
    out.push(readG());
  } catch (e) {
    out.push(e instanceof ReferenceError ? "RefErr" : "other");
  }
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
    stores(),
    builtins(),
    deepChains(),
    polymorphic(),
    ownMethods(),
    literals(),
    deepSpilledAndBuiltins(),
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
  assert.equal(expected.length, 14);
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
