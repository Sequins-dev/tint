// run returns 42 after all checks, or the number of the failing check.
export const typedBindingPatternsSource = `
function log(log: number[], value: number): number {
  log.push(value);
  return value;
}
function source(events: number[]): { a?: number; b: { n: number }; c: number; d: number | null } {
  log(events, 1);
  return { b: { n: 6 }, c: 5, d: null };
}
function parameter({ n = 20 }: { n?: number }, twice: number = n + n): number {
  return twice;
}
export function run(): number {
  const events: number[] = [];
  const { [("a" as "a")]: first = log(events, 2), b: { n }, d = log(events, 10), ...others } = source(events);
  if (first !== 2 || n !== 6 || d !== null || others.c !== 5) return 1;
  if (events.length !== 2 || events[0] !== 1 || events[1] !== 2) return 2;
  const list: (number | undefined)[] = [1, , undefined, 4, 5];
  const [head, , third = log(events, 3), ...tail] = list;
  if (head !== 1 || third !== 3 || tail.length !== 2 || tail[0] !== 4 || tail[1] !== 5) return 3;
  if (events[2] !== 3 || events[3] !== undefined) return 4;
  const items: (number | undefined)[] = [];
  function grow(): number {
    items.push(7, 8, 9);
    return 40;
  }
  const [before = grow(), after, ...empty] = items;
  if (before !== 40 || after !== undefined || empty.length !== 0) return 5;
  const bytes = new Uint8Array(1);
  bytes[0] = 3;
  const [byte, missing = 4, ...more] = bytes;
  if (byte !== 3 || missing !== 4 || more.length !== 0) return 6;
  const reader: { read: (arg: {value: number}) => number } = {
    read({value}: {value: number}): number { return value; }
  };
  if (parameter({}) !== 40 || reader.read({value: 2}) !== 2) return 7;
  const pick: (source: { x: number }) => number = ({ x }) => x;
  let sum = 0;
  const rows: { x: number }[] = [{ x: 12 }, { x: 30 }];
  for (const { x } of rows) sum += pick({ x });
  if (sum !== 42) return 8;
  let a: number = 1, b: number = 2;
  [a, b] = [b, a];
  if (a !== 2 || b !== 1) return 9;
  const original = { a: 42 };
  const returned = ({ a } = original);
  if (a !== 42 || returned !== original) return 10;
  const destination = { value: 0 };
  let order = 0;
  function key(): "a" { order = order * 10 + 1; return "a"; }
  function target(): { value: number } { order = order * 10 + 2; return destination; }
  function fallback(): number { order = order * 10 + 3; return 9; }
  const missingValue: { a?: number } = {};
  ({ [key()]: target().value = fallback() } = missingValue);
  if (order !== 123 || destination.value !== 9) return 11;
  const counts = new Map<string, number>();
  counts.set("answer", 42);
  for (const [key, count] of counts) {
    if (key !== "answer" || count !== 42) return 12;
  }
  const pair = new Uint8Array(2);
  pair[0] = 6;
  pair[1] = 7;
  for (const [first = 1, ...remaining] of [pair]) {
    if (first !== 6 || remaining.length !== 1 || remaining[0] !== 7) return 13;
  }
  return 42;
}
`;

// Tint checks assertions from unknown at runtime. A failed projection must
// leave the annotated destructuring assignment's destination unchanged.
export const typedBindingContractSource = `
export function run(): number {
  let { value }: { value: number } = { value: 42 };
  const invalid: unknown = "wrong";
  try {
    ({ value } = { value: invalid as number });
    return 1;
  } catch (error) {
    if (!(error instanceof TypeError) || value !== 42) return 2;
  }
  const absent: unknown = undefined;
  try {
    const [byte] = absent as Uint8Array;
    return 3;
  } catch (error) {
    if (!(error instanceof TypeError)) return 4;
  }
  const nil: unknown = null;
  try {
    const { value: unused } = nil as { value: number };
    return 5;
  } catch (error) {
    if (!(error instanceof TypeError)) return 6;
  }
  return 42;
}
`;

// Observable iterator and getter cases use the existing general realm path.
export const realmBindingPatternsSource = `
export function run() {
  let order = "";
  let closes = 0;
  const source = {
    get x() { order += "x"; return undefined; },
    get y() { order += "y"; return 20; },
    get z() { order += "z"; return 30; }
  };
  const { x = (order += "d", 10), y, ...rest } = source;
  if (order !== "xdyz" || x !== 10 || y !== 20 || rest.z !== 30) return 1;
  const iterable = {
    [Symbol.iterator]() {
      return {
        next() { return { done: false, value: undefined }; },
        return() { ++closes; return { done: true }; }
      };
    }
  };
  const [, first = 42] = iterable;
  if (first !== 42 || closes !== 1) return 2;
  const marker = {};
  function raised() { throw marker; }
  try {
    const [value = raised()] = iterable;
    return 3;
  } catch (error) {
    if (error !== marker || closes !== 2) return 4;
  }
  for (const value of iterable) break;
  if (closes !== 3) return 5;
  try { throw { value: 42 }; } catch ({ value }) {
    if (value !== 42) return 6;
  }
  for (const absent of [null, undefined]) {
    try {
      const {} = absent;
      return 7;
    } catch (error) {
      if (!(error instanceof TypeError)) return 8;
    }
    try {
      const [] = absent;
      return 9;
    } catch (error) {
      if (!(error instanceof TypeError)) return 10;
    }
  }
  return 42;
}
`;
