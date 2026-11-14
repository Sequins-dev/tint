// Frameless early exits (base cases tested and returned before the frame is
// pushed) must agree with ECMAScript: NaN and -0 operands, swapped constant
// comparisons, references against undefined, returned parameters in later
// argument registers, boolean and void results. The same source runs in Node
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

const source = `interface Tree {
  readonly value: number;
  readonly left: Tree | undefined;
  readonly right: Tree | undefined;
}
function fold(node: Tree | undefined): number {
  if (node === undefined) return 0;
  return node.value + fold(node.left) * 3 + fold(node.right);
}
function present(node: Tree | undefined): boolean {
  if (node !== undefined) return true;
  return node !== undefined && node.value > 1;
}
function fib(n: number): number {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
function swapped(n: number): number {
  if (0.5 >= n) return -0;
  return n * 2 + 1;
}
function second(a: number, b: number, c: number): number {
  if (c !== c) return b;
  return a + c;
}
function pick(a: Tree | undefined, b: Tree | undefined): Tree | undefined {
  if (a === undefined) return b;
  return a.left;
}
let effects = 0;
function touch(n: number): void {
  if (n > 10) return;
  effects = effects * 7 + n;
}
function make(depth: number, seed: number): Tree | undefined {
  if (depth === 0) return undefined;
  return {
    value: seed,
    left: make(depth - 1, (seed * 3) % 17),
    right: make(depth - 1, (seed * 5) % 19),
  };
}
function score(x: number): number {
  if (x !== x) return 1000;
  if (x === Infinity) return 3000;
  if (x === -Infinity) return 4000;
  return x === 0 && 1 / x === -Infinity ? 2000 : x;
}
export function checksum(): number {
  const tree = make(6, 1);
  let total = fold(tree);
  total = total * 3 + (present(tree) ? 1 : 2) + (present(undefined) ? 4 : 8);
  for (let i = -2; i < 18; i++) total = (total * 7 + fib(i)) % 1000003;
  const inputs: number[] = [NaN, -0, 0, 0.25, 0.5, 3, 1e9, Infinity, -Infinity];
  for (let i = 0; i < inputs.length; i++) {
    const n = inputs[i];
    if (n === undefined) return -1;
    total = (total * 7 + score(swapped(n)) + score(second(1, n, n))) % 1000003;
  }
  const picked = pick(undefined, tree);
  total = total * 3 + (picked === undefined ? 5 : picked.value);
  const next = pick(tree, undefined);
  total = total * 3 + (next === undefined ? 5 : next.value);
  const touches: number[] = [1, 20, 3, -0, 11, 10];
  for (let i = 0; i < touches.length; i++) {
    const n = touches[i];
    if (n !== undefined) touch(n);
  }
  return (total * 31 + effects) % 1000003;
}
`;

test("frameless early exits agree with ECMAScript on edge operands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-early-exit-"));
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
    "early-exit",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      rootCapacity: 65536,
    },
  );
});
