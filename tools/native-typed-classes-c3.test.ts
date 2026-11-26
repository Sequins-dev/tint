// Typed classes Phase C3 (docs/design-typed-classes.md): private elements
// (#field, #method, get #x / set #x, static #...), ergonomic brand checks
// (#x in expr), static initialization blocks (static { ... }), named and
// anonymous class expressions (with extends), GC survival, and explicit
// general-path fallbacks. Each fixture runs in Node for the expected trace
// and natively under LLDB on the typed path (TINT_GENERAL_FALLBACK=0), unless
// a test explicitly verifies the general-path fallback partition.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const privateElementsAndBrandChecks = `let log = "";
function note(text: string): number {
  log += text + ";";
  return log.length;
}
function catchErr(fn: () => void): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof TypeError) return "TypeError";
    if (e instanceof Error) return e.name;
    return "other";
  }
}

class Base {
  #x: number = 10;
  readonly #tag: string;
  #opt: number | undefined;
  #earlyCheck: string = this.probeEarly();
  #later: number = 99;
  static #count: number = 0;
  static #prefix: string = "B";

  constructor(tag: string) {
    this.#tag = tag;
    Base.#count += 1;
    this.duringSuper();
  }
  duringSuper(): void {}
  probeEarly(): string {
    const hasLater = #later in this;
    const readErr = catchErr(() => {
      const v = this.#later;
      note("bad:" + String(v));
    });
    const writeErr = catchErr(() => {
      this.#later = 1;
    });
    return String(hasLater) + "/" + readErr + "/" + writeErr;
  }
  #double(): number {
    return this.#x * 2;
  }
  get #scaled(): number {
    return this.#x * 10;
  }
  set #scaled(v: number) {
    this.#x = v / 10;
  }
  get #onlyGet(): string {
    return this.#tag + ":" + String(this.#x);
  }
  set #onlySet(v: string) {
    note("onlySet:" + v);
  }
  static #format(n: number): string {
    return Base.#prefix + "#" + String(n);
  }
  static get #summary(): string {
    return Base.#format(Base.#count);
  }
  static set #summary(p: string) {
    Base.#prefix = p;
  }
  baseInfo(): string {
    this.#opt ??= 7;
    this.#scaled += 50;
    this.#onlySet = "hi";
    return [
      String(this.#x),
      String(this.#double()),
      this.#onlyGet,
      String(this.#opt ?? -1),
      String(this.#later),
      this.#earlyCheck,
    ].join(",");
  }
  addOther(other: Base): number {
    return this.#x + other.#x;
  }
  inspectUnknown(v: unknown): string {
    if (#x in v) {
      return "base:" + String(v.#x) + ":" + String(#double in v) + ":" + String(#scaled in v);
    }
    return "no-base";
  }
  checkStaticBrand(v: unknown): string {
    return String(#count in v) + "/" + String(#format in v) + "/" + String(#summary in v);
  }
  readStaticOn(useDerived: boolean): string {
    const ctor = useDerived ? Derived : Base;
    return String(ctor.#count) + ":" + ctor.#format(ctor.#count) + ":" + ctor.#summary;
  }
  callStaticMethodOn(useDerived: boolean): string {
    const ctor = useDerived ? Derived : Base;
    return ctor.#format(7);
  }
  setPrefixOn(useDerived: boolean, p: string): void {
    const ctor = useDerived ? Derived : Base;
    ctor.#summary = p;
  }
}

class StaticVault {
  static #secret: number = 42;
  static #label: string = "V";
  static #fmt(n: number): string {
    return this.#label + "=" + String(n);
  }
  static get #info(): string {
    return this.#fmt(this.#secret);
  }
  static set #info(v: string) {
    this.#label = v;
  }
  static read(): string {
    return this.#info;
  }
  static rename(v: string): void {
    this.#info = v;
  }
}

class Derived extends Base {
  #x: string = "derived";
  #n: number;
  constructor(tag: string, n: number = 0) {
    super(tag);
    this.#n = n;
  }
  duringSuper(): void {
    note("superHas:" + String(#x in this) + "," + String(#m in this));
    note("superRead:" + catchErr(() => { note(this.#x); }));
    note("superWrite:" + catchErr(() => { this.#x = "oops"; }));
    note("superMethod:" + catchErr(() => { this.#m(); }));
  }
  #m(): string {
    return this.#x + ":" + String(this.#n);
  }
  derivedInfo(): string {
    this.#x += "!";
    this.#n++;
    return this.#m();
  }
  static inspectDerived(v: unknown): string {
    if (#x in v) {
      return "derived:" + v.#x + ":" + String(#m in v);
    }
    return "no-derived";
  }
}

class Sibling {
  #x: number = 555;
  val(): number {
    return this.#x;
  }
}

interface PublicOnly {
  baseInfo(): string;
}

export function trace(): string {
  const b = new Base("b1");
  const d = new Derived("d1", 4);
  const s = new Sibling();
  const plain: PublicOnly = b;
  note("b:" + plain.baseInfo());
  note("d:" + d.baseInfo() + "|" + d.derivedInfo());
  note("cross:" + String(b.addOther(d)));
  // Mutating Base.prototype.baseInfo does not break private methods or accessors.
  Base.prototype.baseInfo = function (this: Base): string {
    return "mutated";
  };
  note("afterProto:" + d.derivedInfo() + "|" + b.inspectUnknown(d));
  note("brands:" + [
    b.inspectUnknown(b),
    b.inspectUnknown(s),
    b.inspectUnknown({ x: 1 }),
    Derived.inspectDerived(d),
    Derived.inspectDerived(b),
    Derived.inspectDerived(s),
  ].join("|"));
  note("primIn:" + [
    catchErr(() => { b.inspectUnknown(42); }),
    catchErr(() => { b.inspectUnknown("str"); }),
    catchErr(() => { b.inspectUnknown(null); }),
    catchErr(() => { b.inspectUnknown(undefined); }),
    catchErr(() => { b.inspectUnknown(true); }),
  ].join(","));
  note("static:" + b.readStaticOn(false) + "|" + StaticVault.read());
  b.setPrefixOn(false, "Z");
  StaticVault.rename("W");
  note("static2:" + b.readStaticOn(false) + "|" + StaticVault.read());
  // Subclass constructor accessing Base's static private members throws TypeError!
  note("subStaticErr:" + [
    catchErr(() => { b.readStaticOn(true); }),
    catchErr(() => { b.callStaticMethodOn(true); }),
    catchErr(() => { b.setPrefixOn(true, "X"); }),
  ].join(","));
  note("staticBrands:" + [
    b.checkStaticBrand(Base),
    b.checkStaticBrand(Derived),
    b.checkStaticBrand(b),
    b.checkStaticBrand(Sibling),
    catchErr(() => { b.checkStaticBrand(123); }),
  ].join("|"));
  note("sib:" + String(s.val()));
  return log;
}
`;

const staticBlocksAndClassExpressions = `let log = "";
function note(text: string): number {
  log += text + ";";
  return log.length;
}
function catchErr(fn: () => void): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof TypeError) return "TypeError";
    if (e instanceof RangeError) return "RangeError";
    if (e instanceof Error) return e.name + ":" + e.message;
    return "other";
  }
}

// 1. Interleaved static fields and static blocks, including private statics
// and uninitialized static fields assigned inside a static block.
class Ordered {
  static a: number = note("field-a");
  static uninit: number;
  static #secret: number;
  static {
    note("block-1:a=" + String(this.a) + ",hasLate=" + String(#late in this));
    Ordered.uninit = this.a * 10;
    Ordered.#secret = 77;
    let earlyLate = "ok";
    try {
      const x = this.#late;
      note(String(x));
    } catch (e) {
      earlyLate = e instanceof TypeError ? "TypeError" : "other";
    }
    note("block-1:earlyLate=" + earlyLate);
  }
  static b: number = note("field-b:" + String(Ordered.uninit));
  static #late: number = note("field-late");
  static {
    note("block-2:b=" + String(Ordered.b) + ",hasLate=" + String(#late in this) + ",late=" + String(this.#late));
    this.#secret += this.#late;
  }
  static report(): string {
    return String(Ordered.a) + "," + String(Ordered.uninit) + "," + String(Ordered.b) + "," + String(Ordered.#secret);
  }
}

// 2. Static block throw prevents partial publication (inside a function scope).
function failingStaticBlock(): string {
  let reached = false;
  const err = catchErr(() => {
    const Bad = class {
      static x: number = note("bad-x");
      static {
        note("bad-block");
        throw new RangeError("static-boom");
      }
      static y: number = note("bad-y-never");
    };
    reached = typeof Bad === "function";
  });
  return err + ":" + String(reached);
}

// 3. Named and anonymous class expressions, heritage, inner binding identity.
const Named = class Inner {
  #value: number;
  static #tag: string = "inner";
  static {
    note("named-static:" + String(this === Inner) + ":" + Inner.#tag);
  }
  constructor(v: number) {
    this.#value = v;
  }
  #bump(by: number): number {
    this.#value += by;
    return this.#value;
  }
  describe(): string {
    return Inner.#tag + ":" + String(this.#bump(1)) + ":" + String(this instanceof Inner);
  }
  static make(v: number): Inner {
    return new Inner(v);
  }
  static isInner(x: unknown): boolean {
    return #value in x;
  }
};

const AnonBase = class {
  #base: number;
  constructor(n: number) {
    this.#base = n;
  }
  #double(): number {
    return this.#base * 2;
  }
  getBase(): number {
    return this.#double();
  }
  hasBase(x: unknown): boolean {
    return #base in x;
  }
};

const AnonSub = class extends AnonBase {
  #extra: string;
  constructor(n: number, extra: string) {
    super(n);
    this.#extra = extra;
  }
  full(): string {
    return this.#extra + "=" + String(this.getBase());
  }
  static hasExtra(x: unknown): boolean {
    return #extra in x;
  }
};

function makeAdder(delta: number): string {
  const Adder = class LocalAdder {
    #base: number;
    static {
      note("local-static:" + String(delta));
    }
    constructor(start: number) {
      this.#base = start;
    }
    run(): number {
      return this.#base + delta;
    }
  };
  return String(new Adder(10).run()) + "/" + String(new Adder(25).run());
}

export function trace(): string {
  note("ordered:" + Ordered.report());
  note("fail:" + failingStaticBlock());
  const n = Named.make(5);
  note("named:" + n.describe() + ":" + String(Named.isInner(n)) + ":" + String(Named.isInner({})));
  const a = new AnonBase(3);
  const sub = new AnonSub(7, "sub");
  note("anon:" + String(a.getBase()) + "|" + sub.full() + "|" +
    String(a.hasBase(sub)) + "," + String(AnonSub.hasExtra(sub)) + "," + String(AnonSub.hasExtra(a)));
  note("factory:" + makeAdder(4) + "|" + makeAdder(100));
  return log;
}
`;

const privateElementsGC = `class Box {
  #id: number;
  #label: string;
  #next: Box | undefined;
  constructor(id: number, label: string, next: Box | undefined) {
    this.#id = id;
    this.#label = label;
    this.#next = next;
  }
  #score(): number {
    return this.#id + this.#label.length;
  }
  get #summary(): number {
    return this.#score();
  }
  total(): number {
    let sum = 0;
    let cur: Box | undefined = this;
    while (cur !== undefined) {
      sum = (sum + cur.#summary) % 1000003;
      cur = cur.#next;
    }
    return sum;
  }
  static check(x: unknown): boolean {
    return #id in x && #score in x;
  }
}

export function trace(): string {
  let chain: Box | undefined = undefined;
  for (let i = 1; i <= 60; i++) {
    chain = new Box(i, "item-" + String(i), chain);
  }
  for (let i = 0; i < 3000; i++) {
    const tmp = new Box(i, "tmp-" + String(i), undefined);
    if (!Box.check(tmp)) throw new Error("lost brand");
  }
  if (chain === undefined) throw new Error("empty");
  return String(chain.total()) + ":" + String(Box.check(chain)) + ":" + String(Box.check({}));
}
`;

const dynamicHeritageFallback = `class A {
  x: number = 1;
}
function pick(): { new (): A } {
  return A;
}
const Dyn = class extends pick() {
  y: number = 2;
};
export function trace(): string {
  const d = new Dyn();
  return String(d.x + d.y) + ":" + String(d instanceof A);
}
`;

async function expectedTrace(text: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "tint-typed-classes-c3-node-"));
  try {
    const file = join(dir, "fixture.ts");
    writeFileSync(file, text);
    const mod = (await import(pathToFileURL(file).href)) as {
      trace: () => string;
    };
    return mod.trace();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withComparison(text: string, expected: string): string {
  return (
    text +
    `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`
  );
}

test("private elements, accessors, static privates and brand checks follow JS semantics on the typed path", async () => {
  const expected = await expectedTrace(privateElementsAndBrandChecks);
  verifyHostedFixture(
    withComparison(privateElementsAndBrandChecks, expected),
    "typed-classes-c3-private",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("static initialization blocks and class expressions follow JS semantics on the typed path", async () => {
  const expected = await expectedTrace(staticBlocksAndClassExpressions);
  verifyHostedFixture(
    withComparison(staticBlocksAndClassExpressions, expected),
    "typed-classes-c3-static-expr",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

test("private elements and brand checks survive GC under a small heap on the typed path", async () => {
  const expected = await expectedTrace(privateElementsGC);
  verifyHostedFixture(
    withComparison(privateElementsGC, expected),
    "typed-classes-c3-gc",
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

test("dynamic class expression heritage falls back explicitly to the general path", async () => {
  const expected = await expectedTrace(dynamicHeritageFallback);
  assert.equal(expected, "3:true");
  let partition: readonly string[] | undefined;
  delete process.env.TINT_GENERAL_FALLBACK;
  try {
    verifyHostedFixture(
      withComparison(dynamicHeritageFallback, expected),
      "typed-classes-c3-fallback",
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
