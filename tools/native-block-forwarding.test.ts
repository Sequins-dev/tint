// Frame words forwarded from registers across block edges: a block whose
// predecessors are all emitted before it starts with the words every edge
// agrees on. Many simultaneously live locals force frame homes; the fixture
// stores them before branches and reads them in successors, across chains of
// single-predecessor blocks, merges where one arm reassigns, calls and
// allocations between the store and the read (a small heap so collections
// move objects), exception handlers and loops. The same source runs in Node
// for the expected checksum and natively under LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `interface Box {
  value: number;
  label: string;
  next: Box | undefined;
}
function make(value: number, label: string): Box {
  return { value: value | 0, label, next: undefined };
}
function churn(seed: number): number {
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const box = make(seed + i, "c" + i);
    total = (total + box.value + box.label.length) | 0;
  }
  return total;
}
function fail(code: number): number {
  if (code % 3 === 1) throw make(code, "thrown");
  return (code + 1) | 0;
}
function sum(boxes: Box[]): number {
  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box === undefined) throw "box";
    total = (total * 7 + box.value + box.label.length) % 1000003;
  }
  return total;
}
function chains(seed: number, flag: number): number {
  let a = make(seed, "a"),
    b = make(seed + 1, "bb"),
    c = make(seed + 2, "ccc"),
    d = make(seed + 3, "d"),
    e = make(seed + 4, "ee"),
    f = make(seed + 5, "f"),
    g = make(seed + 6, "gg"),
    h = make(seed + 7, "h"),
    k = make(seed + 8, "kk"),
    m = make(seed + 9, "m"),
    n = make(seed + 10, "nn"),
    p = make(seed + 11, "p"),
    q = make(seed + 12, "qq"),
    r = make(seed + 13, "r");
  let text = "t" + seed,
    i0 = seed | 0,
    i1 = (seed * 3) | 0,
    i2 = (seed + flag) | 0,
    i3 = (seed ^ flag) | 0,
    i4 = (flag * 5) | 0,
    i5 = (seed - flag) | 0;
  // Reassignment in one arm, read after the merge.
  if ((flag & 1) === 0) {
    a = b;
    i0 = (i0 + i1) | 0;
  } else {
    b = c;
    i1 = (i1 + i2) | 0;
  }
  let total = (a.value + b.value + i0 + i1 + a.label.length) | 0;
  // A chain of single-predecessor blocks, each storing then branching.
  if (flag > 2) {
    d = e;
    i2 = (i2 + 7) | 0;
    if (flag > 4) {
      e = f;
      i3 = (i3 + i2) | 0;
      if (flag > 6) f = g;
      total = (total + d.value + e.value + f.value + i3) | 0;
    } else c = d;
    total = (total + g.value + h.value + c.value + i2) | 0;
  } else d = h;
  total = (total + d.value + c.value + i2 + i3) | 0;
  // A call and an allocation between the store and the read: references
  // move, caller-saved registers are clobbered.
  k = make(total, "k" + i4);
  i4 = (i4 + k.value) | 0;
  total = (total + churn(i4) + k.value + k.label.length + m.value) | 0;
  if (flag !== 3) {
    m = make(i4, k.label + text);
    text = text + m.label;
    total = (total + churn(i5) + m.value + text.length + k.value) | 0;
  } else n = k;
  total = (total + n.value + m.label.length + i4) | 0;
  // An exception handler and the code after it.
  try {
    i5 = (i5 + fail(flag + seed)) | 0;
    p = make(i5, "try");
    total = (total + i5 + p.value) | 0;
  } catch (error) {
    q = p;
    total = (total + 7 + i5 + q.value) | 0;
  }
  total = (total + i5 + p.value + q.value + p.label.length) | 0;
  // A loop: the header has a back edge, the exit sees the loop's writes.
  let node: Box | undefined = r;
  for (let i = 0; i < 5 + (flag & 3); i++) {
    const fresh: Box = make(i0 + i, "l" + i);
    fresh.next = node;
    node = fresh;
    if ((i & 1) === (flag & 1)) {
      r = fresh;
      total = (total + churn(i) + i1) | 0;
    } else {
      i1 = (i1 + i) | 0;
      total = (total + r.value) | 0;
    }
  }
  let walk = node;
  while (walk !== undefined) {
    total = (total * 3 + walk.value + walk.label.length) % 1000003;
    walk = walk.next;
  }
  const all: Box[] = [a, b, c, d, e, f, g, h, k, m, n, p, q, r];
  return (total + sum(all) + i0 + i1 + i2 + i3 + i4 + i5) % 1000003;
}
export function checksum(): number {
  let total = 0;
  for (let seed = 0; seed < 40; seed++)
    for (let flag = 0; flag < 9; flag++)
      total = (total * 31 + chains(seed, flag)) % 1000003;
  return total;
}
`;

test("frame words forwarded across block edges keep ECMAScript values", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-block-forwarding-"));
  let expected: number;
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      checksum(): number;
    };
    expected = module.checksum();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "block-forwarding",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 4194304,
      allocationCapacity: 1048576,
      rootCapacity: 65536,
    },
  );
});
