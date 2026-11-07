import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "../src/closure/lowering/index.ts";
import { verify } from "@tint/ir/scalar";
import type { TargetDataLayout } from "@tint/ts-native/closure/layout";
const target: TargetDataLayout = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
};
function checked(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok);
  const result = checkClosureModule(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("module imports lower their checked ABI without traversing bodies or nested closures", () => {
  const graph = checked(
    "function helper(value:number):number{const hidden:unknown[]=[];function nested():number{return hidden.length;}return value+nested();}export function run():number{return helper(42);}",
  );
  const helper = graph.bindings.functions.find(
    (fn) => fn.node === graph.module.statements[0],
  )!;
  const main = graph.bindings.functions.find(
    (fn) => fn.node === graph.module.statements[1],
  )!;
  const ordinary = lowerModuleEntries(
    graph,
    [main.id, helper.id],
    target,
    4096,
  );
  assert.equal(ordinary.ok, false);
  const imported = lowerModuleEntries(graph, [main.id], target, 4096, {
    importedFunctions: [helper.id],
  });
  assert.ok(imported.ok, JSON.stringify(imported));
  assert.ok(verify(imported.value.module).ok);
  const functions = imported.value.module.functions;
  assert.equal(functions.length, 2);
  assert.equal(functions[1]?.import, true);
  assert.deepEqual(functions[1]?.blocks, []);
  assert.deepEqual(functions[1]?.parameters, [0]);
  assert.deepEqual(functions[1]?.slots, ["number"]);
  assert.equal(functions[1]?.returnType, "number");
  assert.deepEqual(imported.value.entries, [main.id, helper.id]);
  assert.ok(
    functions[0]?.blocks.some((block) =>
      block.instructions.some((op) => op.kind === "call" && op.target === 1),
    ),
  );
  assert.equal(
    lowerModuleEntries(graph, [main.id], target, 4096, {
      importedFunctions: [helper.id, helper.id],
    }).ok,
    false,
  );
  assert.equal(
    lowerModuleEntries(graph, [main.id], target, 4096, {
      importedFunctions: [999999],
    }).ok,
    false,
  );
  const nested = graph.bindings.functions.find(
    (fn) => fn.parent === helper.id,
  )!;
  const denied = lowerModuleEntries(graph, [main.id], target, 4096, {
    importedFunctions: [nested.id],
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.error, /imported.*top-level/);
});

test("an imported ABI match cannot become a local indirect-call signature witness", () => {
  const graph = checked(
    'function imported(value:number):number{throw "UNBOUND";}export function run(callback:(value:number)=>number):number{return callback(42);}',
  );
  const helper = graph.bindings.functions.find(
    (fn) => fn.node === graph.module.statements[0],
  )!;
  const main = graph.bindings.functions.find(
    (fn) => fn.node === graph.module.statements[1],
  )!;
  const result = lowerModuleEntries(graph, [main.id], target, 4096, {
    importedFunctions: [helper.id],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  const indirect = result.value.module.functions
    .flatMap((fn) => fn.blocks.flatMap((block) => block.instructions))
    .find((op) => op.kind === "call-indirect");
  assert.ok(indirect && indirect.kind === "call-indirect");
  assert.notEqual(result.value.module.functions[indirect.target]?.import, true);
});
