// Untyped locals and parameters tested as numbers carry a number shadow
// (shadowGeneralNumbers): a presence flag and an unboxed value kept with
// every store. These sections move values between Number and other
// categories inside loops, through parameters, exceptions and closures, and
// check -0, NaN and BigInt, so a stale or misclassified shadow changes an
// observation. Node computes the expected observations from the same source;
// the native image runs under LLDB through the general path.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const source = `function sum(values) {
  let total = 0;
  for (let i = 0; i < values.length; i++) total = total + values[i];
  return total;
}
function add(a, b) {
  return a + b;
}
function lessThan(a, b) {
  return a < b ? 1 : 0;
}
function transitions(n) {
  let x = 0;
  let trace = "";
  for (let i = 0; i < n; i++) {
    if (i === 3) x = "s";
    else if (i === 5) x = 1;
    else if (i === 7) x = { valueOf() { return 10; } };
    x = x + i;
    trace += typeof x + ":" + String(x) + ";";
  }
  return trace;
}
function guarded(v) {
  let r = v;
  let n = 0;
  while (typeof r === "number" && n < 5) {
    r = r * 2;
    n++;
    if (n === 3) r = String(r);
  }
  return typeof r + String(r) + n;
}
function zeros() {
  let z = -0;
  let t = -0;
  for (let i = 0; i < 2; i++) t = t + z;
  let m = -0;
  for (let i = 0; i < 1; i++) m = m * 1;
  let p = 0;
  for (let i = 0; i < 2; i++) p = p + z;
  return [1 / t, 1 / m, 1 / p, 0 / 0 < 1, NaN === NaN].map(String).join(",");
}
function caught() {
  let x = 1;
  try {
    x = x + 1;
    throw x;
  } catch (e) {
    x = "c" + e;
  }
  for (let i = 0; i < 2; i++) x = x + i;
  return x;
}
function captured() {
  let c = 0;
  const bump = () => {
    c = "b" + c;
  };
  for (let i = 0; i < 4; i++) {
    c = c + 1;
    if (i === 1) bump();
  }
  return String(c);
}
function params(a, b) {
  let r = 0;
  if (typeof a === "number") r = a * 3;
  return [r, a < b, a + b].map(String).join(",");
}
function shadowedSwap(a, b) {
  let x = a;
  let y = b;
  for (let i = 0; i < 3; i++) {
    const t = x;
    x = y;
    y = typeof t === "number" ? t + 1 : t;
  }
  return String(x) + "|" + String(y);
}
export function sections() {
  return [
    String(sum([1, 2, 3.5])),
    String(sum([1, "2", 3])),
    String(add(1, 2)) + String(add("a", 2)) + String(add(undefined, 1)),
    String(lessThan(1, 2)) + String(lessThan("b", "a")) + String(lessThan(NaN, 1)),
    transitions(9),
    guarded(3) + guarded("x") + guarded(1.5),
    zeros(),
    caught(),
    captured(),
    params(2, 3) + params("2", "10") + params(1n, 2n) + params(undefined, 1),
    shadowedSwap(1, "s") + shadowedSwap(2, 3),
  ];
}
`;

test("general number shadows keep JavaScript values across category changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-general-numbers-"));
  let expected: string[];
  try {
    const file = join(directory, "fixture.mjs");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      sections(): string[];
    };
    expected = module.sections();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(expected.length, 11);
  // Exit status 42 when every section matches, else 10 + the first
  // mismatching section's index.
  let general = false;
  verifyHostedFixture(
    source +
      `export function run() {
  const actual = sections();
  const expected = ${JSON.stringify(expected)};
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i]) return 10 + i;
  return 42;
}\n`,
    "general-numbers",
    [],
    [],
    [],
    [],
    {
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      onGeneralFallback: () => {
        general = true;
      },
    },
  );
  assert.ok(general, "expected the general path");
});
