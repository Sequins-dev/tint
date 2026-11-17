import { test } from "node:test";
import assert from "node:assert/strict";
import { linuxHostABI } from "@tint/platform/linux/host-abi";
import type { HostOperation, ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import type { Instruction } from "@tint/codegen/aarch64/isa";
import { instructionCacheSync } from "../src/aarch64/scalar/executable-memory.ts";

const span = { start: 1, end: 3 };

/** Executes the cache-maintenance sequence over a model CTR_EL0 and returns
 * the maintenance operations in program order. */
function run(ctr: number, start: number, length: number): readonly string[] {
  const code = instructionCacheSync(),
    x = new Array<bigint>(32).fill(0n),
    trace: string[] = [];
  x[0] = BigInt(start);
  x[1] = BigInt(length);
  const mask = (1n << 64n) - 1n;
  const read = (r: number | "zr"): bigint => (r === "zr" ? 0n : (x[r] ?? 0n));
  let carry = false,
    pc = 0,
    steps = 0;
  while (pc < code.length) {
    if (++steps > 10000) throw Error("runaway cache sequence");
    const i: Instruction | undefined = code[pc];
    assert.ok(i);
    pc++;
    switch (i.op) {
      case "mrs-ctr":
        x[i.rt as number] = BigInt(ctr);
        break;
      case "ubfm": {
        assert.ok(i.imms >= i.immr, "only UBFX forms are expected");
        const width = BigInt(i.imms - i.immr + 1);
        x[i.rd as number] =
          (read(i.rn) >> BigInt(i.immr)) & ((1n << width) - 1n);
        break;
      }
      case "cbnz":
        if (read(i.rt) !== 0n) pc += i.displacement / 4 - 1;
        break;
      case "movz":
        x[i.rd as number] = BigInt(i.immediate) << BigInt(i.shift);
        break;
      case "lslv":
        x[i.rd as number] = (read(i.rn) << read(i.rm)) & mask;
        break;
      case "sub-imm":
        x[i.rd as number] = (read(i.rn as number) - BigInt(i.immediate)) & mask;
        break;
      case "orn-reg":
        x[i.rd as number] = (read(i.rn) | (~read(i.rm) & mask)) & mask;
        break;
      case "and-reg":
        x[i.rd as number] = read(i.rn) & read(i.rm);
        break;
      case "add-reg":
        x[i.rd as number] = (read(i.rn) + read(i.rm)) & mask;
        break;
      case "sub-reg":
        assert.equal(i.rd, "zr");
        carry = read(i.rn) >= read(i.rm);
        break;
      case "b.cond":
        assert.equal(i.condition, "cc");
        if (!carry) pc += i.displacement / 4 - 1;
        break;
      case "dc-cvau":
      case "ic-ivau":
        trace.push(i.op + " " + read(i.rt).toString(16));
        break;
      case "dsb":
        trace.push("dsb " + i.domain);
        break;
      case "isb":
        trace.push("isb");
        break;
      default:
        assert.fail("unexpected " + i.op);
    }
  }
  return trace;
}
// CTR_EL0: IminLine bits 3:0, DminLine bits 19:16 (log2 words), IDC bit 28,
// DIC bit 29.
const ctr = (dLog: number, iLog: number, idc = 0, dic = 0): number =>
  iLog + dLog * 65536 + idc * 0x10000000 + dic * 0x20000000;

test("instruction-cache sync cleans then invalidates every line of the range", () => {
  // 64-byte lines; an unaligned range spanning three lines.
  assert.deepEqual(run(ctr(4, 4), 0x1004, 0x80), [
    "dc-cvau 1000",
    "dc-cvau 1040",
    "dc-cvau 1080",
    "dsb ish",
    "ic-ivau 1000",
    "ic-ivau 1040",
    "ic-ivau 1080",
    "dsb ish",
    "isb",
  ]);
  // Aligned range ending exactly at a line boundary: one line, not two.
  assert.deepEqual(run(ctr(4, 4), 0x2000, 0x40), [
    "dc-cvau 2000",
    "dsb ish",
    "ic-ivau 2000",
    "dsb ish",
    "isb",
  ]);
  // A single instruction at the end of a line.
  assert.deepEqual(run(ctr(4, 4), 0x203c, 4), [
    "dc-cvau 2000",
    "dsb ish",
    "ic-ivau 2000",
    "dsb ish",
    "isb",
  ]);
  // Independent data (64-byte) and instruction (32-byte) line sizes.
  assert.deepEqual(run(ctr(4, 3), 0x3020, 0x40), [
    "dc-cvau 3000",
    "dc-cvau 3040",
    "dsb ish",
    "ic-ivau 3020",
    "ic-ivau 3040",
    "dsb ish",
    "isb",
  ]);
});

test("CTR_EL0.IDC and DIC skip only the maintenance the hardware makes unnecessary", () => {
  // IDC: no data clean, but stores must still complete before fetch.
  assert.deepEqual(run(ctr(4, 4, 1, 0), 0x1000, 8), [
    "dsb ish",
    "ic-ivau 1000",
    "dsb ish",
    "isb",
  ]);
  // DIC: no instruction invalidation; the context synchronization remains.
  assert.deepEqual(run(ctr(4, 4, 0, 1), 0x1000, 8), [
    "dc-cvau 1000",
    "dsb ish",
    "isb",
  ]);
  assert.deepEqual(run(ctr(4, 4, 1, 1), 0x1000, 8), ["dsb ish", "isb"]);
});

function hostModule(
  operation: HostOperation,
  slots: ModuleIR["functions"][number]["slots"],
): ModuleIR {
  const parameters = slots.map((_, index) => index);
  return {
    functions: [
      {
        id: 0,
        name: "host",
        exported: true,
        parameters,
        slots,
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              ...parameters.map((slot) => ({
                kind: "load" as const,
                id: slot,
                slot,
                ...span,
              })),
              {
                kind: "host-call",
                id: parameters.length,
                operation,
                arguments: parameters,
                ...span,
              },
            ],
            terminator: {
              kind: "return",
              value: parameters.length,
              ...span,
            },
          },
        ],
      },
    ],
  };
}
function imports(
  operation: HostOperation,
  slots: ModuleIR["functions"][number]["slots"],
): string[] {
  const result = emitModule(hostModule(operation, slots), {
    hostABI: linuxHostABI(),
  });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value.imports.map((item) =>
    item.target.kind === "import" ? item.target.name : item.target.kind,
  );
}

test("Linux executable arenas are dual mappings with no RWX fallback", () => {
  // Reserve, create the memory file, size it, map both views, close it,
  // protect the header; failures report errno and undo in reverse order.
  assert.deepEqual(imports("executable-map", ["number"]), [
    "mmap",
    "memfd_create",
    "ftruncate",
    "mmap",
    "mmap",
    "close",
    "mprotect",
    "__errno_location",
    "close",
    "__errno_location",
    "munmap",
    "__errno_location",
  ]);
  // Copy through the writable view, read back the executable view, and
  // repair a debugger-copied page under a temporary RW protection.
  assert.deepEqual(
    imports("executable-write", ["number", "number", "number", "Uint8Array"]),
    ["memmove", "memcmp", "mprotect", "memmove", "mprotect"],
  );
  assert.deepEqual(imports("executable-unmap", ["number", "number"]), [
    "munmap",
    "__errno_location",
  ]);
});

test("Linux executable writes maintain the instruction cache inline", () => {
  const result = emitModule(
    hostModule("executable-write", [
      "number",
      "number",
      "number",
      "Uint8Array",
    ]),
    { hostABI: linuxHostABI() },
  );
  assert.ok(result.ok, JSON.stringify(result));
  const words = new Uint32Array(
    result.value.code.buffer,
    result.value.code.byteOffset,
    result.value.code.byteLength / 4,
  );
  const has = (word: number): boolean => words.includes(word);
  // MRS x9, CTR_EL0; DC CVAU, x13; IC IVAU, x13; DSB ISH; ISB.
  for (const word of [
    0xd53b0029, 0xd50b7b2d, 0xd50b752d, 0xd5033b9f, 0xd5033fdf,
  ])
    assert.ok(has(word), word.toString(16));
  // No Darwin protection toggles or library cache routine.
  assert.ok(
    !result.value.imports.some(
      (item) =>
        item.target.kind === "import" &&
        (item.target.name.includes("jit_write_protect") ||
          item.target.name.includes("icache")),
    ),
  );
});
