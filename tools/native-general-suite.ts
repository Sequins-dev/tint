// Shared `argv`-dispatched `general-realm-suite` binary for the heavy general
// runtime semantic suites (`elements`, `intrinsics`, `numbers`,
// `property-caches`, `buffer-identity`).
//
// Each case module stays a plain standard ESM module loaded lazily via
// `await import(...)` based on `argv[1]`, and runs in its own isolated LLDB
// process. Across test files sharing `TINT_FIXTURE_CACHE_DIRECTORY` (and
// co-located on the same CI shard), the full-realm binary is compiled once and
// reused from the cache.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareHostedFixture, sharedFixtureImage } from "./hosted-fixture.ts";
import {
  generalImportDispatcher,
  nodeProcessModule,
  parseFixtureModule,
  runNativeSuiteCase,
} from "./native-suite-runner.ts";

export const nodeBufferModule = "packages/native-runtime/src/node/buffer.ts";

export const elementsSource = `function read(a, i) { return a[i]; }
function write(a, i, v) { a[i] = v; }
function add(a, i, v) { a[i] += v; }
function increment(a, i) { return a[i]++; }
function show(v) {
  return typeof v === "number" && Object.is(v, -0) ? "-0" : String(v);
}
function dense() {
  const out = [];
  const a = new Array(8);
  for (let i = 0; i < 8; i++) write(a, i, i / 2);
  for (let i = 0; i < 8; i++) add(a, i, 1);
  out.push(read(a, 0), read(a, 7), increment(a, 3), read(a, 3));
  write(a, 2, -0);
  out.push(show(read(a, 2)), show(read(a, -0)), read(a, 1.0));
  write(a, -0, 9);
  out.push(read(a, 0), String(read(a, 8)), String(read(a, -1)));
  write(a, 1.5, "fraction");
  write(a, -1, "negative");
  write(a, NaN, "nan");
  out.push(read(a, 1.5), read(a, -1), read(a, NaN), read(a, "1.5"));
  out.push(read(a, "3"), String(read(a, Infinity)), a.length);
  write(a, 4294967295, "not an index");
  out.push(read(a, 4294967295), a.length, String(read(a, 2 ** 53)));
  let sum = 0;
  const big = [];
  for (let i = 0; i < 1000; i++) write(big, i, i * 0.25);
  for (let i = 0; i < 1000; i++) sum += read(big, i);
  out.push(sum, big.length);
  return out.join(",");
}
function holes() {
  const out = [];
  const a = new Array(5);
  write(a, 0, 1);
  write(a, 1, 2);
  out.push(String(read(a, 2)), a.length, 2 in a);
  Array.prototype[2] = "inherited";
  out.push(read(a, 2));
  let calls = 0;
  Object.defineProperty(Array.prototype, 3, {
    get() { calls++; return "getter"; },
    set(v) { calls += 10; },
    configurable: true,
  });
  out.push(read(a, 3), calls);
  write(a, 2, 3);
  out.push(read(a, 2), 2 in a);
  write(a, 3, 4);
  out.push(read(a, 3), calls, Object.hasOwn(a, 3));
  delete Array.prototype[2];
  delete Array.prototype[3];
  const b = [1, 2, 3, 4];
  delete b[1];
  out.push(String(read(b, 1)), read(b, 2));
  write(b, 1, 20);
  add(b, 2, 5);
  out.push(read(b, 1), read(b, 2), b.join("/"));
  const c = [1, 2, 3];
  write(c, 5, 6);
  out.push(c.length, String(read(c, 4)), read(c, 5));
  return out.join(",");
}
function kinds() {
  const out = [];
  const a = [1, 2, 3];
  write(a, 1, "two");
  out.push(read(a, 0), read(a, 1), read(a, 2));
  add(a, 0, 10);
  add(a, 1, "!");
  out.push(read(a, 0), read(a, 1));
  const o = { tag: "object" };
  write(a, 2, o);
  out.push(read(a, 2) === o, a.length);
  a.length = 0;
  write(a, 0, 5);
  write(a, 1, 6.5);
  add(a, 1, 1);
  out.push(read(a, 0), read(a, 1), a.length);
  const b = [];
  for (let i = 0; i < 6; i++) write(b, i, i % 2 === 0 ? i : String(i));
  out.push(b.join("/"));
  const c = [undefined, null, true, 1n];
  out.push(String(read(c, 0)), String(read(c, 1)), read(c, 2), typeof read(c, 3));
  write(c, 0, 1);
  out.push(read(c, 0));
  const nan = [NaN, Infinity, -Infinity];
  out.push(String(read(nan, 0)), read(nan, 1), read(nan, 2));
  return out.join(",");
}
function restricted() {
  const out = [];
  const frozen = Object.freeze([1, 2, 3]);
  try { write(frozen, 1, 9); out.push("wrote"); } catch (e) { out.push(e.constructor.name); }
  try { add(frozen, 1, 9); out.push("wrote"); } catch (e) { out.push(e.constructor.name); }
  out.push(read(frozen, 1), Object.isFrozen(frozen));
  const sealed = Object.seal([1, 2, 3]);
  write(sealed, 1, 9);
  try { write(sealed, 3, 4); out.push("appended"); } catch (e) { out.push(e.constructor.name); }
  out.push(read(sealed, 1), sealed.length);
  const fixed = [1, 2];
  Object.preventExtensions(fixed);
  write(fixed, 0, 5);
  add(fixed, 1, 5);
  try { write(fixed, 2, 3); out.push("appended"); } catch (e) { out.push(e.constructor.name); }
  out.push(read(fixed, 0), read(fixed, 1), fixed.length);
  const readOnly = [1, 2, 3];
  Object.defineProperty(readOnly, 1, { writable: false });
  try { write(readOnly, 1, 9); out.push("wrote"); } catch (e) { out.push(e.constructor.name); }
  write(readOnly, 2, 9);
  out.push(read(readOnly, 1), read(readOnly, 2));
  const accessor = [1, 2, 3];
  let seen = "";
  Object.defineProperty(accessor, 0, {
    get() { seen += "g"; return 7; },
    set(v) { seen += "s" + v; },
  });
  add(accessor, 0, 1);
  out.push(read(accessor, 0), seen);
  const shortLength = [1, 2, 3];
  Object.defineProperty(shortLength, "length", { writable: false });
  write(shortLength, 0, 4);
  try { write(shortLength, 3, 4); out.push("appended"); } catch (e) { out.push(e.constructor.name); }
  out.push(read(shortLength, 0), shortLength.length);
  const huge = [];
  huge.length = 4294967295;
  write(huge, 4294967294, "last");
  try { huge.push(1); out.push("pushed"); } catch (e) { out.push(e.constructor.name); }
  out.push(read(huge, 4294967294), huge.length);
  return out.join(",");
}
function receivers() {
  const out = [];
  const f64 = new Float64Array(3);
  write(f64, 0, 1.5);
  add(f64, 0, 1);
  write(f64, 5, 9);
  out.push(read(f64, 0), String(read(f64, 5)), String(read(f64, -0)));
  const u8 = new Uint8Array(2);
  write(u8, 0, 300);
  add(u8, 1, -1);
  out.push(read(u8, 0), read(u8, 1));
  out.push(read("abc", 1), String(read("abc", 3)), read("abc", "2"));
  String.prototype[5] = "inherited";
  out.push(read("abc", 5), read("abc", -0), String(read("abc", 1.5)));
  delete String.prototype[5];
  out.push(String(read("abc", 5)), read("", "length"), read("abc", "length"));
  const like = { 0: 1, 1: 2, length: 2 };
  write(like, 0, 10);
  add(like, 1, 1);
  out.push(read(like, 0), read(like, 1));
  const log = [];
  const proxy = new Proxy([1, 2], {
    get(t, k, r) { log.push("get " + String(k)); return Reflect.get(t, k, r); },
    set(t, k, v, r) { log.push("set " + String(k)); return Reflect.set(t, k, v, r); },
  });
  write(proxy, 0, 5);
  add(proxy, 1, 1);
  out.push(read(proxy, 0), read(proxy, 1), log.join(";"));
  class List extends Array {}
  const list = new List();
  write(list, 0, 1);
  add(list, 0, 2);
  out.push(read(list, 0), list.length, list instanceof List);
  function args() { write(arguments, 0, 5); add(arguments, 1, 1); return read(arguments, 0) + read(arguments, 1); }
  out.push(args(1, 2));
  try { read(null, 0); } catch (e) { out.push(e.constructor.name); }
  try { write(undefined, 0, 1); } catch (e) { out.push(e.constructor.name); }
  out.push(String(read(5, 0)), String(read(true, 0)));
  return out.join(",");
}
function ordering() {
  const out = [];
  const log = [];
  const key = { toString() { log.push("key"); return "1"; } };
  const a = [1, 2, 3];
  // GetValue stores the converted key in the Reference for PutValue (one
  // conversion); V8 converts again, so only the result is compared here.
  add(a, key, 5);
  out.push(read(a, 1));
  log.length = 0;
  const value = () => { log.push("value"); return 7; };
  const target = [0, 0];
  target[key] = value();
  out.push(read(target, 1), log.join());
  log.length = 0;
  try { null[key] += 1; } catch (e) { out.push(e.constructor.name, log.join()); }
  const holder = { floor: undefined };
  for (const call of [() => holder.floor(1.5), () => holder.max(1, 2), () => holder.get(1)]) {
    try { call(); out.push("called"); } catch (e) { out.push(e.constructor.name); }
  }
  const symbol = Symbol("s");
  const s = [];
  write(s, symbol, 1);
  add(s, symbol, 1);
  out.push(read(s, symbol), s.length);
  return out.join(",");
}
function lengths() {
  const out = [];
  const length = (o) => o.length;
  const a = new Array(5);
  out.push(length(a));
  write(a, 0, 1);
  a.push(2);
  out.push(length(a));
  a.length = 2;
  out.push(length(a), a.join("/"));
  a.length = 10;
  out.push(length(a));
  write(a, 9, "x");
  out.push(length(a));
  const b = [1, 2, 3];
  b.push(4, 5);
  b.pop();
  out.push(length(b));
  write(b, 100, 1);
  out.push(length(b));
  const frozen = Object.freeze([1, 2]);
  out.push(length(frozen));
  const fixed = [1, 2, 3];
  Object.defineProperty(fixed, "length", { writable: false });
  try { fixed.push(4); } catch (e) { out.push(e.constructor.name); }
  out.push(length(fixed));
  const shrink = [1, 2, 3, 4];
  Object.defineProperty(shrink, 1, { configurable: false });
  try { shrink.length = 0; } catch (e) { out.push(e.constructor.name); }
  out.push(length(shrink));
  out.push(length("text"), length({ length: "seven" }), length(function (x, y) {}));
  out.push(length(new Float64Array(6)), length(new Proxy([1, 2], {})));
  class List extends Array {}
  const list = new List(3);
  out.push(length(list));
  function args() { return length(arguments); }
  out.push(args(1, 2, 3));
  const proto = Object.create([1, 2, 3]);
  out.push(length(proto));
  const own = [];
  own.length = 4294967295;
  out.push(length(own));
  try { own.length = -1; } catch (e) { out.push(e.constructor.name); }
  out.push(length(own));
  return out.join(",");
}
function appends() {
  const out = [];
  const push = (a, v) => a.push(v);
  const append = (a, v) => { a[a.length] = v; return a.length; };
  const a = [];
  for (let i = 0; i < 5; i++) out.push(push(a, i), append(a, i + 0.5));
  out.push(a.join("/"));
  const objects = [];
  const o = { k: 1 };
  out.push(push(objects, o), append(objects, "s"), objects[0] === o, objects[1]);
  const holey = [1];
  holey.length = 3;
  out.push(push(holey, 9), String(holey[1]), holey[3], holey.length);
  let seen = "";
  Object.defineProperty(Array.prototype, 2, {
    set(v) { seen += "proto-set " + v + ";"; },
    get() { return "proto-get"; },
    configurable: true,
  });
  const b = [0, 1];
  out.push(push(b, 2), b.length, Object.hasOwn(b, 2), b[2]);
  const c = [0, 1];
  out.push(append(c, 2), Object.hasOwn(c, 2), seen);
  delete Array.prototype[2];
  Object.prototype[1] = "inherited";
  let objectSeen = "";
  Object.defineProperty(Object.prototype, 3, {
    set(v) { objectSeen += "object-set " + v; },
    configurable: true,
  });
  const d = [0, 1, 2];
  out.push(push(d, 3), d.length, Object.hasOwn(d, 3), objectSeen);
  delete Object.prototype[1];
  delete Object.prototype[3];
  const fixed = Object.preventExtensions([1]);
  try { push(fixed, 2); out.push("pushed"); } catch (e) { out.push(e.constructor.name); }
  try { append(fixed, 2); out.push("appended"); } catch (e) { out.push(e.constructor.name); }
  out.push(fixed.length);
  const readOnly = [1];
  Object.defineProperty(readOnly, "length", { writable: false });
  try { push(readOnly, 2); out.push("pushed"); } catch (e) { out.push(e.constructor.name); }
  out.push(readOnly.length, String(readOnly[1]));
  class List extends Array {}
  const list = new List();
  out.push(push(list, 1), append(list, 2), list.length);
  const orphan = [1];
  Object.setPrototypeOf(orphan, null);
  out.push(Array.prototype.push.call(orphan, 2), orphan.length);
  const like = { length: 1, push: Array.prototype.push };
  out.push(push(like, "x"), like.length, like[1]);
  const original = Array.prototype.push;
  Array.prototype.push = function (v) { return "replaced " + v; };
  const replaced = push([], 1);
  Array.prototype.push = original;
  out.push(replaced);
  const shadowed = [1, 2];
  shadowed.push = function (v) { return "own " + v; };
  out.push(push(shadowed, 3), shadowed.length);
  Array.prototype.unrelatedPushTag = 123;
  const afterProto = [1];
  out.push(push(afterProto, 2), push(afterProto, 3), afterProto.join("/"));
  delete Array.prototype.unrelatedPushTag;
  delete Array.prototype.push;
  let deletedPushErr = "pushed";
  try { push([], 1); } catch (e) { deletedPushErr = e.constructor.name; }
  let getterHits = 0;
  Object.defineProperty(Array.prototype, "push", {
    get() { getterHits++; return original; },
    configurable: true,
  });
  const viaGetter = [];
  const getterLen = push(viaGetter, 7);
  Object.defineProperty(Array.prototype, "push", {
    value: original,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  out.push(deletedPushErr, getterLen, getterHits, viaGetter[0]);
  const growing = [];
  for (let i = 0; i < 20; i++) push(growing, i);
  push(growing, "tail");
  out.push(growing.length, growing[0], growing[19], growing[20]);
  const unpackedPush = [1, 2, 3];
  delete unpackedPush[1];
  out.push(push(unpackedPush, 4), unpackedPush.length, String(unpackedPush[1]), unpackedPush[3]);
  out.push([].push(), [1].push(2, 3));
  const huge = [];
  huge.length = 4294967295;
  try { push(huge, 1); } catch (e) { out.push(e.constructor.name); }
  out.push(huge.length, huge[4294967295]);
  const frozenElements = [1, 2];
  Object.freeze(frozenElements);
  try { push(frozenElements, 3); } catch (e) { out.push(e.constructor.name); }
  return out.join(",");
}
function sumMasked(n) { let sum = 0; for (let i = 0; i < n; i++) { const values = [1, 2, 3, 4]; sum += values[i & 3]; } return sum; }
function sumDefaulted(n) { let sum = 0; for (let i = 0; i < n; i++) { const values = [1, 2, 3, 4]; sum += values[i & 3] ?? 10; } return sum; }
function sumPastEnd(n) { let sum = 0; for (let i = 0; i < n; i++) { const values = [1, 2, 3, 4]; sum += values[i & 7]; } return sum; }
function literals() {
  const out = ["literals", ":"];
  const log = ["", ""];
  const at = (n, v) => { log.push(n); return v; };
  let seen = "";
  Object.defineProperty(Array.prototype, 1, {
    set(v) { seen += "proto-set " + v + ";"; },
    get() { return "proto-get"; },
    configurable: true,
  });
  const a = [at(0, 1), at(1, "two"), at(2, 3.5)];
  out.push(a.length, a.join("/"), Object.hasOwn(a, 1), seen, log.join(""));
  const sparse = [0, , 2];
  out.push(sparse[1], Object.hasOwn(sparse, 1), seen);
  delete Array.prototype[1];
  const numbers = [1, -0, NaN, 2.5];
  out.push(numbers.map(show).join(" "), numbers.length);
  numbers[1] = "s";
  out.push(numbers.join("/"), read(numbers, 2) !== read(numbers, 2));
  const empty = [];
  out.push(empty.length, Object.getPrototypeOf(empty) === Array.prototype, Array.isArray(empty));
  out.push(empty.push(1), empty[0]);
  const trailing = [1, 2, ,];
  out.push(trailing.length, 2 in trailing);
  const spread = [0, ...[1, 2], 3];
  out.push(spread.join("/"), spread.length);
  const nested = [[1], [2, [3]]];
  out.push(nested[1][1][0], nested.length);
  const missing = [undefined, null];
  out.push(missing.length, 0 in missing, String(missing[0]), String(missing[1]));
  try {
    [at(3, 1), (() => { throw new RangeError("x"); })(), at(4, 2)];
  } catch (e) {
    out.push(e.constructor.name, log.join(""));
  }
  const fresh = () => [1, 2];
  const x = fresh();
  const y = fresh();
  write(x, 0, 9);
  out.push(y[0], x !== y, x[0]);
  const element = Object.getOwnPropertyDescriptor([7], 0);
  out.push(element.writable, element.enumerable, element.configurable, element.value);
  const length = Object.getOwnPropertyDescriptor([7, 8], "length");
  out.push(length.writable, length.enumerable, length.configurable, length.value);
  out.push(Object.keys(["a", "b"]).join("/"), Object.isExtensible([1]));
  function rest(...r) { return r; }
  const r = rest(1, "b", 3);
  out.push(r.length, r.join("/"), Array.isArray(r), r.push(4), r[3]);
  const frozen = Object.freeze([1, 2]);
  try { write(frozen, 0, 5); } catch (e) { out.push(e.constructor.name); }
  out.push(frozen[0]);
  const frozenEmpty = Object.freeze([]);
  const sealedEmpty = Object.seal([]);
  out.push(
    Object.isFrozen(frozenEmpty),
    Object.isSealed(sealedEmpty),
    Object.getOwnPropertyDescriptor(frozenEmpty, "length").writable,
    Object.getOwnPropertyDescriptor(sealedEmpty, "length").writable,
  );
  try { frozenEmpty.length = 2; out.push("resized"); } catch (e) { out.push(e.constructor.name); }
  sealedEmpty.length = 2;
  try { delete sealedEmpty.length; out.push("deleted"); } catch (e) { out.push(e.constructor.name); }
  out.push(sealedEmpty.length, Reflect.deleteProperty(sealedEmpty, "length"));
  const expando = [10, 20];
  const sym = Symbol("k");
  expando.first = 1;
  expando[sym] = 2;
  expando.second = 3;
  out.push(Reflect.ownKeys(expando).map((k) => typeof k === "symbol" ? "sym" : k).join("/"));
  expando.length = 1;
  out.push(Reflect.ownKeys(expando).map((k) => typeof k === "symbol" ? "sym" : k).join("/"));
  expando[5] = 50;
  out.push(Reflect.ownKeys(expando).map((k) => typeof k === "symbol" ? "sym" : k).join("/"));
  const mixed = [1, 2, "three", 4];
  out.push(mixed.join("/"), mixed.length);
  const d0 = [];
  const d1 = [42];
  const d2 = [1, -0];
  const d3 = [1, "b", 3];
  const d4 = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];
  out.push(d0.length, d1[0], show(d2[1]), d3.join("/"), d4.map((v) => v.a).join("/"));
  const make1 = (a) => ({ a });
  const make2 = (a, b) => ({ a, b });
  const make3 = (a, b, c) => ({ a, b, c });
  const make4 = (a, b, c, d) => ({ a, b, c, d });
  const p1 = make1(1);
  const p2 = make2(2, 3);
  const p3 = make3(4, 5, 6);
  const p4 = make4(7, 8, 9, 10);
  const dupObj = { a: 1, a: 2 };
  const idxObj = { 0: "z", a: "w" };
  let protoSetCalls = 0;
  Object.defineProperty(Object.prototype, "litTrap", {
    set() { protoSetCalls++; },
    get() { return "proto"; },
    configurable: true,
  });
  const trapped = { litTrap: "own", b: 2 };
  delete Object.prototype.litTrap;
  out.push(
    p1.a,
    p2.a + p2.b,
    p3.a + p3.b + p3.c,
    p4.a + p4.b + p4.c + p4.d,
    dupObj.a,
    idxObj[0] + idxObj.a,
    trapped.litTrap,
    protoSetCalls,
  );
  Object.prototype.extraLitProp = "inherited";
  const p2After = make2(20, 30);
  out.push(p2After.a, p2After.b, p2After.extraLitProp);
  delete Object.prototype.extraLitProp;
  const protoArr = [1, 2, 3];
  const derived = Object.create(protoArr);
  out.push(derived.length, Object.hasOwn(protoArr, "length"), "length" in protoArr);
  Object.defineProperty(protoArr, "length", { writable: false });
  try { derived.length = 9; out.push("wrote"); } catch (e) { out.push(e.constructor.name); }
  out.push(derived.length);
  out.push(sumMasked(10), sumDefaulted(10), String(sumPastEnd(10)), sumPastEnd(4));
  return out.join(",");
}
function popAndSpecLoops() {
  const out = [];
  const pop = (a) => a.pop();
  const nums = [10, 20, 30];
  out.push(pop(nums), pop(nums), pop(nums), String(pop(nums)), nums.length);
  const objs = [{ id: 1 }, "s", null];
  out.push(String(pop(objs)), pop(objs), pop(objs).id, objs.length);
  const frozen = Object.freeze([1, 2]);
  try { pop(frozen); out.push("ok"); } catch (e) { out.push(e.constructor.name); }
  const nonWritableLen = [1, 2];
  Object.defineProperty(nonWritableLen, "length", { writable: false });
  try { pop(nonWritableLen); out.push("ok"); } catch (e) { out.push(e.constructor.name); }
  Array.prototype[1] = "proto-1";
  const holey = [5, ,];
  out.push(pop(holey), holey.length);
  delete Array.prototype[1];
  const origPop = Array.prototype.pop;
  Array.prototype.pop = function () { return "patched:" + this.length; };
  out.push(pop([1, 2, 3]));
  Array.prototype.pop = origPop;
  out.push(pop([1, 2, 3]));
  const pre = new Array(8);
  for (let i = 0; i < 8; i++) pre[i] = i * 2 + 1;
  out.push(pre.length, pre.join("/"));
  function saxpy(a, b, k, n) {
    for (var i = 0; i < n; i++) a[i] += k * b[i];
    return i;
  }
  const x = [1, 2, 3, 4], y = [10, 20, 30, 40];
  out.push(saxpy(x, y, 0.5, 4), x.join("/"));
  const alias = [1, 2, 3, 4];
  function shiftWrite(a, b, n) {
    for (var i = 0; i < n; i++) { a[i] = b[i] + 1; b[i] = a[i] * 2; }
    return i;
  }
  out.push(shiftWrite(alias, alias, 4), alias.join("/"));
  const small = [1, 2, 3];
  out.push(saxpy(small, [10, 20, 30, 40], 1, 4), small.length, small.join("/"));
  function writeAt(a, idxs, n) {
    for (var i = 0; i < n; i++) a[idxs[i]] = i + 100;
    return i;
  }
  const target = [0, 0, 0];
  out.push(writeAt(target, [0, 1.5, 2], 3), target[0], target[1.5], target[2]);
  const targetNeg = [0, 0];
  out.push(writeAt(targetNeg, [0, -1, 1], 3), targetNeg[0], targetNeg[-1], targetNeg[1]);
  const targetNan = [0, 0];
  out.push(writeAt(targetNan, [0, NaN, 1], 3), targetNan[0], targetNan.NaN, targetNan[1]);
  const nonNum = [1, 2, 3];
  out.push(saxpy(nonNum, [1, 2, 3], "2", 3), nonNum.join("/"));
  function gridSolve(g, w, h) {
    var rowSize = w + 2;
    for (var j = 1; j <= h; j++) {
      var pos = j * rowSize;
      for (var i = 1; i <= w; i++) {
        g[++pos] = g[pos] + j * 10 + i;
      }
    }
    return j * 100 + i;
  }
  const grid = new Array(16);
  for (let k = 0; k < 16; k++) grid[k] = 0;
  out.push(gridSolve(grid, 2, 2), grid.join("/"));
  const shortGrid = [0, 0, 0, 0, 0, 0, 0, 0];
  out.push(gridSolve(shortGrid, 2, 2), shortGrid.length, shortGrid[5], shortGrid[10]);
  function setBndLike(x, n) {
    var rowSize = n + 2;
    for (var i = 1; i <= n; i++) {
      x[i] = x[i + rowSize] * 2;
      x[i + (n + 1) * rowSize] = x[i + n * rowSize] + 1;
    }
    return i;
  }
  const bnd = new Array(16);
  for (let k = 0; k < 16; k++) bnd[k] = k + 1;
  out.push(setBndLike(bnd, 2), bnd.join("/"));
  function linSolveCarried(x, x0, a, invC, w, h) {
    var rowSize = w + 2;
    var last = 0;
    for (var j = 1; j <= h; j++) {
      var lastRow = (j - 1) * rowSize;
      var currentRow = j * rowSize;
      var nextRow = (j + 1) * rowSize;
      var lastX = x[currentRow];
      ++currentRow;
      for (var i = 1; i <= w; i++) {
        lastX = x[currentRow] =
          (x0[currentRow] + a * (lastX + x[++currentRow] + x[++lastRow] + x[++nextRow])) * invC;
      }
      last = lastX;
    }
    return Math.round(last * 1000) / 1000;
  }
  const lsX = new Array(16), lsX0 = new Array(16);
  for (let k = 0; k < 16; k++) { lsX[k] = k * 0.25; lsX0[k] = k * 0.5; }
  out.push(linSolveCarried(lsX, lsX0, 0.2, 0.5, 2, 2), lsX.map((v) => Math.round(v * 1000) / 1000).join("/"));
  const lsAlias = new Array(16);
  for (let k = 0; k < 16; k++) lsAlias[k] = k + 1;
  out.push(linSolveCarried(lsAlias, lsAlias, 0.1, 0.5, 2, 2), lsAlias.map((v) => Math.round(v * 1000) / 1000).join("/"));
  function descFill(arr, start) {
    var total = 0;
    for (var i = start; i >= 0; i--) {
      arr[i] = arr[i] + i;
      total += arr[i];
    }
    return i + ":" + total;
  }
  const desc = [10, 20, 30, 40];
  out.push(descFill(desc, 3), desc.join("/"), descFill(desc, -1));
  const frac = [1, 2, 3];
  out.push(descFill(frac, 1.5), frac[1.5], frac[0.5]);
  function advectLike(d, d0, u, v, w, h, dt) {
    var rowSize = w + 2;
    var Wdt0 = dt * w;
    var Hdt0 = dt * h;
    var Wp5 = w + 0.5;
    var Hp5 = h + 0.5;
    for (var j = 1; j <= h; j++) {
      var pos = j * rowSize;
      for (var i = 1; i <= w; i++) {
        var x = i - Wdt0 * u[++pos];
        var y = j - Hdt0 * v[pos];
        if (x < 0.5) x = 0.5;
        else if (x > Wp5) x = Wp5;
        var i0 = x | 0;
        var i1 = i0 + 1;
        if (y < 0.5) y = 0.5;
        else if (y > Hp5) y = Hp5;
        var j0 = y | 0;
        var j1 = j0 + 1;
        var s1 = x - i0;
        var s0 = 1 - s1;
        var t1 = y - j0;
        var t0 = 1 - t1;
        var row1 = j0 * rowSize;
        var row2 = j1 * rowSize;
        d[pos] =
          s0 * (t0 * d0[i0 + row1] + t1 * d0[i0 + row2]) +
          s1 * (t0 * d0[i1 + row1] + t1 * d0[i1 + row2]);
      }
    }
    return j * 10 + i;
  }
  const adD = new Array(16), adD0 = new Array(16), adU = new Array(16), adV = new Array(16);
  for (let k = 0; k < 16; k++) {
    adD[k] = 0;
    adD0[k] = k + 1;
    adU[k] = (k % 3) * 0.25 - 0.2;
    adV[k] = ((k + 1) % 3) * 0.25 - 0.1;
  }
  out.push(advectLike(adD, adD0, adU, adV, 2, 2, 0.5), adD.map((v) => Math.round(v * 1000) / 1000).join("/"));
  const adShortD = new Array(16);
  for (let k = 0; k < 16; k++) adShortD[k] = 0;
  const adShortD0 = [1, 2, 3, 4, 5, 6, 7, 8];
  out.push(advectLike(adShortD, adShortD0, adU, adV, 2, 2, 0.5), adShortD.map((v) => (Number.isNaN(v) ? "NaN" : Math.round(v * 1000) / 1000)).join("/"));
  return out.join(",");
}
function cachedLoops() {
  const out = [];
  const shrink = (arr) => { arr.length = 2; };
  const unpack = (arr) => { arr[4] = "text"; };
  const freeze = (arr) => { Object.freeze(arr); };
  const a = [1, 2, 3, 4, 5, 6];
  let sumA = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 2) shrink(a);
    const v = a[i];
    if (typeof v === "number") sumA += v;
    else out.push("shrunk:" + i + ":" + String(v));
  }
  out.push(sumA, a.length);
  const b = [10, 20, 30, 40, 50, 60];
  let traceB = "";
  for (let i = 0; i < 6; i++) {
    if (i === 3) unpack(b);
    traceB += String(b[i]) + "/";
  }
  out.push(traceB);
  const c = [1, 2, 3, 4, 5, 6];
  let froze = "";
  for (let i = 0; i < 6; i++) {
    if (i === 2) freeze(c);
    try { c[i] = i * 10; } catch (e) { froze += i + ":" + e.constructor.name + ";"; }
  }
  out.push(c.join("/"), froze);
  let s1 = 0;
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) continue;
    s1 += i;
  }
  let s2 = 0;
  outer: for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (j === 1) continue;
      if (i === 2 && j === 2) continue outer;
      s2 += i * 10 + j;
    }
  }
  out.push(s1, s2);
  const protoPush = [];
  let protoSetCount = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 3) {
      Object.defineProperty(Array.prototype, 3, {
        set(v) { protoSetCount += v; },
        get() { return 777; },
        configurable: true,
      });
    }
    protoPush.push(i);
  }
  delete Array.prototype[3];
  out.push(protoPush.length, Object.hasOwn(protoPush, 3), protoPush[4], protoSetCount);
  const objProtoPush = [];
  let objProtoSeen = 0;
  for (let i = 0; i < 5; i++) {
    if (i === 2) {
      Object.defineProperty(Object.prototype, 2, {
        set(v) { objProtoSeen += v + 10; },
        configurable: true,
      });
    }
    objProtoPush.push(i);
  }
  delete Object.prototype[2];
  out.push(objProtoPush.length, Object.hasOwn(objProtoPush, 2), objProtoPush[3], objProtoSeen);
  return out.join(",");
}
export function sections() {
  return [
    dense(),
    holes(),
    kinds(),
    restricted(),
    receivers(),
    ordering(),
    lengths(),
    appends(),
    literals(),
    popAndSpecLoops(),
    cachedLoops(),
  ];
}
`;

export const intrinsicsSource = `function show(v) {
  return typeof v === "number" && Object.is(v, -0) ? "-0" : String(v);
}
const floor = (x) => Math.floor(x);
const ceil = (x) => Math.ceil(x);
const trunc = (x) => Math.trunc(x);
const round = (x) => Math.round(x);
const abs = (x) => Math.abs(x);
const sign = (x) => Math.sign(x);
const sqrt = (x) => Math.sqrt(x);
const fround = (x) => Math.fround(x);
const clz32 = (x) => Math.clz32(x);
const max2 = (a, b) => Math.max(a, b);
const min3 = (a, b, c) => Math.min(a, b, c);
const imul = (a, b) => Math.imul(a, b);
const toNumber = (x) => Number(x);
const code = (s, i) => s.charCodeAt(i);
const char = (s, i) => s.charAt(i);
function numbers() {
  const out = [];
  for (const x of [1.5, -1.5, -0.5, 0.5, 2.5, -2.5, -0, NaN, Infinity, -Infinity, 1e21, -7]) {
    out.push([floor(x), ceil(x), trunc(x), round(x), abs(x), sign(x)].map(show).join(" "));
  }
  out.push(show(sqrt(2)), show(sqrt(-1)), show(sqrt(-0)), show(fround(5.05)), clz32(0), clz32(-1), clz32(2 ** 32));
  out.push(show(max2(-0, 0)), show(max2(0, -0)), show(max2(NaN, 1)), show(max2(1, 2)));
  out.push(show(min3(0, -0, 1)), show(min3(3, NaN, 1)), show(min3(3, 2, 1)));
  out.push(imul(0xffffffff, 5), imul(2 ** 31, 2), imul(3.9, 2.9));
  out.push(show(toNumber(-0)), toNumber(12.5), show(toNumber(NaN)));
  return out.join(";");
}
function conversions() {
  const out = [];
  const log = [];
  const value = (n) => ({ valueOf() { log.push("v" + n); return n; } });
  out.push(floor("2.7"), floor(true), String(floor(undefined)), floor(null));
  out.push(max2(value(1), value(2)), log.join());
  log.length = 0;
  out.push(min3(value(3), NaN, value(4)), log.join());
  out.push(toNumber("12"), toNumber(true), toNumber(10n), String(toNumber({})));
  try { floor(Symbol("s")); } catch (e) { out.push(e.constructor.name); }
  out.push(Math.max(), Math.min(), String(Math.floor()), Number());
  out.push(Math.floor(5.5, log.push("extra")), log.join());
  return out.join(";");
}
function strings() {
  const out = [];
  const text = "abc" + String.fromCodePoint(0x1f600);
  for (const i of [0, 1, 2.9, 3, 4, -1, 99, NaN, -0, Infinity]) out.push(show(code(text, i)), char(text, i));
  out.push(code(new String("xyz"), 1), char(new String("xyz"), 2));
  const borrowed = {
    charCodeAt: String.prototype.charCodeAt,
    charAt: String.prototype.charAt,
    toString() { return "q9"; },
  };
  out.push(code(borrowed, 1), char(borrowed, 0));
  out.push(code("abc", "1"), char("abc", { valueOf() { return 2; } }));
  try { String.prototype.charCodeAt.call(null, 0); } catch (e) { out.push(e.constructor.name); }
  out.push(String(code("", 0)), char("", 0) === "");
  return out.join(",");
}
function replaced() {
  const out = [];
  const original = Math.floor;
  Math.floor = (x) => "replaced " + x;
  out.push(floor(1.5));
  delete Math.floor;
  try { floor(1.5); } catch (e) { out.push(e.constructor.name); }
  let reads = 0;
  Object.defineProperty(Math, "floor", {
    get() { reads++; return original; },
    configurable: true,
  });
  out.push(floor(2.5), floor(3.5), reads);
  Object.defineProperty(Math, "floor", { value: original, writable: true, configurable: true });
  out.push(floor(4.5));
  const holder = { floor: Math.ceil };
  out.push(holder.floor(4.5));
  const originalCode = String.prototype.charCodeAt;
  String.prototype.charCodeAt = function (i) { return "patched " + this + i; };
  out.push(code("ab", 1));
  delete String.prototype.charCodeAt;
  try { code("ab", 1); out.push("called"); } catch (e) { out.push(e.constructor.name); }
  let codeGetterHits = 0;
  Object.defineProperty(String.prototype, "charCodeAt", {
    get() { codeGetterHits++; return originalCode; },
    configurable: true,
  });
  out.push(code("ab", 1), codeGetterHits);
  Object.defineProperty(String.prototype, "charCodeAt", {
    value: originalCode,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  out.push(code("ab", 1));
  const originalSqrt = Math.sqrt;
  Math.sqrt = (x) => "sqrt:" + x;
  out.push(sqrt(9));
  Math.sqrt = originalSqrt;
  out.push(sqrt(9), Math.PI > 3.14 && Math.E > 2.71 && Math.SQRT2 > 1.41);
  const OriginalNumber = Number;
  globalThis.Number = (x) => "shadowed " + x;
  out.push(Number(5));
  globalThis.Number = OriginalNumber;
  out.push(Number(5));
  const custom = { max(a, b) { return "custom " + a + b; } };
  out.push(custom.max(1, 2));
  const OriginalMath = globalThis.Math;
  let midSum = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 3) globalThis.Math = { floor: (x) => x + 100 };
    midSum += Math.floor(i + 0.5);
  }
  globalThis.Math = OriginalMath;
  out.push(midSum, Math.floor(2.9));
  const origFloorLoop = Math.floor;
  let floorLoopSum = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 3) Math.floor = (x) => x + 50;
    floorLoopSum += Math.floor(i + 0.5);
  }
  Math.floor = origFloorLoop;
  out.push(floorLoopSum);
  const origMapSet = Map.prototype.set;
  const origSetAdd = Set.prototype.add;
  const loopMap = new Map();
  let mapIntercepted = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 3) Map.prototype.set = function (k, v) { mapIntercepted += k + v; return this; };
    loopMap.set(i, i * 2);
  }
  Map.prototype.set = origMapSet;
  const loopSet = new Set();
  let setIntercepted = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 3) Set.prototype.add = function (v) { setIntercepted += v + 10; return this; };
    loopSet.add(i);
  }
  Set.prototype.add = origSetAdd;
  out.push(loopMap.size, mapIntercepted, loopSet.size, setIntercepted);
  const ccStr = "abcdef";
  const ccIdxs = [0, -0, 1.9, 5, -1, 2147483648, 4294967296, NaN, Infinity, -Infinity];
  const ccOut = [];
  for (let i = 0; i < ccIdxs.length; i++) ccOut.push(show(ccStr.charCodeAt(ccIdxs[i])));
  out.push(ccOut.join("/"));
  return out.join(",");
}
function collections() {
  const out = [];
  const get = (m, k) => m.get(k);
  const set = (m, k, v) => m.set(k, v);
  const has = (m, k) => m.has(k);
  const add = (s, v) => s.add(v);
  const m = new Map();
  out.push(set(m, -0, "zero") === m, get(m, 0), has(m, -0), m.size);
  set(m, NaN, "nan");
  set(m, "k", 1);
  set(m, "k", 2);
  out.push(get(m, NaN), get(m, "k"), String(get(m, "missing")), has(m, "k"), m.size);
  const key = {};
  set(m, key, "object");
  out.push(get(m, key), has(m, {}));
  const s = new Set();
  out.push(add(s, -0) === s, has(s, 0), add(s, 1).size, [...s].map(show).join("/"));
  class SubMap extends Map {}
  const sub = new SubMap([[1, "one"]]);
  out.push(get(sub, 1), has(sub, 2));
  try { get(s, 1); } catch (e) { out.push(e.constructor.name); }
  try { add(m, 1); } catch (e) { out.push(e.constructor.name); }
  out.push(has(m, "k"), has(s, 1));
  const store = { values: {}, get(k) { return "own " + k; }, set(k, v) { this.values[k] = v; return 7; }, has(k) { return "has " + k; }, add(v) { return "add " + v; } };
  out.push(get(store, 1), set(store, "a", 1), has(store, 2), add(store, 3));
  const originalGet = Map.prototype.get;
  Map.prototype.get = function (k) { return "patched " + k; };
  out.push(get(m, "k"));
  Map.prototype.get = originalGet;
  out.push(get(m, "k"));
  try { Map.prototype.set.call(new Set(), 1, 2); } catch (e) { out.push(e.constructor.name); }
  const order = [];
  m.set((order.push("key"), "x"), (order.push("value"), 1));
  out.push(order.join(), get(m, "x"), m.get());
  const big = new Map();
  big.set(0n, "zeroN");
  big.set(0, "zero");
  big.set("0", "zeroS");
  big.set(1n << 80n, "huge");
  for (let i = 0; i < 32; i++) big.set("k" + i, i);
  big.delete("k5");
  out.push(
    big.get(0n),
    big.get(-0),
    big.get("0"),
    big.get(1n << 80n),
    big.has("k5"),
    big.get("k31"),
    big.size,
  );
  const live = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const seen = [];
  for (const [k, v] of live) {
    seen.push(k + v);
    if (k === "a" && v === 1) {
      live.delete("b");
      live.delete("a");
      live.set("a", 9);
    }
  }
  out.push(seen.join("/"));
  const cleared = new Set([1, 2, 3]);
  const seenSet = [];
  for (const v of cleared) {
    seenSet.push(v);
    if (v === 1) cleared.clear();
  }
  out.push(seenSet.join("/"), cleared.size);
  const fastMap = new Map();
  for (let i = 0; i < 16; i++) fastMap.set(i, i);
  for (let i = 0; i < 16; i++) fastMap.set(i, i * 10 + 1);
  fastMap.set(-0, 999);
  fastMap.set(3, "str");
  fastMap.set(4, undefined);
  fastMap.set(NaN, 123);
  const fastReads = [];
  for (let i = 0; i < 6; i++) fastReads.push(String(fastMap.get(i)));
  fastReads.push(
    String(fastMap.get(-0)),
    String(fastMap.get(NaN)),
    String(fastMap.has(3)),
    String(fastMap.has(99)),
  );
  const cursorSeen = [];
  for (const [k, v] of fastMap) {
    if (k < 5 || k !== k) cursorSeen.push(String(k) + "=" + String(v));
  }
  const cloned = new Map(fastMap);
  fastMap.set(1, 555);
  fastMap.delete(2);
  out.push(
    fastReads.join("/"),
    cursorSeen.join("/"),
    cloned.get(0),
    cloned.get(1),
    cloned.get(3),
    String(cloned.get(4)),
    fastMap.get(1),
    fastMap.has(2),
    fastMap.size,
  );
  fastMap.clear();
  out.push(fastMap.size, fastMap.has(0));
  return out.join(",");
}
export function sections() {
  return [numbers(), conversions(), strings(), replaced(), collections()];
}
`;

export const numbersSource = `function sum(values) {
  let total = 0;
  for (let i = 0; i < values.length; i++) total = total + values[i];
  return total;
}
function add(a, b) {
  return a + b;
}
function lessThan(a, b) {
  return a < b ? 1 : 0;
}
function transitions(n) {
  let x = 0;
  let trace = "";
  for (let i = 0; i < n; i++) {
    if (i === 3) x = "s";
    else if (i === 5) x = 1;
    else if (i === 7) x = { valueOf() { return 10; } };
    x = x + i;
    trace += typeof x + ":" + String(x) + ";";
  }
  return trace;
}
function guarded(v) {
  let r = v;
  let n = 0;
  while (typeof r === "number" && n < 5) {
    r = r * 2;
    n++;
    if (n === 3) r = String(r);
  }
  return typeof r + String(r) + n;
}
function zeros() {
  let z = -0;
  let t = -0;
  for (let i = 0; i < 2; i++) t = t + z;
  let m = -0;
  for (let i = 0; i < 1; i++) m = m * 1;
  let p = 0;
  for (let i = 0; i < 2; i++) p = p + z;
  return [1 / t, 1 / m, 1 / p, 0 / 0 < 1, NaN === NaN].map(String).join(",");
}
function caught() {
  let x = 1;
  try {
    x = x + 1;
    throw x;
  } catch (e) {
    x = "c" + e;
  }
  for (let i = 0; i < 2; i++) x = x + i;
  return x;
}
function captured() {
  let c = 0;
  const bump = () => {
    c = "b" + c;
  };
  for (let i = 0; i < 4; i++) {
    c = c + 1;
    if (i === 1) bump();
  }
  return String(c);
}
function params(a, b) {
  let r = 0;
  if (typeof a === "number") r = a * 3;
  return [r, a < b, a + b].map(String).join(",");
}
function shadowedSwap(a, b) {
  let x = a;
  let y = b;
  for (let i = 0; i < 3; i++) {
    const t = x;
    x = y;
    y = typeof t === "number" ? t + 1 : t;
  }
  return String(x) + "|" + String(y);
}
function bits(values) {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += [v | 0, v & 0xffff, v ^ -1, v << 1, v >> 1, v >>> 0].join(" ") + ";";
  }
  return out;
}
export function sections() {
  return [
    String(sum([1, 2, 3.5])),
    String(sum([1, "2", 3])),
    String(add(1, 2)) + String(add("a", 2)) + String(add(undefined, 1)),
    String(lessThan(1, 2)) + String(lessThan("b", "a")) + String(lessThan(NaN, 1)),
    transitions(9),
    guarded(3) + guarded("x") + guarded(1.5),
    zeros(),
    caught(),
    captured(),
    params(2, 3) + params("2", "10") + params(1n, 2n) + params(undefined, 1),
    shadowedSwap(1, "s") + shadowedSwap(2, 3),
    bits([
      0, -0, 1.9, -1.9, 2 ** 31, -(2 ** 31) - 1, 2 ** 32 + 5, -(2 ** 53),
      1e20, -1e300, 2 ** 63, NaN, Infinity, -Infinity, 4294967295.5,
      "7", true, null, undefined,
    ]),
  ];
}
`;

export const propertyCachesSource = `function Point(x, y) { this.x = x; this.y = y; }
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
  let seen = "none";
  Object.defineProperty(P.prototype, "b", {
    set(v) { seen = "set " + v; },
    get() { return "g"; },
    configurable: true,
  });
  const q = new P(1, 2);
  out.push(seen, q.b, Object.keys(q).join());
  delete P.prototype.b;
  const attempt = (f) => {
    try {
      return String(f());
    } catch (e) {
      return e instanceof TypeError ? "TypeError" : "other";
    }
  };
  Object.defineProperty(P.prototype, "a", { value: "ro", writable: false, configurable: true });
  out.push(attempt(() => new P(3, 4).a));
  delete P.prototype.a;
  out.push(Object.keys(new P(3, 4)).join());
  const write = (o, v) => { o.a = v; o.c = v; };
  const s = new P(5, 6);
  write(s, 7);
  write(s, 8);
  const f = Object.freeze(new P(9, 10));
  out.push(attempt(() => write(f, 11)));
  const n = Object.preventExtensions(new P(12, 13));
  out.push(attempt(() => write(n, 14)));
  out.push(s.a, s.c, f.a, String(f.c), n.a, String(n.c));
  const big = {};
  for (let i = 0; i < 140; i++) big["k" + i] = i;
  out.push(Object.keys(big).length, big.k3, big.k139, Object.keys(big)[100]);
  const proto = {};
  const child = Object.create(proto);
  const put = (o, v) => { o.shared = v; };
  put(proto, "p1");
  put(child, "c1");
  put(proto, "p2");
  out.push(proto.shared, child.shared);
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
  proto.z = 1;
  K.prototype.n = 1;
  for (const o of objects) out.push(call(o));
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
  const dictProto = { a: 1, b: 2, run() { return "dict1:" + this.id; } };
  delete dictProto.a;
  const dObj = Object.create(dictProto);
  dObj.id = 9;
  const callDict = (o) => o.run();
  for (let i = 0; i < 3; i++) out.push(callDict(dObj));
  dictProto.run = function () { return "dict2:" + this.id; };
  out.push(callDict(dObj));
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
  const mathOp = (x) => Math.floor(Math.sqrt(Math.abs(x)));
  for (let i = 0; i < 3; i++) out.push(mathOp(-16 - i * 9));
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
  const code0 = (s) => s.charCodeAt(0);
  for (let i = 0; i < 3; i++) out.push(code0("abc"), code0("XYZ"));
  const origCharCodeAt = String.prototype.charCodeAt;
  String.prototype.charCodeAt = function () { return 999; };
  out.push(code0("abc"));
  String.prototype.charCodeAt = origCharCodeAt;
  out.push(code0("abc"));
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
function inheritedNonMethodAndEviction() {
  const out = [];
  const matProto = { reflection: 0.25, gloss: 2, hasTexture: false };
  const m1 = Object.create(matProto);
  const m2 = Object.create(matProto);
  m2.reflection = 0.75;
  const readMat = (m) => m.reflection + ":" + m.gloss + ":" + m.hasTexture;
  for (let i = 0; i < 3; i++) out.push(readMat(m1), readMat(m2));
  matProto.reflection = 0.5;
  matProto.hasTexture = true;
  out.push(readMat(m1), readMat(m2));
  m1.gloss = 9;
  out.push(readMat(m1), readMat(m2));
  delete m1.gloss;
  out.push(readMat(m1));
  const readV = (o) => o.v;
  const shapes = [
    { a: 1, v: 10 },
    { b: 1, v: 20 },
    { c: 1, v: 30 },
    { d: 1, v: 40 },
    { e: 1, v: 50 },
    { f: 1, v: 60 },
    { g: 1, v: 70 },
    { h: 1, v: 80 },
  ];
  let sum = 0;
  for (let round = 0; round < 20; round++) {
    for (const s of shapes) sum += readV(s);
  }
  out.push(sum);
  const callInit = (o) => o.init();
  const cold = [];
  for (let k = 0; k < 5; k++) {
    const p = { init() { return "c" + k; } };
    const o = Object.create(p);
    o["cold" + k] = k;
    cold.push(o);
  }
  for (const c of cold) out.push(callInit(c));
  const hotProtos = [];
  const hot = [];
  for (let k = 0; k < 4; k++) {
    const p = { init() { return k + 1; } };
    hotProtos.push(p);
    const o = Object.create(p);
    o["hot" + k] = k;
    hot.push(o);
  }
  let hotSum = 0;
  for (let r = 0; r < 100; r++) {
    for (const h of hot) hotSum += callInit(h);
  }
  hotProtos[2].init = function () { return 100; };
  for (const h of hot) hotSum += callInit(h);
  out.push(hotSum);
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
    inheritedNonMethodAndEviction(),
  ];
}
`;

export const bufferIdentitySource = `
import process from "node:process";
import { Buffer } from "node:buffer";
function checkBufferIdentity() {
  if (globalThis.Buffer !== Buffer ||
      Object.getPrototypeOf(Buffer) !== Uint8Array ||
      Object.getPrototypeOf(Buffer.prototype) !== Uint8Array.prototype) return 1;
  const bytes = Buffer.from([0x6f, 0x6b, 0]);
  if (!Buffer.isBuffer(bytes) || !(bytes instanceof Uint8Array) ||
      Object.getPrototypeOf(bytes) !== Buffer.prototype ||
      Buffer.isBuffer(new Uint8Array(1)) || Buffer.isBuffer(Buffer.prototype)) return 2;
  const sub = bytes.subarray(-2, -1);
  const slice = bytes.slice(0, 2);
  if (!Buffer.isBuffer(sub) || !Buffer.isBuffer(slice) ||
      sub.buffer !== bytes.buffer || slice.buffer !== bytes.buffer ||
      sub.byteOffset !== bytes.byteOffset + 1 || sub.toString() !== "k") return 3;
  sub[0] = 0x6d;
  if (bytes[1] !== 0x6d || slice.toString() !== "om") return 4;
  const backing = new ArrayBuffer(4);
  const alias = Buffer.from(backing, 1, 2);
  const data = new Uint8Array(backing);
  alias[0] = 42;
  if (alias.buffer !== backing || alias.byteOffset !== 1 || data[1] !== 42) return 5;
  const copied = Buffer.from(alias);
  alias[0] = 37;
  if (copied[0] !== 42 || copied.buffer === backing) return 6;
  if (Buffer.from("A", "UCS-2").toString("hex") !== "4100" ||
      Buffer.alloc(5, "AB").toString("ascii") !== "ABABA" ||
      Buffer.alloc(0).length !== 0) return 7;
  try { Buffer.from("x", "missing"); return 8; }
  catch (error) { if (!(error instanceof TypeError) || error.code !== "ERR_UNKNOWN_ENCODING") return 8; }
  return 42;
}
process.exitCode = checkBufferIdentity();
`;

export type GeneralRealmCaseName =
  "elements" | "intrinsics" | "numbers" | "property-caches" | "buffer-identity";

export async function computeNodeSections(
  source: string,
  prefix: string,
): Promise<string[]> {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try {
    const file = join(directory, "fixture.mjs");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      sections(): string[];
    };
    return module.sections();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function sectionRunnerModule(
  source: string,
  expected: readonly string[],
  prelude = "",
): string {
  return `import process from "node:process";
${source}
function checkSections() {
${prelude}  const actual = sections();
  const expected = ${JSON.stringify(expected)};
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i]) return 10 + i;
  return 42;
}
process.exitCode = checkSections();
`;
}

let cachedExpected:
  | {
      readonly elements: readonly string[];
      readonly intrinsics: readonly string[];
      readonly numbers: readonly string[];
      readonly propertyCaches: readonly string[];
    }
  | undefined;

async function allNodeExpectations() {
  if (cachedExpected !== undefined) return cachedExpected;
  const [elements, intrinsics, numbers, propertyCaches] = await Promise.all([
    computeNodeSections(elementsSource, "tint-general-elements-"),
    computeNodeSections(intrinsicsSource, "tint-general-intrinsics-"),
    computeNodeSections(numbersSource, "tint-general-numbers-"),
    computeNodeSections(propertyCachesSource, "tint-property-caches-"),
  ]);
  assert.equal(elements.length, 11);
  assert.equal(intrinsics.length, 5);
  assert.equal(numbers.length, 12);
  assert.equal(propertyCaches.length, 15);
  cachedExpected = { elements, intrinsics, numbers, propertyCaches };
  return cachedExpected;
}

/** Build (or reuse from `TINT_FIXTURE_CACHE_DIRECTORY`) the shared
 * `general-realm-suite` binary and execute `name` in its own isolated LLDB
 * process. */
export async function runGeneralRealmSuiteCase(
  name: GeneralRealmCaseName,
): Promise<void> {
  const expected = await allNodeExpectations();
  const cases = [
    {
      name: "elements",
      specifier: "./elements.ts",
      id: "fixture:general-elements",
      text: sectionRunnerModule(
        elementsSource,
        expected.elements,
        "  if (Object.isFrozen(Object.seal([]))) return 99;\n",
      ),
      deps: [["node:process", nodeProcessModule]] as [string, string][],
    },
    {
      name: "intrinsics",
      specifier: "./intrinsics.ts",
      id: "fixture:general-intrinsics",
      text: sectionRunnerModule(intrinsicsSource, expected.intrinsics),
      deps: [["node:process", nodeProcessModule]] as [string, string][],
    },
    {
      name: "numbers",
      specifier: "./numbers.ts",
      id: "fixture:general-numbers",
      text: sectionRunnerModule(numbersSource, expected.numbers),
      deps: [["node:process", nodeProcessModule]] as [string, string][],
    },
    {
      name: "property-caches",
      specifier: "./property-caches.ts",
      id: "fixture:general-property-caches",
      text: sectionRunnerModule(propertyCachesSource, expected.propertyCaches),
      deps: [["node:process", nodeProcessModule]] as [string, string][],
    },
    {
      name: "buffer-identity",
      specifier: "./buffer-identity.ts",
      id: "fixture:ffi-buffer-identity",
      text: bufferIdentitySource,
      deps: [
        ["node:process", nodeProcessModule],
        ["node:buffer", nodeBufferModule],
      ] as [string, string][],
    },
  ];
  const dispatcher = generalImportDispatcher(cases);
  const binary = sharedFixtureImage(
    "general-realm-suite",
    [dispatcher, ...cases.map((entry) => entry.text)],
    () => {
      let general: readonly string[] | undefined;
      const built = prepareHostedFixture(
        dispatcher,
        "general-realm-suite",
        [
          ["node:process", nodeProcessModule],
          ...cases.map(({ specifier, id }): [string, string] => [
            specifier,
            id,
          ]),
        ],
        cases.map(({ id, text, deps }) => parseFixtureModule(id, text, deps)),
        [],
        [
          {
            module: nodeBufferModule,
            namespace: "node-buffer",
            retainedExports: [],
          },
        ],
        {
          managedBytes: 67108864,
          allocationCapacity: 1048576,
          onGeneralFallback(modules) {
            general = modules;
          },
        },
      );
      assert.ok(general !== undefined, "expected the general path");
      assert.ok(
        !general.includes(nodeBufferModule),
        "node:buffer must remain typed: " + JSON.stringify(general),
      );
      assert.ok(
        !general.includes("packages/native-runtime/src/node/process-host.ts"),
        "process-host must remain typed: " + JSON.stringify(general),
      );
      return built;
    },
  );
  runNativeSuiteCase(binary, [name], { cleanup: true });
}
