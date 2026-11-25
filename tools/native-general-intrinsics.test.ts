// Generated calls of Math methods, Number, String.prototype.charCodeAt and
// charAt, and the Map and Set methods perform the builtin inline when the
// callee is the realm's own function and the operands have the inline form's
// types, and otherwise call the callee with the same operands. These sections
// call each through shared call sites with Numbers and edge values, with
// operands that convert observably, after the builtin is replaced, deleted
// or made an accessor, through other receivers and with too few arguments,
// so an inline form that applies where it must not, or differs from the
// builtin, changes an observation. Node computes the expected observations
// from the same source; the native image runs under LLDB through the general
// path.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const source = `function show(v) {
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
  // Replacing globalThis.Math mid-loop must invalidate module-level global cache.
  const OriginalMath = globalThis.Math;
  let midSum = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 3) globalThis.Math = { floor: (x) => x + 100 };
    midSum += Math.floor(i + 0.5);
  }
  globalThis.Math = OriginalMath;
  out.push(midSum, Math.floor(2.9));
  // Replacing Math.floor mid-loop must invalidate loop-cached property-load.
  const origFloorLoop = Math.floor;
  let floorLoopSum = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 3) Math.floor = (x) => x + 50;
    floorLoopSum += Math.floor(i + 0.5);
  }
  Math.floor = origFloorLoop;
  out.push(floorLoopSum);
  // Replacing Map.prototype.set / Set.prototype.add mid-loop must invalidate loop-cached property-load.
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
  // Hot-loop charCodeAt edge indices (-0, fractional, negative, >= 2^31, NaN, Infinity).
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
  // ScriptMap: BigInt vs number vs string, rehash, and live iteration mutation.
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
  // Direct-mapped numeric fast table: in-place numeric updates, non-number transition,
  // -0/NaN, live cursor sync, Map copy sync, delete, and clear.
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

test("inline builtin calls keep JavaScript semantics for any callee and operand", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-general-intrinsics-"));
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
  assert.equal(expected.length, 5);
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
    "general-intrinsics",
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
