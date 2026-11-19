export const typedRestSource = `
type Item = { value: number };
function total(scale: number = 2, ...values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return scale * sum;
}
function change(...xs: number[]): number[] {
  xs[0] = 99;
  return xs;
}
function words(...xs: readonly string[]): string { return xs[0] ?? ""; }
function records(...xs: Array<Item>): number { return xs[0]?.value ?? 0; }
function big(...xs: bigint[]): boolean { return (xs[0] ?? 0n) === 9007199254740993n; }
function captureRest(...xs: number[]): () => number {
  return () => (xs[0] ?? 0);
}
function stop(): number { throw new TypeError("stop"); }
export function run(): number {
  if (total() !== 0 || total(3, 4) !== 12 || total(2, 1, 2, 3) !== 12) return 1;
  if (total(undefined, 3, 4) !== 14) return 2;
  let order = 0;
  const mark = (n: number): number => { order = order * 10 + n; return n; };
  const collect = (...xs: number[]): number => total(1, ...xs);
  if (total(mark(1), mark(2), ...[mark(3), mark(4)], mark(5)) !== 14 || order !== 12345) return 3;
  const source: number[] = [7, 8];
  const a = change(...source);
  const b = change(...source);
  a[1] = 10;
  if (source[0] !== 7 || source[1] !== 8 || b[1] !== 8 || a[0] !== 99) return 4;
  const fn: (...xs: number[]) => number = collect;
  if (fn(...source) !== 15 || fn() !== 0) return 5;
  const capture = 3;
  const sum = (...xs: number[]): number => total(capture, ...xs);
  const obj = { sum(...xs: number[]): number { return sum(...xs); } };
  if (obj.sum(2, 3) !== 15) return 6;
  if (words(...["ok"]) !== "ok" || records({ value: 42 }) !== 42 || !big(9007199254740993n)) return 7;
  order = 0;
  try {
    total(mark(1), ...[mark(2)], stop(), mark(3));
    return 8;
  } catch {
    if (order !== 12) return 9;
  }
  if (captureRest(42)() !== 42) return 10;
  const bytes = new Uint8Array(2);
  bytes[0] = 20;
  bytes[1] = 21;
  if (total(1, ...bytes) !== 41) return 11;
  return 42;
}
`;

export const typedVoidSource = `
function named(xs: number[]): number { return xs.push(4); }
function invoke(action: () => void): void { action(); }
function invokeWith(xs: number[], action: (xs: number[]) => void): void { action(xs); }
function count(arr: number[]): unknown { return arr.push(1); }
function size(arr: number[]): number { return arr.length; }
export function run(): number {
  const values: number[] = [];
  const callback: () => void = () => count(values);
  callback();
  if (size(values) !== 1) return 1;
  invoke(() => values.push(2));
  if (size(values) !== 2) return 2;
  const callbacks: { action: () => void } = {
    action: () => { values.push(3); return "discard"; }
  };
  callbacks.action();
  if (size(values) !== 3) return 3;
  const namedCallback: (xs: number[]) => void = named;
  namedCallback(values);
  invokeWith(values, named);
  if (size(values) !== 5 || values[4] !== 4) return 4;
  return 42;
}
`;
