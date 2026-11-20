import { verifyHostedFixture } from "./hosted-fixture.ts";
import { createHostedSourceValidator } from "./source-validation.ts";

// Reflective writes and the invalid getter result exercise Tint's runtime
// contracts after TypeScript erasure.
const source = `let order = "";
let finalized = 0;
function kernel(value: number): number { return value * 2; }
function audit(_value: unknown, context: ClassDecoratorContext): void {
  order += "D";
  context.addInitializer(() => { order += "I"; });
}
function add(_value: undefined, _context: ClassFieldDecoratorContext): (value: number) => number {
  order += "F";
  return (value: number): number => { order += "f"; return value + 1; };
}
function replacement(_value: unknown): unknown { return "wrong"; }
function replace(_value: unknown, _context: ClassMethodDecoratorContext): any { return replacement; }
class Base { total: number = 16; }
@audit class Derived extends Base {
  #amount: number = 2;
  @add field: number = 2;
  static count: number = 4;
  constructor() { super(); if (new.target !== Derived) throw 2; }
  set amount(value: number) { this.#amount = value; }
  get amount(): number { return this.#amount; }
  get invalid(): number { try { return "wrong" as any; } finally { finalized++; } }
  @replace method(value: number): number { return value; }
}
export function run(): number {
  if (order !== "FDI") return 3;
  const item = new Derived();
  if (!(item instanceof Base) || item.constructor !== Derived || String(order) !== "FDIf") return 4;
  if ((item.method as unknown) !== replacement || replacement(7) !== "wrong") return 7;
  let rejected = 0;
  try { (item as any).total = "wrong"; } catch (error) { if (error instanceof TypeError) rejected++; }
  try { Object.defineProperty(item, "field", { value: "wrong" }); } catch (error) { if (error instanceof TypeError) rejected++; }
  try { (Derived as any).count = "wrong"; } catch (error) { if (error instanceof TypeError) rejected++; }
  try { (item as any).amount = "wrong"; } catch (error) { if (error instanceof TypeError) rejected++; }
  try { item.invalid; } catch (error) { if (error instanceof TypeError && finalized === 1) rejected++; }
  try { item.method(7); } catch (error) { if (error instanceof TypeError) rejected++; }
  return rejected === 6 && Derived.count === 4 ? kernel(item.total + item.field + item.amount) : 5;
}`;

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("class fixture requires TINT_BUILD_ONLY=1");
verifyHostedFixture(source, "slice3-class-fields", [], [], [], [], {
  managedBytes: 67108864,
  allocationCapacity: 1048576,
  validateSource: createHostedSourceValidator([
    { id: "fixture", text: source },
  ]),
  functionFallback: true,
});
