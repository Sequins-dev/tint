/** Cooperative instruction model of the platform worker bridge. CAS is modeled
 * as its audited leaf contract, not as evidence of native/hardware ordering. */
import assert from "node:assert/strict";
import type { ContentionCode } from "./native-contention-fixture.ts";
export function modelContention(
  code: ContentionCode,
  abortBeforeStart = false,
  schedule: "round-robin" | "aba" = "round-robin",
) {
  const memory = new Map<bigint, number>(),
    base = 0x10000n,
    mask = (1n << 64n) - 1n;
  function write(address: bigint, width: number, value: bigint) {
    for (let n = 0; n < width; n++)
      memory.set(address + BigInt(n), Number((value >> BigInt(n * 8)) & 255n));
  }
  function read(address: bigint, width: number) {
    let value = 0n;
    for (let n = width - 1; n >= 0; n--)
      value = (value << 8n) | BigInt(memory.get(address + BigInt(n)) ?? 0);
    return value;
  }
  for (let n = 60; n < 76; n++) write(base + BigInt(n), 1, 165n);
  write(base + 64n, code.width, 0n);
  const workers = [0, 1].map((id) => {
    const record = base + BigInt(128 + id * 64),
      sp = 0x20000n + BigInt(id * 0x10000);
    write(record, 8, base);
    write(record + 8n, 8, base + BigInt(8 + id * 4));
    write(record + 56n, 8, base + BigInt(16 + (1 - id) * 4));
    const registers = Array.from({ length: 31 }, (_, r) =>
      BigInt(0x800000 + id * 256 + r),
    );
    registers[0] = record;
    registers[30] = 0x400000n;
    return {
      registers,
      sp,
      initialSp: sp,
      original: registers.slice(),
      pc: code.workerOffset / 4,
      left: 0n,
      right: 0n,
      done: false,
      successful: 0,
    };
  });
  let steps = 0,
    abaPhase = 0;
  while (workers.some((w) => !w.done)) {
    assert.ok(++steps < 2000000, "workers must terminate");
    let selected: number | undefined;
    if (schedule === "aba") {
      if (
        abaPhase === 0 &&
        workers.every((w) => code.instructions[w.pc]?.op === "bl")
      )
        abaPhase = 1;
      if (
        abaPhase === 1 &&
        (workers[0]!.successful >= 256 || read(base + 24n, 4) === 1n)
      )
        abaPhase = 2;
      if (abaPhase === 2 && workers[1]!.done) abaPhase = 3;
      if (abaPhase > 0) selected = abaPhase === 2 ? 1 : 0;
    }
    for (const [workerIndex, w] of workers.entries()) {
      if (w.done || (selected !== undefined && workerIndex !== selected))
        continue;
      if (
        schedule === "aba" &&
        abaPhase === 0 &&
        code.instructions[w.pc]?.op === "bl"
      )
        continue;
      const get = (r: number | "zr" | "sp") =>
        r === "zr" ? 0n : r === "sp" ? w.sp : w.registers[r]!;
      function set(r: number | "zr" | "sp", v: bigint, width = 64) {
        if (r === "zr") return;
        v &= (1n << BigInt(width)) - 1n;
        if (r === "sp") w.sp = v;
        else w.registers[r] = v;
      }
      const i = code.instructions[w.pc];
      assert.ok(i, `valid pc ${w.pc}`);
      const at = w.pc;
      w.pc++;
      const cond = (c: string) =>
        c === "eq"
          ? w.left === w.right
          : c === "ne"
            ? w.left !== w.right
            : c === "hi"
              ? w.left > w.right
              : c === "cc"
                ? w.left < w.right
                : assert.fail("unexpected condition " + c);
      switch (i.op) {
        case "movz":
          set(i.rd, BigInt(i.immediate) << BigInt(i.shift), i.width);
          break;
        case "movk": {
          const shift = BigInt(i.shift);
          set(
            i.rd,
            (get(i.rd) & ~(65535n << shift)) | (BigInt(i.immediate) << shift),
            i.width,
          );
          break;
        }
        case "orr-reg":
          set(i.rd, get(i.rn) | get(i.rm), i.width);
          break;
        case "orn-reg":
          set(i.rd, get(i.rn) | ~get(i.rm), i.width);
          break;
        case "and-reg":
          set(i.rd, get(i.rn) & get(i.rm), i.width);
          break;
        case "add-imm":
        case "sub-imm": {
          const a = get(i.rn),
            b = BigInt(i.immediate) << BigInt(i.shift),
            result = i.op === "add-imm" ? a + b : a - b;
          if (i.setFlags) {
            w.left = result & mask;
            w.right = 0n;
          }
          set(i.rd, result, i.width);
          break;
        }
        case "add-reg":
        case "sub-reg": {
          assert.equal(i.amount, 0);
          const a = get(i.rn),
            b = get(i.rm);
          if (i.setFlags) {
            w.left = a;
            w.right = b;
          }
          set(i.rd, i.op === "add-reg" ? a + b : a - b, i.width);
          break;
        }
        case "ldr":
        case "str":
        case "ldar":
        case "stlr": {
          const address = get(i.rn) + BigInt("offset" in i ? i.offset : 0),
            width = i.width / 8;
          if (i.op === "ldr" || i.op === "ldar")
            set(i.rt, read(address, width), i.width === 64 ? 64 : 32);
          else write(address, width, get(i.rt));
          break;
        }
        case "stp":
        case "ldp": {
          assert.equal(i.width, 64);
          let address = get(i.rn);
          if (i.mode === "pre") {
            address += BigInt(i.offset);
            set(i.rn, address);
          } else if (i.mode === "offset") address += BigInt(i.offset);
          if (i.op === "stp") {
            write(address, 8, get(i.rt));
            write(address + 8n, 8, get(i.rt2));
          } else {
            set(i.rt, read(address, 8));
            set(i.rt2, read(address + 8n, 8));
          }
          if (i.mode === "post") set(i.rn, get(i.rn) + BigInt(i.offset));
          break;
        }
        case "b":
          w.pc = at + i.displacement / 4;
          break;
        case "b.cond":
          if (cond(i.condition)) w.pc = at + i.displacement / 4;
          break;
        case "bl": {
          assert.equal(at * 4 + i.displacement, code.casLeafOffset);
          assert.equal(get(0), base);
          assert.equal(get(1), 16384n);
          assert.equal(get(2), 64n);
          assert.equal(get(3), BigInt(code.width));
          const expected = get(4),
            replacement = get(5),
            maximum = (1n << BigInt(code.width * 8)) - 1n;
          assert.ok(expected <= maximum && replacement <= maximum);
          const observed = read(base + 64n, code.width);
          if (observed === expected) {
            write(base + 64n, code.width, replacement);
            w.successful++;
          }
          for (let r = 1; r <= 15; r++) set(r, BigInt(0x70000 + r));
          set(30, BigInt(w.pc * 4));
          set(0, observed);
          break;
        }
        case "yield":
        case "dmb":
          break;
        case "ret":
          assert.equal(get(i.rn), 0x400000n);
          assert.equal(
            get(0),
            abortBeforeStart ? 1n : 0n,
            "worker returned expected status",
          );
          assert.equal(w.sp, w.initialSp);
          for (let r = 19; r <= 29; r++)
            assert.equal(get(r), w.original[r], "callee preserved x" + r);
          w.done = true;
          break;
        default:
          assert.fail("unmodeled worker instruction " + i.op);
      }
    }
    // Parent publishes start only after both independent worker ready signals.
    if (read(base + 8n, 4) === 1n && read(base + 12n, 4) === 1n) {
      if (abortBeforeStart) write(base + 4n, 4, 1n);
      write(base, 4, 1n);
    }
  }
  return {
    counter: Number(read(base + 64n, code.width)),
    completed: workers.filter((w) => w.done).length,
    mismatches: Number(read(base + 176n, 4) + read(base + 240n, 4)),
    canariesIntact: [
      60,
      61,
      62,
      63,
      ...Array.from({ length: 8 }, (_, i) => 64 + code.width + i),
    ].every((n) => read(base + BigInt(n), 1) === 165n),
    steps,
  };
}
