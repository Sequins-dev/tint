import { test } from "node:test";
import assert from "node:assert/strict";
import { writeInstruction, patchBranch } from "@tint/codegen/aarch64/isa";
import { link } from "@tint/image/layout";

test("layout and encoder compose through resolved offsets, without importing each other", () => {
  const caller = new Uint8Array(8),
    callee = new Uint8Array(8);
  assert.equal(
    writeInstruction(caller, 0, { op: "b", displacement: 0 }).ok,
    true,
  );
  assert.equal(writeInstruction(caller, 4, { op: "nop" }).ok, true);
  assert.equal(
    writeInstruction(callee, 0, {
      op: "movz",
      width: 32,
      rd: 0,
      immediate: 42,
      shift: 0,
    }).ok,
    true,
  );
  assert.equal(writeInstruction(callee, 4, { op: "ret", rn: 30 }).ok, true);
  const result = link({
    fragments: [
      { id: "callee", order: 1, alignment: 16, bytes: callee },
      { id: "caller", order: 0, alignment: 4, bytes: caller },
    ],
    symbols: [
      { id: "entry", fragment: "caller", offset: 0 },
      { id: "target", fragment: "callee", offset: 0 },
    ],
    fixups: [],
    virtualBase: { lo: 0, hi: 1 },
    maxByteLength: 64,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const entry = result.value.symbols.find((s) => s.id === "entry"),
    target = result.value.symbols.find((s) => s.id === "target");
  assert.ok(entry);
  assert.ok(target);
  assert.equal(
    patchBranch(result.value.bytes, {
      offset: entry.fileOffset,
      targetOffset: target.fileOffset,
      branch: { op: "b" },
    }).ok,
    true,
  );
  assert.deepEqual(
    [...result.value.bytes],
    [
      4, 0, 0, 0x14, 0x1f, 0x20, 3, 0xd5, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 5, 0x80,
      0x52, 0xc0, 3, 0x5f, 0xd6,
    ],
  );
  // Patching the output does not change the original fragment.
  assert.deepEqual([...caller.subarray(0, 4)], [0, 0, 0, 0x14]);
});
