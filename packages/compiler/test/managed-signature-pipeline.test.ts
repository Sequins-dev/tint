import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { pruneClosedModule } from "@tint/ir/optimization";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import {
  planManagedSignatureGroups,
  lowerManagedSignatureGroups,
} from "../src/native/index.ts";

test("checked callback contracts compose into separate equal-ABI native identities", () => {
  const parsed = parseModule(
    createSourceTextView(`interface Left{readonly value:number;}interface Right{readonly label:string;}
 function unrelated():number{return 0;}
 export function entry(left:Left,right:Right):number{const first=(value:Left):number=>value.value;const second=(value:Right):number=>value.label.length;return first(left)+second(right);}`),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const graph = checked.value;
  const entry = graph.bindings.functions.find((fn) => {
    const binding = graph.bindings.bindings.find(
      (binding) => binding.node === fn.node && binding.kind === "function",
    );
    return binding?.name === "entry";
  });
  assert.ok(entry);
  const callbacks = graph.bindings.functions.filter(
    (fn) => fn.parent === entry.id,
  );
  assert.equal(callbacks.length, 2);
  const types = new Map<number, number>();
  graph.expressions.forEach((type, expression) => {
    for (const fn of callbacks)
      if (fn.node === expression) types.set(fn.id, type);
  });
  const requests = callbacks.map((fn, index) => {
    const type = types.get(fn.id);
    assert.notEqual(type, undefined);
    return {
      name: "callback" + index,
      contract: "test.callback." + index + ".v1",
      type: type!,
      functions: [fn.id],
    };
  });
  const plan = planManagedSignatureGroups(graph, requests);
  assert.ok(plan.ok, JSON.stringify(plan));
  const lowered = lowerModuleEntries(
    graph,
    [entry.id],
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    { signatureTypes: true },
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.equal(lowered.value.entries[0], entry.id);
  assert.notEqual(entry.id, 0);
  const first = pruneClosedModule(lowered.value.module, [0]);
  assert.ok(first);
  const second = pruneClosedModule(first.module, [first.functionIds[0]! - 1]);
  assert.ok(second);
  const local = lowerManagedSignatureGroups(
    plan.value,
    lowered.value.entries,
    lowered.value.signatureTypes,
    [first.functionIds, second.functionIds],
  );
  assert.ok(local.ok, JSON.stringify(local));
  assert.equal(local.value.length, 2);
  const native = emitModule(second.module, { localSignatures: local.value });
  assert.ok(native.ok, JSON.stringify(native));
  const descriptors = local.value.map((group) => {
    const signature = native.value.signatures.find(
      (signature) => signature.identity?.contract === group.contract,
    );
    assert.ok(signature, group.contract);
    for (const fn of group.functions)
      assert.ok(signature.functions.includes(fn));
    return signature;
  });
  assert.notEqual(descriptors[0]!.offset, descriptors[1]!.offset);
  assert.deepEqual(descriptors[0]!.parameters, descriptors[1]!.parameters);
  assert.equal(descriptors[0]!.returnType, descriptors[1]!.returnType);
});
