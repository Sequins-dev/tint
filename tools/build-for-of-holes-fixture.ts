import { verifyHostedFixture } from "./hosted-fixture.ts";
// for-of elements are typed T, as in TypeScript (docs/unified-pipeline.md,
// slice 4a). A hole is not a value of an element type that excludes
// undefined, so iterating one throws a TypeError; element types that admit
// undefined bind it, as JavaScript does. Native only: JavaScript binds
// undefined for every hole, so Node cannot serve as the reference.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("for-of holes fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
console.log(
  verifyHostedFixture(
    `interface Point { readonly x: number }
function sumNumbers(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
function joinStrings(values: string[]): string {
  let text = "";
  for (const value of values) text += value;
  return text;
}
function countTrue(values: boolean[]): number {
  let count = 0;
  for (const value of values) if (value) count++;
  return count;
}
function sumPoints(points: Point[]): number {
  let total = 0;
  for (const point of points) total += point.x;
  return total;
}
function describe(values: (number | string)[]): string {
  let text = "";
  for (const value of values) text += typeof value;
  return text;
}
function countAbsent(values: (number | undefined)[]): number {
  let count = 0;
  for (const value of values) if (value === undefined) count++;
  return count;
}
function countUnknownAbsent(values: unknown[]): number {
  let count = 0;
  for (const value of values) if (value === undefined) count++;
  return count;
}
// Compiler sources guard elements explicitly; on a typed-array element (a
// present reference) the guard is constant false.
function totalLength(pages: Uint32Array[]): number {
  let total = 0;
  for (const page of pages) {
    if (page === undefined) throw "page invariant";
    total += page.length;
  }
  return total;
}
function throwsOnHole(action: () => void): boolean {
  try {
    action();
  } catch (error) {
    return error instanceof TypeError;
  }
  return false;
}
export function run(): number {
  // Dense lists iterate their elements as T.
  if (sumNumbers([1, 2, 3]) !== 6) return 1;
  if (joinStrings(["a", "b"]) !== "ab") return 2;
  if (countTrue([true, false, true]) !== 2) return 3;
  if (sumPoints([{ x: 1 }, { x: 2 }]) !== 3) return 4;
  if (describe([1, "a"]) !== "numberstring") return 5;
  if (totalLength([new Uint32Array(2), new Uint32Array(3)]) !== 5) return 13;
  // Holes (made by growing the length) are not values of these T.
  const numbers: number[] = [1];
  numbers.length = 3;
  if (!throwsOnHole(() => sumNumbers(numbers))) return 6;
  const strings: string[] = ["a"];
  strings.length = 2;
  if (!throwsOnHole(() => joinStrings(strings))) return 7;
  const flags: boolean[] = [true];
  flags.length = 2;
  if (!throwsOnHole(() => countTrue(flags))) return 8;
  const points: Point[] = [{ x: 1 }];
  points.length = 2;
  if (!throwsOnHole(() => sumPoints(points))) return 9;
  const mixed: (number | string)[] = [1];
  mixed.length = 2;
  if (!throwsOnHole(() => describe(mixed))) return 10;
  // Element types that admit undefined bind it for a hole.
  const optional: (number | undefined)[] = [1];
  optional.length = 3;
  if (countAbsent(optional) !== 2) return 11;
  const opaque: unknown[] = [1];
  opaque.length = 2;
  if (countUnknownAbsent(opaque) !== 1) return 12;
  return 42;
}
`,
    "for-of-holes-v1",
  ),
);
