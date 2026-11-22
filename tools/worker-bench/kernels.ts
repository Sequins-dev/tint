// Worker-performance CPU kernels (docs/results/worker-runtime-baseline-v1.md).
// The same text runs in a program without Workers, on the main thread of a
// program that starts Workers, and inside a Worker, natively and under Node
// (type stripping). Each kernel takes a scale and returns a deterministic
// 32-bit checksum. The file is self-contained and uses erasable syntax only.

// --- Allocation: short-lived records and arrays with a surviving window. ---
interface Cell {
  readonly id: number;
  value: number;
  readonly tags: number[];
}
export function allocation(scale: number): number {
  // Survivors: a rolling window of batches, so collections see a live set.
  const window: Cell[][] = [];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const batch: Cell[] = [];
    for (let i = 0; i < 256; i++) {
      const tags: number[] = [i & 7, (i * 3) & 15, round & 31];
      batch.push({ id: round * 256 + i, value: (i * 2654435761) >>> 16, tags });
    }
    for (let i = 0; i < batch.length; i++) {
      const cell = batch[i];
      if (cell === undefined) throw "cell";
      const pair = { left: cell.value & 255, right: cell.id & 255 };
      cell.value = (cell.value + pair.left * pair.right) | 0;
      checksum = (checksum + cell.value + (cell.tags[1] ?? 0)) | 0;
    }
    window.push(batch);
    if (window.length > 32) window.shift();
  }
  for (let i = 0; i < window.length; i++) {
    const batch = window[i];
    if (batch === undefined) throw "batch";
    checksum = (checksum + batch.length) | 0;
  }
  return checksum;
}

// --- Numeric: allocation-free integer and floating-point loops. ---
export function numeric(scale: number): number {
  const field = new Float64Array(1024);
  for (let i = 0; i < field.length; i++) field[i] = (i % 17) * 0.125;
  let hash = 0;
  for (let round = 0; round < scale; round++) {
    let acc = 0;
    for (let i = 1; i < field.length - 1; i++) {
      const left = field[i - 1] ?? 0,
        middle = field[i] ?? 0,
        right = field[i + 1] ?? 0;
      const next = (left + middle * 2 + right) * 0.25;
      field[i] = next;
      acc += next;
    }
    let x = round | 0;
    for (let i = 0; i < 512; i++) {
      x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
      x = (x ^ (x >>> 12)) | 0;
    }
    hash = (Math.imul(hash, 31) + x + Math.floor(acc)) | 0;
  }
  return hash;
}

// --- Calls: small functions over records (inlining candidates). ---
interface Vector {
  readonly x: number;
  readonly y: number;
}
function dot(a: Vector, b: Vector): number {
  return a.x * b.x + a.y * b.y;
}
function scaled(a: Vector, factor: number): number {
  return a.x * factor - a.y;
}
function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
export function calls(scale: number): number {
  const points: Vector[] = [];
  for (let i = 0; i < 512; i++) points.push({ x: i % 13, y: (i * 7) % 11 });
  let total = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (a === undefined || b === undefined) throw "point";
      total = (total + clamp(dot(a, b) + scaled(b, round & 7), -64, 64)) | 0;
    }
  }
  return total;
}

// --- Strings: building, slicing and character scans. ---
export function strings(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const parts: string[] = [];
    for (let i = 0; i < 64; i++)
      parts.push("item" + String(round + i) + ":" + String((i * 7) % 10));
    const joined = parts.join(",");
    let text = "";
    for (let i = 0; i < 16; i++) text += joined.slice(i * 8, i * 8 + 6);
    for (let i = 0; i < text.length; i++)
      checksum = (Math.imul(checksum, 33) + text.charCodeAt(i)) | 0;
    checksum = (checksum + joined.indexOf("item" + String(round + 32))) | 0;
  }
  return checksum;
}

// --- Compiler-like: tokens, syntax records and scoped Map lookups. ---
interface Token {
  readonly kind: number; // 0 identifier, 1 number, 2 punctuation
  readonly text: string;
  readonly start: number;
}
interface Node {
  readonly kind: number; // 0 declaration, 1 reference, 2 literal
  readonly name: string;
  readonly value: number;
  readonly start: number;
}
interface SymbolRecord {
  readonly name: string;
  readonly declaration: number;
  uses: number;
}
const sourceWords: readonly string[] = [
  "let",
  "alpha",
  "=",
  "1",
  ";",
  "let",
  "beta",
  "=",
  "alpha",
  ";",
  "gamma",
  "=",
  "beta",
  ";",
  "let",
  "delta",
  "=",
  "42",
  ";",
  "alpha",
  "=",
  "delta",
  ";",
];
function compilerSource(copies: number): string {
  const lines: string[] = [];
  for (let copy = 0; copy < copies; copy++)
    for (let i = 0; i < sourceWords.length; i++) {
      const word = sourceWords[i];
      if (word === undefined) throw "word";
      lines.push(
        word === "alpha" || word === "beta" || word === "delta"
          ? word + String(copy % 8)
          : word,
      );
    }
  return lines.join(" ");
}
function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}
function isLetter(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 32) {
      i++;
      continue;
    }
    const start = i;
    if (isLetter(code)) {
      while (
        i < text.length &&
        (isLetter(text.charCodeAt(i)) || isDigit(text.charCodeAt(i)))
      )
        i++;
      tokens.push({ kind: 0, text: text.slice(start, i), start });
    } else if (isDigit(code)) {
      while (i < text.length && isDigit(text.charCodeAt(i))) i++;
      tokens.push({ kind: 1, text: text.slice(start, i), start });
    } else {
      i++;
      tokens.push({ kind: 2, text: text.slice(start, i), start });
    }
  }
  return tokens;
}
function parse(tokens: readonly Token[]): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) throw "token";
    if (token.kind === 0 && token.text === "let") {
      const name = tokens[i + 1];
      if (name === undefined) throw "declaration";
      nodes.push({ kind: 0, name: name.text, value: 0, start: name.start });
      i++;
    } else if (token.kind === 0)
      nodes.push({ kind: 1, name: token.text, value: 0, start: token.start });
    else if (token.kind === 1)
      nodes.push({
        kind: 2,
        name: "",
        value: Number(token.text),
        start: token.start,
      });
  }
  return nodes;
}
interface Scope {
  readonly symbols: Map<string, SymbolRecord>;
  readonly parent: Scope | undefined;
}
function bind(nodes: readonly Node[]): number {
  let scope: Scope = {
    symbols: new Map<string, SymbolRecord>(),
    parent: undefined,
  };
  const declared: SymbolRecord[] = [];
  let unresolved = 0,
    literals = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node === undefined) throw "node";
    if (i % 46 === 0)
      scope = { symbols: new Map<string, SymbolRecord>(), parent: scope };
    if (node.kind === 0) {
      const symbol: SymbolRecord = { name: node.name, declaration: i, uses: 0 };
      scope.symbols.set(node.name, symbol);
      declared.push(symbol);
    } else if (node.kind === 1) {
      let found: SymbolRecord | undefined = undefined;
      let search: Scope | undefined = scope;
      while (search !== undefined && found === undefined) {
        found = search.symbols.get(node.name);
        search = search.parent;
      }
      if (found === undefined) unresolved++;
      else found.uses++;
    } else literals = (literals + node.value) | 0;
  }
  let uses = 0;
  for (let i = 0; i < declared.length; i++) {
    const symbol = declared[i];
    if (symbol === undefined) throw "symbol";
    uses = (uses + symbol.uses * (symbol.declaration & 15)) | 0;
  }
  return (uses * 7 + unresolved * 3 + literals) | 0;
}
export function compiler(scale: number): number {
  const text = compilerSource(64);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const tokens = tokenize(text);
    const nodes = parse(tokens);
    checksum = (checksum + bind(nodes) + tokens.length + round) | 0;
  }
  return checksum;
}

/** Kernel names in run order. */
export const kernelNames: readonly string[] = [
  "allocation",
  "numeric",
  "calls",
  "strings",
  "compiler",
];
/** Scales calibrated to roughly 50–150 ms per iteration under Node 26. */
export function kernelScale(name: string): number {
  if (name === "allocation") return 2000;
  if (name === "numeric") return 4000;
  if (name === "calls") return 20000;
  if (name === "strings") return 6000;
  if (name === "compiler") return 200;
  throw "unknown kernel " + name;
}
export function runKernel(name: string, scale: number): number {
  if (name === "allocation") return allocation(scale);
  if (name === "numeric") return numeric(scale);
  if (name === "calls") return calls(scale);
  if (name === "strings") return strings(scale);
  if (name === "compiler") return compiler(scale);
  throw "unknown kernel " + name;
}
