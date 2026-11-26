// Typed classes declared at module scope (docs/design-typed-classes.md, C1
// steps 1 and 2): module instances evaluate each class statement in their
// initializer, where its contract resolves; closure lowering defines it there
// with one closure per member. The fixtures cover field initialization order,
// constructor bodies, statics and their order against the class bindings,
// method identity, own overrides and prototype mutation from typed code,
// `instanceof`, `typeof`, exceptions from initializers and constructor bodies,
// instances surviving collections under a small heap, `delete` of fields
// that admit undefined, fields read before their first assignment, and
// accessors. Each source runs in Node for the expected trace and natively
// under LLDB, on the typed path unless a test asserts the general-path
// partition.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixtures must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const semantics = `let log = "";
function note(text: string): number {
  log += text + ";";
  return log.length;
}
function early(): string {
  try {
    return new Late().name;
  } catch (e) {
    return e instanceof Error ? "threw" : "other";
  }
}
const before = 0;
class Late {
  name: string = "late";
}
class Counter {
  static created: number = note("static created");
  static label: string = "counter";
  static last: Counter | undefined;
  first: number = note("first");
  count: number;
  readonly label: string = "c" + String(note("label"));
  last: number | undefined;
  constructor(start: number) {
    note("body " + String(start));
    this.count = start;
    Counter.created += 1;
    Counter.last = this;
  }
  step(by: number): number {
    this.count += by;
    return this.count;
  }
  describe(): string {
    return this.label + ":" + String(this.count);
  }
  static summary(): string {
    return Counter.label + "/" + String(Counter.created);
  }
}
const after = note("after class " + early());
class Account {
  balance: number;
  readonly owner: string;
  constructor(owner: string, balance: number) {
    this.owner = owner;
    this.balance = balance;
  }
  deposit(amount: number): number {
    this.balance += amount;
    return this.balance;
  }
}
interface Plain {
  readonly count: number;
}
function check(value: unknown): string {
  return String(value instanceof Counter) + "/" + String(value instanceof Account);
}
export function trace(): string {
  const a = new Counter(1);
  const b = new Counter(10);
  note(String(a.step(2)) + "," + String(b.step(3)));
  note(a.describe());
  note(String(a.step === b.step));
  note(Counter.summary());
  note(String(Counter.last === b));
  const before = a.last;
  note(before === undefined ? "undefined" : "set");
  a.last = 5;
  const later = a.last;
  note(later === undefined ? "undefined" : String(later));
  note(String(a instanceof Counter) + "," + check(a) + "," + check(b));
  const account = new Account("ada", 10);
  account.deposit(5);
  note(String(account.deposit(27)) + account.owner + check(account));
  const plain: Plain = { count: 1 };
  note(check(plain) + check(3) + check(undefined) + check(Counter));
  a.step = (by: number): number => by * 100;
  note(String(a.step(2)) + "," + String(b.step(1)));
  Counter.prototype.describe = function (this: Counter): string {
    return "changed " + String(this.count);
  };
  note(a.describe() + "," + b.describe());
  Counter.label = "renamed";
  note(Counter.summary());
  note(typeof Counter + "," + typeof a.describe);
  return log;
}
`;

const failuresAndCollection = `let log = "";
function note(text: string): number {
  log += text + ";";
  return log.length;
}
function boom(text: string): number {
  throw new Error(text);
}
class Fragile {
  a: number = note("a");
  b: number;
  c: number = note("c");
  constructor(fail: number) {
    if (fail === 1) boom("body");
    this.b = fail + 1;
  }
}
class FailsInField {
  a: number = note("x");
  b: number = boom("field");
  c: number = note("never");
}
class Link {
  value: number;
  next: Link | undefined;
  constructor(value: number, next: Link | undefined) {
    this.value = value;
    this.next = next;
  }
  total(): number {
    let sum = 0;
    let node: Link | undefined = this;
    while (node !== undefined) {
      sum = (sum + node.value) % 1000003;
      node = node.next;
    }
    return sum;
  }
}
class Churn {
  x: number;
  y: number;
  constructor(x: number) {
    this.x = x;
    this.y = x * 2;
  }
  mix(): number {
    return this.x + this.y;
  }
}
export function trace(): string {
  try {
    new Fragile(1);
    note("no throw");
  } catch (e) {
    note(e instanceof Error ? e.message : "?");
  }
  try {
    new FailsInField();
    note("no throw");
  } catch (e) {
    note(e instanceof Error ? e.message : "?");
  }
  const fragile = new Fragile(4);
  note(String(fragile.b) + "," + String(fragile.a) + "," + String(fragile.c));
  let head: Link | undefined = undefined;
  let churn = 0;
  for (let i = 0; i < 4000; i++) {
    head = new Link(i, head);
    for (let j = 0; j < 8; j++) churn = (churn + new Churn(i + j).mix()) % 1000003;
  }
  note(String(head === undefined ? -1 : head.total()) + "," + String(churn));
  note(String(head instanceof Link) + "," + String(head !== undefined && head.next instanceof Link));
  return log;
}
`;

// TypeScript lets an object literal be typed as a class instance: such
// values are plain objects, and accesses through the class type dispatch on
// both layouts.
const classTypedLiteral = `class Box {
  value: number = 1;
  read(): number {
    return this.value;
  }
}
function make(literal: boolean): Box {
  if (literal)
    return {
      value: 2,
      read(): number {
        return 20;
      },
    };
  return new Box();
}
function total(boxes: Box[]): number {
  let sum = 0;
  for (const box of boxes) sum += box.read() + box.value;
  return sum;
}
export function trace(): string {
  const a = make(false),
    b = make(true);
  return (
    String(a.read()) + "," + String(b.read()) + "," +
    String(a instanceof Box) + "," + String(b instanceof Box) + "," +
    String(total([a, b, a]))
  );
}
`;

// Required fields read before their first assignment: through a method the
// constructor calls, through `this` escaping to another function, and by a
// numeric update. The reads give `undefined` exactly; such fields are
// stored `undefined`-capable and their reads are speculative general values.
const unprovenFields = `class Early {
  x: number;
  label: string;
  flag: boolean;
  seen: string;
  constructor() {
    this.seen = this.describe();
    this.x = 1;
    this.label = "l";
    this.flag = true;
  }
  describe(): string {
    return (
      String(this.x) + "," + String(this.label) + "," + String(this.flag) + "," +
      String(this.x === undefined) + "," + String(this.x + 1) + "," +
      typeof this.label + "," + (this.flag ? "yes" : "no") + "," + \`\${this.label}\`
    );
  }
}
function capture(note: Note): string {
  return String(note.count) + ":" + note.title;
}
class Note {
  title: string;
  count: number;
  observed: string;
  constructor(title: string) {
    this.title = title;
    this.observed = capture(this);
    this.count = 2;
  }
}
class Tally {
  total: number;
  log: string;
  constructor() {
    this.bump();
    this.log = this.show();
    this.total = 3;
    this.bump();
  }
  bump(): void {
    this.total += 1;
  }
  show(): string {
    return String(this.total);
  }
}
export function trace(): string {
  const early = new Early(),
    note = new Note("n"),
    tally = new Tally();
  return [
    early.seen,
    early.describe(),
    note.observed,
    String(note.count),
    tally.log,
    String(tally.total),
    String("count" in note),
  ].join("|");
}
`;

// An `undefined` read reaching a written `number` result is outside the
// result's contract: a TypeError (docs/unified-pipeline.md, contracts), where
// untyped JavaScript would return `undefined`.
const unprovenContract = `class Early {
  x: number;
  seen: string;
  constructor() {
    this.seen = this.probe();
    this.x = 1;
  }
  probe(): string {
    try {
      return String(this.read());
    } catch (error) {
      return error instanceof TypeError ? "TypeError" : "other";
    }
  }
  read(): number {
    return this.x;
  }
}
export function trace(): string {
  const early = new Early();
  return early.seen + "," + early.probe();
}
`;

// A base constructor dispatching to a subclass override reads the subclass
// field before its initializer runs (C2): the general path observes
// `undefined` exactly.
const uninitializedReads = `class Base {
  seen: string;
  constructor() {
    this.seen = this.describe();
  }
  describe(): string {
    return "base";
  }
}
class Derived extends Base {
  label: string = "derived";
  describe(): string {
    return String(this.label);
  }
}
export function trace(): string {
  const derived = new Derived();
  return derived.seen + "," + derived.label;
}
`;

// Constructors calling the class's own methods, which read assigned fields
// and assign others: the checker analyzes the calls in place, so these
// classes stay typed.
const constructorMethodCalls = `class Grid {
  width: number;
  height: number;
  cells: number[];
  total: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = [];
    this.fill();
    this.total = this.sum();
  }
  fill(): void {
    for (let i = 0; i < this.width * this.height; i++) this.cells.push(i % 7);
  }
  sum(): number {
    let total = 0;
    for (const cell of this.cells) total += cell;
    return total;
  }
}
class Account {
  owner: string;
  balance: number;
  label: string = "account";
  history: string[];
  constructor(owner: string) {
    this.owner = owner;
    this.balance = 0;
    this.history = [];
    this.record("open " + this.describe());
  }
  describe(): string {
    return this.label + ":" + this.owner;
  }
  record(entry: string): void {
    this.history.push(entry);
  }
}
export function trace(): string {
  const grid = new Grid(5, 4);
  const account = new Account("ada");
  return String(grid.total) + "," + account.history.join("|");
}
`;

// `delete` of fields that admit undefined (optional, `| undefined`,
// `unknown`) and of an optional interface property: the property becomes
// absent (`in` is false, reads give undefined) until written again.
const optionalDeletes = `class Note {
  title: string;
  body?: string;
  count: number | undefined;
  extra: unknown = "x";
  constructor(title: string) {
    this.title = title;
    this.body = "text";
    this.count = 3;
  }
}
interface Options {
  name: string;
  limit?: number;
}
function presence(note: Note): string {
  return [
    "body" in note,
    "count" in note,
    "extra" in note,
    note.body === undefined,
    note.count === undefined,
    note.extra === undefined,
  ].join(",");
}
export function trace(): string {
  const note = new Note("a");
  const before = presence(note);
  const removed = [delete note.body, delete note.count, delete note.extra, delete note.body].join(",");
  const after = presence(note);
  note.body = "again";
  note.extra = 1;
  const restored = presence(note) + "," + (note.body ?? "none");
  const options: Options = { name: "x", limit: 5 };
  const removedOption = String(delete options.limit);
  const optionAfter = String("limit" in options) + "," + String(options.limit === undefined);
  options.limit = 7;
  const optionRestored = String("limit" in options) + "," + String(options.limit ?? -1);
  return [before, removed, after, restored, removedOption, optionAfter, optionRestored, note.title].join("|");
}
`;

// TypeScript-only class syntax: heritage type arguments, `implements`, index
// signatures, overload signatures and optional methods. Erasure drops the
// types; the typed checker does not lower these classes yet, so the module
// takes the general path.
const typeScriptClassSyntax = `interface Shape {
  area(): number;
}
interface Named {
  name: string;
}
class Base<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
class Square extends Base<number> implements Shape, Named {
  name: string = "square";
  [key: string]: unknown;
  constructor(side: number);
  constructor(side: number, label: string);
  constructor(side: number, label?: string) {
    super(side);
    if (label !== undefined) this.name = label;
  }
  area(): number {
    return this.value * this.value;
  }
  scale(by: number): number;
  scale(by: string): number;
  scale(by: number | string): number {
    return typeof by === "number" ? this.value * by : -1;
  }
  describe?(): string {
    return this.name + ":" + String(this.area());
  }
  later?(): void;
}
export function trace(): string {
  const square = new Square(3, "box");
  const shape: Shape = square;
  return [
    String(shape.area()), square.describe?.() ?? "none", String(square.scale(2)),
    String(square.scale("x")), String(square.later === undefined), String("later" in square),
  ].join("|");
}
`;

// Accessors: getter and setter closures live in hidden prototype (or
// constructor state) slots and are called with the receiver, including
// compound assignment, a throwing getter, a getter called during
// construction, `in`, and reads through a data-only interface.
const accessors = `let log = "";
class Temperature {
  celsius: number;
  seen: string;
  constructor(celsius: number) {
    this.seen = this.label;
    this.celsius = celsius;
  }
  get fahrenheit(): number {
    log += "get;";
    return this.celsius * 9 / 5 + 32;
  }
  set fahrenheit(value: number) {
    log += "set " + String(value) + ";";
    this.celsius = (value - 32) * 5 / 9;
  }
  get label(): string {
    return String(this.celsius) + "C";
  }
  get broken(): number {
    throw new RangeError("no reading");
  }
  static scale: string = "metric";
  static get describe(): string {
    return "scale:" + Temperature.scale;
  }
  static set describe(value: string) {
    Temperature.scale = value;
  }
}
interface Labeled {
  readonly label: string;
}
function read(value: Temperature): string {
  return value.label;
}
export function trace(): string {
  const t = new Temperature(100);
  const before = t.fahrenheit;
  t.fahrenheit = 32;
  t.fahrenheit += 18;
  let caught = "none";
  try {
    caught = String(t.broken);
  } catch (error) {
    caught = error instanceof RangeError ? error.message : "other";
  }
  Temperature.describe = "imperial";
  const labeled: Labeled = t;
  return [
    String(before), String(t.celsius), t.label, t.seen, Temperature.describe,
    caught, String("label" in t), labeled.label, read(t), log,
  ].join("|");
}
`;

// Class values reaching general code (a dynamic object, a thrown value, an
// exported `unknown` result) need record views (step 4); until then the
// module takes the general path and runs with JavaScript semantics, never
// as a raw record and never as a build error.
const classEscape = `class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
export function exposed(): unknown {
  return new Point(1, 2);
}
function roundTrip(value: unknown): number {
  return value instanceof Point ? value.sum() : -1;
}
export function trace(): string {
  const point = new Point(3, 4);
  const bag: Record<string, unknown> = {};
  bag.point = point;
  const stored = bag.point;
  let keys = "none";
  if (typeof stored === "object" && stored !== null) keys = Object.keys(stored).join(",");
  let thrown = "none";
  try {
    throw point;
  } catch (error) {
    thrown = String(roundTrip(error));
  }
  return [keys, String(roundTrip(stored)), String(roundTrip(exposed())), thrown, JSON.stringify(point)].join("|");
}
`;

// Class instances and object literals behind one interface with methods:
// member calls through a method signature pass the object as the receiver,
// so class methods and arrow functions both implement it.
const interfaceMethods = `interface Shape {
  readonly name: string;
  area(): number;
  scaled(by: number): number;
}
class Square implements Shape {
  name: string = "square";
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
  scaled(by: number): number {
    return this.area() * by;
  }
}
class Circle {
  name: string = "circle";
  r: number;
  constructor(r: number) {
    this.r = r;
  }
  area(): number {
    return 3 * this.r * this.r;
  }
  scaled(by: number): number {
    return this.area() * by * 2;
  }
}
function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area() + shape.scaled(2);
  return sum;
}
export function trace(): string {
  const literal: Shape = {
    name: "literal",
    area: (): number => 7,
    scaled: (by: number): number => by * 10,
  };
  const shapes: Shape[] = [new Square(2), new Circle(1), literal];
  const names = shapes.map((shape: Shape): string => shape.name).join(",");
  return names + "|" + String(total(shapes)) + "|" + String(shapes[0]?.area() ?? -1);
}
`;

// Object-literal methods reading `this` under an interface with method
// signatures: `this` is the interface (TypeScript's noImplicitThis), and
// calls through the signature pass the object, as for class instances.
const literalMethods = `interface Counter {
  count: number;
  bump(by: number): number;
  label(): string;
}
class Tally implements Counter {
  count: number = 10;
  bump(by: number): number {
    this.count += by;
    return this.count;
  }
  label(): string {
    return "tally:" + String(this.count);
  }
}
function drive(counter: Counter, times: number): string {
  for (let i = 0; i < times; i++) counter.bump(i);
  return counter.label();
}
export function trace(): string {
  const literal: Counter = {
    count: 0,
    bump(by: number): number {
      this.count += by * 2;
      return this.count;
    },
    label() {
      return "literal:" + String(this.count);
    },
  };
  return [drive(literal, 4), drive(new Tally(), 3), String(literal.bump(1))].join("|");
}
`;

async function expectedTrace(text: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-typed-classes-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, text);
    const module = (await import(pathToFileURL(file).href)) as {
      trace(): string;
    };
    return module.trace();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function withComparison(text: string, expected: string): string {
  return (
    text +
    `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`
  );
}

test("typed classes follow JavaScript evaluation and object semantics", async () => {
  const expected = await expectedTrace(semantics);
  assert.match(
    expected,
    /^static created;after class late;first;label;body 1;/,
  );
  verifyHostedFixture(
    withComparison(semantics, expected),
    "typed-classes",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("typed class construction propagates exceptions and survives collection", async () => {
  const expected = await expectedTrace(failuresAndCollection);
  assert.match(expected, /^a;c;body;x;field;/);
  verifyHostedFixture(
    withComparison(failuresAndCollection, expected),
    "typed-classes-collection",
    [],
    [],
    [],
    [],
    // A small heap: the nursery fills every few hundred instances.
    {
      requireTyped: true,
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 4194304,
      allocationCapacity: 262144,
      rootCapacity: 65536,
    },
  );
});

test("object literals typed as a class stay plain objects", async () => {
  const expected = await expectedTrace(classTypedLiteral);
  assert.equal(expected, "1,20,true,false,26");
  verifyHostedFixture(
    withComparison(classTypedLiteral, expected),
    "typed-classes-literal",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("fields read before their first assignment read undefined on the typed path", async () => {
  const expected = await expectedTrace(unprovenFields);
  assert.equal(
    expected,
    "undefined,undefined,undefined,true,NaN,undefined,no,undefined|1,l,true,false,2,string,yes,l|undefined:n|2|NaN|4|true",
  );
  verifyHostedFixture(
    withComparison(unprovenFields, expected),
    "typed-classes-unproven",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("an undefined read returned through a number result throws a TypeError", async () => {
  assert.equal(await expectedTrace(unprovenContract), "undefined,1");
  verifyHostedFixture(
    withComparison(unprovenContract, "TypeError,1"),
    "typed-classes-unproven-contract",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("base constructors dispatching to subclass overrides take the general path", async () => {
  const expected = await expectedTrace(uninitializedReads);
  assert.equal(expected, "undefined,derived");
  let partition: readonly string[] | undefined;
  delete process.env.TINT_GENERAL_FALLBACK;
  try {
    verifyHostedFixture(
      withComparison(uninitializedReads, expected),
      "typed-classes-uninitialized",
      [],
      [],
      [],
      [],
      {
        managedBytes: 67108864,
        allocationCapacity: 1048576,
        onGeneralFallback(modules) {
          partition = modules;
        },
      },
    );
  } finally {
    process.env.TINT_GENERAL_FALLBACK = "0";
  }
  assert.deepEqual(partition, ["fixture"]);
});

test("constructors calling their own methods stay typed", async () => {
  const expected = await expectedTrace(constructorMethodCalls);
  assert.equal(expected, "57,open account:ada");
  verifyHostedFixture(
    withComparison(constructorMethodCalls, expected),
    "typed-classes-constructor-methods",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("optional fields and properties are deleted on the typed path", async () => {
  const expected = await expectedTrace(optionalDeletes);
  assert.equal(
    expected,
    "true,true,true,false,false,false|true,true,true,true|false,false,false,true,true,true|true,false,true,false,true,false,again|true|false,true|true,7|a",
  );
  verifyHostedFixture(
    withComparison(optionalDeletes, expected),
    "typed-classes-delete",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("TypeScript-only class syntax compiles on the general path", async () => {
  const expected = await expectedTrace(typeScriptClassSyntax);
  assert.equal(expected, "9|box:9|6|-1|true|false");
  let partition: readonly string[] | undefined;
  delete process.env.TINT_GENERAL_FALLBACK;
  try {
    verifyHostedFixture(
      withComparison(typeScriptClassSyntax, expected),
      "typed-classes-typescript-syntax",
      [],
      [],
      [],
      [],
      {
        managedBytes: 67108864,
        allocationCapacity: 1048576,
        onGeneralFallback(modules) {
          partition = modules;
        },
      },
    );
  } finally {
    process.env.TINT_GENERAL_FALLBACK = "0";
  }
  assert.deepEqual(partition, ["fixture"]);
});

test("class accessors call their getters and setters on the typed path", async () => {
  const expected = await expectedTrace(accessors);
  assert.equal(
    expected,
    "212|10|10C|undefinedC|scale:imperial|no reading|true|10C|10C|get;set 32;get;set 50;",
  );
  verifyHostedFixture(
    withComparison(accessors, expected),
    "typed-classes-accessors",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("class values escaping to general code build and run on the general path", async () => {
  const expected = await expectedTrace(classEscape);
  assert.equal(expected, 'x,y|7|3|7|{"x":3,"y":4}');
  let partition: readonly string[] | undefined;
  delete process.env.TINT_GENERAL_FALLBACK;
  try {
    verifyHostedFixture(
      withComparison(classEscape, expected),
      "typed-classes-escape",
      [],
      [],
      [],
      [],
      {
        managedBytes: 67108864,
        allocationCapacity: 1048576,
        onGeneralFallback(modules) {
          partition = modules;
        },
      },
    );
  } finally {
    process.env.TINT_GENERAL_FALLBACK = "0";
  }
  assert.deepEqual(partition, ["fixture"]);
});

test("class instances implement interfaces with methods on the typed path", async () => {
  const expected = await expectedTrace(interfaceMethods);
  assert.equal(expected, "square,circle,literal|54|4");
  verifyHostedFixture(
    withComparison(interfaceMethods, expected),
    "typed-classes-interface-methods",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("object-literal methods read this through an interface on the typed path", async () => {
  const expected = await expectedTrace(literalMethods);
  assert.equal(expected, "literal:12|tally:13|14");
  verifyHostedFixture(
    withComparison(literalMethods, expected),
    "typed-classes-literal-methods",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

const inheritanceSemantics = `let log = "";
function note(text: string): number {
  log += text + ";";
  return log.length;
}
function targetName(t: unknown): string {
  if (t === undefined) return "undefined";
  if (t === Base) return "Base";
  if (t === Child) return "Child";
  if (t === GrandChild) return "GrandChild";
  if (t === AutoChild) return "AutoChild";
  return "other";
}
class Base {
  bField: number = note("B.field:" + targetName(new.target));
  x: number;
  constructor(x: number) {
    note("B.ctor:" + String(x) + ":" + targetName(new.target));
    this.x = x;
  }
  baseOnly(): string {
    return "baseOnly:" + String(this.x);
  }
  describe(): string {
    return "B(" + String(this.x) + ")";
  }
  add(delta: number): number {
    return this.x + delta;
  }
}
class Child extends Base {
  cField: number = note("C.field:" + targetName(new.target));
  y: number;
  constructor(x: number, y: number) {
    note("C.pre:" + targetName(new.target));
    super(x);
    note("C.post:" + String(this.x) + ":" + String(this.cField > 0));
    this.y = y;
    note("C.superInCtor:" + super.describe());
  }
  override describe(): string {
    return "C(" + super.describe() + "," + String(this.y) + ")";
  }
  override add(delta: number): number {
    return super.add(delta) + this.y;
  }
}
class GrandChild extends Child {
  gField: number = note("G.field:" + targetName(new.target));
  z: number;
  constructor(x: number, y: number, z: number) {
    note("G.pre:" + targetName(new.target));
    super(x, y);
    this.z = z;
  }
  override describe(): string {
    return "G(" + super.describe() + "," + String(this.z) + ")";
  }
  methodNewTarget(): string {
    return targetName(new.target);
  }
}
class AutoChild extends Base {
  tag: string = "auto:" + String(note("A.field:" + targetName(new.target)));
  override describe(): string {
    return "A(" + super.describe() + "," + this.tag + ")";
  }
}
class Circle {
  readonly kind: "circle" = "circle";
  r: number;
  constructor(r: number) {
    this.r = r;
  }
  measure(): number {
    return this.r * this.r;
  }
}
class Square {
  readonly kind: "square" = "square";
  s: number;
  constructor(s: number) {
    this.s = s;
  }
  measure(): number {
    return this.s * 4;
  }
}
function checkFamily(v: unknown): string {
  return (
    String(v instanceof Base) +
    "/" +
    String(v instanceof Child) +
    "/" +
    String(v instanceof GrandChild) +
    "/" +
    String(v instanceof AutoChild) +
    "/" +
    String(v instanceof Circle)
  );
}
function narrowBase(b: Base): string {
  if (b instanceof GrandChild) return "GC:" + String(b.z);
  if (b instanceof Child) return "C:" + String(b.y);
  return "B:" + String(b.x);
}
function narrowUnion(u: Circle | Square): number {
  const byDisc = u.kind === "circle" ? u.r : u.s;
  const byInst = u instanceof Circle ? u.r * 10 : u.s * 100;
  return u.measure() + byDisc + byInst;
}
export function trace(): string {
  const b = new Base(1);
  const c = new Child(2, 3);
  const g = new GrandChild(4, 5, 6);
  const a = new AutoChild(7);
  note("desc:" + b.describe() + "|" + c.describe() + "|" + g.describe() + "|" + a.describe());
  note("inh:" + g.baseOnly() + "|" + a.baseOnly() + "|" + g.methodNewTarget());
  note("inst:" + checkFamily(b) + "," + checkFamily(c) + "," + checkFamily(g) + "," + checkFamily(a) + "," + checkFamily(42));
  const items: Base[] = [b, c, g, a];
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) throw "item";
    note("poly:" + item.describe() + ":" + narrowBase(item));
    sum += item.add(10);
  }
  note("sum:" + String(sum));
  // Argument side-effect mutating receiver's own method AFTER method read:
  // JS reads callee first, then evaluates arguments, then invokes original callee.
  const argOrder = new Child(10, 20);
  const r1 = argOrder.add(
    ((): number => {
      argOrder.add = (d: number): number => d * 1000;
      return 5;
    })(),
  );
  const r2 = argOrder.add(5);
  note("argOrder:" + String(r1) + "," + String(r2));
  // Own override and prototype mutation across hierarchy.
  g.describe = (): string => "ownG";
  note("own:" + g.describe() + "|" + c.describe());
  Base.prototype.baseOnly = function (this: Base): string {
    return "mutBase:" + String(this.x);
  };
  note("protoMut:" + b.baseOnly() + "|" + c.baseOnly() + "|" + g.baseOnly());
  // Union of distinct classes.
  note("union:" + String(narrowUnion(new Circle(3))) + "," + String(narrowUnion(new Square(5))));
  return log;
}
`;

const inheritanceErrorsAndGC = `let log = "";
function note(text: string): number {
  log += text + ";";
  return log.length;
}
class Root {
  v: number;
  constructor(v: number, explode: boolean) {
    note("Root:" + String(v));
    if (explode) throw new Error("root-boom");
    this.v = v;
  }
  id(): number {
    return this.v;
  }
}
class BadThisBeforeSuper extends Root {
  extra: number = note("badThis.field");
  constructor() {
    note("before:" + String(this.v));
    super(1, false);
  }
}
class BadSuperArgUsesThis extends Root {
  constructor() {
    super(this.v, false);
  }
}
class BadDoubleSuper extends Root {
  f: number = note("double.field");
  constructor() {
    super(1, false);
    super(2, false);
  }
}
class BadEarlyReturn extends Root {
  constructor(skip: boolean) {
    if (skip) return;
    super(3, false);
  }
}
class BadFallthrough extends Root {
  constructor(call: boolean) {
    if (call) super(4, false);
  }
}
class FinallySuper extends Root {
  f: number = note("finally.field");
  constructor() {
    try {
      return;
    } finally {
      super(5, false);
    }
  }
}
class FieldThrows extends Root {
  bad: number = ((): number => {
    note("fieldThrows");
    throw new Error("field-boom");
  })();
  constructor(rootExplode: boolean) {
    super(6, rootExplode);
    note("never");
  }
}
class GcBase {
  a: number;
  constructor(a: number) {
    this.a = a;
  }
  score(): number {
    return this.a;
  }
}
class GcMid extends GcBase {
  b: number;
  constructor(a: number, b: number) {
    super(a);
    this.b = b;
  }
  override score(): number {
    return super.score() + this.b;
  }
}
class GcLeaf extends GcMid {
  c: number;
  constructor(a: number, b: number, c: number) {
    super(a, b);
    this.c = c;
  }
  override score(): number {
    return super.score() + this.c;
  }
}
function catchKind(fn: () => void): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof Error) return e.name + ":" + e.message;
    return "non-error";
  }
}
export function trace(): string {
  note("t1:" + (catchKind(() => { new BadThisBeforeSuper(); }).startsWith("ReferenceError") ? "RefErr" : "other"));
  note("t2:" + (catchKind(() => { new BadSuperArgUsesThis(); }).startsWith("ReferenceError") ? "RefErr" : "other"));
  note("t3:" + (catchKind(() => { new BadDoubleSuper(); }).startsWith("ReferenceError") ? "RefErr" : "other"));
  note("t4:" + (catchKind(() => { new BadEarlyReturn(true); }).startsWith("ReferenceError") ? "RefErr" : "other"));
  note("t5:" + catchKind(() => { new BadEarlyReturn(false); }));
  note("t6:" + (catchKind(() => { new BadFallthrough(false); }).startsWith("ReferenceError") ? "RefErr" : "other"));
  note("t7:" + catchKind(() => { new BadFallthrough(true); }));
  const fs = new FinallySuper();
  note("t8:" + String(fs.id()) + ":" + String(fs.f > 0));
  note("t9:" + catchKind(() => { new FieldThrows(true); }));
  note("t10:" + catchKind(() => { new FieldThrows(false); }));
  // GC stress across 3-level hierarchy under small generational heap.
  const kept: GcBase[] = [];
  for (let i = 0; i < 4000; i++) {
    const inst: GcBase =
      i % 3 === 0
        ? new GcBase(i)
        : i % 3 === 1
          ? new GcMid(i, 10)
          : new GcLeaf(i, 10, 100);
    if (i % 100 === 0) kept.push(inst);
  }
  let total = 0;
  let leaves = 0;
  for (let i = 0; i < kept.length; i++) {
    const k = kept[i];
    if (k === undefined) throw "kept";
    total += k.score();
    if (k instanceof GcLeaf) leaves++;
  }
  note("gc:" + String(total) + ":" + String(leaves));
  return log;
}
`;

const inheritanceUnsupportedFallback = `class Base {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
class ReturningObject extends Base {
  constructor(x: number) {
    super(x);
    return new Base(x * 10);
  }
}
export function trace(): string {
  const r = new ReturningObject(7);
  return String(r.x) + ":" + String(r instanceof Base) + ":" + String(r instanceof ReturningObject);
}
`;

test("derived class inheritance follows JavaScript semantics on the typed path", async () => {
  const expected = await expectedTrace(inheritanceSemantics);
  verifyHostedFixture(
    withComparison(inheritanceSemantics, expected),
    "typed-classes-inheritance",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("derived class super errors, exceptions and GC survival work on the typed path", async () => {
  const expected = await expectedTrace(inheritanceErrorsAndGC);
  verifyHostedFixture(
    withComparison(inheritanceErrorsAndGC, expected),
    "typed-classes-inheritance-errors-gc",
    [],
    [],
    [],
    [],
    {
      requireTyped: true,
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 4194304,
      allocationCapacity: 262144,
      rootCapacity: 65536,
    },
  );
});

test("unsupported derived constructor return takes the general path", async () => {
  const expected = await expectedTrace(inheritanceUnsupportedFallback);
  assert.equal(expected, "70:true:false");
  let partition: readonly string[] | undefined;
  delete process.env.TINT_GENERAL_FALLBACK;
  try {
    verifyHostedFixture(
      withComparison(inheritanceUnsupportedFallback, expected),
      "typed-classes-inheritance-fallback",
      [],
      [],
      [],
      [],
      {
        managedBytes: 67108864,
        allocationCapacity: 1048576,
        onGeneralFallback(modules) {
          partition = modules;
        },
      },
    );
  } finally {
    process.env.TINT_GENERAL_FALLBACK = "0";
  }
  assert.deepEqual(partition, ["fixture"]);
});
