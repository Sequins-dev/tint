// A program the typed pipeline cannot specialize (classes with inheritance
// and accessors, destructuring, generators, spread, closures over `var`)
// compiles with general JavaScript semantics instead of being rejected.
import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
class Vec {
  x: number;
  y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
  add(other: Vec): Vec { return new Vec(this.x + other.x, this.y + other.y); }
  get sum(): number { return this.x + this.y; }
  static zero(): Vec { return new Vec(0, 0); }
}
class Vec3 extends Vec {
  z: number;
  constructor(x: number, y: number, z: number) { super(x, y); this.z = z; }
  get sum(): number { return super.sum + this.z; }
}
function* range(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i; }
function collect(...values: number[]): number { var total = 0; for (const v of values) total += v; return total; }
export function run(): number {
  const { x, y } = new Vec(1, 2).add(new Vec(3, 4));
  let total = 0;
  for (const i of range(10)) total += i;
  const [a, , b = 7, ...rest] = [1, 2, undefined, 4, 5];
  const merged = { ...{ p: 1 }, q: 2 };
  const spread = collect(...[1, 2, 3], a);
  const v3 = new Vec3(1, 2, 3);
  console.log("general", x, y, total, v3.sum, Vec.zero().sum);
  return x === 4 && y === 6 && total === 45 && b === 7 && rest.length === 2 &&
    merged.q === 2 && spread === 7 && v3.sum === 6 && v3 instanceof Vec ? 42 : 1;
}
`,
  "general-fallback",
  [],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
