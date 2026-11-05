// Verification adapter for emitted cell helpers; not source-level closure lowering.
import assert from "node:assert/strict";
import {
  writeInstruction,
  patchBranch,
  type Instruction,
  type Branch,
} from "@tint/codegen/aarch64/isa";
import { emitCellAccess, type CellAccess } from "@tint/codegen/aarch64/cell";
export interface CellCase {
  readonly name: string;
  readonly access: CellAccess;
  readonly state: number;
  readonly status: number;
}
export const cellCases: CellCase[] = [];
for (const byteLength of [0, 1, 7, 8, 9, 16, 24, 31, 32, 33, 47])
  for (const operation of ["initialize", "read", "write"] as const)
    cellCases.push({
      name: operation + "-" + byteLength,
      access: {
        operation,
        stateOffset: 0,
        valueOffset: 7,
        byteLength,
        mutable: true,
      },
      state: operation === "initialize" ? 0 : 1,
      status: 0,
    });
for (const [operation, state, mutable, status] of [
  ["read", 0, true, 1],
  ["write", 0, true, 1],
  ["initialize", 1, true, 2],
  ["write", 1, false, 3],
  ["write", 0, false, 1],
  ["initialize", 0, false, 0],
  ["read", 2, true, 4],
  ["write", 255, true, 4],
  ["initialize", 2, true, 4],
] as const)
  cellCases.push({
    name: `${operation}-state${state}-mutable${mutable}`,
    access: {
      operation,
      stateOffset: 0,
      valueOffset: 7,
      byteLength: 16,
      mutable,
    },
    state,
    status,
  });
export function nativeCellFixture(test: CellCase): Uint8Array {
  const helper = emitCellAccess(test.access);
  assert.ok(helper.ok);
  const instructions: Instruction[] = [],
    labels = new Map<string, number>(),
    fixups: { offset: number; target: string; branch: Branch }[] = [];
  const emit = (i: Instruction) => instructions.push(i);
  const imm = (rd: number, value: number) =>
    emit({ op: "movz", width: 32, rd, immediate: value, shift: 0 });
  const branch = (target: string, b: Branch = { op: "b" }) => {
    fixups.push({ offset: instructions.length * 4, target, branch: b });
    emit({ ...b, displacement: 0 });
  };
  const cmp = (rn: number, value: number) => {
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn,
      immediate: value,
      shift: 0,
      setFlags: true,
    });
    branch("fail", { op: "b.cond", condition: "ne" });
  };
  emit({
    op: "stp",
    width: 64,
    rt: 29,
    rt2: 30,
    rn: "sp",
    offset: -16,
    mode: "pre",
  });
  emit({
    op: "sub-imm",
    width: 64,
    rd: "sp",
    rn: "sp",
    immediate: 128,
    shift: 0,
    setFlags: false,
  });
  const expected = new Uint8Array(128);
  for (let i = 0; i < 128; i++) {
    expected[i] = (i * 13 + 0xa5) & 255;
    imm(2, expected[i]!);
    emit({ op: "strb", rt: 2, rn: "sp", offset: i });
  }
  expected[test.access.stateOffset] = test.state;
  imm(2, test.state);
  emit({ op: "strb", rt: 2, rn: "sp", offset: test.access.stateOffset });
  emit({
    op: "add-imm",
    width: 64,
    rd: 0,
    rn: "sp",
    immediate: 0,
    shift: 0,
    setFlags: false,
  });
  if (test.status === 0)
    emit({
      op: "add-imm",
      width: 64,
      rd: 1,
      rn: "sp",
      immediate: 64,
      shift: 0,
      setFlags: false,
    });
  else imm(1, 0); // A failed guard must never touch this invalid transfer pointer.
  branch("helper", { op: "bl" });
  cmp(0, test.status);
  if (test.status === 0) {
    const { operation, valueOffset, byteLength, stateOffset } = test.access;
    if (operation === "read")
      expected.set(expected.slice(valueOffset, valueOffset + byteLength), 64);
    else expected.set(expected.slice(64, 64 + byteLength), valueOffset);
    if (operation === "initialize") expected[stateOffset] = 1;
  }
  // Check every payload, transfer and canary byte, including both sides of the cell.
  for (let i = 0; i < 128; i++) {
    emit({ op: "ldrb", rt: 2, rn: "sp", offset: i });
    cmp(2, expected[i]!);
  }
  imm(0, 0);
  branch("done");
  labels.set("fail", instructions.length * 4);
  imm(0, 1);
  labels.set("done", instructions.length * 4);
  emit({
    op: "add-imm",
    width: 64,
    rd: "sp",
    rn: "sp",
    immediate: 128,
    shift: 0,
    setFlags: false,
  });
  emit({
    op: "ldp",
    width: 64,
    rt: 29,
    rt2: 30,
    rn: "sp",
    offset: 16,
    mode: "post",
  });
  emit({ op: "ret", rn: 30 });
  labels.set("helper", instructions.length * 4);
  const code = new Uint8Array(instructions.length * 4 + helper.value.length);
  instructions.forEach((instruction, index) =>
    assert.ok(writeInstruction(code, index * 4, instruction).ok),
  );
  code.set(helper.value, instructions.length * 4);
  for (const f of fixups) {
    const targetOffset = labels.get(f.target);
    assert.notEqual(targetOffset, undefined);
    assert.ok(
      patchBranch(code, {
        offset: f.offset,
        targetOffset: targetOffset!,
        branch: f.branch,
      }).ok,
    );
  }
  return code;
}
