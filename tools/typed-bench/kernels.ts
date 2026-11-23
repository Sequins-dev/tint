// Typed code-generation kernels (docs/results/typed-codegen-baseline-v1.md).
// Plain typed TypeScript in erasable syntax: Node 26.13.1 runs the stripped
// text and Tint compiles the same text with the general fallback disabled, so
// every measurement is of typed code. Each kernel takes a scale and returns a
// deterministic 32-bit checksum. The file is self-contained: the benchmark
// driver appends its `run()` to this text.
//
// The first five kernels are the Worker benchmark kernels of PR #15
// (tools/worker-bench/kernels.ts at ae24161ab), unchanged, so their results
// compare directly. The rest isolate one language feature area each.

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

// --- Typed arrays: element read/write loops over three element kinds. ---
// (Kept on Uint32Array for comparable history; typedArrayKinds covers the
// signed, clamped and Float32 kinds.)
export function typedArrays(scale: number): number {
  const size = 4096;
  const words = new Uint32Array(size),
    bytes = new Uint8Array(size),
    floats = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    words[i] = i * 7;
    bytes[i] = i & 255;
    floats[i] = i * 0.5;
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < size; i++) words[i] = ((words[i] ?? 0) * 3 + round) | 0;
    for (let i = 1; i < size; i++)
      bytes[i] = ((bytes[i - 1] ?? 0) + (bytes[i] ?? 0)) & 255;
    let sum = 0;
    for (let i = 0; i < size; i++)
      sum += (floats[i] ?? 0) * ((words[i] ?? 0) & 15);
    checksum =
      (checksum +
        (words[round & (size - 1)] ?? 0) +
        (bytes[(round * 7) & (size - 1)] ?? 0) +
        Math.floor(sum)) |
      0;
  }
  return checksum;
}

// --- Typed-array kinds: signed, clamped and Float32 element loops. ---
export function typedArrayKinds(scale: number): number {
  const size = 4096;
  const words = new Int32Array(size),
    bytes = new Int8Array(size),
    halves = new Int16Array(size),
    pixels = new Uint8ClampedArray(size),
    singles = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    words[i] = i * 7 - 9000;
    bytes[i] = i;
    halves[i] = i * 13;
    pixels[i] = i;
    singles[i] = i * 0.25;
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < size; i++) words[i] = ((words[i] ?? 0) * 3 + round) | 0;
    for (let i = 1; i < size; i++)
      bytes[i] = (bytes[i - 1] ?? 0) + (bytes[i] ?? 0);
    for (let i = 0; i < size; i++)
      halves[i] = (halves[i] ?? 0) - (bytes[i] ?? 0) * 5;
    for (let i = 0; i < size; i++) pixels[i] = (pixels[i] ?? 0) * 1.5 - 20.5;
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const single = (singles[i] ?? 0) * 0.999 + 0.5;
      singles[i] = single;
      sum += single * ((words[i] ?? 0) & 15) + (pixels[i] ?? 0);
    }
    checksum =
      (checksum +
        (words[round & (size - 1)] ?? 0) +
        (halves[(round * 7) & (size - 1)] ?? 0) +
        Math.floor(sum)) |
      0;
  }
  return checksum;
}

// --- Typed-array fill: bitmap clears and sets, byte and float patterns. ---
export function typedArrayFill(scale: number): number {
  const words = new Uint32Array(4096),
    bytes = new Uint8Array(16384),
    floats = new Float64Array(2048),
    halves = new Int16Array(4099);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    words.fill(0);
    words.fill(0xffffffff, round & 63, 4096 - (round & 31));
    bytes.fill(round & 255);
    bytes.fill(0, -(round & 1023));
    floats.fill(round * 0.5);
    halves.fill(-round, 3);
    checksum =
      (checksum +
        (words[round & 4095] ?? 0) +
        (bytes[(round * 7) & 16383] ?? 0) +
        (halves[(round * 3) % 4099] ?? 0) +
        Math.floor(floats[round & 2047] ?? 0)) |
      0;
  }
  return checksum;
}

// --- String equality: fresh strings against literals, a switch and a list. ---
const reservedWords: readonly string[] = [
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "enum",
  "await",
];
export function stringEquality(scale: number): number {
  // Split words are fresh strings, so every comparison inspects contents.
  const words: string[] = (
    reservedWords.join(" ") + " alpha beta gamma delta value index result count"
  ).split(" ");
  let hits = 0;
  for (let round = 0; round < scale; round++) {
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      if (word === undefined) throw "word";
      if (word === "function" || word === "return" || word === "const")
        hits += 3;
      else if (word === "alpha") hits += 1;
      switch (word) {
        case "if":
          hits += 2;
          break;
        case "while":
          hits += 5;
          break;
        case "class":
          hits += 7;
          break;
        default:
          break;
      }
      for (let k = (round + w) % 5; k < reservedWords.length; k += 5)
        if (reservedWords[k] === word) hits++;
    }
  }
  return hits | 0;
}

// --- String building: concatenation, templates, conversions, charCodeAt. ---
export function stringBuild(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let text = "";
    for (let i = 0; i < 48; i++) text += `${i}:${round & 15};`;
    let line = "";
    for (let i = 0; i < 24; i++)
      line = line + String.fromCharCode(97 + ((i + round) % 26));
    const label = "round " + round + " of " + scale;
    for (let i = 0; i < text.length; i += 3)
      checksum = (Math.imul(checksum, 31) + text.charCodeAt(i)) | 0;
    checksum =
      (checksum + line.length + label.length + line.charCodeAt(round % 24)) | 0;
  }
  return checksum;
}

// --- Map and Set: string and number keys, hits and misses. ---
export function mapSet(scale: number): number {
  const names: string[] = [];
  for (let i = 0; i < 512; i++) names.push("key" + String(i));
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const counts = new Map<string, number>();
    const seen = new Set<number>();
    for (let i = 0; i < 1024; i++) {
      const name = names[(i * 7 + round) & 511];
      if (name === undefined) throw "name";
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const id = (i * 13 + round) & 1023;
      if (!seen.has(id)) seen.add(id);
    }
    const byId = new Map<number, number>();
    for (let i = 0; i < 512; i++) byId.set(i * 3, i);
    for (let i = 0; i < 1024; i++)
      checksum = (checksum + (byId.get(i) ?? -1)) | 0;
    checksum =
      (checksum + counts.size + seen.size + (counts.get("key7") ?? 0)) | 0;
  }
  return checksum;
}

// --- Closures: captured state, function values and array callbacks. ---
function makeCounter(step: number): () => number {
  let count = 0;
  return () => {
    count += step;
    return count;
  };
}
function applyAll(
  functions: readonly ((value: number) => number)[],
  value: number,
): number {
  let result = value;
  for (const apply of functions) result = apply(result) | 0;
  return result;
}
export function closures(scale: number): number {
  const offset = 3;
  const functions: ((value: number) => number)[] = [
    (value) => value + offset,
    (value) => value * 3,
    (value) => value ^ 0x55,
    (value) => (value >>> 1) + offset,
  ];
  const values: number[] = [];
  for (let i = 0; i < 32; i++) values.push(i * 5);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const counter = makeCounter(round & 7);
    for (let i = 0; i < 16; i++) checksum = (checksum + counter()) | 0;
    checksum = applyAll(functions, checksum + round);
    const factor = round & 3;
    // (No reduce: typed lists lower map and filter but not reduce yet.)
    const even = values
      .map((value) => value * factor)
      .filter((value) => (value & 1) === 0);
    for (const value of even) checksum = (checksum + value) | 0;
  }
  return checksum;
}

// --- Arrays: push, pop, indexed and for-of iteration. ---
interface Item {
  readonly key: number;
  readonly label: string;
}
export function arrays(scale: number): number {
  const labels: string[] = ["a", "bb", "ccc", "dddd"];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const stack: number[] = [];
    for (let i = 0; i < 512; i++) stack.push((i * round) & 1023);
    let sum = 0;
    for (const value of stack) sum += value;
    while (stack.length > 256) sum += stack.pop() ?? 0;
    for (let i = 0; i < stack.length; i++) sum ^= stack[i] ?? 0;
    const items: Item[] = [];
    for (let i = 0; i < 64; i++)
      items.push({ key: i ^ round, label: labels[i & 3] ?? "" });
    for (const item of items) sum += item.key + item.label.length;
    checksum = (checksum + sum) | 0;
  }
  return checksum;
}

// --- Escape: temporaries that die young, and some that escape. ---
interface Point {
  readonly x: number;
  readonly y: number;
}
function addPoints(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}
export function escape(scale: number): number {
  const kept: Point[] = [];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let total: Point = { x: 0, y: 0 };
    for (let i = 0; i < 128; i++) {
      const delta = { x: i & 7, y: (i >> 3) & 7 };
      total = addPoints(total, delta);
    }
    if ((round & 15) === 0) kept.push(total);
    if (kept.length > 64) kept.shift();
    checksum = (checksum + total.x * 3 + total.y) | 0;
  }
  return (checksum + kept.length) | 0;
}
