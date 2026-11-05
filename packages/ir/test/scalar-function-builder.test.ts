import assert from "node:assert/strict";
import { test } from "node:test";
import { createFunctionBuilder, verify } from "@tint/ir/scalar";
test("generated functions share typed slots, block lifecycle and source spans", () => {
  const span = { start: 4, end: 8 };
  const b = createFunctionBuilder(0, "generated", ["number"], "number", span);
  const result = b.load(0);
  b.end({ kind: "return", value: result, ...span });
  const fn = b.finish();
  assert.ok(verify({ functions: [fn] }).ok);
  assert.equal(fn.blocks[0]!.instructions[0]!.start, 4);
  assert.throws(() => b.emit({ kind: "constant", id: 1, value: 0, ...span }));
  assert.throws(() => b.at(0));
});
test("generated functions reject open or missing blocks", () => {
  const b = createFunctionBuilder(0, "incomplete", [], "void");
  assert.throws(() => b.finish());
  const next = b.block();
  b.end({ kind: "jump", target: next, start: 0, end: 0 });
  assert.throws(() => b.finish());
  b.at(next);
  b.end({ kind: "return", value: undefined, start: 0, end: 0 });
  assert.ok(verify({ functions: [b.finish()] }).ok);
});

test("source span views cannot overwrite generated instruction operands", () => {
  const span = { start: 1, end: 2, id: 99, slot: 99, value: "source metadata" };
  const b = createFunctionBuilder(0, "sourceView", ["number"], "number", span);
  const value = b.load(0);
  b.save(0, value);
  b.end({ kind: "return", value, start: 1, end: 2 });
  const fn = b.finish();
  assert.ok(
    verify({ functions: [fn] }).ok,
    JSON.stringify(verify({ functions: [fn] })),
  );
});
