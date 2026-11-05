import test from "node:test";
import assert from "node:assert/strict";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import type { ModuleIR } from "@tint/ir/scalar";

const span = { start: 1, end: 2 };
const module: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "choose",
      exported: true,
      parameters: [],
      slots: [],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [{ kind: "constant", id: 0, value: true, ...span }],
          terminator: {
            kind: "branch",
            condition: 0,
            consequent: 1,
            alternate: 2,
            ...span,
          },
        },
        {
          id: 1,
          instructions: [{ kind: "constant", id: 1, value: 19, ...span }],
          terminator: { kind: "return", value: 1, ...span },
        },
        {
          id: 2,
          instructions: [{ kind: "constant", id: 2, value: 42, ...span }],
          terminator: { kind: "return", value: 2, ...span },
        },
      ],
    },
  ],
};

test("debug frame pointers exclude prologue and each return teardown without changing code", () => {
  const plain = emitModule(module),
    debug = emitModule(module, { maxByteLength: 0xffffffff, debugSpans: true });
  assert.ok(plain.ok);
  assert.ok(debug.ok);
  assert.deepEqual(debug.value.code, plain.value.code);
  assert.equal(plain.value.functions[0]?.debugFrame, undefined);
  const fn = debug.value.functions[0]!,
    frame = fn.debugFrame!;
  assert.ok(frame);
  assert.equal(frame.register, 29);
  assert.ok(frame.contextOffset < 0 && frame.contextOffset >= -fn.frameBytes);
  assert.ok(frame.resultOffset < 0 && frame.resultOffset >= -fn.frameBytes);
  assert.notEqual(frame.contextOffset, frame.resultOffset);
  assert.equal(frame.ranges.length, 2);
  assert.ok(frame.ranges[0]!.offset > fn.offset);
  const code = new DataView(
    debug.value.code.buffer,
    debug.value.code.byteOffset,
    debug.value.code.byteLength,
  );
  let returns = 0,
    previousEnd = fn.offset;
  for (const range of frame.ranges) {
    assert.ok(range.offset >= previousEnd && range.byteLength > 0);
    previousEnd = range.offset + range.byteLength;
    assert.ok(previousEnd <= fn.offset + fn.byteLength);
    for (let at = range.offset; at < previousEnd; at += 4)
      assert.notEqual(code.getUint32(at, true), 0xd65f03c0);
  }
  for (let at = fn.offset; at < fn.offset + fn.byteLength; at += 4) {
    if (code.getUint32(at, true) === 0xd65f03c0) {
      returns++;
      assert.ok(
        !frame.ranges.some(
          (r) => at >= r.offset && at < r.offset + r.byteLength,
        ),
      );
    }
  }
  assert.equal(returns, 2);
});
