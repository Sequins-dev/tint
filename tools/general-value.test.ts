import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type ModuleIR, type Instruction } from "@tint/ir/scalar";
import {
  generalValueFixture,
  generalExceptionFixture,
} from "./general-value-fixture.ts";
const s = { start: 0, end: 0 };
test("general ABI and exception fixtures satisfy verified IR contracts", () => {
  assert.deepEqual(verify(generalValueFixture()), { ok: true });
  assert.deepEqual(verify(generalExceptionFixture()), { ok: true });
});
test("catch initialization uses state at the throw site, not the end of its block", () => {
  for (const before of [true, false]) {
    const source = generalExceptionFixture();
    const module: ModuleIR = {
      ...source,
      functions: source.functions.map((fn) =>
        fn.id !== 0
          ? fn
          : {
              ...fn,
              slots: [...fn.slots, "number"],
              blocks: fn.blocks.map((block) => {
                if (block.id === 1) {
                  const instructions: Instruction[] =
                    block.instructions.slice();
                  instructions.splice(before ? 1 : instructions.length, 0, {
                    kind: "store",
                    slot: 2,
                    value: 2,
                    ...s,
                  });
                  return { ...block, instructions };
                }
                if (block.id === 2)
                  return {
                    ...block,
                    instructions: [{ kind: "load", id: 7, slot: 2, ...s }],
                    terminator: { kind: "return", value: 7, ...s },
                  };
                return block;
              }),
            },
      ),
    };
    const checked = verify(module);
    assert.equal(checked.ok, before, JSON.stringify(checked));
    if (!checked.ok) assert.equal(checked.error.code, "INITIALIZATION");
  }
});
test("exception handlers require a general receiver", () => {
  const source = generalExceptionFixture();
  const checked = verify({
    ...source,
    functions: source.functions.map((fn) =>
      fn.id !== 0
        ? fn
        : {
            ...fn,
            blocks: fn.blocks.map((block) =>
              block.exception === undefined
                ? block
                : { ...block, exception: { ...block.exception, slot: 0 } },
            ),
          },
    ),
  });
  assert.ok(!checked.ok);
  assert.equal(checked.error.code, "TYPE");
});
