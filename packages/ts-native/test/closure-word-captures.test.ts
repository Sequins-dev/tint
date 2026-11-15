import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { verify } from "@tint/ir/scalar";
import { lowerModuleEntries } from "../src/closure/lowering/index.ts";
const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
function lower(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const output = lowerModuleEntries(checked.value, [0], target, 4096);
  assert.ok(output.ok, JSON.stringify(output));
  assert.deepEqual(verify(output.value.module), { ok: true });
  return output.value.module;
}
for (const [type, result, read, encoding] of [
  ["boolean", "boolean", "value", "boolean"],
  ["string", "string", "value", "string"],
  ["{value:number}", "number", "value.value", "reference"],
  ["Uint32Array", "number", "value[0]??0", "Uint32Array"],
  ["()=>number", "number", "value()", "reference"],
  // NaN-boxed: one word, captured by value like any other.
  ["number|undefined", "number|undefined", "value", "optional-number"],
] as const)
  test(`strict immutable ${type} parameter uses one closure allocation and its traced payload`, () => {
    const module = lower(
        `function make(value:${type}):()=>${result}{return ()=>${read};}`,
      ),
      owner = module.functions[0]!;
    assert.equal(
      owner.blocks
        .flatMap((b) => b.instructions)
        .filter((op) => op.kind === "record-new").length,
      1,
      "an initialized immutable parameter needs no shared capture cell",
    );
    const closure = module.functions.find(
      (fn) => fn.closureEnvironment !== undefined,
    )!;
    assert.ok(closure);
    assert.equal(
      module.records![closure.closureEnvironment!]!.fields[0]!.type,
      encoding,
    );
    assert.ok(!closure.blocks.some((b) => b.terminator.kind === "record-cell"));
  });
for (const text of [
  "function make(value:{value:number}):()=>number{const read:()=>number=()=>value.value;value={value:9};return read;}",
  "function make(value:{value:number}):()=>number{return ()=>{value={value:9};return value.value;};}",
  "function make(value:{value:number}={value:42}):()=>number{return ()=>value.value;}",
])
  test(`mutable or defaulted reference retains a shared cell: ${text}`, () => {
    const module = lower(text),
      closure = module.functions.find(
        (fn) => fn.closureEnvironment !== undefined,
      )!;
    assert.ok(closure.blocks.some((b) => b.terminator.kind === "record-cell"));
  });

for (const type of ["boolean|undefined", "unknown"]) {
  test(`wide ${type} carriers retain their existing shared-cell layout`, () => {
    const module = lower(
      `function make(value:${type}):()=>${type}{return ()=>value;}`,
    );
    const closure = module.functions.find(
      (fn) => fn.closureEnvironment !== undefined,
    )!;
    assert.ok(closure.blocks.some((b) => b.terminator.kind === "record-cell"));
  });
}
test("forwarded references remain traced direct payloads in both closure environments", () => {
  const module = lower(
    "function make(value:{value:number}):()=>()=>number{return ()=>()=>value.value;}",
  );
  const closures = module.functions.filter(
    (fn) => fn.closureEnvironment !== undefined,
  );
  assert.equal(closures.length, 2);
  for (const closure of closures) {
    assert.equal(
      module.records![closure.closureEnvironment!]!.fields[0]!.type,
      "reference",
    );
    assert.ok(!closure.blocks.some((b) => b.terminator.kind === "record-cell"));
  }
});
