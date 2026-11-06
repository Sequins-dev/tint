import assert from "node:assert/strict";
import test from "node:test";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import type { FunctionIR } from "@tint/ir/scalar";
const span = { start: 0, end: 0 };
function words(fn: FunctionIR): number[] {
  const emitted = emitModule({ functions: [fn] }, { closedRoots: [0] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const image = emitted.value.functions[0]!,
    code = emitted.value.code;
  const view = new DataView(
    code.buffer,
    code.byteOffset + image.offset,
    image.byteLength,
  );
  return Array.from({ length: image.byteLength / 4 }, (_, i) =>
    view.getUint32(i * 4, true),
  );
}
const result = (id: number, value: number) => ({
  id,
  instructions: [{ kind: "constant" as const, id, value, ...span }],
  terminator: { kind: "return" as const, value: id, ...span },
});
test("entry and jumps fall through to the next emitted block", () => {
  const code = words({
    id: 0,
    name: "fallthrough",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "jump", target: 1, ...span },
      },
      result(1, 42),
    ],
  });
  assert.equal(
    code.includes(0x14000001),
    false,
    "unconditional branch to the following instruction",
  );
});
for (const consequentFirst of [true, false])
  test(`conditional ${consequentFirst ? "consequent" : "alternate"} falls through`, () => {
    const code = words({
      id: 0,
      name: "conditional",
      exported: true,
      parameters: [0],
      slots: ["boolean"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
          terminator: {
            kind: "branch",
            condition: 0,
            consequent: consequentFirst ? 1 : 2,
            alternate: consequentFirst ? 2 : 1,
            ...span,
          },
        },
        result(1, 42),
        result(2, 0),
      ],
    });
    assert.equal(
      code.includes(consequentFirst ? 0x14000002 : 0x14000001),
      false,
      "redundant branch around the next block",
    );
  });
test("a nonfirst entry retains its transfer", () => {
  const code = words({
    id: 0,
    name: "entry",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 1,
    blocks: [
      result(0, 42),
      {
        id: 1,
        instructions: [],
        terminator: { kind: "jump", target: 0, ...span },
      },
    ],
  });
  assert.ok(code.some((word) => (word & 0xfc000000) === 0x14000000));
});
