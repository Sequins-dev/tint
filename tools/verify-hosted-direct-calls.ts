// Top-level functions used only as direct callees are called directly,
// including self and mutual recursion between nested module functions
// (packages/ts-native/src/closure/lowering, direct function fixpoint).
// A reassigned declaration keeps its cell and indirect calls.
import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
function even(n: number): boolean { return n === 0 ? true : odd(n - 1); }
function odd(n: number): boolean { return n === 0 ? false : even(n - 1); }
interface Tree { readonly value: number; readonly left: Tree | undefined; readonly right: Tree | undefined }
function make(depth: number): Tree | undefined {
  return depth === 0 ? undefined : { value: depth, left: make(depth - 1), right: make(depth - 1) };
}
function sum(tree: Tree | undefined): number {
  return tree === undefined ? 0 : tree.value + sum(tree.left) + sum(tree.right);
}
let step = function (n: number): number { return n + 1; };
function twice(n: number): number { return step(step(n)); }
export function run(): number {
  const before = twice(1);
  step = (n: number): number => n * 10;
  const after = twice(1);
  return fib(15) === 610 && even(10) && odd(7) && !even(3) &&
    sum(make(5)) === 57 && before === 3 && after === 100 ? 42 : 1;
}`,
  "direct-calls",
  [],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
