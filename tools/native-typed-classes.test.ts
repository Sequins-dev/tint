// Typed classes declared at module scope (docs/design-typed-classes.md, C1
// steps 1 and 2): module instances evaluate each class statement in their
// initializer, where its contract resolves; closure lowering defines it there
// with one closure per member. The fixtures cover field initialization order,
// constructor bodies, statics and their order against the class bindings,
// method identity, own overrides and prototype mutation from typed code,
// `instanceof`, `typeof`, exceptions from initializers and constructor bodies,
// and instances surviving collections under a small heap. Each source runs in
// Node for the expected trace and natively under LLDB on the typed path.
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
