import assert from "node:assert/strict";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { buildMixedGeneralCallFixture } from "./build-typed-general-call-fixture.ts";

// Tint checks explicitly typed consumption and cannot dynamically call an
// unbridged native closure. Node has neither restriction.
const typed = `
export function consume(fn: unknown): number {
  if (typeof fn !== "function") return 0;
  let open = fn();
  open = "still open";
  if (open !== "still open") return -1;
  let result: number = 0;
  result = fn();
  const copy: number = result;
  return copy;
}
function dynamic(fn: unknown, effect: () => number): unknown {
  if (typeof fn !== "function") return undefined;
  return fn(effect());
}
export function nativeClosure(): number {
  let called = false;
  let evaluated = false;
  const fn = (): number => { called = true; return 42; };
  const effect = (): number => { evaluated = true; return 1; };
  try { dynamic(fn, effect); return 1; }
  catch (error) {
    if (!(error instanceof TypeError)) return 2;
    if (error.message !== "Calling a native closure through Function requires the slice 2b closure view") return 3;
  }
  return evaluated && !called ? 42 : 4;
}
`;
const entry = `
import { consume, nativeClosure } from "trusted";
export function run() {
  if (consume(() => 42) !== 42) return 1;
  let calls = 0;
  try { consume(() => { calls++; return "wrong"; }); return 2; }
  catch (error) {
    if (!(error instanceof TypeError) || error.message !== "value does not match the asserted type") return 3;
  }
  if (calls !== 2) return 4;
  if (nativeClosure() !== 42) return 5;
  return 42;
}
`;

console.log(
  buildMixedGeneralCallFixture(entry, typed, "typed-general-call-contracts"),
);

process.env.TINT_GENERAL_FALLBACK = "0";
console.log(
  verifyHostedFixture(
    typed + "export function run(): number { return nativeClosure(); }",
    "typed-general-call-native-closure",
  ),
);

assert.throws(
  () =>
    verifyHostedFixture(
      `
  export function run(): number {
    const concrete = (): number => 42;
    const erased: unknown = concrete;
    if (typeof erased === "function") return erased();
    return 1;
  }`,
      "typed-general-call-static-rejection",
    ),
  /Calling a native closure through Function requires the slice 2b closure view/,
);
