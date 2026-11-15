import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  visitInstructionOperands,
  substituteInstructionValues,
  promoteSlots,
  lowerSSA,
} from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { compactSlots } from "@tint/ir/optimization/slots";
import { receiverIRFixture } from "./receiver-ir-fixture.ts";
test("receiver slots initialize independently of positional parameters", () => {
  const module = receiverIRFixture();
  assert.deepEqual(verify(module), { ok: true });
  const fn = module.functions[1]!;
  for (const receiverSlot of [-1, 0, 1, 99])
    assert.equal(
      verify({
        ...module,
        functions: [module.functions[0]!, { ...fn, receiverSlot }],
      }).ok,
      false,
    );
  const compact = compactSlots(fn, 1000);
  assert.ok(compact);
  assert.equal(compact.fn.receiverSlot, 1);
  assert.deepEqual(compact.fn.parameters, [0]);
  assert.deepEqual(
    verify({ ...module, functions: [module.functions[0]!, compact.fn] }),
    { ok: true },
  );
  const promoted = promoteSlots(fn, 1000);
  assert.ok(promoted);
  const lowered = lowerSSA(promoted);
  assert.ok(lowered);
  assert.deepEqual(
    verify({ ...module, functions: [module.functions[0]!, lowered] }),
    { ok: true },
  );
});
test("call receiver values participate in operand and substitution contracts", () => {
  const op = receiverIRFixture().functions[0]!.blocks[0]!.instructions[4]!;
  const operands: number[] = [];
  visitInstructionOperands(op, (id) => operands.push(id));
  assert.deepEqual(operands, [1, 2]);
  const substitutions = new Uint32Array(2);
  substitutions[1] = 9;
  const rewritten = substituteInstructionValues(op, substitutions);
  assert.equal(rewritten.kind, "call");
  if (rewritten.kind !== "call") throw "call invariant";
  assert.equal(rewritten.receiver, 8);
});

test("receivers are general values for both direct and indirect calls", () => {
  for (const indirect of [false, true]) {
    const module = receiverIRFixture(indirect);
    assert.deepEqual(verify(module), { ok: true });
    const caller = module.functions[0]!;
    const block = caller.blocks[0]!;
    const op = block.instructions[4]!;
    assert.ok(op.kind === "call" || op.kind === "call-indirect");
    const operands: number[] = [];
    visitInstructionOperands(op, (id) => operands.push(id));
    assert.deepEqual(operands, indirect ? [4, 1, 2] : [1, 2]);
    for (const receiver of [0, 99]) {
      const instructions = [...block.instructions];
      instructions[4] = { ...op, receiver };
      assert.equal(
        verify({
          ...module,
          functions: [
            { ...caller, blocks: [{ ...block, instructions }] },
            module.functions[1]!,
          ],
        }).ok,
        false,
      );
    }
    const substitutions = new Uint32Array(5);
    substitutions[1] = 9;
    substitutions[4] = 10;
    const rewritten = substituteInstructionValues(op, substitutions);
    assert.ok(rewritten.kind === "call" || rewritten.kind === "call-indirect");
    assert.equal(rewritten.receiver, 8);
    if (rewritten.kind === "call-indirect") assert.equal(rewritten.callee, 9);
  }
});

test("omitted receivers retain valid separate entry storage", () => {
  for (const indirect of [false, true])
    assert.deepEqual(verify(receiverIRFixture(indirect, false)), { ok: true });
});

test("receiver entry storage participates in general-value root descriptors", () => {
  const original = receiverIRFixture().functions[1]!;
  const module = { functions: [{ ...original, id: 0, exported: true }] };
  const result = emitModule(module, { aliasSlotLoads: false });
  assert.ok(result.ok, JSON.stringify(result));
  const root = result.value.functions[0]!.frameRoots!;
  assert.ok(root);
  // With private load homes, the entry receiver slot and its loaded SSA value
  // are independently rooted.
  assert.equal(root.generals.length, 2);
  assert.equal(root.generals[1]! - root.generals[0]!, 16);
  // A load never overwritten before its last use reads the rooted slot in
  // place, so the receiver slot is the only general root.
  const aliased = emitModule(module);
  assert.ok(aliased.ok, JSON.stringify(aliased));
  assert.equal(aliased.value.functions[0]!.frameRoots!.generals.length, 1);
});
