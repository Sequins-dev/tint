import {
  writeInstruction,
  patchBranch,
  type Instruction,
  type Branch,
} from "./isa.ts";
export interface CellAccess {
  readonly operation: "initialize" | "read" | "write";
  readonly stateOffset: number;
  readonly valueOffset: number;
  readonly byteLength: number;
  readonly mutable: boolean;
}
export type CellEmission =
  | { readonly ok: true; readonly value: Uint8Array }
  | {
      readonly ok: false;
      readonly error: "INVALID_LAYOUT" | "CODE_LIMIT" | "ENCODING";
    };
/** x0=environment payload, x1=transfer buffer; returns status in w0. Pointer-free bytes only. */
export function emitCellAccess(
  cell: CellAccess,
  maxByteLength: number = 1024,
): CellEmission {
  if (
    !Number.isInteger(cell.stateOffset) ||
    cell.stateOffset < 0 ||
    cell.stateOffset > 4095 ||
    !Number.isInteger(cell.valueOffset) ||
    cell.valueOffset < 0 ||
    cell.valueOffset > 4095 ||
    !Number.isInteger(cell.byteLength) ||
    cell.byteLength < 0 ||
    cell.byteLength > 4096 ||
    (cell.stateOffset >= cell.valueOffset &&
      cell.stateOffset < cell.valueOffset + cell.byteLength)
  )
    return { ok: false, error: "INVALID_LAYOUT" };
  if (!Number.isInteger(maxByteLength) || maxByteLength < 0)
    return { ok: false, error: "CODE_LIMIT" };
  const instructions: Instruction[] = [],
    labels = new Map<string, number>(),
    fixups: { offset: number; target: string; branch: Branch }[] = [];
  const emit = (i: Instruction): void => {
    instructions.push(i);
  };
  const label = (name: string): void => {
    labels.set(name, instructions.length * 4);
  };
  const branch = (target: string, b: Branch = { op: "b" }): void => {
    fixups.push({ offset: instructions.length * 4, target, branch: b });
    if (b.op === "b" || b.op === "bl") emit({ op: b.op, displacement: 0 });
    else if (b.op === "b.cond")
      emit({ op: b.op, condition: b.condition, displacement: 0 });
    else if (b.op === "cbz" || b.op === "cbnz")
      emit({ op: b.op, width: b.width, rt: b.rt, displacement: 0 });
    else throw "branch invariant";
  };
  const imm = (rd: number, value: number): void =>
    emit({ op: "movz", width: 32, rd, immediate: value, shift: 0 });
  const add = (rd: number, rn: number, value: number): void =>
    emit({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate: value,
      shift: 0,
      setFlags: false,
    });
  emit({ op: "ldrb", rt: 2, rn: 0, offset: cell.stateOffset });
  emit({
    op: "sub-imm",
    width: 32,
    rd: "zr",
    rn: 2,
    immediate: 1,
    shift: 0,
    setFlags: true,
  });
  branch("invalid", { op: "b.cond", condition: "hi" });
  branch(cell.operation === "initialize" ? "already" : "uninitialized", {
    op: cell.operation === "initialize" ? "cbnz" : "cbz",
    width: 32,
    rt: 2,
  });
  if (cell.operation === "write" && !cell.mutable) branch("immutable");
  else {
    if (cell.byteLength > 0) {
      add(3, 0, cell.valueOffset);
      if (cell.byteLength <= 32) {
        // The ABI requires disjoint normal-memory ranges. AArch64 permits
        // unaligned word loads/stores; only complete words are accessed.
        let offset = 0;
        while (offset + 8 <= cell.byteLength) {
          emit({
            op: "ldr",
            width: 64,
            rt: 5,
            rn: cell.operation === "read" ? 3 : 1,
            offset,
          });
          emit({
            op: "str",
            width: 64,
            rt: 5,
            rn: cell.operation === "read" ? 1 : 3,
            offset,
          });
          offset += 8;
        }
        while (offset < cell.byteLength) {
          emit({
            op: "ldrb",
            rt: 5,
            rn: cell.operation === "read" ? 3 : 1,
            offset,
          });
          emit({
            op: "strb",
            rt: 5,
            rn: cell.operation === "read" ? 1 : 3,
            offset,
          });
          offset++;
        }
      } else {
        imm(4, cell.byteLength);
        label("copy");
        emit({
          op: "ldrb",
          rt: 5,
          rn: cell.operation === "read" ? 3 : 1,
          offset: 0,
        });
        emit({
          op: "strb",
          rt: 5,
          rn: cell.operation === "read" ? 1 : 3,
          offset: 0,
        });
        add(3, 3, 1);
        add(1, 1, 1);
        emit({
          op: "sub-imm",
          width: 32,
          rd: 4,
          rn: 4,
          immediate: 1,
          shift: 0,
          setFlags: true,
        });
        branch("copy", { op: "b.cond", condition: "ne" });
      }
    }
    if (cell.operation === "initialize") {
      imm(2, 1);
      emit({ op: "strb", rt: 2, rn: 0, offset: cell.stateOffset });
    }
    imm(0, 0);
    emit({ op: "ret", rn: 30 });
  }
  const failures: readonly { name: string; status: number }[] = [
    { name: "uninitialized", status: 1 },
    { name: "already", status: 2 },
    { name: "immutable", status: 3 },
    { name: "invalid", status: 4 },
  ];
  for (const failure of failures) {
    if (failure === undefined) throw "failure label invariant";
    label(failure.name);
    imm(0, failure.status);
    emit({ op: "ret", rn: 30 });
  }
  if (instructions.length * 4 > maxByteLength)
    return { ok: false, error: "CODE_LIMIT" };
  const code = new Uint8Array(instructions.length * 4);
  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];
    if (instruction === undefined) throw "cell instruction invariant";
    if (!writeInstruction(code, i * 4, instruction).ok)
      return { ok: false, error: "ENCODING" };
  }
  for (const f of fixups) {
    if (f === undefined) throw "cell fixup invariant";
    const targetOffset = labels.get(f.target);
    if (targetOffset === undefined) throw "cell branch invariant";
    if (
      !patchBranch(code, { offset: f.offset, targetOffset, branch: f.branch })
        .ok
    )
      return { ok: false, error: "ENCODING" };
  }
  return { ok: true, value: code };
}
