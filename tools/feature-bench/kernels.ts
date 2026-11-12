// Feature benchmark kernels: realistic workloads, one per language feature
// area, written once in the native subset so Node (type stripping) and tint
// run identical code. Each takes a scale and returns a deterministic
// checksum. Self-contained: the native harness compiles this file's text as
// a single module. Typed classes, generators and destructuring patterns are
// not yet in the native subset; add kernels for them when they lower natively.

// --- Records and discriminated unions: an expression-tree interpreter. ---
type Expr =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "var"; readonly slot: number }
  | {
      readonly kind: "add" | "sub" | "mul";
      readonly left: Expr;
      readonly right: Expr;
    }
  | {
      readonly kind: "if";
      readonly test: Expr;
      readonly then: Expr;
      readonly otherwise: Expr;
    };
function buildExpr(seed: number, depth: number): Expr {
  if (depth === 0)
    return seed % 3 === 0
      ? { kind: "var", slot: seed % 4 }
      : { kind: "num", value: seed % 17 };
  const next = (seed * 1103515245 + 12345) >>> 0;
  const left = buildExpr(next >>> 3, depth - 1),
    right = buildExpr(next >>> 7, depth - 1);
  switch (next % 4) {
    case 0:
      return { kind: "add", left, right };
    case 1:
      return { kind: "sub", left, right };
    case 2:
      return { kind: "mul", left, right };
    default:
      return { kind: "if", test: left, then: right, otherwise: left };
  }
}
function evaluate(expr: Expr, slots: Float64Array): number {
  switch (expr.kind) {
    case "num":
      return expr.value;
    case "var":
      return slots[expr.slot] ?? 0;
    case "add":
      return (evaluate(expr.left, slots) + evaluate(expr.right, slots)) | 0;
    case "sub":
      return (evaluate(expr.left, slots) - evaluate(expr.right, slots)) | 0;
    case "mul":
      return Math.imul(evaluate(expr.left, slots), evaluate(expr.right, slots));
    case "if":
      return evaluate(expr.test, slots) % 2 === 0
        ? evaluate(expr.then, slots)
        : evaluate(expr.otherwise, slots);
  }
  throw "unknown expression";
}
export function interpreter(scale: number): number {
  const trees: Expr[] = [];
  for (let i = 0; i < 64; i++) trees.push(buildExpr(i * 7919 + 1, 10));
  const slots = new Float64Array(4);
  let total = 0;
  for (let round = 0; round < scale; round++) {
    slots[0] = round;
    slots[1] = round * 3;
    slots[2] = round ^ 5;
    slots[3] = 7;
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      if (tree === undefined) throw "tree";
      total = (total + evaluate(tree, slots)) | 0;
    }
  }
  return total;
}

// --- Records: construction, field access and updates (particles). ---
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly mass: number;
}
export function records(scale: number): number {
  const particles: Particle[] = [];
  for (let i = 0; i < 2048; i++)
    particles.push({
      x: i % 97,
      y: (i * 31) % 89,
      vx: ((i % 7) - 3) * 0.25,
      vy: ((i % 5) - 2) * 0.5,
      mass: 1 + (i % 4),
    });
  let energy = 0;
  for (let step = 0; step < scale; step++) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p === undefined) throw "particle";
      p.vy = p.vy - 0.01 * p.mass;
      p.x = p.x + p.vx;
      p.y = p.y + p.vy;
      if (p.y < 0) {
        p.y = -p.y;
        p.vy = -p.vy * 0.9;
      }
      if (p.x < 0 || p.x > 100) p.vx = -p.vx;
    }
    // Allocate fresh summary records each step (short-lived objects).
    const summary = { left: 0, right: 0 };
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p === undefined) throw "particle";
      if (p.x < 50) summary.left++;
      else summary.right++;
    }
    energy = (energy + summary.left * 3 + summary.right) | 0;
  }
  let sum = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p !== undefined) sum += p.x + p.y * 2;
  }
  return (energy + Math.floor(sum)) | 0;
}

// --- Closures: captured state, callbacks and memoization. ---
interface Counter {
  readonly next: () => number;
  readonly add: (amount: number) => void;
}
function makeCounter(start: number): Counter {
  const state = { value: start };
  return {
    next: () => {
      state.value = (state.value * 1664525 + 1013904223) >>> 0;
      return state.value;
    },
    add: (amount: number) => {
      state.value = (state.value + amount) >>> 0;
    },
  };
}
function applyTwice(f: (x: number) => number, x: number): number {
  return f(f(x));
}
export function closures(scale: number): number {
  const counters: Counter[] = [];
  for (let i = 0; i < 32; i++) counters.push(makeCounter(i));
  const memo = new Map<number, number>();
  const fib: (n: number) => number = (n) => {
    if (n < 2) return n;
    const known = memo.get(n);
    if (known !== undefined) return known;
    const value = (fib(n - 1) + fib(n - 2)) % 1000003;
    memo.set(n, value);
    return value;
  };
  let total = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < counters.length; i++) {
      const counter = counters[i];
      if (counter === undefined) throw "counter";
      const value = counter.next();
      counter.add(round & 15);
      const offset = round & 7;
      total = (total + applyTwice((x) => (x * 3 + offset) | 0, value)) | 0;
    }
    if (round % 64 === 0) {
      memo.clear();
      total = (total + fib(200 + (round % 50))) | 0;
    }
  }
  return total;
}

// --- Iterator chains: map/filter/find/some/every and for-of. ---
interface Order {
  readonly id: number;
  readonly price: number;
  readonly quantity: number;
  readonly region: "north" | "south" | "east" | "west";
}
export function pipelines(scale: number): number {
  const regions: ("north" | "south" | "east" | "west")[] = [
    "north",
    "south",
    "east",
    "west",
  ];
  const orders: Order[] = [];
  for (let i = 0; i < 4096; i++)
    orders.push({
      id: i,
      price: (i * 37) % 500,
      quantity: 1 + (i % 9),
      region: regions[i % 4] ?? "north",
    });
  let total = 0;
  for (let round = 0; round < scale; round++) {
    const threshold = 100 + (round % 300);
    const large = orders
      .filter((order) => order.price * order.quantity > threshold)
      .map((order) => order.price * order.quantity);
    let sum = 0;
    for (const value of large) sum += value ?? 0;
    const north = orders.filter((order) => order.region === "north").length;
    const found = orders.find(
      (order) => order !== undefined && order.price === threshold % 500,
    );
    const any = orders.some((order) => order.quantity > 8);
    const all = orders.every((order) => order.price >= 0);
    total =
      (total +
        (sum % 100000) +
        north +
        (found === undefined ? 0 : found.id) +
        (any ? 1 : 0) +
        (all ? 2 : 0)) |
      0;
  }
  return total;
}

// --- Maps and sets: word frequencies and graph search. ---
export function collections(scale: number): number {
  const words: string[] = [];
  for (let i = 0; i < 2000; i++) words.push("w" + ((i * 7919) % 613));
  let total = 0;
  for (let round = 0; round < scale; round++) {
    const counts = new Map<string, number>();
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word === undefined) throw "word";
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    total = (total + counts.size + (counts.get("w" + (round % 613)) ?? 0)) | 0;
    // Breadth-first search over an implicit graph with a visited set.
    const seen = new Set<number>();
    const queue: number[] = [round % 1000];
    seen.add(round % 1000);
    let head = 0;
    while (head < queue.length && head < 600) {
      const node = queue[head++];
      if (node === undefined) throw "node";
      const a = (node * 3 + 1) % 1000,
        b = (node * 7 + 5) % 1000;
      if (!seen.has(a)) {
        seen.add(a);
        queue.push(a);
      }
      if (!seen.has(b)) {
        seen.add(b);
        queue.push(b);
      }
    }
    total = (total + seen.size) | 0;
  }
  return total;
}

// --- Strings: tokenizing, slicing, building and comparison. ---
export function strings(scale: number): number {
  let source = "";
  for (let i = 0; i < 400; i++)
    source += "let x" + (i % 37) + " = " + ((i * 13) % 1000) + ";\n";
  let total = 0;
  for (let round = 0; round < scale; round++) {
    let identifiers = 0,
      numbers = 0,
      start = 0;
    const out: string[] = [];
    for (let i = 0; i <= source.length; i++) {
      const code = i < source.length ? source.charCodeAt(i) : 32;
      const word =
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 95;
      if (!word) {
        if (i > start) {
          const token = source.slice(start, i);
          const first = token.charCodeAt(0);
          if (first >= 48 && first <= 57) numbers += token.length;
          else {
            identifiers++;
            if (token === "let") out.push(token);
          }
        }
        start = i + 1;
      }
    }
    const joined = out.join(",");
    total = (total + identifiers + numbers + joined.length + round) | 0;
  }
  return total;
}

// --- Numeric loops and typed arrays: matrix multiply and a sieve. ---
export function numeric(scale: number): number {
  const n = 48;
  const a = new Float64Array(n * n),
    b = new Float64Array(n * n),
    c = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    a[i] = (i % 13) * 0.5;
    b[i] = (i % 7) - 3;
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++)
          sum += (a[i * n + k] ?? 0) * (b[k * n + j] ?? 0);
        c[i * n + j] = sum;
      }
    checksum = (checksum + Math.floor(c[(round * 7) % (n * n)] ?? 0)) | 0;
    const limit = 20000;
    const composite = new Uint8Array(limit);
    let primes = 0;
    for (let p = 2; p < limit; p++) {
      if (composite[p] !== 0) continue;
      primes++;
      for (let m = p * p; m < limit; m += p) composite[m] = 1;
    }
    checksum = (checksum + primes) | 0;
  }
  return checksum;
}

// --- Recursion: building and folding binary trees. ---
interface TreeNode {
  readonly value: number;
  readonly left: TreeNode | undefined;
  readonly right: TreeNode | undefined;
}
function makeTree(depth: number, seed: number): TreeNode {
  return {
    value: seed,
    left: depth === 0 ? undefined : makeTree(depth - 1, (seed * 2) % 1009),
    right: depth === 0 ? undefined : makeTree(depth - 1, (seed * 2 + 1) % 1009),
  };
}
function foldTree(node: TreeNode | undefined): number {
  if (node === undefined) return 0;
  return (node.value + foldTree(node.left) * 3 + foldTree(node.right)) | 0;
}
export function recursion(scale: number): number {
  let total = 0;
  for (let round = 0; round < scale; round++)
    total = (total + foldTree(makeTree(12, round % 1009))) | 0;
  return total;
}

// --- Exceptions: throwing and catching inside loops. ---
function parseDigit(code: number): number {
  if (code < 48 || code > 57) throw "not a digit";
  return code - 48;
}
export function exceptions(scale: number): number {
  const text = "12a45b78c9d0e12f";
  let total = 0,
    failures = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < text.length; i++) {
      try {
        total = (total + parseDigit(text.charCodeAt(i)) * (round & 7)) | 0;
      } catch {
        failures++;
      } finally {
        total = (total + 1) | 0;
      }
    }
  }
  return (total + failures) | 0;
}

// --- Optional values: optional chaining and nullish defaults. ---
interface Config {
  readonly name: string;
  readonly limits?: { readonly low?: number; readonly high?: number };
  readonly tags?: string[];
}
export function optionals(scale: number): number {
  const configs: Config[] = [];
  for (let i = 0; i < 512; i++)
    configs.push(
      i % 3 === 0
        ? { name: "c" + i }
        : i % 3 === 1
          ? { name: "c" + i, limits: { low: i % 10 } }
          : { name: "c" + i, limits: { low: 1, high: i }, tags: ["a", "b"] },
    );
  let total = 0;
  for (let round = 0; round < scale; round++)
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      if (config === undefined) throw "config";
      const low = config.limits?.low ?? 0,
        high = config.limits?.high ?? 100;
      // Typed binding patterns (destructuring) are not native yet.
      const name = config.name;
      total =
        (total +
          low +
          high +
          name.length +
          (config.tags?.length ?? 0) +
          round) |
        0;
    }
  return total;
}

// --- Sorting with comparators. ---
export function sorting(scale: number): number {
  let total = 0;
  for (let round = 0; round < scale; round++) {
    const values: number[] = [];
    for (let i = 0; i < 2000; i++)
      values.push(((i + round) * 2654435761) % 10007);
    values.sort((a, b) => a - b);
    const keyed: { readonly key: number; readonly label: string }[] = [];
    for (let i = 0; i < 300; i++)
      keyed.push({ key: (i * 7 + round) % 97, label: "k" + i });
    keyed.sort((a, b) => a.key - b.key || (a.label < b.label ? -1 : 1));
    total =
      (total + (values[round % 2000] ?? 0) + (keyed[round % 300]?.key ?? 0)) |
      0;
  }
  return total;
}

// --- Serialization: recursive JSON-like encoding with string building. ---
type Value =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "list"; readonly items: Value[] }
  | {
      readonly kind: "object";
      readonly keys: string[];
      readonly values: Value[];
    };
function buildValue(depth: number, seed: number): Value {
  if (depth === 0)
    return seed % 2 === 0
      ? { kind: "number", value: seed % 1000 }
      : { kind: "string", value: "s" + (seed % 97) };
  const items: Value[] = [];
  const keys: string[] = [];
  for (let i = 0; i < 4; i++) {
    items.push(buildValue(depth - 1, seed * 4 + i));
    keys.push("k" + i);
  }
  return seed % 3 === 0
    ? { kind: "list", items }
    : { kind: "object", keys, values: items };
}
function encode(value: Value, out: string[]): void {
  switch (value.kind) {
    case "number":
      out.push(String(value.value));
      return;
    case "string":
      out.push('"' + value.value + '"');
      return;
    case "list":
      out.push("[");
      for (let i = 0; i < value.items.length; i++) {
        if (i > 0) out.push(",");
        const item = value.items[i];
        if (item !== undefined) encode(item, out);
      }
      out.push("]");
      return;
    case "object":
      out.push("{");
      for (let i = 0; i < value.keys.length; i++) {
        if (i > 0) out.push(",");
        out.push('"' + (value.keys[i] ?? "") + '":');
        const item = value.values[i];
        if (item !== undefined) encode(item, out);
      }
      out.push("}");
  }
}
export function serialization(scale: number): number {
  const document = buildValue(5, 1);
  let total = 0;
  for (let round = 0; round < scale; round++) {
    const out: string[] = [];
    encode(document, out);
    const text = out.join("");
    total = (total + text.length + text.charCodeAt(round % text.length)) | 0;
  }
  return total;
}

export function none(scale: number): number {
  return scale;
}
