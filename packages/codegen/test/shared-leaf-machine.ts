import assert from "node:assert/strict";
import type { Instruction } from "../src/aarch64/isa.ts";
/** Small instruction-level model for the shared leaf's integer/control subset.
 * This verifies paths and access widths, not native execution or memory ordering. */
export function sharedLeafMachine(
  code: readonly Instruction[],
  args: readonly bigint[],
  initial: bigint = 0xffffffffffffffffn,
  failures = 0,
  scratchLength = 2,
  scratchData = 0x3000n,
) {
  const registers = Array.from({ length: 31 }, (_, i) => BigInt(0x8000 + i));
  for (const [index, value] of args.entries()) registers[index] = value;
  const memory = new Map<bigint, number>();
  const accesses: { op: string; address: bigint; width: number }[] = [];
  const mask = (1n << 64n) - 1n;
  const get = (reg: number | "zr" | "sp") =>
    reg === "zr"
      ? 0n
      : reg === "sp"
        ? assert.fail("unexpected SP")
        : registers[reg]!;
  function set(reg: number | "zr" | "sp", value: bigint): void {
    if (reg === "zr") return;
    assert.notEqual(reg, "sp");
    registers[reg as number] = value & mask;
  }
  function write(address: bigint, width: number, value: bigint): void {
    for (let i = 0; i < width; i++)
      memory.set(address + BigInt(i), Number((value >> BigInt(i * 8)) & 255n));
  }
  function read(address: bigint, width: number): bigint {
    let value = 0n;
    for (let i = width - 1; i >= 0; i--)
      value = (value << 8n) | BigInt(memory.get(address + BigInt(i)) ?? 0);
    return value;
  }
  write(0x1000n, 8, initial);
  write(0x2000n + 16n, 8, BigInt(scratchLength));
  write(0x2000n + 24n, 8, scratchData);
  write(0x3000n, 8, 0x123456789abcdef0n);
  let left = 0n,
    right = 0n,
    pc = 0,
    steps = 0;
  const condition = (c: string) =>
    c === "eq"
      ? left === right
      : c === "ne"
        ? left !== right
        : c === "hi"
          ? left > right
          : c === "cc"
            ? left < right
            : c === "ls"
              ? left <= right
              : assert.fail("unsupported condition " + c);
  for (;;) {
    assert.ok(++steps < 10000, "leaf must terminate");
    const i = code[pc];
    assert.ok(i);
    pc++;
    switch (i.op) {
      case "movz":
        set(i.rd, BigInt(i.immediate) << BigInt(i.shift));
        break;
      case "movk": {
        const shift = BigInt(i.shift);
        set(
          i.rd,
          (get(i.rd) & ~(65535n << shift)) | (BigInt(i.immediate) << shift),
        );
        break;
      }
      case "orr-reg":
        set(i.rd, get(i.rn) | get(i.rm));
        break;
      case "orn-reg":
        set(i.rd, get(i.rn) | ~get(i.rm));
        break;
      case "and-reg":
        set(i.rd, get(i.rn) & get(i.rm));
        break;
      case "lslv":
        set(i.rd, get(i.rn) << (get(i.rm) & 63n));
        break;
      case "ubfm": {
        const bits = BigInt(i.imms - i.immr + 1);
        set(
          i.rd,
          i.imms >= i.immr
            ? (get(i.rn) >> BigInt(i.immr)) & ((1n << bits) - 1n)
            : (get(i.rn) & ((1n << BigInt(i.imms + 1)) - 1n)) <<
                BigInt(64 - i.immr),
        );
        break;
      }
      case "add-reg":
      case "sub-reg": {
        assert.equal(i.amount, 0);
        const a = get(i.rn),
          b = get(i.rm);
        if (i.setFlags) {
          left = a;
          right = b;
        }
        set(i.rd, i.op === "add-reg" ? a + b : a - b);
        break;
      }
      case "add-imm":
      case "sub-imm":
        set(
          i.rd,
          i.op === "add-imm"
            ? get(i.rn) + BigInt(i.immediate)
            : get(i.rn) - BigInt(i.immediate),
        );
        break;
      case "b":
        pc += i.displacement / 4 - 1;
        break;
      case "b.cond":
        if (condition(i.condition)) pc += i.displacement / 4 - 1;
        break;
      case "dmb":
      case "clrex":
        accesses.push({ op: i.op, address: 0n, width: 0 });
        break;
      case "ldr":
      case "str":
      case "ldrb":
      case "strb":
      case "ldrh":
      case "strh":
      case "ldar":
      case "stlr":
      case "ldaxr":
      case "stlxr": {
        const width =
          i.op === "ldrb" || i.op === "strb"
            ? 1
            : i.op === "ldrh" || i.op === "strh"
              ? 2
              : "width" in i
                ? i.width / 8
                : assert.fail("missing access width");
        const address = get(i.rn) + BigInt("offset" in i ? i.offset : 0);
        assert.ok(
          (address >= 0x1000n && address + BigInt(width) <= 0x1010n) ||
            (address >= 0x2000n && address + BigInt(width) <= 0x2020n) ||
            (address >= 0x3000n && address + BigInt(width) <= 0x3008n),
          "access outside owned test windows",
        );
        accesses.push({ op: i.op, address, width });
        if (i.op === "stlxr") {
          if (failures > 0) {
            failures--;
            set(i.rs, 1n);
          } else {
            write(address, width, get(i.rt));
            set(i.rs, 0n);
          }
        } else if (i.op.startsWith("st")) write(address, width, get(i.rt));
        else set(i.rt, read(address, width));
        break;
      }
      case "ret":
        for (let r = 16; r < 30; r++)
          assert.equal(registers[r], BigInt(0x8000 + r), "preserved x" + r);
        return {
          result: get(0),
          payload: read(0x1000n, 8),
          scratch: read(0x3000n, 8),
          accesses,
          steps,
        };
      default:
        assert.fail("unmodeled instruction " + i.op);
    }
  }
}
