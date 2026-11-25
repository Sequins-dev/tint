// Generated element access reads and overwrites the packed binary64
// elements of arrays inline (IR element-load and element-store natively)
// and leaves every other case to the generic paths: holes and appends,
// inherited and accessor elements, general elements and kind transitions,
// frozen, sealed and non-extensible arrays, typed arrays, strings, proxies,
// array-likes, non-integer and non-Number keys and nullish bases. Array
// literals without spreads or holes create their packed elements directly,
// beside setters on Array.prototype, holes, spreads and abrupt elements. These
// sections drive the same read, write and read-modify-write sites through
// each of them, so a fast path that applies where it must not changes an
// observation. Node computes the expected observations from the same
// source; the native image runs under LLDB through the general path.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const source = `function read(a, i) { return a[i]; }
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
  // This program installs no Math, Map or Set: their realm fields stay
  // undefined, which an undefined method must not match.
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
  // Own push property shadows Array.prototype.push even on a packed array.
  const shadowed = [1, 2];
  shadowed.push = function (v) { return "own " + v; };
  out.push(push(shadowed, 3), shadowed.length);
  // Unrelated mutation on Array.prototype bumps its property epoch; push still works and self-heals.
  Array.prototype.unrelatedPushTag = 123;
  const afterProto = [1];
  out.push(push(afterProto, 2), push(afterProto, 3), afterProto.join("/"));
  delete Array.prototype.unrelatedPushTag;
  // Deleting Array.prototype.push throws TypeError at the call site.
  delete Array.prototype.push;
  let deletedPushErr = "pushed";
  try { push([], 1); } catch (e) { deletedPushErr = e.constructor.name; }
  // Accessor on Array.prototype.push must be invoked.
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
  // Push across capacity growth and number -> value transition, and on unpacked arrays.
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
// Loops over a fresh numeric literal: a masked read inside the literal is a
// number; a read past it is undefined.
function sumMasked(n) { let sum = 0; for (let i = 0; i < n; i++) { const values = [1, 2, 3, 4]; sum += values[i & 3]; } return sum; }
function sumDefaulted(n) { let sum = 0; for (let i = 0; i < n; i++) { const values = [1, 2, 3, 4]; sum += values[i & 3] ?? 10; } return sum; }
function sumPastEnd(n) { let sum = 0; for (let i = 0; i < n; i++) { const values = [1, 2, 3, 4]; sum += values[i & 7]; } return sum; }
function literals() {
  // out and log own index 1 before the setter below exists.
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
  // V8 incorrectly reports Object.isFrozen(Object.seal([])) as true despite
  // length.writable === true (ECMA-262 TestIntegrityLevel 7.3.16 requires false);
  // compare the agreed descriptors and assert sealedEmpty is not frozen below.
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
  // Small dense array literals of arities 0..4 (numbers, objects, mixed).
  const d0 = [];
  const d1 = [42];
  const d2 = [1, -0];
  const d3 = [1, "b", 3];
  const d4 = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];
  out.push(d0.length, d1[0], show(d2[1]), d3.join("/"), d4.map((v) => v.a).join("/"));
  // Small static-key object literals of arities 1..4, duplicate keys, numeric keys, and prototype mutation.
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
  // Warm literal site continues to work after Object.prototype changes.
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
  // Packed pop (numbers, objects, empty, frozen, non-writable length, holey + prototype).
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
  // Sequential fill of preallocated new Array(n).
  const pre = new Array(8);
  for (let i = 0; i < 8; i++) pre[i] = i * 2 + 1;
  out.push(pre.length, pre.join("/"));
  // Speculative numeric for loop: fast path, compound +=, alias distinctness,
  // and exact deopt on OOB, negative, fractional, NaN, non-number scalar, and
  // holey/string arrays.
  function saxpy(a, b, k, n) {
    for (var i = 0; i < n; i++) a[i] += k * b[i];
    return i;
  }
  const x = [1, 2, 3, 4], y = [10, 20, 30, 40];
  out.push(saxpy(x, y, 0.5, 4), x.join("/"));
  // Aliased a === b must observe exact sequential writes.
  const alias = [1, 2, 3, 4];
  function shiftWrite(a, b, n) {
    for (var i = 0; i < n; i++) { a[i] = b[i] + 1; b[i] = a[i] * 2; }
    return i;
  }
  out.push(shiftWrite(alias, alias, 4), alias.join("/"));
  // Deopt mid-loop on out-of-bounds read/write, negative, fractional, NaN.
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
  // Non-number scalar falls back cleanly.
  const nonNum = [1, 2, 3];
  out.push(saxpy(nonNum, [1, 2, 3], "2", 3), nonNum.join("/"));
  // Nested 2-level numeric loop + inner deopt resuming cleanly.
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
  // Trigger inner deopt at row 2 (grid too short for row 2, falls back to general).
  const shortGrid = [0, 0, 0, 0, 0, 0, 0, 0];
  out.push(gridSolve(shortGrid, 2, 2), shortGrid.length, shortGrid[5], shortGrid[10]);
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
  // Direct and continue-bearing for loops (unlabelled, labelled, nested inner continue).
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

test("element access keeps JavaScript semantics on every receiver and key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-general-elements-"));
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
  assert.equal(expected.length, 10);
  // Exit status 42 when every section matches, else 10 + the first
  // mismatching section's index.
  let general = false;
  verifyHostedFixture(
    source +
      `export function run() {
  if (Object.isFrozen(Object.seal([]))) return 99;
  const actual = sections();
  const expected = ${JSON.stringify(expected)};
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i]) return 10 + i;
  return 42;
}\n`,
    "general-elements",
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
