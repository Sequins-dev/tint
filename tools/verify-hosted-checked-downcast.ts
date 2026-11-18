// `x as T` from unknown is a checked downcast (docs/unified-pipeline.md,
// "Contracts and speculation"): a value of T passes and keeps its identity;
// any other value throws a TypeError. The program stays typed.
import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `interface Point { readonly x: number; readonly y: number }
interface Other { readonly a: number }
function asNumber(v: unknown): number { return v as number; }
function asPoint(v: unknown): Point { return v as Point; }
function asBytes(v: unknown): Uint8Array { return v as Uint8Array; }
function asText(v: unknown): string | undefined { return v as string | undefined; }
function rejects(attempt: () => void): number {
  try { attempt(); } catch (error) { if (error instanceof TypeError) return 1; }
  return 0;
}
export function run(): number {
  const point: Point = { x: 40, y: 2 };
  const other: Other = { a: 1 };
  const bytes = new Uint8Array(3);
  const anyPoint: unknown = point, anyOther: unknown = other, anyBytes: unknown = bytes;
  const accepted =
    asNumber(1.5) === 1.5 &&
    asPoint(anyPoint) === point &&
    asPoint(anyPoint).x + asPoint(anyPoint).y === 42 &&
    asBytes(anyBytes) === bytes &&
    asText("a") === "a" &&
    asText(undefined) === undefined;
  const rejected =
    rejects((): void => { asNumber("s"); }) +
    rejects((): void => { asPoint(1); }) +
    rejects((): void => { asPoint(anyOther); }) +
    rejects((): void => { asBytes("x"); }) +
    rejects((): void => { asBytes(anyPoint); }) +
    rejects((): void => { asText(3); });
  return accepted && rejected === 6 ? 42 : 1;
}`,
  "checked-downcast",
  [],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576, requireTyped: true },
);
