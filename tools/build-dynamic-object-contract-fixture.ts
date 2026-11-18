// Tint's explicit property contracts intentionally reject writes that Node
// permits after type erasure. The caller is general JavaScript so assignment,
// deletion and both reflection paths use the ordinary runtime operations.
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("dynamic object contract fixture requires TINT_BUILD_ONLY=1");

const typed = parseModule(
  createSourceTextView(`
interface Answer {
  [key: string]: number;
  answer: number;
}
export function make(): unknown {
  const object: Answer = { answer: 42 };
  return object;
}
export function admit(input: unknown): unknown {
  return input as Record<string, number>;
}
export function admitNested(input: unknown): unknown {
  return input as Record<string, Record<string, number>>;
}
export function openObject(key: string): unknown {
  return { [key]: 42 } satisfies Record<string, number>;
}
`),
);
assert.ok(typed.ok, JSON.stringify(typed));
const caller = `
import { make, admit, admitNested, openObject } from "./typed";
function rejects(operation) {
  try { operation(); } catch (error) { return error instanceof TypeError; }
  return false;
}
export function run() {
  const object = make();
  if (!rejects(() => { object.answer = "bad"; }) || object.answer !== 42) return 1;
  if (!rejects(() => Reflect.defineProperty(object, "answer", { value: "bad" })) || object.answer !== 42) return 2;
  if (!rejects(() => Object.defineProperty(object, "answer", { value: "bad" })) || object.answer !== 42) return 3;
  if (!rejects(() => Object.defineProperty(object, "answer", { get() { return 9; } })) || object.answer !== 42) return 4;
  if (!rejects(() => { delete object.answer; }) || object.answer !== 42) return 5;
  if (!rejects(() => Reflect.defineProperty(object, "absent", {})) || "absent" in object) return 6;
  let reads = 0;
  const accessor = { get answer() { reads++; return 42; } };
  if (!rejects(() => admit(accessor)) || reads !== 0) return 7;
  const first = { correct: 7 }, second = { wrong: "bad" };
  if (!rejects(() => admitNested({ first, second }))) return 8;
  first.correct = "still open";
  if (first.correct !== "still open") return 9;
  const fromGeneral = { key: 42 };
  if (admit(fromGeneral) !== fromGeneral) return 10;
  if (!rejects(() => { fromGeneral[0] = "bad"; }) || 0 in fromGeneral) return 11;
  const open = openObject("answer");
  open.answer = "allowed";
  if (open.answer !== "allowed") return 12;
  return 42;
}
`;
let fallback = false;
verifyHostedFixture(
  caller,
  "dynamic-object-contract-c1",
  [["./typed", "fixture:typed"]],
  [{ id: "fixture:typed", module: typed.value, dependencies: new Map() }],
  [],
  [],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    onGeneralFallback(modules) {
      assert.deepEqual(modules, ["fixture"]);
      fallback = true;
    },
  },
);
assert.ok(fallback);
