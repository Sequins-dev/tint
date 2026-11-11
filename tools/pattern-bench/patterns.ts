// Micro-benchmarks of the compiler's dominant source patterns, written once in
// the native subset so Node (type stripping) and tint run identical code.
// Each takes an iteration count and returns a checksum. Self-contained: the
// native harness compiles this file's text as a single module.

export function typedSum(n: number): number {
  const words = new Uint32Array(1024);
  for (let i = 0; i < 1024; i++) words[i] = (i * 2654435761) >>> 0;
  let total = 0;
  for (let round = 0; round < n; round++)
    for (let i = 0; i < 1024; i++) total = (total + (words[i] ?? 0)) >>> 0;
  return total;
}

export function arrayPushRead(n: number): number {
  let total = 0;
  for (let round = 0; round < n; round++) {
    const values: number[] = [];
    for (let i = 0; i < 1024; i++) values.push(i + round);
    for (let i = 0; i < 1024; i++) {
      const value = values[i];
      if (value === undefined) throw "missing";
      total = (total + value) | 0;
    }
  }
  return total;
}

interface Token {
  readonly kind: "name" | "number" | "punct";
  readonly start: number;
  readonly end: number;
}

export function recordAllocate(n: number): number {
  let total = 0;
  for (let round = 0; round < n; round++) {
    const tokens: Token[] = [];
    for (let i = 0; i < 1024; i++)
      tokens.push({
        kind: i % 3 === 0 ? "name" : i % 3 === 1 ? "number" : "punct",
        start: i,
        end: i + 3,
      });
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === undefined) throw "missing";
      total = (total + token.end - token.start) | 0;
    }
  }
  return total;
}

interface Span {
  readonly start: number;
  readonly end: number;
}
function span(start: number, end: number): Span {
  return { start, end };
}
function width(value: Span): number {
  return value.end - value.start;
}
export function temporaryRecord(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + width(span(i, i + 7))) | 0;
  return total;
}

interface Node {
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly value: number;
}
export function spreadCopy(n: number): number {
  const base: Node = { kind: "literal", start: 1, end: 9, value: 0 };
  let total = 0;
  for (let i = 0; i < n; i++) {
    const copy: Node = { ...base, value: i };
    total = (total + copy.value + copy.end) | 0;
  }
  return total;
}

interface Counter {
  readonly next: () => number;
  readonly count: () => number;
}
function createCounter(): Counter {
  let current = 0;
  const seen: number[] = [];
  function next(): number {
    current++;
    if (current % 64 === 0) seen.push(current);
    return current;
  }
  return { next, count: () => seen.length };
}
export function closureCalls(n: number): number {
  const counter = createCounter();
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + counter.next()) | 0;
  return (total + counter.count()) | 0;
}

export function mapNumbers(n: number): number {
  const map = new Map<number, number>();
  let total = 0;
  for (let round = 0; round < n; round++) {
    for (let i = 0; i < 256; i++) map.set(i * 7 + round, i);
    for (let i = 0; i < 256; i++)
      total = (total + (map.get(i * 7 + round) ?? 0)) | 0;
    map.clear();
  }
  return total;
}

export function mapStrings(n: number): number {
  const names: string[] = [];
  for (let i = 0; i < 256; i++) names.push("identifier_" + i);
  const map = new Map<string, number>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name !== undefined) map.set(name, i);
  }
  let total = 0;
  for (let round = 0; round < n; round++)
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (name === undefined) throw "missing";
      total = (total + (map.get(name) ?? 0)) | 0;
    }
  return total;
}

type Expression =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "add"; readonly left: number; readonly right: number }
  | { readonly kind: "negate"; readonly operand: number };
export function switchKind(n: number): number {
  const nodes: Expression[] = [];
  for (let i = 0; i < 1024; i++)
    nodes.push(
      i % 3 === 0
        ? { kind: "number", value: i }
        : i % 3 === 1
          ? { kind: "add", left: i, right: 2 }
          : { kind: "negate", operand: i },
    );
  let total = 0;
  for (let round = 0; round < n; round++)
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node === undefined) throw "missing";
      switch (node.kind) {
        case "number":
          total += node.value;
          break;
        case "add":
          total += node.left + node.right;
          break;
        case "negate":
          total -= node.operand;
          break;
      }
      total |= 0;
    }
  return total;
}

export function stringScan(n: number): number {
  let text = "";
  for (let i = 0; i < 1024; i++) text += String.fromCharCode(97 + (i % 26));
  let total = 0;
  for (let round = 0; round < n; round++)
    for (let i = 0; i < text.length; i++)
      total = (total * 31 + text.charCodeAt(i)) >>> 0;
  return total;
}

function mix(a: number, b: number): number {
  return (a * 31 + b) | 0;
}
export function directCalls(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total = mix(total, i);
  return total;
}

export function modulo(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + i * 7) % 1000003;
  return total;
}

function rotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
/** SHA-256 compression (the foundation's compressWords): uint32 rounds over
 * typed arrays with an inlined rotate helper. */
function compressWords(
  state: Uint32Array,
  schedule: Uint32Array,
  constants: Uint32Array,
): void {
  for (let i = 16; i < 64; i++) {
    const x = schedule[i - 15] ?? 0,
      y = schedule[i - 2] ?? 0;
    const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
    const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
    schedule[i] =
      ((schedule[i - 16] ?? 0) + s0 + (schedule[i - 7] ?? 0) + s1) >>> 0;
  }
  let a = state[0] ?? 0,
    b = state[1] ?? 0,
    c = state[2] ?? 0,
    d = state[3] ?? 0;
  let e = state[4] ?? 0,
    f = state[5] ?? 0,
    g = state[6] ?? 0,
    h = state[7] ?? 0;
  for (let i = 0; i < 64; i++) {
    const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
    const choose = (e & f) ^ (~e & g);
    const t1 =
      (h + s1 + choose + (constants[i] ?? 0) + (schedule[i] ?? 0)) >>> 0;
    const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (s0 + majority) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  state[0] = ((state[0] ?? 0) + a) >>> 0;
  state[1] = ((state[1] ?? 0) + b) >>> 0;
  state[2] = ((state[2] ?? 0) + c) >>> 0;
  state[3] = ((state[3] ?? 0) + d) >>> 0;
  state[4] = ((state[4] ?? 0) + e) >>> 0;
  state[5] = ((state[5] ?? 0) + f) >>> 0;
  state[6] = ((state[6] ?? 0) + g) >>> 0;
  state[7] = ((state[7] ?? 0) + h) >>> 0;
}

export function sha256(n: number): number {
  const state = new Uint32Array(8),
    schedule = new Uint32Array(64),
    constants = new Uint32Array(64);
  for (let i = 0; i < 64; i++) constants[i] = (i * 0x9e3779b9) >>> 0;
  for (let round = 0; round < n; round++) {
    for (let i = 0; i < 16; i++) schedule[i] = (round * 31 + i) >>> 0;
    compressWords(state, schedule, constants);
  }
  return state[0] ?? 0;
}

export function none(n: number): number {
  return n;
}
