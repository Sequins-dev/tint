import assert from "node:assert/strict";
import test from "node:test";
import { encode, type Instruction } from "@tint/codegen/aarch64/isa";
import {
  createWordBuffer,
  appendWord,
  readWord,
} from "@tint/foundation/binary/word-buffer";
import { promoteStackWords } from "../src/aarch64/scalar/stack-registers.ts";
function word(op: Instruction): number {
  const result = encode(op);
  assert.ok(result.ok);
  return result.value;
}
test("stack promotion covers temporary words and preserves code offsets", () => {
  const code = createWordBuffer();
  for (const op of [
    { op: "str-d", rt: 0, rn: "sp", offset: 64 },
    { op: "ldr", width: 64, rt: 9, rn: "sp", offset: 64 },
    { op: "str", width: 64, rt: 9, rn: "sp", offset: 72 },
    { op: "ldr-d", rt: 1, rn: "sp", offset: 72 },
  ] as const)
    appendWord(code, word(op));
  assert.equal(promoteStackWords(code, 0, 4, 64, 80), 2);
  assert.equal(code.length, 4);
  assert.equal(readWord(code, 0), word({ op: "fmov-d-d", rd: 16, rn: 0 }));
  assert.equal(readWord(code, 1), word({ op: "fmov-x-d", rd: 9, rn: 16 }));
  assert.equal(readWord(code, 2), word({ op: "fmov-d-x", rd: 17, rn: 9 }));
  assert.equal(readWord(code, 3), word({ op: "fmov-d-d", rd: 1, rn: 17 }));
});
test("budget exhaustion is atomic and context storage stays in memory", () => {
  const code = createWordBuffer();
  const context = word({ op: "str", width: 64, rt: 0, rn: "sp", offset: 0 }),
    local = word({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 64 });
  appendWord(code, context);
  appendWord(code, local);
  assert.equal(promoteStackWords(code, 0, 2, 64, 72, 0), 0);
  assert.equal(readWord(code, 1), local);
  assert.equal(promoteStackWords(code, 0, 2, 64, 72), 1);
  assert.equal(readWord(code, 0), context);
});
test("partial-width accesses prevent promotion of their shared word", () => {
  const code = createWordBuffer();
  const ops: Instruction[] = [
    { op: "str", width: 64, rt: 9, rn: "sp", offset: 64 },
    { op: "ldr", width: 32, rt: 10, rn: "sp", offset: 68 },
  ];
  for (const op of ops) appendWord(code, word(op));
  assert.equal(promoteStackWords(code, 0, 2, 64, 72), 0);
  assert.equal(readWord(code, 0), word(ops[0]!));
});

test("promotion caps pressure at sixteen registers and favors reused words", () => {
  const code = createWordBuffer();
  for (let slot = 0; slot < 20; slot++)
    appendWord(
      code,
      word({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 64 + slot * 8 }),
    );
  appendWord(
    code,
    word({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 64 + 19 * 8 }),
  );
  assert.equal(promoteStackWords(code, 0, code.length, 64, 224), 16);
  assert.equal(readWord(code, 19), word({ op: "fmov-x-d", rd: 9, rn: 16 }));
  assert.equal(
    readWord(code, 18),
    word({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 208 }),
  );
});
