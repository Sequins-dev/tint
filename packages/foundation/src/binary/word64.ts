/** Exact unsigned 64-bit data; neither part is a native pointer. */
export interface Word64 {
  readonly lo: number;
  readonly hi: number;
}
export type WordError =
  "INVALID_WORD" | "INVALID_NUMBER" | "OVERFLOW" | "UNDERFLOW";
export type WordResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WordError };
const BASE = 0x100000000;
function validPart(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < BASE;
}
function valid(w: Word64): boolean {
  return validPart(w.lo) && validPart(w.hi);
}
export function fromParts(lo: number, hi: number): WordResult<Word64> {
  if (!validPart(lo) || !validPart(hi))
    return { ok: false, error: "INVALID_WORD" };
  return { ok: true, value: { lo: lo + 0, hi: hi + 0 } };
}
export function fromSafeInteger(value: number): WordResult<Word64> {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    return { ok: false, error: "INVALID_NUMBER" };
  return fromParts(value % BASE, Math.floor(value / BASE));
}
export function toSafeInteger(value: Word64): WordResult<number> {
  if (!valid(value)) return { ok: false, error: "INVALID_WORD" };
  if (value.hi > 0x1fffff) return { ok: false, error: "INVALID_NUMBER" };
  return { ok: true, value: value.hi * BASE + value.lo };
}
export function add(a: Word64, b: Word64): WordResult<Word64> {
  if (!valid(a) || !valid(b)) return { ok: false, error: "INVALID_WORD" };
  const lo = a.lo + b.lo;
  const hi = a.hi + b.hi + (lo >= BASE ? 1 : 0);
  if (hi >= BASE) return { ok: false, error: "OVERFLOW" };
  return fromParts(lo % BASE, hi);
}
export function subtract(a: Word64, b: Word64): WordResult<Word64> {
  if (!valid(a) || !valid(b)) return { ok: false, error: "INVALID_WORD" };
  if (a.hi < b.hi || (a.hi === b.hi && a.lo < b.lo))
    return { ok: false, error: "UNDERFLOW" };
  const lo = a.lo - b.lo;
  return fromParts(lo < 0 ? lo + BASE : lo, a.hi - b.hi - (lo < 0 ? 1 : 0));
}
