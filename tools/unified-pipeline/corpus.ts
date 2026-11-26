// Construct corpus for the unified typed/untyped pipeline (docs/unified-pipeline.md).
// Every construct has a typed form (annotated TypeScript) and an untyped form
// (the same program as plain JavaScript). Each form is a module whose
// `run()` returns 42 when its checks hold. The ledger
// (tools/unified-pipeline/ledger.ts) records which forms compile on the typed
// path and which reach the general fallback; the Node reference test runs
// both forms under Node.
//
// Typing rule (docs/unified-pipeline.md, "Contracts and speculation"): a
// written annotation is an enforced contract, so a foreign write through any
// path throws a TypeError; a slot whose type is only inferred is open and
// accepts any value. Type-erased execution (Node) ignores contracts, so the
// constructs that pin a contract declare a different Node result.

import { nativeCallablePropertySource } from "../slice2b-view-fixtures.ts";
import {
  nestedCaptureSource,
  nestedContractSource,
} from "../slice3-nested-fixture-source.ts";

export interface Construct {
  readonly name: string;
  readonly typed: string;
  readonly untyped: string;
  /** Source modules the forms import as "./<file>". */
  readonly helpers?: Readonly<Record<string, string>>;
  readonly helperImports?: Readonly<Record<string, readonly string[]>>;
  /** Prelinked worker entry modules the program starts by filename. */
  readonly workers?: readonly string[];
  /** Node's result where Tint's semantics intentionally differ from
   * type-erased execution (enforced annotations); otherwise 42. */
  readonly node?: { readonly typed?: number; readonly untyped?: number };
  /** The typed form is ill-typed under the program's compiler options and
   * must be rejected at compile time, exactly as tsc reports it. */
  readonly typedError?: string;
  /** Compiler options the forms assume (Tint's defaults follow the
   * workspace tsconfig, which sets noUncheckedIndexedAccess). */
  readonly options?: { readonly noUncheckedIndexedAccess?: boolean };
}

/** An untyped module through which forms write and call foreign values. */
const untypedHelper = {
  "untyped.ts": `export function write(target, key, value) { target[key] = value; }
export function call(fn, value) { return fn(value); }
`,
};

export const constructs: readonly Construct[] = [
  {
    name: "worker-construction",
    workers: ["peer.ts"],
    helpers: {
      "peer.ts": `import { parentPort, workerData } from "node:worker_threads";
const port = parentPort;
if (port === null || typeof workerData !== "number") throw "invalid worker context";
port.once("message", (value) => {
  port.postMessage(workerData + value);
  port.close();
});`,
    },
    typed: `import { Worker } from "node:worker_threads";
const worker: Worker = new Worker("./worker-construction/peer.ts", { workerData: 41 });
export function run(): number {
  if (worker.threadId <= 0) return 1;
  let received: boolean = false;
  worker.once("message", (value: unknown): void => {
    if (value !== 42) throw "wrong worker response";
    received = true;
  });
  worker.once("exit", (status: unknown): void => {
    if (status !== 0 || !received || worker.threadId !== -1) throw "unexpected worker exit";
  });
  worker.postMessage(1);
  return 42;
}`,
    untyped: `import { Worker } from "node:worker_threads";
const worker = new Worker("./worker-construction/peer.ts", { workerData: 41 });
export function run() {
  if (worker.threadId <= 0) return 1;
  let received = false;
  worker.once("message", (value) => {
    if (value !== 42) throw "wrong worker response";
    received = true;
  });
  worker.once("exit", (status) => {
    if (status !== 0 || !received || worker.threadId !== -1) throw "unexpected worker exit";
  });
  worker.postMessage(1);
  return 42;
}`,
  },
  {
    name: "numeric-loop",
    typed: `export function run(): number {
  let total = 0;
  for (let i = 0; i < 10; i++) total += i * 2;
  let n = 7, steps = 0;
  while (n !== 1) { n = n % 2 === 0 ? n / 2 : 3 * n + 1; steps++; }
  return total === 90 && steps === 16 ? 42 : 1;
}`,
    untyped: `export function run() {
  let total = 0;
  for (let i = 0; i < 10; i++) total += i * 2;
  let n = 7, steps = 0;
  while (n !== 1) { n = n % 2 === 0 ? n / 2 : 3 * n + 1; steps++; }
  return total === 90 && steps === 16 ? 42 : 1;
}`,
  },
  {
    name: "string-methods",
    typed: `export function run(): number {
  const text: string = "Hello, World";
  const lower = text.toLowerCase();
  const parts = text.split(", ");
  const joined = \`\${parts[1]}-\${parts[0]}\`;
  return lower === "hello, world" && text.indexOf("World") === 7 &&
    text.slice(0, 5) === "Hello" && joined === "World-Hello" ? 42 : 1;
}`,
    untyped: `export function run() {
  const text = "Hello, World";
  const lower = text.toLowerCase();
  const parts = text.split(", ");
  const joined = \`\${parts[1]}-\${parts[0]}\`;
  return lower === "hello, world" && text.indexOf("World") === 7 &&
    text.slice(0, 5) === "Hello" && joined === "World-Hello" ? 42 : 1;
}`,
  },
  {
    name: "array-callbacks",
    typed: `export function run(): number {
  const values: number[] = [1, 2, 3, 4, 5, 6];
  const doubled = values.filter((v: number) => v % 2 === 0).map((v: number) => v * 2);
  const sum = values.reduce((a: number, b: number) => a + b, 0);
  return doubled.length === 3 && doubled[2] === 12 && sum === 21 ? 42 : 1;
}`,
    untyped: `export function run() {
  const values = [1, 2, 3, 4, 5, 6];
  const doubled = values.filter((v) => v % 2 === 0).map((v) => v * 2);
  const sum = values.reduce((a, b) => a + b, 0);
  return doubled.length === 3 && doubled[2] === 12 && sum === 21 ? 42 : 1;
}`,
  },
  {
    name: "explicit-dynamic-property-contract",
    node: { typed: 1 },
    typed: `export function run(): number {
  const object: Record<string, number> = { answer: 42 };
  const alias: Record<string, unknown> = object;
  let rejected: boolean = false;
  try { alias.answer = "bad"; } catch (error) { rejected = true; }
  return rejected && object.answer === 42 ? 42 : 1;
}`,
    untyped: `export function run() {
  const object = { answer: 42 };
  const alias = object;
  alias.answer = "open";
  return object.answer === "open" ? 42 : 1;
}`,
  },
  {
    name: "dynamic-object-literal",
    typed: `export function run(): number {
  const key: string = "computed";
  const object: Record<string, number> = { [key]: 42 };
  return object.computed ?? 0;
}`,
    untyped: `export function run() {
  const key = "computed";
  const object = { [key]: 42 };
  return object.computed ?? 0;
}`,
  },
  {
    name: "dynamic-object-index",
    typed: `export function run(): number {
  const object: { [key: string]: number } = {};
  const key: string = "answer";
  object[key] = 42;
  return object[key] ?? 0;
}`,
    untyped: `export function run() {
  const object = {};
  const key = "answer";
  object[key] = 42;
  return object[key] ?? 0;
}`,
  },
  {
    name: "dynamic-object-local-aggregate",
    typed: `export function run(): number {
  const entry: { value: number } = { value: 17 };
  const list = [entry];
  const groups: Record<string, { value: number }[]> = { group: list };
  const alias = groups.group;
  if (alias === undefined || alias !== list) return 1;
  alias.push({ value: 25 });
  return (alias[0]?.value ?? 0) + (list[1]?.value ?? 0);
}`,
    untyped: `export function run() {
  const entry = { value: 17 };
  const list = [entry];
  const groups = { group: list };
  const alias = groups.group;
  if (!Array.isArray(alias) || alias !== list) return 1;
  alias.push({ value: 25 });
  return alias[0].value + list[1].value;
}`,
  },
  {
    name: "dynamic-object-own-data-definition",
    typed: `export function run(): number {
  const groups: Record<string, number[]> = {};
  Object.defineProperty(groups, "__proto__", { value: [42], writable: true, enumerable: true, configurable: true });
  const group = groups["__proto__"];
  return Object.hasOwn(groups, "__proto__") && group !== undefined ? group[0] ?? 0 : 1;
}`,
    untyped: `export function run() {
  const groups = {};
  Object.defineProperty(groups, "__proto__", { value: [42], writable: true, enumerable: true, configurable: true });
  const group = groups["__proto__"];
  return Object.hasOwn(groups, "__proto__") && Object.getPrototypeOf(groups) === Object.prototype ? group[0] : 1;
}`,
  },
  {
    name: "dynamic-object-update",
    typed: `export function run(): number {
  const values: { first: number; [key: string]: number } = { first: 9 };
  const name: "first" = "first";
  if (values[name]++ !== 9 || (values[name] *= 4) !== 40) return 1;
  return (values.last ??= values.first + 2);
}`,
    untyped: `export function run() {
  const values = { first: 9 };
  const name = "first";
  if (values[name]++ !== 9 || (values[name] *= 4) !== 40) return 1;
  return (values.last ??= values.first + 2);
}`,
  },
  {
    name: "dynamic-object-realm-methods",
    typed: `export function run(): number {
  const values: Record<string, number[]> = { first: [20] };
  const items = values.first;
  if (items === undefined || items.unshift(22) !== 2) return 1;
  const copy = items.slice();
  return copy === items ? 2 : (copy.pop() ?? 0) + (copy.shift() ?? 0);
}`,
    untyped: `export function run() {
  const values = { first: [20] };
  const items = values.first;
  if (items === undefined || items.unshift(22) !== 2) return 1;
  const copy = items.slice();
  return copy === items ? 2 : (copy.pop() ?? 0) + (copy.shift() ?? 0);
}`,
  },
  {
    name: "dynamic-object-aggregate-flow",
    typed: `function pass(items: number[]): number[] { return items; }
export function run(): number {
  const list = [40];
  const holder: { items: number[] } = { items: list };
  const choice = list.length === 1 ? pass(holder.items) : [0];
  const work = (): void => { choice.push(2); };
  const record: Record<string, number[]> = { choice };
  work();
  return record.choice === list ? (list[0] ?? 0) + (list[1] ?? 0) : 1;
}`,
    untyped: `function pass(items) { return items; }
export function run() {
  const list = [40];
  const holder = { items: list };
  const choice = list.length === 1 ? pass(holder.items) : [0];
  const work = () => { choice.push(2); };
  const record = { choice };
  work();
  return record.choice === list ? list[0] + list[1] : 1;
}`,
  },
  {
    name: "native-callable-property-views",
    typed: nativeCallablePropertySource,
    untyped: `export function run() {
  let total = 0;
  const increment = (by) => { total += by; return total; };
  const table = {};
  table.first = increment;
  table.second = increment;
  const callable = table.first;
  if (callable !== table.second || typeof callable !== "function") return 1;
  if (callable(38) !== 38) return 2;
  const arrays = { values: [2, 2] };
  const values = arrays.values;
  if (values === undefined) return 3;
  const mapped = values.map(increment);
  return mapped[0] === 40 && mapped[1] === 42 && total === 42 ? 42 : 4;
}`,
  },
  {
    name: "native-storage-keyed-views",
    typed: `export function run(): number {
  const list: number[] = [18];
  const record: { delta: number; label: string } = { delta: 2, label: "live" };
  const table: Record<string, unknown> = { list, record };
  table.listAlias = list;
  table.recordAlias = record;
  list[0] = 20;
  record.delta = 22;
  return table.list === table.listAlias && table.record === table.recordAlias
    ? (list[0] ?? 0) + record.delta : 1;
}`,
    untyped: `export function run() {
  const list = [18];
  const record = { delta: 2, label: "live" };
  const table = { list, record };
  table.listAlias = list;
  table.recordAlias = record;
  list[0] = 20;
  record.delta = 22;
  return table.list === table.listAlias && table.record === table.recordAlias
    ? list[0] + record.delta : 1;
}`,
  },
  {
    name: "dynamic-object-in-delete",
    typed: `export function run(): number {
  const object: Record<string, number> = { key: 1 };
  const name: string = "key";
  return (name in object) && delete object[name] && !(name in object) ? 42 : 1;
}`,
    untyped: `export function run() {
  const object = { key: 1 };
  const name = "key";
  return (name in object) && delete object[name] && !(name in object) ? 42 : 1;
}`,
  },
  {
    name: "dynamic-object-own-enumeration",
    typed: `export function run(): number {
  const object: Record<string, number> = { b: 42, 2: 7 };
  const entry = Object.entries(object)[1];
  return Object.keys(object)[0] === "2" && Object.values(object)[0] === 7 &&
    entry !== undefined && entry[0] === "b" ? entry[1] : 1;
}`,
    untyped: `export function run() {
  const object = { b: 42, 2: 7 };
  const entry = Object.entries(object)[1];
  return Object.keys(object)[0] === "2" && Object.values(object)[0] === 7 &&
    entry !== undefined && entry[0] === "b" ? entry[1] : 1;
}`,
  },
  {
    name: "dynamic-object-for-in",
    typed: `export function run(): number {
  const object: Record<string, number> = { b: 2, 3: 7 };
  let keys: string = "";
  for (const key in object) keys += key;
  return keys === "3b" ? 42 : 1;
}`,
    untyped: `export function run() {
  const object = { b: 2, 3: 7 };
  let keys = "";
  for (const key in object) keys += key;
  return keys === "3b" ? 42 : 1;
}`,
  },
  {
    name: "dynamic-object-spread",
    typed: `export function run(): number {
  const first: Record<string, number> = { answer: 1 };
  const result: Record<string, number> = { ...first, answer: 42 };
  return result.answer ?? 0;
}`,
    untyped: `export function run() {
  const first = { answer: 1 };
  const result = { ...first, answer: 42 };
  return result.answer ?? 0;
}`,
  },
  {
    name: "object-records",
    typed: `interface Point { x: number; y: number; label: string }
function move(p: Point, dx: number): Point { return { x: p.x + dx, y: p.y, label: p.label }; }
export function run(): number {
  const p: Point = { x: 1, y: 2, label: "p" };
  const q = move(p, 3);
  q.y = 10;
  return q.x === 4 && q.y === 10 && p.y === 2 && q.label === "p" ? 42 : 1;
}`,
    untyped: `function move(p, dx) { return { x: p.x + dx, y: p.y, label: p.label }; }
export function run() {
  const p = { x: 1, y: 2, label: "p" };
  const q = move(p, 3);
  q.y = 10;
  return q.x === 4 && q.y === 10 && p.y === 2 && q.label === "p" ? 42 : 1;
}`,
  },
  {
    name: "closures",
    typed: `function counter(start: number): () => number {
  let value = start;
  return (): number => ++value;
}
export function run(): number {
  const next = counter(10);
  next(); next();
  const other = counter(0);
  return next() === 13 && other() === 1 ? 42 : 1;
}`,
    untyped: `function counter(start) {
  let value = start;
  return () => ++value;
}
export function run() {
  const next = counter(10);
  next(); next();
  const other = counter(0);
  return next() === 13 && other() === 1 ? 42 : 1;
}`,
  },
  {
    name: "class-basic",
    typed: `class Account {
  balance: number;
  readonly owner: string;
  constructor(owner: string, balance: number) { this.owner = owner; this.balance = balance; }
  deposit(amount: number): number { this.balance += amount; return this.balance; }
}
export function run(): number {
  const account = new Account("ada", 10);
  account.deposit(5);
  return account.deposit(27) === 42 && account.owner === "ada" ? 42 : 1;
}`,
    untyped: `class Account {
  constructor(owner, balance) { this.owner = owner; this.balance = balance; }
  deposit(amount) { this.balance += amount; return this.balance; }
}
export function run() {
  const account = new Account("ada", 10);
  account.deposit(5);
  return account.deposit(27) === 42 && account.owner === "ada" ? 42 : 1;
}`,
  },
  {
    name: "class-inheritance",
    typed: `class Shape {
  constructor(public name: string) {}
  area(): number { return 0; }
  get description(): string { return this.name + ":" + this.area(); }
}
class Square extends Shape {
  constructor(private side: number) { super("square"); }
  override area(): number { return this.side * this.side; }
}
export function run(): number {
  const shape: Shape = new Square(3);
  return shape.description === "square:9" && shape instanceof Shape ? 42 : 1;
}`,
    untyped: `class Shape {
  constructor(name) { this.name = name; }
  area() { return 0; }
  get description() { return this.name + ":" + this.area(); }
}
class Square extends Shape {
  constructor(side) { super("square"); this.side = side; }
  area() { return this.side * this.side; }
}
export function run() {
  const shape = new Square(3);
  return shape.description === "square:9" && shape instanceof Shape ? 42 : 1;
}`,
  },
  {
    name: "class-private-static",
    typed: `class Ids {
  static #next: number = 0;
  static created: number;
  static { Ids.created = 0; }
  #id: number;
  constructor() { this.#id = ++Ids.#next; Ids.created++; }
  get id(): number { return this.#id; }
}
export function run(): number {
  new Ids();
  const second = new Ids();
  return second.id === 2 && Ids.created === 2 ? 42 : 1;
}`,
    untyped: `class Ids {
  static #next = 0;
  static created;
  static { Ids.created = 0; }
  #id;
  constructor() { this.#id = ++Ids.#next; Ids.created++; }
  get id() { return this.#id; }
}
export function run() {
  new Ids();
  const second = new Ids();
  return second.id === 2 && Ids.created === 2 ? 42 : 1;
}`,
  },
  {
    name: "destructuring",
    typed: `export function run(): number {
  const { a, b: renamed = 5, ...others }: { a: number; b?: number; c: number; d: number } = { a: 1, c: 3, d: 4 };
  const [first, , third = 30, ...tail]: (number | undefined)[] = [10, 20, undefined, 40, 50];
  return a === 1 && renamed === 5 && others.c + others.d === 7 &&
    first === 10 && third === 30 && tail.length === 2 ? 42 : 1;
}`,
    untyped: `export function run() {
  const { a, b: renamed = 5, ...others } = { a: 1, c: 3, d: 4 };
  const [first, , third = 30, ...tail] = [10, 20, undefined, 40, 50];
  return a === 1 && renamed === 5 && others.c + others.d === 7 &&
    first === 10 && third === 30 && tail.length === 2 ? 42 : 1;
}`,
  },
  {
    name: "destructuring-entry-points",
    typed: `function read({ value = 20 }: { value?: number }): number {
      return value;
    }
    export function run(): number {
      let a: number = 2, b: number = 20;
      [a, b] = [b, a];
      const rows: { value: number }[] = [{ value: b }, { value: a }];
      let total: number = read({});
      for (const { value } of rows) total += value;
      return total === 42 ? 42 : 1;
    }`,
    untyped: `function read({ value = 20 }) {
      return value;
    }
    export function run() {
      let a = 2, b = 20;
      [a, b] = [b, a];
      const rows = [{ value: b }, { value: a }];
      let total = read({});
      for (const { value } of rows) total += value;
      return total === 42 ? 42 : 1;
    }`,
  },
  {
    name: "destructuring-realm",
    typed: `export const { answer } = { answer: 42 };
function head([glyph]: string): string | undefined { return glyph; }
export function run(): number {
  try {
    throw { value: answer };
  } catch ({ value }: any) {
    return head("😀x") === "😀" && value === 42 ? 42 : 1;
  }
}`,
    untyped: `export const { answer } = { answer: 42 };
function head([glyph]) { return glyph; }
export function run() {
  try {
    throw { value: answer };
  } catch ({ value }) {
    return head("😀x") === "😀" && value === 42 ? 42 : 1;
  }
}`,
  },
  {
    name: "spread",
    typed: `function sum3(a: number, b: number, c: number): number { return a + b + c; }
export function run(): number {
  const parts: number[] = [1, 2];
  const all = [...parts, 3, ...parts];
  const args: [number, number, number] = [4, 5, 6];
  const merged = { ...{ p: 1, q: 2 }, q: 3 };
  return all.length === 5 && sum3(...args) === 15 && merged.p + merged.q === 4 ? 42 : 1;
}`,
    untyped: `function sum3(a, b, c) { return a + b + c; }
export function run() {
  const parts = [1, 2];
  const all = [...parts, 3, ...parts];
  const args = [4, 5, 6];
  const merged = { ...{ p: 1, q: 2 }, q: 3 };
  return all.length === 5 && sum3(...args) === 15 && merged.p + merged.q === 4 ? 42 : 1;
}`,
  },
  {
    name: "rest-default-parameters",
    typed: `function total(scale: number = 2, ...values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum * scale;
}
export function run(): number {
  return total(undefined, 1, 2) === 6 && total(3) === 0 && total(1, 40, 2) === 42 ? 42 : 1;
}`,
    untyped: `function total(scale = 2, ...values) {
  let sum = 0;
  for (const value of values) sum += value;
  return sum * scale;
}
export function run() {
  return total(undefined, 1, 2) === 6 && total(3) === 0 && total(1, 40, 2) === 42 ? 42 : 1;
}`,
  },
  {
    name: "rest-spread",
    typed: `function total(head: number, ...xs: number[]): number {
  const sum = head + (xs[0] ?? 0) + (xs[1] ?? 0);
  xs[0] = 0;
  return sum;
}
export function run(): number {
  const xs: number[] = [20, 21];
  return total(1, ...xs) === 42 && xs[0] === 20 ? 42 : 1;
}`,
    untyped: `function total(head, ...xs) {
  const sum = head + (xs[0] ?? 0) + (xs[1] ?? 0);
  xs[0] = 0;
  return sum;
}
export function run() {
  const xs = [20, 21];
  return total(1, ...xs) === 42 && xs[0] === 20 ? 42 : 1;
}`,
  },
  {
    name: "void-callbacks",
    typed: `function invoke(action: () => void): void { action(); }
export function run(): number {
  let result = 0;
  const action: () => void = () => (result = 42);
  invoke(action);
  return result;
}`,
    untyped: `function invoke(action) { action(); }
export function run() {
  let result = 0;
  const action = () => (result = 42);
  invoke(action);
  return result;
}`,
  },
  {
    name: "void-callback-result",
    typed: `function forward(callback: () => void): void { return callback(); }
export function run(): number {
  const answer: unknown = forward(() => 42);
  return answer === 42 ? 42 : 1;
}`,
    untyped: `function forward(callback) { return callback(); }
export function run() {
  const answer = forward(() => 42);
  return answer === 42 ? 42 : 1;
}`,
  },
  {
    name: "array-mixed-spread",
    typed: `function frameMap(frame: number, roots: number[], generals: number[]): number[] {
  return [frame, roots.length, ...roots, generals.length, ...generals, 0];
}
export function run(): number {
  const map = frameMap(32, [3], [4]);
  return map.join(",") === "32,1,3,1,4,0" ? 42 : 1;
}`,
    untyped: `function frameMap(frame, roots, generals) {
  return [frame, roots.length, ...roots, generals.length, ...generals, 0];
}
export function run() {
  const map = frameMap(32, [3], [4]);
  return map.join(",") === "32,1,3,1,4,0" ? 42 : 1;
}`,
  },
  {
    name: "generators",
    typed: `function* range(start: number, end: number): Generator<number> {
  for (let i = start; i < end; i++) yield i;
}
export function run(): number {
  let total = 0;
  for (const value of range(0, 5)) total += value;
  const iterator = range(7, 9);
  const first = iterator.next();
  return total === 10 && first.value === 7 && first.done === false ? 42 : 1;
}`,
    untyped: `function* range(start, end) {
  for (let i = start; i < end; i++) yield i;
}
export function run() {
  let total = 0;
  for (const value of range(0, 5)) total += value;
  const iterator = range(7, 9);
  const first = iterator.next();
  return total === 10 && first.value === 7 && first.done === false ? 42 : 1;
}`,
  },
  {
    name: "async-await",
    typed: `const order: string[] = [];
async function compute(value: number): Promise<number> {
  order.push("start");
  const doubled = await Promise.resolve(value * 2);
  order.push("resumed");
  return doubled;
}
const result: number = await compute(21);
export function run(): number {
  return result === 42 && order.join(",") === "start,resumed" ? 42 : 1;
}`,
    untyped: `const order = [];
async function compute(value) {
  order.push("start");
  const doubled = await Promise.resolve(value * 2);
  order.push("resumed");
  return doubled;
}
const result = await compute(21);
export function run() {
  return result === 42 && order.join(",") === "start,resumed" ? 42 : 1;
}`,
  },
  {
    name: "errors",
    typed: `function fail(message: string): never { throw new Error(message); }
export function run(): number {
  let caught = "";
  let cleaned = false;
  try { fail("boom"); }
  catch (error) { if (error instanceof Error) caught = error.message; }
  finally { cleaned = true; }
  const range = new RangeError("r");
  return caught === "boom" && cleaned && range instanceof Error && range.name === "RangeError" ? 42 : 1;
}`,
    untyped: `function fail(message) { throw new Error(message); }
export function run() {
  let caught = "";
  let cleaned = false;
  try { fail("boom"); }
  catch (error) { if (error instanceof Error) caught = error.message; }
  finally { cleaned = true; }
  const range = new RangeError("r");
  return caught === "boom" && cleaned && range instanceof Error && range.name === "RangeError" ? 42 : 1;
}`,
  },
  {
    name: "exposed-native-error",
    helpers: {
      "error-factory.ts": `const shared = new TypeError("shared");
export function make(): TypeError { return shared; }`,
    },
    typed: `import { make } from "./error-factory.ts";
export function run(): number {
  const error: Error = make();
  return error === make() && error instanceof TypeError &&
    error.message === "shared" ? 42 : 1;
}`,
    untyped: `import { make } from "./error-factory.ts";
export function run() {
  const error = make();
  return error === make() && Object.getPrototypeOf(error) === TypeError.prototype &&
    Object.prototype.toString.call(error) === "[object Error]" &&
    error.message === "shared" ? 42 : 1;
}`,
  },
  {
    name: "unknown-typeof-callable",
    typed: `function kind(value: unknown): string { return typeof value; }
export function run(): number {
  const closure = (): number => 42;
  return kind(closure) === "function" && kind({}) === "object" ? 42 : 1;
}`,
    untyped: `function kind(value) { return typeof value; }
export function run() {
  const closure = () => 42;
  return kind(closure) === "function" && kind({}) === "object" ? 42 : 1;
}`,
  },
  {
    name: "unknown-callable-direct",
    typed: `function invoke(value: ((n: number) => number) | undefined): number {
  if ("function" !== typeof value) return 0;
  const result = value(40);
  return result;
}
export function run(): number {
  return invoke((n: number): number => n + 2) + invoke(undefined);
}`,
    untyped: `function invoke(value) {
  if ("function" !== typeof value) return 0;
  const result = value(40);
  return result;
}
export function run() {
  return invoke(n => n + 2) + invoke(undefined);
}`,
  },
  {
    name: "unknown-callable-arguments",
    // Argument evaluation is shared with Node. A native closure reaches
    // Tint's closure-view boundary after its argument has run.
    typed: `function invoke(value: unknown, effect: () => number): unknown {
  if (typeof value !== "function") return undefined;
  return value(effect());
}
export function run(): number {
  let trace = 0;
  const fn = (n: number): number => n;
  const effect = (): number => { trace = 42; return trace; };
  try { return invoke(fn, effect) === 42 ? trace : 1; }
  catch (e) {
    return e instanceof TypeError &&
      e.message === "Calling a native closure through Function requires the slice 2b closure view"
      ? trace : 2;
  }
}`,
    untyped: `function invoke(value, effect) {
  if (typeof value !== "function") return undefined;
  return value(effect());
}
export function run() {
  let trace = 0;
  const answer = invoke(n => n, () => { trace = 42; return trace; });
  return answer === trace ? trace : 1;
}`,
  },
  {
    name: "unknown-narrowing",
    typed: `function describe(value: unknown): string {
  if (typeof value === "number") return "n" + value.toFixed(1);
  if (typeof value === "string") return "s" + value.length;
  if (value === null) return "null";
  return "other";
}
export function run(): number {
  return describe(2) + describe("abc") + describe(null) + describe(true) === "n2.0s3nullother" ? 42 : 1;
}`,
    untyped: `function describe(value) {
  if (typeof value === "number") return "n" + value.toFixed(1);
  if (typeof value === "string") return "s" + value.length;
  if (value === null) return "null";
  return "other";
}
export function run() {
  return describe(2) + describe("abc") + describe(null) + describe(true) === "n2.0s3nullother" ? 42 : 1;
}`,
  },
  {
    name: "map-set",
    typed: `export function run(): number {
  const counts = new Map<string, number>();
  for (const word of ["a", "b", "a", "c", "a"]) counts.set(word, (counts.get(word) ?? 0) + 1);
  const seen = new Set<number>([1, 2, 2, 3]);
  seen.delete(1);
  let keys = "";
  for (const [key, count] of counts) keys += key + count;
  return keys === "a3b1c1" && seen.size === 2 && !seen.has(1) ? 42 : 1;
}`,
    untyped: `export function run() {
  const counts = new Map();
  for (const word of ["a", "b", "a", "c", "a"]) counts.set(word, (counts.get(word) ?? 0) + 1);
  const seen = new Set([1, 2, 2, 3]);
  seen.delete(1);
  let keys = "";
  for (const [key, count] of counts) keys += key + count;
  return keys === "a3b1c1" && seen.size === 2 && !seen.has(1) ? 42 : 1;
}`,
  },
  {
    name: "typed-arrays",
    typed: `export function run(): number {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i * 40;
  const view = new DataView(bytes.buffer, 2, 4);
  view.setUint16(0, 0x1234, true);
  const words = new Uint32Array(bytes.buffer, 4, 1);
  return bytes[2] === 0x34 && bytes[3] === 0x12 && bytes[7] === 24 &&
    words.length === 1 && bytes instanceof Uint8Array ? 42 : 1;
}`,
    untyped: `export function run() {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i * 40;
  const view = new DataView(bytes.buffer, 2, 4);
  view.setUint16(0, 0x1234, true);
  const words = new Uint32Array(bytes.buffer, 4, 1);
  return bytes[2] === 0x34 && bytes[3] === 0x12 && bytes[7] === 24 &&
    words.length === 1 && bytes instanceof Uint8Array ? 42 : 1;
}`,
  },
  {
    name: "math",
    typed: `export function run(): number {
  return Math.pow(2, 10) === 1024 && Math.log2(8) === 3 && Math.fround(5.5) === 5.5 &&
    Math.sqrt(16) === 4 && Math.max(1, 9, 3) === 9 && Math.floor(-1.5) === -2 ? 42 : 1;
}`,
    untyped: `export function run() {
  return Math.pow(2, 10) === 1024 && Math.log2(8) === 3 && Math.fround(5.5) === 5.5 &&
    Math.sqrt(16) === 4 && Math.max(1, 9, 3) === 9 && Math.floor(-1.5) === -2 ? 42 : 1;
}`,
  },
  {
    name: "json",
    typed: `interface Config { name: string; sizes: number[] }
export function run(): number {
  const text = JSON.stringify({ name: "x", sizes: [1, 2] });
  const parsed = JSON.parse(text) as Config;
  return text === '{"name":"x","sizes":[1,2]}' && parsed.sizes[1] === 2 ? 42 : 1;
}`,
    untyped: `export function run() {
  const text = JSON.stringify({ name: "x", sizes: [1, 2] });
  const parsed = JSON.parse(text);
  return text === '{"name":"x","sizes":[1,2]}' && parsed.sizes[1] === 2 ? 42 : 1;
}`,
  },
  {
    name: "optional-chaining",
    typed: `interface Node { value: number; next?: Node }
function second(node: Node | undefined): number { return node?.next?.value ?? -1; }
export function run(): number {
  const list: Node = { value: 1, next: { value: 2 } };
  return second(list) === 2 && second(list.next) === -1 && second(undefined) === -1 ? 42 : 1;
}`,
    untyped: `function second(node) { return node?.next?.value ?? -1; }
export function run() {
  const list = { value: 1, next: { value: 2 } };
  return second(list) === 2 && second(list.next) === -1 && second(undefined) === -1 ? 42 : 1;
}`,
  },
  {
    name: "labels-switch",
    typed: `function classify(n: number): string {
  switch (n % 3) { case 0: return "fizz"; case 1: return "one"; default: return "two"; }
}
export function run(): number {
  let found = -1;
  outer: for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (j > i) continue outer;
      if (i * j === 6) { found = i * 10 + j; break outer; }
    }
  }
  return found === 32 && classify(9) + classify(4) + classify(5) === "fizzonetwo" ? 42 : 1;
}`,
    untyped: `function classify(n) {
  switch (n % 3) { case 0: return "fizz"; case 1: return "one"; default: return "two"; }
}
export function run() {
  let found = -1;
  outer: for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (j > i) continue outer;
      if (i * j === 6) { found = i * 10 + j; break outer; }
    }
  }
  return found === 32 && classify(9) + classify(4) + classify(5) === "fizzonetwo" ? 42 : 1;
}`,
  },
  {
    name: "var-hoisting",
    typed: `export function run(): number {
  const early = hoisted();
  var total: number = 0;
  for (var i = 0; i < 4; i++) total += i;
  function hoisted(): number { return 40; }
  return early + total - i + 0 === 42 ? 42 : 1;
}`,
    untyped: `export function run() {
  const early = hoisted();
  var total = 0;
  for (var i = 0; i < 4; i++) total += i;
  function hoisted() { return 40; }
  return early + total - i + 0 === 42 ? 42 : 1;
}`,
  },
  {
    name: "iterator-protocol",
    typed: `class Countdown implements Iterable<number> {
  constructor(private from: number) {}
  [Symbol.iterator](): Iterator<number> {
    let current = this.from;
    return { next: (): IteratorResult<number> => current > 0 ? { value: current--, done: false } : { value: undefined, done: true } };
  }
}
export function run(): number {
  const values = [...new Countdown(3)];
  return values.join("") === "321" ? 42 : 1;
}`,
    untyped: `class Countdown {
  constructor(from) { this.from = from; }
  [Symbol.iterator]() {
    let current = this.from;
    return { next: () => current > 0 ? { value: current--, done: false } : { value: undefined, done: true } };
  }
}
export function run() {
  const values = [...new Countdown(3)];
  return values.join("") === "321" ? 42 : 1;
}`,
  },
  {
    name: "accessors-object-literal",
    typed: `export function run(): number {
  let writes = 0;
  const box = {
    stored: 1,
    get double(): number { return this.stored * 2; },
    set double(value: number) { writes++; this.stored = value / 2; },
  };
  box.double = 42;
  return box.stored === 21 && box.double === 42 && writes === 1 ? 42 : 1;
}`,
    untyped: `export function run() {
  let writes = 0;
  const box = {
    stored: 1,
    get double() { return this.stored * 2; },
    set double(value) { writes++; this.stored = value / 2; },
  };
  box.double = 42;
  return box.stored === 21 && box.double === 42 && writes === 1 ? 42 : 1;
}`,
  },
  {
    name: "regexp",
    typed: `export function run(): number {
  const match = /(\\d+)-(\\d+)/.exec("range 10-32");
  const replaced = "a1b2".replace(/\\d/g, "#");
  return match !== null && Number(match[1]) + Number(match[2]) === 42 && replaced === "a#b#" ? 42 : 1;
}`,
    untyped: `export function run() {
  const match = /(\\d+)-(\\d+)/.exec("range 10-32");
  const replaced = "a1b2".replace(/\\d/g, "#");
  return match !== null && Number(match[1]) + Number(match[2]) === 42 && replaced === "a#b#" ? 42 : 1;
}`,
  },
  {
    name: "enums",
    typed: `enum Color { Red = 1, Green, Blue = 40 }
export function run(): number {
  return Color.Green === 2 && Color[40] === "Blue" && Color.Blue + Color.Green === 42 ? 42 : 1;
}`,
    untyped: `const Color = { Red: 1, Green: 2, Blue: 40, 1: "Red", 2: "Green", 40: "Blue" };
export function run() {
  return Color.Green === 2 && Color[40] === "Blue" && Color.Blue + Color.Green === 42 ? 42 : 1;
}`,
  },
  {
    name: "arguments-object",
    typed: `function count(..._values: number[]): number { return arguments.length; }
export function run(): number {
  return count(1, 2, 3) === 3 && count() === 0 ? 42 : 1;
}`,
    untyped: `function count() { return arguments.length; }
export function run() {
  return count(1, 2, 3) === 3 && count() === 0 ? 42 : 1;
}`,
  },
  {
    name: "arguments-function-fallback",
    typed: `function kernel(): number { return 6 * 7; }
function read(): number { return kernel() - arguments.length; }
export function run(): number { return read(); }`,
    untyped: `function kernel() { return 6 * 7; }
function read() { return kernel() - arguments.length; }
export function run() { return read(); }`,
  },
  {
    name: "arguments-function-fallback-reentry",
    typed: `function kernel(): number { return read() + 22; }
function read(...values: number[]): number { return arguments.length === 0 ? 17 : kernel() + arguments.length; }
export function run(): number { return read(1, 2, 3); }`,
    untyped: `function kernel() { return read() + 22; }
function read(...values) { return arguments.length === 0 ? 17 : kernel() + arguments.length; }
export function run() { return read(1, 2, 3); }`,
  },
  {
    name: "arguments-function-fallback-throw",
    typed: `function kernel(): number { throw 7; }
function read(): number { return kernel() + arguments.length; }
export function run(): number { try { read(); return 1; } catch (error) { return error === 7 ? 42 : 2; } }`,
    untyped: `function kernel() { throw 7; }
function read() { return kernel() + arguments.length; }
export function run() { try { read(); return 1; } catch (error) { return error === 7 ? 42 : 2; } }`,
  },
  {
    name: "arguments-function-fallback-numeric",
    typed: `function kernel(left: number, right: number): number { return left * 10 + right; }
function read(value: number): number { return kernel(value, arguments.length) + 1; }
export function run(): number { return read(4); }`,
    untyped: `function kernel(left, right) { return left * 10 + right; }
function read(value) { return kernel(value, arguments.length) + 1; }
export function run() { return read(4); }`,
  },
  {
    name: "function-fallback-primitive-contracts",
    node: { typed: 1 },
    typed: `let defaults = 0;
let finalizers = 0;
const marker = { value: 42 };
function subject(this: { base: number }, value: number = ++defaults): number {
  if (arguments.length > 1) throw marker;
  if (value === -1) value = "bad" as unknown as number;
  return this.base + value;
}
function invalid(): number {
  try { return "bad" as unknown as number; }
  finally { finalizers++; }
}
export function run(): number {
  const receiver = { base: 40, subject };
  if (receiver.subject() !== 41 || receiver.subject(undefined) !== 42 || defaults !== 2) return 2;
  let rejected = 0;
  try { receiver.subject("bad" as unknown as number); } catch (error) { if (error instanceof TypeError) rejected++; }
  try { receiver.subject(-1); } catch (error) { if (error instanceof TypeError) rejected++; }
  try { receiver.subject(...([1, 2] as unknown as [number])); } catch (error) { if (error === marker) rejected++; }
  try { invalid(); } catch (error) { if (error instanceof TypeError && finalizers === 1) rejected++; }
  return rejected === 4 ? 42 : 1;
}`,
    untyped: `let defaults = 0;
let finalizers = 0;
const marker = { value: 42 };
function subject(value = ++defaults) {
  if (arguments.length > 1) throw marker;
  return this.base + value;
}
function invalid() { try { return "bad"; } finally { finalizers++; } }
export function run() {
  const receiver = { base: 40, subject };
  if (receiver.subject() !== 41 || receiver.subject(undefined) !== 42 || defaults !== 2) return 2;
  let throwsSame = false;
  try { receiver.subject(1, 2); } catch (error) { throwsSame = error === marker; }
  return throwsSame && receiver.subject("bad") === "40bad" && invalid() === "bad" && finalizers === 1 ? 42 : 1;
}`,
  },
  {
    name: "function-fallback-defaults-mixed",
    typed: `function kernel(): number { return observe(2); }
function observe(value: number = kernel() + 17): number {
  const count = arguments.length;
  if (count === 0) return value;
  return value * 2 + count;
}
export function run(): number { return observe() + observe(undefined) - 25; }`,
    untyped: `function kernel() { return observe(2); }
function observe(value = kernel() + 17) {
  const count = arguments.length;
  if (count === 0) return value;
  return value * 2 + count;
}
export function run() { return observe() + observe(undefined) - 25; }`,
  },
  {
    name: "function-fallback-reexport-identity",
    helperImports: { "reexport.ts": ["kernel.ts"] },
    helpers: {
      "kernel.ts": `function kernel(value: number): number { return value + 1; }
export { kernel as first, kernel as second };`,
      "reexport.ts": `export { second as third } from "./kernel.ts";`,
    },
    typed: `import { first, second } from "./kernel.ts";
import { third } from "./reexport.ts";
function size(): number { return arguments.length; }
export function run(): number {
  return first === second && first === third && size() === 0 ? third(41) : 1;
}`,
    untyped: `import { first, second } from "./kernel.ts";
import { third } from "./reexport.ts";
function size() { return arguments.length; }
export function run() {
  return first === second && first === third && size() === 0 ? third(41) : 1;
}`,
  },
  {
    name: "function-fallback-mixed-throw-object",
    typed: `function exchange(value?: unknown): unknown {
  if (arguments.length !== 0) throw value;
  return { message: "same object" };
}
export function run(): number {
  const marker = exchange();
  try { exchange(marker); return 1; }
  catch (caught) { return caught === marker ? 42 : 2; }
}`,
    untyped: `function exchange(value) {
  if (arguments.length !== 0) throw value;
  return { message: "same object" };
}
export function run() {
  const marker = exchange();
  try { exchange(marker); return 1; }
  catch (caught) { return caught === marker ? 42 : 2; }
}`,
  },
  {
    name: "function-fallback-rest-spread",
    typed: `function read(base: number, ...values: number[]): number {
  let total = base + arguments.length;
  for (const value of values) total += value;
  return total;
}
export function run(): number {
  const tail: number[] = [10, 11];
  return read(1) === 2 ? read(18, ...tail) : 1;
}`,
    untyped: `function read(base, ...values) {
  let total = base + arguments.length;
  for (const value of values) total += value;
  return total;
}
export function run() {
  const tail = [10, 11];
  return read(1) === 2 ? read(18, ...tail) : 1;
}`,
  },
  {
    name: "tagged-templates",
    typed: `function tag(strings: TemplateStringsArray, ...values: number[]): string {
  return strings.raw.join("|") + values.join(",");
}
export function run(): number {
  return tag\`a\${1}b\${2}\` === "a|b|1,2" ? 42 : 1;
}`,
    untyped: `function tag(strings, ...values) {
  return strings.raw.join("|") + values.join(",");
}
export function run() {
  return tag\`a\${1}b\${2}\` === "a|b|1,2" ? 42 : 1;
}`,
  },
  {
    name: "object-reflection",
    typed: `export function run(): number {
  const record: Record<string, number> = { b: 2, a: 1 };
  record["c"] = 3;
  const keys = Object.keys(record).join("");
  const frozen = Object.freeze({ x: 1 });
  return keys === "bac" && Object.isFrozen(frozen) && Reflect.has(record, "a") && "c" in record ? 42 : 1;
}`,
    untyped: `export function run() {
  const record = { b: 2, a: 1 };
  record["c"] = 3;
  const keys = Object.keys(record).join("");
  const frozen = Object.freeze({ x: 1 });
  return keys === "bac" && Object.isFrozen(frozen) && Reflect.has(record, "a") && "c" in record ? 42 : 1;
}`,
  },
  {
    name: "generic-functions",
    typed: `function first<T>(values: readonly T[], fallback: T): T { return values.length > 0 ? values[0] as T : fallback; }
class Stack<T> { items: T[] = []; push(item: T): void { this.items.push(item); } pop(): T | undefined { return this.items.pop(); } }
export function run(): number {
  const stack = new Stack<string>();
  stack.push("a"); stack.push("b");
  return first([40], 0) + first<number>([], 2) === 42 && stack.pop() === "b" ? 42 : 1;
}`,
    untyped: `function first(values, fallback) { return values.length > 0 ? values[0] : fallback; }
class Stack { items = []; push(item) { this.items.push(item); } pop() { return this.items.pop(); } }
export function run() {
  const stack = new Stack();
  stack.push("a"); stack.push("b");
  return first([40], 0) + first([], 2) === 42 && stack.pop() === "b" ? 42 : 1;
}`,
  },
  // Open slots: no annotation, so the inferred or first-assigned type is
  // only speculation. Each slot accepts number -> string -> object ->
  // undefined from typed code, untyped code and reflective writes.
  {
    name: "open-variable",
    helpers: untypedHelper,
    typed: `import { call } from "./untyped.ts";
export function run(): number {
  let value = 1;
  const seen: string[] = [typeof value];
  value = "two";
  seen.push(typeof value + value);
  call((next: unknown): void => { value = next; }, { n: 3 });
  seen.push(typeof value);
  value = undefined;
  seen.push(typeof value);
  let later;
  later = 4;
  later = "four";
  return seen.join(",") === "number,stringtwo,object,undefined" && later === "four" ? 42 : 1;
}`,
    untyped: `import { call } from "./untyped.ts";
export function run() {
  let value = 1;
  const seen = [typeof value];
  value = "two";
  seen.push(typeof value + value);
  call((next) => { value = next; }, { n: 3 });
  seen.push(typeof value);
  value = undefined;
  seen.push(typeof value);
  let later;
  later = 4;
  later = "four";
  return seen.join(",") === "number,stringtwo,object,undefined" && later === "four" ? 42 : 1;
}`,
  },
  {
    name: "open-object-literal-field",
    helpers: untypedHelper,
    typed: `import { write } from "./untyped.ts";
export function run(): number {
  const box = { value: 1 };
  const seen: string[] = [typeof box.value];
  box.value = "two";
  seen.push(typeof box.value);
  write(box, "value", { n: 3 });
  seen.push(typeof box.value + (box.value as { n: number }).n);
  Reflect.set(box, "value", undefined);
  seen.push(typeof box.value);
  box.value = 5;
  return seen.join(",") === "number,string,object3,undefined" && box.value === 5 ? 42 : 1;
}`,
    untyped: `import { write } from "./untyped.ts";
export function run() {
  const box = { value: 1 };
  const seen = [typeof box.value];
  box.value = "two";
  seen.push(typeof box.value);
  write(box, "value", { n: 3 });
  seen.push(typeof box.value + box.value.n);
  Reflect.set(box, "value", undefined);
  seen.push(typeof box.value);
  box.value = 5;
  return seen.join(",") === "number,string,object3,undefined" && box.value === 5 ? 42 : 1;
}`,
  },
  {
    name: "open-class-field",
    helpers: untypedHelper,
    typed: `import { write } from "./untyped.ts";
class Cell {
  value = 1;
  label;
  constructor() { this.label = 0; this.extra = 0; }
  replace(next: unknown): void { this.value = next; }
}
export function run(): number {
  const cell = new Cell();
  const seen: string[] = [typeof cell.value];
  cell.replace("two");
  seen.push(typeof cell.value);
  write(cell, "value", { n: 3 });
  seen.push(typeof cell.value);
  cell.value = undefined;
  seen.push(typeof cell.value);
  cell.label = "x";
  write(cell, "extra", [1, 2]);
  return seen.join(",") === "number,string,object,undefined" && cell.label === "x" &&
    cell.extra.length === 2 ? 42 : 1;
}`,
    untyped: `import { write } from "./untyped.ts";
class Cell {
  value = 1;
  label;
  constructor() { this.label = 0; this.extra = 0; }
  replace(next) { this.value = next; }
}
export function run() {
  const cell = new Cell();
  const seen = [typeof cell.value];
  cell.replace("two");
  seen.push(typeof cell.value);
  write(cell, "value", { n: 3 });
  seen.push(typeof cell.value);
  cell.value = undefined;
  seen.push(typeof cell.value);
  cell.label = "x";
  write(cell, "extra", [1, 2]);
  return seen.join(",") === "number,string,object,undefined" && cell.label === "x" &&
    cell.extra.length === 2 ? 42 : 1;
}`,
  },
  {
    name: "open-array-elements",
    helpers: untypedHelper,
    typed: `import { write } from "./untyped.ts";
export function run(): number {
  const items = [1, 2];
  items.push("three");
  write(items, 0, { n: 1 });
  items[1] = undefined;
  return items.length === 3 && typeof items[0] === "object" && items[1] === undefined &&
    items[2] === "three" ? 42 : 1;
}`,
    untyped: `import { write } from "./untyped.ts";
export function run() {
  const items = [1, 2];
  items.push("three");
  write(items, 0, { n: 1 });
  items[1] = undefined;
  return items.length === 3 && typeof items[0] === "object" && items[1] === undefined &&
    items[2] === "three" ? 42 : 1;
}`,
  },
  {
    name: "open-callback-parameter",
    typed: `export function run(): number {
  const values: number[] = [1, 2];
  const marked = values.map((value) => { value = "#" + value; return value; });
  return marked.join("") === "#1#2" ? 42 : 1;
}`,
    untyped: `export function run() {
  const values = [1, 2];
  const marked = values.map((value) => { value = "#" + value; return value; });
  return marked.join("") === "#1#2" ? 42 : 1;
}`,
  },
  // Enforced contracts: written annotations reject foreign writes with a
  // TypeError on every path and keep the previous value. The untyped forms
  // have no annotations, so the same writes succeed.
  {
    name: "nested-shared-captures",
    typed: nestedCaptureSource,
    untyped: `function activation(seed) {
  let count = seed;
  function bump(delta) { count += delta; return count; }
  const alias = bump;
  function general(delta) {
    if (arguments.length !== 1 || bump !== alias) return -1;
    count += 1;
    return alias(delta);
  }
  return general;
}
export function run() {
  const first = activation(1);
  const second = activation(10);
  if (first(1) !== 3 || second(1) !== 12) return 1;
  return first(38) === 42 ? 42 : 2;
}`,
  },
  {
    name: "nested-capture-contract",
    typed: nestedContractSource,
    node: { typed: 3 },
    untyped: `export function run() {
  let count = 20;
  function write(value) { count = value; }
  function read() { return count; }
  write("open");
  if (read() !== "open") return 1;
  write(42);
  return read();
}`,
  },
  {
    name: "explicit-field-contract",
    helpers: untypedHelper,
    node: { typed: 1 },
    typed: `import { write } from "./untyped.ts";
interface Point { x: number }
class Counter { count: number = 0; }
export function run(): number {
  const point: Point = { x: 1 };
  const counter = new Counter();
  let rejected = 0;
  try { write(point, "x", "s"); } catch (error) { if (error instanceof TypeError) rejected++; }
  try { (counter as unknown as { count: unknown }).count = {}; } catch (error) { if (error instanceof TypeError) rejected++; }
  point.x = 2;
  return rejected === 2 && point.x === 2 && counter.count === 0 ? 42 : 1;
}`,
    untyped: `import { write } from "./untyped.ts";
class Counter { count = 0; }
export function run() {
  const point = { x: 1 };
  const counter = new Counter();
  write(point, "x", "s");
  counter.count = {};
  return point.x === "s" && typeof counter.count === "object" ? 42 : 1;
}`,
  },
  {
    // A record type with a literal field (a discriminant) is a contract like
    // any other: untyped code writing a value outside a field's declared type,
    // or changing the readonly discriminant, gets a TypeError. The general
    // path used to drop the whole record contract for a literal field type.
    name: "explicit-literal-field-contract",
    helpers: untypedHelper,
    node: { typed: 1 },
    typed: `import { write } from "./untyped.ts";
interface Tagged { readonly kind: "tagged"; x: string; count: 1 | 2 }
export function run(): number {
  const tagged: Tagged = { kind: "tagged", x: "a", count: 1 };
  let rejected = 0;
  try { write(tagged, "x", 1); } catch (error) { if (error instanceof TypeError) rejected++; }
  try { write(tagged, "kind", "other"); } catch (error) { if (error instanceof TypeError) rejected++; }
  try { write(tagged, "count", 3); } catch (error) { if (error instanceof TypeError) rejected++; }
  write(tagged, "count", 2);
  return rejected === 3 && tagged.x === "a" && tagged.kind === "tagged" && tagged.count === 2 ? 42 : 1;
}`,
    untyped: `import { write } from "./untyped.ts";
export function run() {
  const tagged = { kind: "tagged", x: "a", count: 1 };
  write(tagged, "x", 1);
  write(tagged, "kind", "other");
  write(tagged, "count", 3);
  return tagged.x === 1 && tagged.kind === "other" && tagged.count === 3 ? 42 : 1;
}`,
  },
  {
    name: "explicit-binding-contract",
    helpers: untypedHelper,
    node: { typed: 1 },
    typed: `import { call } from "./untyped.ts";
function twice(n: number): number { return n * 2; }
export function run(): number {
  let count: number = 1;
  let rejected = 0;
  try { eval('count = "x"'); } catch (error) { if (error instanceof TypeError) rejected++; }
  try { call(twice, "21"); } catch (error) { if (error instanceof TypeError) rejected++; }
  return rejected === 2 && count === 1 && call(twice, 21) === 42 ? 42 : 1;
}`,
    untyped: `import { call } from "./untyped.ts";
function twice(n) { return n * 2; }
export function run() {
  let count = 1;
  eval('count = "x"');
  return count === "x" && call(twice, "21") === 42 ? 42 : 1;
}`,
  },
  // Typed-path gaps reported by FFI phase 1 (docs/native-ffi.md, known
  // defects): general-value casts, buffer views, caught-error reads and
  // constructs used by compiler sources.
  {
    name: "general-value-casts",
    typed: `function size(value: string | Uint8Array): number {
  return typeof value === "string" ? value.length : value.length * 10;
}
export function run(): number {
  const value: unknown = new Uint8Array(3);
  const bytes = value as Uint8Array;
  bytes[0] = 4;
  return size("ab") + size(bytes) === 32 && bytes[0] === 4 ? 42 : 1;
}`,
    untyped: `function size(value) {
  return typeof value === "string" ? value.length : value.length * 10;
}
export function run() {
  const value = new Uint8Array(3);
  const bytes = value;
  bytes[0] = 4;
  return size("ab") + size(bytes) === 32 && bytes[0] === 4 ? 42 : 1;
}`,
  },
  {
    name: "typed-array-buffer-views",
    typed: `export function run(): number {
  const floats = new Float64Array([1]);
  const raw = new Uint8Array(floats.buffer);
  const high = new Uint32Array(raw.buffer, 4, 1);
  return raw.length === 8 && raw[7] === 0x3f && raw[6] === 0xf0 && high[0] === 0x3ff00000 ? 42 : 1;
}`,
    untyped: `export function run() {
  const floats = new Float64Array([1]);
  const raw = new Uint8Array(floats.buffer);
  const high = new Uint32Array(raw.buffer, 4, 1);
  return raw.length === 8 && raw[7] === 0x3f && raw[6] === 0xf0 && high[0] === 0x3ff00000 ? 42 : 1;
}`,
  },
  {
    name: "unknown-realm-instanceof",
    typed: `function read(value: unknown): string {
  const constructors = { current: Error };
  if (value instanceof constructors.current) return value.message;
  return "other";
}
export function run(): number {
  return read(new RangeError("ready")) === "ready" && read(1) === "other" ? 42 : 1;
}`,
    untyped: `function read(value) {
  const constructors = { current: Error };
  if (value instanceof constructors.current) return value.message;
  return "other";
}
export function run() {
  return read(new RangeError("ready")) === "ready" && read(1) === "other" ? 42 : 1;
}`,
  },
  {
    name: "unknown-typed-array-instanceof",
    typed: `function read(value: unknown): number {
  if (!(value instanceof Uint8Array)) return 1;
  const alias = value;
  value.fill(42);
  return alias[0] ?? 0;
}
export function run(): number { return read(new Uint8Array(1)); }`,
    untyped: `function read(value) {
  if (!(value instanceof Uint8Array)) return 1;
  const alias = value;
  value.fill(42);
  return alias[0] ?? 0;
}
export function run() { return read(new Uint8Array(1)); }`,
  },
  {
    name: "native-error-flow",
    typed: `function describe(value: Error | string): string {
  if (!(value instanceof Error)) return value;
  if (value instanceof TypeError) return value.name;
  return value.message;
}
export function run(): number {
  return describe("other") === "other" && describe(new Error()) === "" &&
      describe(new TypeError("message")) === "TypeError" &&
      describe(new RangeError("range")) === "range" ? 42 : 1;
}`,
    untyped: `function describe(value) {
  if (!(value instanceof Error)) return value;
  if (value instanceof TypeError) return value.name;
  return value.message;
}
export function run() {
  return describe("other") === "other" && describe(new Error()) === "" &&
      describe(new TypeError("message")) === "TypeError" &&
      describe(new RangeError("range")) === "range" ? 42 : 1;
}`,
  },
  {
    name: "caught-error-reads",
    typed: `export function run(): number {
  let message = "", name = "", plain = "";
  try { throw new TypeError("bad"); }
  catch (error) { if (error instanceof TypeError) message = error.message; }
  try { throw new RangeError("far"); }
  catch (error) { name = (error as RangeError).name; }
  try { throw "plain"; }
  catch (error) { if (typeof error === "string") plain = error; }
  return message === "bad" && name === "RangeError" && plain === "plain" ? 42 : 1;
}`,
    untyped: `export function run() {
  let message = "", name = "", plain = "";
  try { throw new TypeError("bad"); }
  catch (error) { if (error instanceof TypeError) message = error.message; }
  try { throw new RangeError("far"); }
  catch (error) { name = error.name; }
  try { throw "plain"; }
  catch (error) { if (typeof error === "string") plain = error; }
  return message === "bad" && name === "RangeError" && plain === "plain" ? 42 : 1;
}`,
  },
  {
    name: "coded-error-guard",
    typed: `function code(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    const code: string = error.code;
    return code;
  }
  return "";
}
export function run(): number {
  const coded: { name: string; message: string; code: string } = { name: "Example", message: "test", code: "E_TEST" };
  return code(new Error("missing")) === "" && code(coded) === "" && code(1) === "" ? 42 : 1;
}`,
    untyped: `function code(error) {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    const code = error.code;
    return code;
  }
  return "";
}
export function run() {
  const coded = { name: "Example", message: "test", code: "E_TEST" };
  return code(new Error("missing")) === "" && code(coded) === "" && code(1) === "" ? 42 : 1;
}`,
  },
  {
    name: "tuple-types",
    typed: `function pair(n: number): [number, string] { return [n, "ab"]; }
export function run(): number {
  const p = pair(40);
  return p[0] + p[1].length === 42 && p.length === 2 ? 42 : 1;
}`,
    untyped: `function pair(n) { return [n, "ab"]; }
export function run() {
  const p = pair(40);
  return p[0] + p[1].length === 42 && p.length === 2 ? 42 : 1;
}`,
  },
  {
    name: "nested-type-declarations",
    typed: `export function run(): number {
  interface Local { value: number }
  type Locals = Local[];
  const items: Locals = [{ value: 40 }, { value: 2 }];
  let total = 0;
  for (const item of items) total += item.value;
  return total === 42 ? 42 : 1;
}`,
    untyped: `export function run() {
  const items = [{ value: 40 }, { value: 2 }];
  let total = 0;
  for (const item of items) total += item.value;
  return total === 42 ? 42 : 1;
}`,
  },
  {
    name: "forward-inferred-const",
    typed: `function scaled(n: number): number { return n * factor; }
const factor = 6;
export function run(): number { return scaled(7) === 42 ? 42 : 1; }`,
    untyped: `function scaled(n) { return n * factor; }
const factor = 6;
export function run() { return scaled(7) === 42 ? 42 : 1; }`,
  },
  {
    name: "union-object-ternary",
    typed: `type Instruction = { kind: "add"; a: number } | { kind: "sub"; a: number };
function emit(instruction: Instruction): number {
  return instruction.kind === "add" ? instruction.a : -instruction.a;
}
export function run(): number {
  const flag = Math.max(0, 1) === 1;
  return emit({ kind: flag ? "add" : "sub", a: 42 }) === 42 ? 42 : 1;
}`,
    untyped: `function emit(instruction) {
  return instruction.kind === "add" ? instruction.a : -instruction.a;
}
export function run() {
  const flag = Math.max(0, 1) === 1;
  return emit({ kind: flag ? "add" : "sub", a: 42 }) === 42 ? 42 : 1;
}`,
  },
  {
    // The preceding write proves the constant indexed read.
    name: "typed-array-index",
    typed: `export function run(): number {
  const bytes = new Uint8Array(2);
  bytes[1] = 42;
  const value: number = bytes[1];
  const missing = bytes[5];
  return value === 42 && missing === undefined ? 42 : 1;
}`,
    untyped: `export function run() {
  const bytes = new Uint8Array(2);
  bytes[1] = 42;
  const value = bytes[1];
  const missing = bytes[5];
  return value === 42 && missing === undefined ? 42 : 1;
}`,
  },
  {
    name: "typed-array-index-unproven",
    typedError: "TS2322",
    typed: `export function run(): number {
  const bytes = new Uint8Array(2);
  const value: number = bytes[5];
  return value === undefined ? 42 : 1;
}`,
    untyped: `export function run() {
  const bytes = new Uint8Array(2);
  const value = bytes[5];
  return value === undefined ? 42 : 1;
}`,
  },
  {
    name: "type-error-after-generator",
    typedError: "TS2322",
    typed: `function* count(): Generator<number, void, unknown> { yield 42; }
export function run(): number {
  const invalid: number = "wrong";
  for (const value of count()) if (typeof invalid === "string") return value;
  return 1;
}`,
    untyped: `function* count() { yield 42; }
export function run() {
  const invalid = "wrong";
  for (const value of count()) if (typeof invalid === "string") return value;
  return 1;
}`,
  },
  {
    // The checked form of the same reads: `?? 0` satisfies
    // noUncheckedIndexedAccess.
    name: "typed-array-index-checked",
    typed: `export function run(): number {
  const bytes = new Uint8Array(2);
  bytes[1] = 42;
  const value: number = bytes[1] ?? 0;
  const missing = bytes[5];
  return value === 42 && missing === undefined ? 42 : 1;
}`,
    untyped: `export function run() {
  const bytes = new Uint8Array(2);
  bytes[1] = 42;
  const value = bytes[1] ?? 0;
  const missing = bytes[5];
  return value === 42 && missing === undefined ? 42 : 1;
}`,
  },
  {
    // Without noUncheckedIndexedAccess the read is number (inferred,
    // speculative): the out-of-range read still yields undefined.
    name: "typed-array-index-unchecked",
    options: { noUncheckedIndexedAccess: false },
    typed: `export function run(): number {
  const bytes = new Uint8Array(2);
  bytes[1] = 42;
  const value: number = bytes[1];
  const missing = bytes[5];
  return value === 42 && missing === undefined ? 42 : 1;
}`,
    untyped: `export function run() {
  const bytes = new Uint8Array(2);
  bytes[1] = 42;
  const value = bytes[1];
  const missing = bytes[5];
  return value === 42 && missing === undefined ? 42 : 1;
}`,
  },
  // FFI phase 2 and slice 1 findings.
  {
    name: "for-of-record-reads",
    typed: `interface Point { readonly x: number; readonly y: number }
function total(points: readonly Point[]): number {
  let sum = 0;
  for (const point of points) sum += point.x * point.y;
  return sum;
}
export function run(): number {
  return total([{ x: 2, y: 3 }, { x: 4, y: 9 }]) === 42 ? 42 : 1;
}`,
    untyped: `function total(points) {
  let sum = 0;
  for (const point of points) sum += point.x * point.y;
  return sum;
}
export function run() {
  return total([{ x: 2, y: 3 }, { x: 4, y: 9 }]) === 42 ? 42 : 1;
}`,
  },
  {
    name: "bigint",
    typed: `function widen(n: bigint): bigint { return (n << 32n) | 0xffn; }
export function run(): number {
  const wide = widen(10n);
  return wide === 42949673215n && Number(wide >> 32n) + 32 === 42 && typeof wide === "bigint" ? 42 : 1;
}`,
    untyped: `function widen(n) { return (n << 32n) | 0xffn; }
export function run() {
  const wide = widen(10n);
  return wide === 42949673215n && Number(wide >> 32n) + 32 === 42 && typeof wide === "bigint" ? 42 : 1;
}`,
  },
  {
    name: "module-statements",
    typed: `const log: string[] = [];
log.push("init");
if (log.length === 1) log.push("checked");
export function run(): number { return log.join(",") === "init,checked" ? 42 : 1; }`,
    untyped: `const log = [];
log.push("init");
if (log.length === 1) log.push("checked");
export function run() { return log.join(",") === "init,checked" ? 42 : 1; }`,
  },
  {
    name: "weak-collections",
    typed: `export function run(): number {
  const key = { id: 1 };
  const cache = new WeakMap<object, number>();
  cache.set(key, 41);
  const seen = new WeakSet<object>([key]);
  return (cache.get(key) ?? 0) + (seen.has(key) ? 1 : 0) === 42 ? 42 : 1;
}`,
    untyped: `export function run() {
  const key = { id: 1 };
  const cache = new WeakMap();
  cache.set(key, 41);
  const seen = new WeakSet([key]);
  return (cache.get(key) ?? 0) + (seen.has(key) ? 1 : 0) === 42 ? 42 : 1;
}`,
  },
  {
    // A parameter narrowed earlier in an && chain stays narrowed after a
    // call later in the chain (Linux thread report).
    name: "narrowing-across-calls",
    typed: `interface Tagged { readonly label: string; readonly payload: number[] }
function intact(t: Tagged | undefined, id: number): boolean {
  return t !== undefined && t.label === "x" + String(id) && t.payload.length === 2;
}
export function run(): number {
  return intact({ label: "x7", payload: [1, 2] }, 7) && !intact(undefined, 7) ? 42 : 1;
}`,
    untyped: `function intact(t, id) {
  return t !== undefined && t.label === "x" + String(id) && t.payload.length === 2;
}
export function run() {
  return intact({ label: "x7", payload: [1, 2] }, 7) && !intact(undefined, 7) ? 42 : 1;
}`,
  },
  // FFI phase 4 reports (2026-11-18).
  {
    name: "for-of-typed-array-list",
    typed: `function sum(bytes: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < bytes.length; i++) total += bytes[i] ?? 0;
  return total;
}
export function run(): number {
  const list: Uint8Array[] = [new Uint8Array([20, 1]), new Uint8Array([21])];
  let total = 0;
  for (const bytes of list) total += sum(bytes);
  return total === 42 ? 42 : 1;
}`,
    untyped: `function sum(bytes) {
  let total = 0;
  for (let i = 0; i < bytes.length; i++) total += bytes[i] ?? 0;
  return total;
}
export function run() {
  const list = [new Uint8Array([20, 1]), new Uint8Array([21])];
  let total = 0;
  for (const bytes of list) total += sum(bytes);
  return total === 42 ? 42 : 1;
}`,
  },
  {
    name: "for-of-object-list",
    typed: `export function run(): number {
  const items = [{ value: 40 }, { value: 2 }];
  let total = 0;
  for (const item of items) total += item.value;
  return total === 42 ? 42 : 1;
}`,
    untyped: `export function run() {
  const items = [{ value: 40 }, { value: 2 }];
  let total = 0;
  for (const item of items) total += item.value;
  return total === 42 ? 42 : 1;
}`,
  },
  {
    name: "reassignment-narrowing",
    typed: `interface Item { readonly value: number }
function find(id: number): Item | undefined { return id > 0 ? { value: id } : undefined; }
export function run(): number {
  let first = find(0);
  first = first === undefined ? { value: 40 } : first;
  let second = find(0);
  second ??= { value: 2 };
  return first.value + second.value === 42 ? 42 : 1;
}`,
    untyped: `function find(id) { return id > 0 ? { value: id } : undefined; }
export function run() {
  let first = find(0);
  first = first === undefined ? { value: 40 } : first;
  let second = find(0);
  second ??= { value: 2 };
  return first.value + second.value === 42 ? 42 : 1;
}`,
  },
  {
    // A guard on a mutable binding holds after inner loops, switches and
    // labelled statements that never assign the binding (gc-granule and
    // gc-release fixtures; the typed checker used to drop it there).
    name: "loop-narrowing",
    typed: `interface Cell { readonly id: number; readonly next: Cell | undefined }
function walk(head: Cell | undefined): number {
  let total = 0;
  let cell: Cell | undefined = head;
  while (cell !== undefined) {
    total += cell.id;
    for (let j = 0; j < cell.id; j++) total += j;
    switch (cell.id) {
      case 1:
        total += 100;
        break;
      default:
        total += 1;
    }
    scan: for (let j = 0; j < 4; j++) if (j === cell.id) break scan;
    cell = cell.next;
  }
  return total;
}
export function run(): number {
  const chain: Cell = { id: 1, next: { id: 3, next: undefined } };
  return walk(chain) === 108 && walk(undefined) === 0 ? 42 : 1;
}`,
    untyped: `function walk(head) {
  let total = 0;
  let cell = head;
  while (cell !== undefined) {
    total += cell.id;
    for (let j = 0; j < cell.id; j++) total += j;
    switch (cell.id) {
      case 1:
        total += 100;
        break;
      default:
        total += 1;
    }
    scan: for (let j = 0; j < 4; j++) if (j === cell.id) break scan;
    cell = cell.next;
  }
  return total;
}
export function run() {
  const chain = { id: 1, next: { id: 3, next: undefined } };
  return walk(chain) === 108 && walk(undefined) === 0 ? 42 : 1;
}`,
  },
  {
    // Writes and updates to fields every member of a record union declares
    // with a type the value fits, at different positions in each member
    // (gc-granule fixture).
    name: "union-field-write-shared",
    typed: `interface One { readonly kind: "one"; next: Item | undefined; count: number }
interface Three { readonly kind: "three"; text: string; count: number; next: Item | undefined }
type Item = One | Three;
function link(old: Item, tail: Item): boolean {
  old.next = tail;
  old.count += 1;
  return old.next === tail;
}
export function run(): number {
  const one: One = { kind: "one", next: undefined, count: 0 };
  const three: Three = { kind: "three", text: "x", count: 10, next: undefined };
  return link(one, three) && link(three, one) && three.next === one &&
    one.count === 1 && three.count === 11 && three.text === "x" ? 42 : 1;
}`,
    untyped: `function link(old, tail) {
  old.next = tail;
  old.count += 1;
  return old.next === tail;
}
export function run() {
  const one = { kind: "one", next: undefined, count: 0 };
  const three = { kind: "three", text: "x", count: 10, next: undefined };
  return link(one, three) && link(three, one) && three.next === one &&
    one.count === 1 && three.count === 11 && three.text === "x" ? 42 : 1;
}`,
  },
  {
    // A write through a record union of a value one member's declared type
    // excludes: TypeScript accepts any value of the union's read type, but
    // One declares x as string, so the write must throw a TypeError when the
    // object is a One (explicit annotations are contracts). The typed path
    // has no per-member run-time check yet and falls back
    // (union-field-write capability). Type-erased Node stores the number.
    name: "union-field-write",
    typed: `interface One { readonly kind: "one"; x: string }
interface Three { readonly kind: "three"; x: string | number }
type Item = One | Three;
function set(o: Item, value: string | number): void {
  o.x = value;
}
export function run(): number {
  const one: One = { kind: "one", x: "a" };
  const three: Three = { kind: "three", x: "b" };
  set(three, 1);
  if (three.x !== 1) return 2;
  set(one, "c");
  if (one.x !== "c") return 3;
  try {
    set(one, 1);
    return 4;
  } catch (error) {
    if (!(error instanceof TypeError)) return 5;
  }
  return one.x === "c" ? 42 : 6;
}`,
    untyped: `function set(o, value) {
  o.x = value;
}
export function run() {
  const one = { kind: "one", x: "a" };
  const three = { kind: "three", x: "b" };
  set(three, 1);
  if (three.x !== 1) return 2;
  set(one, "c");
  if (one.x !== "c") return 3;
  set(one, 1);
  return one.x === 1 ? 42 : 4;
}`,
    node: { typed: 4 },
  },
  {
    // String() of a caught value, which typed code holds as unknown
    // (gc-release fixture): native errors (with and without messages) and
    // primitives of each kind.
    name: "caught-value-string",
    typed: `function risky(n: number): number {
  if (n === 1) throw new RangeError("big " + String(n));
  if (n === 2) throw new TypeError("odd");
  if (n === 3) throw new Error();
  if (n === 4) throw "text";
  if (n === 5) throw 42.5;
  if (n === 6) throw undefined;
  if (n === 7) throw null;
  if (n === 8) throw false;
  if (n === 9) throw true;
  return n;
}
function measure(n: number): string {
  try {
    return String(risky(n));
  } catch (error) {
    return String(error);
  }
}
export function run(): number {
  const expected = ["RangeError: big 1", "TypeError: odd", "Error", "text", "42.5", "undefined", "null", "false", "true", "10"];
  for (let i = 0; i < expected.length; i++)
    if (measure(i + 1) !== expected[i]) return 10 + i;
  return 42;
}`,
    untyped: `function risky(n) {
  if (n === 1) throw new RangeError("big " + String(n));
  if (n === 2) throw new TypeError("odd");
  if (n === 3) throw new Error();
  if (n === 4) throw "text";
  if (n === 5) throw 42.5;
  if (n === 6) throw undefined;
  if (n === 7) throw null;
  if (n === 8) throw false;
  if (n === 9) throw true;
  return n;
}
function measure(n) {
  try {
    return String(risky(n));
  } catch (error) {
    return String(error);
  }
}
export function run() {
  const expected = ["RangeError: big 1", "TypeError: odd", "Error", "text", "42.5", "undefined", "null", "false", "true", "10"];
  for (let i = 0; i < expected.length; i++)
    if (measure(i + 1) !== expected[i]) return 10 + i;
  return 42;
}`,
  },
  {
    name: "module-initializers",
    typed: `function scale(n: number): number { return n * 2; }
const table: number[] = [];
for (let i = 0; i < 4; i++) table.push(scale(i));
const total: number = table.reduce((a: number, b: number) => a + b, 0) + scale(15);
export function run(): number { return total === 42 ? 42 : 1; }`,
    untyped: `function scale(n) { return n * 2; }
const table = [];
for (let i = 0; i < 4; i++) table.push(scale(i));
const total = table.reduce((a, b) => a + b, 0) + scale(15);
export function run() { return total === 42 ? 42 : 1; }`,
  },
  {
    name: "evolving-empty-array",
    typed: `export function run(): number {
  let list = [];
  list.push(40);
  list.push(2);
  return (list[0] ?? 0) + (list[1] ?? 0) === 42 ? 42 : 1;
}`,
    untyped: `export function run() {
  let list = [];
  list.push(40);
  list.push(2);
  return (list[0] ?? 0) + (list[1] ?? 0) === 42 ? 42 : 1;
}`,
  },
  // Class fields TypeScript proves assigned where Tint's initialization
  // analysis is stricter (assignments in both try and catch, in every
  // switch path, and a `!` field assigned after construction): the typed
  // form takes the general path until the analysis follows tsc's flow.
  {
    name: "class-initialization-try",
    typed: `function parse(text: string): number { return text.length * 21; }
class Parsed {
  value: number;
  constructor(text: string) {
    try { this.value = parse(text); } catch { this.value = 0; }
  }
}
export function run(): number { return new Parsed("ab").value === 42 ? 42 : 1; }`,
    untyped: `function parse(text) { return text.length * 21; }
class Parsed {
  constructor(text) {
    try { this.value = parse(text); } catch { this.value = 0; }
  }
}
export function run() { return new Parsed("ab").value === 42 ? 42 : 1; }`,
  },
  {
    name: "class-initialization-switch",
    typed: `class Mode {
  size: number;
  constructor(kind: number) {
    switch (kind) { case 1: this.size = 42; break; default: this.size = 0; }
  }
}
export function run(): number { return new Mode(1).size === 42 ? 42 : 1; }`,
    untyped: `class Mode {
  constructor(kind) {
    switch (kind) { case 1: this.size = 42; break; default: this.size = 0; }
  }
}
export function run() { return new Mode(1).size === 42 ? 42 : 1; }`,
  },
  {
    name: "class-definite-field",
    typed: `class Lazy {
  value!: number;
  init(): void { this.value = 42; }
}
export function run(): number { const lazy = new Lazy(); lazy.init(); return lazy.value === 42 ? 42 : 1; }`,
    untyped: `class Lazy {
  init() { this.value = 42; }
}
export function run() { const lazy = new Lazy(); lazy.init(); return lazy.value === 42 ? 42 : 1; }`,
  },
  {
    name: "discriminant-narrowing",
    typed: `type Shape = { kind: "square"; size: number } | { kind: "rect"; w: number; h: number };
function area(shape: Shape): number { return shape.kind === "square" ? shape.size * shape.size : shape.w * shape.h; }
export function run(): number { return area({ kind: "rect", w: 21, h: 2 }) === 42 ? 42 : 1; }`,
    untyped: `function area(shape) { return shape.kind === "square" ? shape.size * shape.size : shape.w * shape.h; }
export function run() { return area({ kind: "rect", w: 21, h: 2 }) === 42 ? 42 : 1; }`,
  },
];
