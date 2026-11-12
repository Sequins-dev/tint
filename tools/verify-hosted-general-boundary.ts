// Mixed program: the module the typed pipeline rejects (and its importers)
// compiles with general semantics, while the typed library it imports keeps
// typed compilation and is reached through checked entries: arguments are
// checked against the declared primitive types, and an ill-typed call
// throws a TypeError instead of entering typed code.
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const library = `export function sumSquares(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + i * i) % 1000003;
  return total;
}
export function label(name: string, count?: number): string { return name + ":" + (count ?? 0); }
export const scale: number = 3;`;
const parsed = parseModule(createSourceTextView(library));
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));
verifyHostedFixture(
  `import { sumSquares, label, scale } from "./lib";
class Box { value: number; constructor(value: number) { this.value = value; } }
export function run(): number {
  const box = new Box(sumSquares(1000) * scale);
  let rejected = false;
  try { Reflect.apply(sumSquares, undefined, ["x"]); } catch (error) { rejected = error instanceof TypeError; }
  console.log(label("n"), label("m", 2), box.value, rejected);
  return label("n") === "n:0" && label("m", 2) === "m:2" && box.value === 2497512 && rejected ? 42 : 1;
}`,
  "general-boundary",
  [["./lib", "lib"]],
  [{ id: "lib", module: parsed.value, dependencies: new Map() }],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
