import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModule } from "@tint/typescript/syntax";
import { createSourceTextView } from "@tint/source/text";
import { checkClosureModule } from "@tint/typescript/checker";
import { verify, type FunctionIR } from "@tint/ir/scalar";
import {
  lowerModuleEntries,
  type FunctionAddressBinding,
} from "../src/closure/lowering/index.ts";
import type { TargetDataLayout } from "@tint/ts-native/closure/layout";
const target: TargetDataLayout = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
};
function fixture() {
  const parsed = parseModule(
    createSourceTextView(
      'function target(value:number):number{return value;}function entry():number{const hidden:unknown[]=[];function nested():number{return hidden.length;}return nested();}function signature():number{throw "UNBOUND";}',
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const graph = checked.value;
  function id(name: string) {
    const declaration = graph.module.statements.find(
      (s) => s.kind === "function" && s.name === name,
    );
    const fn = graph.bindings.functions.find((f) => f.node === declaration);
    assert.ok(fn);
    return fn.id;
  }
  return {
    graph,
    callee: id("target"),
    entry: id("entry"),
    signature: id("signature"),
  };
}
test("explicit bindings replace stub bodies without traversing their nested closures", () => {
  const f = fixture(),
    entries = [f.callee, f.entry, f.signature];
  assert.equal(lowerModuleEntries(f.graph, entries, target, 4096).ok, false);
  const functionAddressBindings: FunctionAddressBinding[] = [
    { function: f.entry, target: f.callee, part: "entry" },
    { function: f.signature, target: f.callee, part: "signature" },
  ];
  const lowered = lowerModuleEntries(f.graph, entries, target, 4096, {
    functionAddressBindings,
  });
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
  assert.deepEqual(lowered.value.entries, entries);
  assert.equal(lowered.value.module.functions.length, 3);
  for (const [id, part] of [
    [1, "entry"],
    [2, "signature"],
  ] as const) {
    const fn: FunctionIR = lowered.value.module.functions[id]!;
    assert.equal(fn.parameters.length, 0);
    assert.equal(fn.returnType, "number");
    assert.deepEqual(fn.blocks[0]!.instructions, [
      {
        kind: "function-address",
        id: 0,
        target: 0,
        part,
        start: f.graph.bodies.get(entries[id]!)!.node.start,
        end: f.graph.bodies.get(entries[id]!)!.node.end,
      },
    ]);
  }
});
test("address bindings reject duplicates, missing entries and overlapping capabilities", () => {
  const f = fixture(),
    entries = [f.callee, f.entry, f.signature],
    binding: FunctionAddressBinding = {
      function: f.entry,
      target: f.callee,
      part: "entry",
    };
  const cases = [
    { functionAddressBindings: [binding, binding] },
    { functionAddressBindings: [{ ...binding, target: 999999 }] },
    {
      functionAddressBindings: [
        { ...binding, target: f.signature },
        { function: f.signature, target: f.callee, part: "signature" as const },
      ],
    },
    { functionAddressBindings: [binding], importedFunctions: [f.callee] },
    { functionAddressBindings: [binding], importedFunctions: [f.entry] },
    {
      functionAddressBindings: [binding],
      recordBindings: [{ function: f.callee, operation: "identity" as const }],
    },
  ];
  for (const options of cases) {
    const result = lowerModuleEntries(f.graph, entries, target, 4096, options);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /function address binding/);
  }
  const missing = lowerModuleEntries(
    f.graph,
    [f.entry, f.signature],
    target,
    4096,
    { functionAddressBindings: [binding] },
  );
  assert.equal(missing.ok, false);
  if (!missing.ok)
    assert.match(missing.error, /function address binding.*included/);
});

test("address stubs require zero arguments, a number result and no receiver", () => {
  for (const stub of [
    "function stub(value:number):number{return value;}",
    "function stub(value:number=1):number{return value;}",
    "function stub():boolean{return false;}",
    "function stub(this:{value:number}):number{return this.value;}",
  ]) {
    const parsed = parseModule(
      createSourceTextView(
        "function callee(value:number):number{return value;}" + stub,
      ),
    );
    assert.ok(parsed.ok);
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
    const lowered = lowerModuleEntries(checked.value, [0, 1], target, 4096, {
      functionAddressBindings: [{ function: 1, target: 0, part: "entry" }],
    });
    assert.equal(lowered.ok, false);
    if (!lowered.ok)
      assert.match(lowered.error, /function address binding stub/);
  }
});
