export const typedRealmInstanceofSource = `
let order: number = 0;
function left(value: unknown): unknown { order = order * 10 + 1; return value; }
function right(): ErrorConstructor { order = order * 10 + 2; return Error; }
export function dateTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return -1;
}
export function mapSize(value: unknown): number {
  if (value instanceof Map) return value.size;
  return -1;
}
function matches(value: unknown, constructor: RegExpConstructor): boolean {
  return value instanceof constructor && value.test("tint") && value.source === "t.nt";
}
export function pattern(value: unknown): boolean {
  const C: RegExpConstructor = RegExp;
  return matches(value, C);
}
export function promise(value: unknown): boolean { return value instanceof Promise; }
export function ordered(value: unknown): boolean {
  order = 0;
  const matched = left(value) instanceof right();
  return matched && order === 12;
}
export function aliasError(value: unknown): string {
  const constructors = { current: Error };
  if (value instanceof constructors.current) return value.message;
  return "other";
}
export function shadow(value: unknown): boolean {
  const Error = Uint8Array;
  return value instanceof Error;
}
export function eligible(value: unknown): boolean {
  return value instanceof Uint8Array;
}
export function arrayUses(value: unknown, source: unknown): number {
  if (!(value instanceof Uint8Array) || !(source instanceof Uint8Array)) return 1;
  const alias = value;
  if ((alias[0] ?? 0) !== 3 || alias[99] !== undefined) return 2;
  value[1] = 9;
  if ((alias[1] ?? 0) !== 9) return 3;
  alias.set(source, 1);
  if ((alias[1] ?? 0) !== 8) return 19;
  if (alias.length !== 2 || alias.byteLength !== 2 || alias.byteOffset !== 0) return 4;
  if ((alias.at(-1) ?? 0) !== 8) return 5;
  const view = alias.subarray(1);
  view.fill(7);
  if ((value[1] ?? 0) !== 7) return 6;
  return 42;
}
export function realmOnly(value: unknown): boolean {
  if (!(value instanceof Int16Array)) return false;
  value[1] = -140;
  const view = value.subarray(1);
  view.fill(-421);
  return value.length === 2 && view.buffer === value.buffer && value[1] === -421;
}
export function detached(value: unknown): boolean {
  if (!(value instanceof Uint8Array)) return false;
  if (value.length !== 0 || value[0] !== undefined) return false;
  try { value.fill(1); } catch (e) { return e instanceof TypeError; }
  return false;
}
export function brand(value: unknown): boolean {
  if (!(value instanceof Uint8Array)) return false;
  try { value.at(0); } catch (e) { return e instanceof TypeError; }
  return false;
}
`;

export const realmInstanceofDriverSource = `
import { ordered, aliasError, shadow, eligible, arrayUses, detached, brand, realmOnly, dateTime, mapSize, pattern, promise } from "./trusted.ts";
export function run(): number {
  class DerivedDate extends Date {}
  if (dateTime(new Date(42)) !== 42 || dateTime({}) !== -1) return 20;
  if (dateTime(new DerivedDate(43)) !== 43) return 21;
  if (mapSize(new Map([[1, "a"]])) !== 1 || mapSize(new Set()) !== -1) return 22;
  if (!pattern(/t.nt/) || pattern("tint")) return 23;
  if (!promise(Promise.resolve(1)) || promise({ then() {} })) return 24;
  if (!ordered(new Error("ordered"))) return 7;
  if (aliasError(new RangeError("message")) !== "message") return 8;
  const array = new Uint8Array(2);
  array[0] = 3;
  if (!shadow(array) || shadow(new Error())) return 9;
  if (arrayUses(array, new Uint8Array([8])) !== 42 || array[1] !== 7) return 10;
  if (!realmOnly(new Int16Array(2))) return 18;
  if (!brand(Object.create(Uint8Array.prototype))) return 11;
  const gone = new Uint8Array(2);
  gone.buffer.transfer();
  if (!detached(gone)) return 12;
  let reads = 0;
  const p = new Proxy({}, {
    getPrototypeOf() { reads++; return Uint8Array.prototype; },
  });
  if (!eligible(p) || reads !== 1) return 13;
  const sentinel = {};
  const failing = new Proxy({}, {
    getPrototypeOf() { throw sentinel; },
  });
  let thrown;
  try { eligible(failing); } catch (e) { thrown = e; }
  if (thrown !== sentinel) return 14;
  const Original = Uint8Array;
  const save = globalThis.Uint8Array;
  try {
    globalThis.Uint8Array = Original.bind(undefined);
    if (!eligible(array)) return 15;
    let called = 0;
    const hook = {
      get [Symbol.hasInstance]() {
        called++;
        return function (value) { return this === hook && value === 17; };
      }
    };
    globalThis.Uint8Array = hook;
    if (!eligible(17) || eligible(array) || called !== 2) return 16;
    globalThis.Uint8Array = { [Symbol.hasInstance]: 12 };
    try { eligible(array); } catch (e) { if (e instanceof TypeError) return 42; }
    return 17;
  } finally { globalThis.Uint8Array = save; }
}
`;
