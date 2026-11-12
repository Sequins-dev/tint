// TypeScript-only syntax compiles with TypeScript's runtime meaning:
// assertions and modifiers erase, parameter properties assign in the
// constructor (after super in derived classes), abstract and declare
// members vanish, enums build objects with reverse mappings, and ambient
// declarations emit nothing.
import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `declare const ambient: number;
declare function external(x: number): void;
enum Color { Red, Green = 5, Blue }
const enum Kind { A = "a", B = "b" }
enum Flags { None = 0, X = 1 << 0, Y = 1 << 1, XY = X | Y }
abstract class Shape {
  abstract area(): number;
  protected abstract readonly label: string;
  declare tag: string;
  describe(): string { return this.label + ":" + this.area(); }
}
class Square extends Shape {
  protected readonly label = "square";
  constructor(private readonly side: number, public scale = 2) { super(); }
  area(): number { return this.side * this.side * this.scale; }
}
class Point {
  static readonly origin: number = 0;
  x?: number;
  y!: number;
  constructor(public a: number) {}
}
export function run(): number {
  const values = [1, 2, 3] as number[];
  const first = values[0]!;
  const frozen = { k: 1 } as const;
  const square = new Square(3);
  const point = new Point(7);
  const checks = [
    Color.Red === 0, Color.Green === 5, Color.Blue === 6, Color[6] === "Blue",
    Kind.A === "a", (Kind as unknown as Record<string, string>)["a"] === undefined,
    Flags.XY === 3, Flags[3] === "XY",
    square.describe() === "square:18", square.scale === 2,
    !("tag" in square), point.a === 7, !("x" in point) || point.x === undefined,
    first === 1, frozen.k === 1, Point.origin === 0,
  ];
  let passed = 0;
  for (const check of checks) if (check) passed++;
  console.log("typescript syntax", passed, "of", checks.length);
  return passed === checks.length ? 42 : 1;
}`,
  "typescript-syntax",
  [],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
