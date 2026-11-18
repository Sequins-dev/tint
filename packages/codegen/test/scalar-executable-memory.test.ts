import { test } from "node:test";
import assert from "node:assert/strict";
import { linuxHostABI } from "@tint/platform/linux/host-abi";
import type { HostOperation, ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import type { Condition, Instruction } from "@tint/codegen/aarch64/isa";
import {
  dualMappingOf,
  emitDualMappingMap,
  emitDualMappingUnmap,
  emitDualMappingWrite,
  instructionCacheSync,
  type DualMapping,
  type InlineSequence,
} from "../src/aarch64/scalar/executable-memory.ts";

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
  // Reserve, create the memory file (MFD_EXEC, then without it; refused:
  // the single anonymous mapping), size it, map both views, close it,
  // protect the header; failures report errno and undo in reverse order.
  assert.deepEqual(imports("executable-map", ["number"]), [
    "mmap",
    "memfd_create",
    "__errno_location",
    "memfd_create",
    "__errno_location",
    "mmap",
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

/** A C library call the model sequence makes: the symbol and x0-x5. */
interface ModelCall {
  readonly symbol: string;
  readonly args: readonly bigint[];
}
/** Runs an inline sequence over a model machine whose C calls `libc`
 * answers (returning x0, or a negative errno: -1 is returned and errno set
 * as C does). Memory is a sparse map of 64-bit words; scratch words live at
 * `scratchBase`. Returns x0 at the end (or "rejected") and the calls. */
function runSequence(
  build: (s: InlineSequence) => void,
  libc: (call: ModelCall, memory: Map<bigint, bigint>) => bigint,
  registers: readonly (readonly [number, bigint])[] = [],
  memory: Map<bigint, bigint> = new Map(),
): { readonly result: bigint | "rejected"; readonly calls: ModelCall[] } {
  type Step =
    | { readonly kind: "instruction"; readonly instruction: Instruction }
    | {
        readonly kind: "branch";
        readonly label: string;
        readonly condition: Condition | undefined;
      }
    | { readonly kind: "call"; readonly symbol: string }
    | {
        readonly kind: "constant";
        readonly rd: number;
        readonly value: bigint;
      };
  const steps: Step[] = [],
    labels = new Map<string, number>();
  const scratchBase = 0x7000n,
    errnoAddress = 0x7800n;
  const sequence: InlineSequence = {
    emit: (instruction) => {
      steps.push({ kind: "instruction", instruction });
    },
    label: (name) => {
      assert.ok(!labels.has(name), "duplicate label " + name);
      labels.set(name, steps.length);
    },
    branch: (label, condition) => {
      steps.push({ kind: "branch", label, condition });
    },
    call: (symbol) => {
      steps.push({ kind: "call", symbol });
    },
    load: (rt, word) => {
      steps.push({
        kind: "instruction",
        instruction: { op: "ldr", width: 64, rt, rn: 28, offset: word * 8 },
      });
    },
    store: (rt, word) => {
      steps.push({
        kind: "instruction",
        instruction: { op: "str", width: 64, rt, rn: 28, offset: word * 8 },
      });
    },
    constant: (rd, lo, hi = 0) => {
      steps.push({
        kind: "constant",
        rd,
        value: (BigInt(hi) << 32n) | BigInt(lo),
      });
    },
    address: (rd, word) => {
      steps.push({
        kind: "instruction",
        instruction: {
          op: "add-imm",
          width: 64,
          rd,
          rn: 28,
          immediate: word * 8,
          shift: 0,
          setFlags: false,
        },
      });
    },
  };
  build(sequence);
  labels.set("rejected", -1);
  const mask = (1n << 64n) - 1n,
    x = new Array<bigint>(32).fill(0n),
    calls: ModelCall[] = [];
  x[28] = scratchBase;
  for (const [register, value] of registers) x[register] = value & mask;
  const read = (r: number | "zr" | "sp"): bigint =>
    r === "zr" || r === "sp" ? 0n : (x[r] ?? 0n);
  const signed = (value: bigint, width: number): bigint =>
    BigInt.asIntN(width, value);
  let n = false,
    z = false,
    c = false,
    v = false;
  const subtract = (a: bigint, b: bigint, width: 32 | 64): void => {
    const m = (1n << BigInt(width)) - 1n,
      left = a & m,
      right = b & m,
      difference = (left - right) & m;
    n = signed(difference, width) < 0n;
    z = difference === 0n;
    c = left >= right;
    v =
      signed(left, width) - signed(right, width) !== signed(difference, width);
  };
  const holds = (condition: Condition): boolean => {
    switch (condition) {
      case "eq":
        return z;
      case "ne":
        return !z;
      case "lt":
        return n !== v;
      case "ge":
        return n === v;
      case "le":
        return z || n !== v;
      case "hi":
        return c && !z;
      default:
        assert.fail("unexpected condition " + condition);
    }
  };
  let pc = 0,
    count = 0;
  while (pc < steps.length) {
    if (++count > 10000) assert.fail("runaway sequence");
    const step = steps[pc++];
    assert.ok(step);
    if (step.kind === "branch") {
      if (step.condition === undefined || holds(step.condition)) {
        const target = labels.get(step.label);
        assert.ok(target !== undefined, "missing label " + step.label);
        if (target < 0) return { result: "rejected", calls };
        pc = target;
      }
      continue;
    }
    if (step.kind === "constant") {
      x[step.rd] = step.value;
      continue;
    }
    if (step.kind === "call") {
      if (step.symbol === "__errno_location") {
        x[0] = errnoAddress;
        continue;
      }
      const call = { symbol: step.symbol, args: x.slice(0, 6) };
      calls.push(call);
      const returned = libc(call, memory);
      if (returned < 0n) {
        memory.set(errnoAddress, -returned);
        x[0] = mask;
      } else x[0] = returned;
      for (let r = 1; r <= 18; r++) x[r] = 0xdeadn;
      continue;
    }
    const i = step.instruction;
    switch (i.op) {
      case "add-imm":
      case "sub-imm": {
        const operand = BigInt(i.immediate) << BigInt(i.shift),
          base = read(i.rn as number);
        if (i.setFlags) subtract(base, operand, i.width);
        if (i.rd !== "zr")
          x[i.rd as number] =
            (i.op === "add-imm" ? base + operand : base - operand) & mask;
        break;
      }
      case "add-reg":
        assert.ok(!i.setFlags);
        x[i.rd as number] = (read(i.rn) + read(i.rm)) & mask;
        break;
      case "sub-reg":
        if (i.setFlags) subtract(read(i.rn), read(i.rm), i.width);
        if (i.rd !== "zr") x[i.rd as number] = (read(i.rn) - read(i.rm)) & mask;
        break;
      case "orr-reg":
        x[i.rd as number] = read(i.rn) | read(i.rm);
        break;
      case "ubfm": {
        const value = read(i.rn);
        x[i.rd as number] =
          i.imms >= i.immr
            ? (value >> BigInt(i.immr)) &
              ((1n << BigInt(i.imms - i.immr + 1)) - 1n)
            : ((value & ((1n << BigInt(i.imms + 1)) - 1n)) <<
                BigInt(64 - i.immr)) &
              mask;
        break;
      }
      case "sbfm":
        assert.equal(i.immr, 0);
        x[i.rd as number] = BigInt.asIntN(i.imms + 1, read(i.rn)) & mask;
        break;
      case "ldr": {
        const word = memory.get(read(i.rn) + BigInt(i.offset)) ?? 0n;
        x[i.rt as number] = i.width === 32 ? word & 0xffffffffn : word;
        break;
      }
      case "str":
        memory.set(read(i.rn) + BigInt(i.offset), read(i.rt));
        break;
      case "mrs-ctr":
        // The cache maintenance that follows is modelled separately above.
        return { result: x[0] ?? 0n, calls };
      default:
        assert.fail("unexpected " + i.op);
    }
  }
  return { result: x[0] ?? 0n, calls };
}

const argumentCounts: Record<string, number> = {
  mmap: 6,
  munmap: 2,
  mprotect: 3,
  memfd_create: 2,
  ftruncate: 2,
  close: 1,
  memmove: 3,
  memcmp: 3,
};
/** symbol(arguments) in hexadecimal. */
function describe(call: ModelCall): string {
  return (
    call.symbol +
    "(" +
    call.args
      .slice(0, argumentCounts[call.symbol] ?? 6)
      .map((arg) => "0x" + arg.toString(16))
      .join(",") +
    ")"
  );
}
const dualMapping = dualMappingOf(linuxHostABI());
assert.ok(dualMapping);
const linuxMapping: DualMapping = dualMapping;
const reservation = 0x40000000n,
  granule = 16384n;
/** A Linux kernel model for mapExecutableMemory: `memoryFile` answers
 * memfd_create(flags); everything else succeeds. */
function mapOn(
  memoryFile: (flags: bigint) => bigint,
  mapAnonymous: bigint = 0n,
  reserved: bigint = reservation,
): { readonly result: bigint; readonly calls: string[]; header: bigint[] } {
  const memory = new Map<bigint, bigint>();
  const run = runSequence(
    (s) => emitDualMappingMap(s, linuxMapping),
    (call, words) => {
      const [a0 = 0n, a1 = 0n] = call.args;
      switch (call.symbol) {
        case "mmap":
          if (a0 === 0n) return reserved;
          if (call.args[4] === 0xffffffffn && mapAnonymous < 0n)
            return mapAnonymous;
          return a0;
        case "memfd_create": {
          const name =
            (words.get(a0) ?? 0n).toString(16) +
            ":" +
            (words.get(a0 + 8n) ?? 0n);
          assert.equal(name, "74696a2d746e6974:0", "tint-jit\\0");
          return memoryFile(a1);
        }
        default:
          return 0n;
      }
    },
    [[1, 100n]],
    memory,
  );
  assert.notEqual(run.result, "rejected");
  return {
    result: BigInt.asIntN(64, run.result as bigint),
    calls: run.calls.map(describe),
    // The header follows the first granule boundary after the reservation.
    header: [0n, 8n, 16n, 24n, 32n].map(
      (offset) =>
        memory.get(
          ((reserved + 2n * granule - 1n) & ~(granule - 1n)) - granule + offset,
        ) ?? 0n,
    ),
  };
}
const executable = reservation + granule,
  magicWord = 0x50414d58544e4954n;
const reserve = "mmap(0x0,0x10000,0x3,0x4022,0xffffffff,0x0)";
const dualCalls = (memoryFileCalls: readonly string[]): string[] => [
  reserve,
  ...memoryFileCalls,
  "ftruncate(0x3,0x4000)",
  "mmap(0x40004000,0x4000,0x5,0x12,0x3,0x0)",
  "mmap(0x40008000,0x4000,0x3,0x11,0x3,0x0)",
  "close(0x3)",
  "mprotect(0x40000000,0x4000,0x1)",
];
const memfdCall = (flags: number): string =>
  "memfd_create(0x7010,0x" + flags.toString(16) + ")";

test("executable memory files are requested with MFD_EXEC, retried without it on older kernels", () => {
  // Linux 6.3+: MFD_EXEC is accepted.
  const current = mapOn(() => 3n);
  assert.equal(current.result, executable);
  assert.deepEqual(current.calls, dualCalls([memfdCall(0x11)]));
  assert.deepEqual(current.header, [
    magicWord,
    executable,
    granule,
    executable + granule,
    reservation,
  ]);
  // Before 6.3 the unknown flag is EINVAL; the plain file is a dual mapping.
  const older = mapOn((flags) => ((flags & 0x10n) !== 0n ? -22n : 3n));
  assert.equal(older.result, executable);
  assert.deepEqual(older.calls, dualCalls([memfdCall(0x11), memfdCall(0x1)]));
  assert.deepEqual(older.header, current.header);
});

test("a kernel refusing executable memory files gets a single W^X mapping", () => {
  const singleCalls = (memoryFileCalls: readonly string[]): string[] => [
    reserve,
    ...memoryFileCalls,
    "mmap(0x40004000,0x4000,0x5,0x32,0xffffffff,0x0)",
    "mprotect(0x40000000,0x4000,0x1)",
  ];
  // vm.memfd_noexec=2 (EACCES); also after an EINVAL retry.
  for (const [kernel, calls] of [
    [() => -13n, [memfdCall(0x11)]],
    [
      (flags: bigint) => ((flags & 0x10n) !== 0n ? -22n : -13n),
      [memfdCall(0x11), memfdCall(0x1)],
    ],
  ] as const) {
    const single = mapOn(kernel);
    assert.equal(single.result, executable);
    assert.deepEqual(single.calls, singleCalls(calls));
    // The header names the executable view as its own writable view.
    assert.deepEqual(single.header, [
      magicWord,
      executable,
      granule,
      executable,
      reservation,
    ]);
  }
});

test("other memory-file and fallback failures release the reservation and report errno", () => {
  const release = "munmap(0x40000000,0x10000)";
  // EMFILE, and EINVAL from both attempts, are not refusals of exec.
  const emfile = mapOn(() => -24n);
  assert.equal(emfile.result, -24n);
  assert.deepEqual(emfile.calls, [reserve, memfdCall(0x11), release]);
  const invalid = mapOn(() => -22n);
  assert.equal(invalid.result, -22n);
  assert.deepEqual(invalid.calls.slice(1), [
    memfdCall(0x11),
    memfdCall(0x1),
    release,
  ]);
  // The fallback mapping itself refused (SELinux execmem): -EACCES.
  const refused = mapOn(() => -13n, -13n);
  assert.equal(refused.result, -13n);
  assert.equal(refused.calls.at(-1), release);
});

test("views start on a granule boundary when the kernel's pages are smaller", () => {
  // A 4 KiB-aligned reservation: the header moves up to the granule below
  // the first boundary, and the release covers the original reservation.
  const unaligned = mapOn(() => 3n, 0n, reservation + 0x1000n);
  assert.equal(unaligned.result, reservation + 2n * granule);
  assert.deepEqual(unaligned.calls.slice(-4), [
    "mmap(0x40008000,0x4000,0x5,0x12,0x3,0x0)",
    "mmap(0x4000c000,0x4000,0x3,0x11,0x3,0x0)",
    "close(0x3)",
    "mprotect(0x40004000,0x4000,0x1)",
  ]);
  assert.deepEqual(unaligned.header, [
    magicWord,
    reservation + 2n * granule,
    granule,
    reservation + 3n * granule,
    reservation + 0x1000n,
  ]);
  const failed = mapOn(() => -24n, 0n, reservation + 0x1000n);
  assert.equal(failed.calls.at(-1), "munmap(0x40001000,0x10000)");
  // Unmapping releases the recorded reservation, whatever its alignment.
  const header = reservation + granule,
    view = header + granule;
  const unmap = runSequence(
    (s) => emitDualMappingUnmap(s, linuxMapping.symbols),
    () => 0n,
    [
      [0, view],
      [1, granule],
    ],
    new Map<bigint, bigint>([
      [header, magicWord],
      [header + 8n, view],
      [header + 16n, granule],
      [header + 24n, view + granule],
      [header + 32n, reservation + 0x1000n],
    ]),
  );
  assert.equal(unmap.result, 0n);
  assert.deepEqual(unmap.calls.map(describe), ["munmap(0x40001000,0x10000)"]);
});

/** writeExecutableMemory's copy over a header naming `writable`, with
 * `visible` the memcmp result (0 unless a debugger copied the page). */
function writeOn(
  writable: bigint,
  visible: bigint = 0n,
  protect: bigint = 0n,
): { readonly result: bigint | "rejected"; readonly calls: string[] } {
  const memory = new Map<bigint, bigint>([
    [reservation, magicWord],
    [reservation + 8n, executable],
    [reservation + 16n, granule],
    [reservation + 24n, writable],
  ]);
  const run = runSequence(
    (s) =>
      emitDualMappingWrite(s, linuxMapping.symbols, (condition) =>
        s.branch("rejected", condition),
      ),
    (call) =>
      call.symbol === "memcmp"
        ? visible
        : call.symbol === "mprotect"
          ? protect
          : 0n,
    // The last 64 bytes of the arena's only granule.
    [
      [0, executable],
      [1, granule],
      [2, 0x3fc0n],
      [3, 0x9000n],
      [10, 64n],
    ],
    memory,
  );
  return {
    result: run.result,
    calls: run.calls.map(describe),
  };
}

test("single-mapping writes flip the spanned granules RW then RX", () => {
  const destination = "0x" + (executable + 0x3fc0n).toString(16);
  // Dual mapping: copy through the writable view and read it back.
  assert.deepEqual(writeOn(executable + granule).calls, [
    "memmove(0x" +
      (executable + granule + 0x3fc0n).toString(16) +
      ",0x9000,0x40)",
    "memcmp(" + destination + ",0x9000,0x40)",
  ]);
  // A debugger-copied page is repaired in place.
  assert.deepEqual(writeOn(executable + granule, 1n).calls.slice(2), [
    "mprotect(0x40004000,0x4000,0x3)",
    "memmove(" + destination + ",0x9000,0x40)",
    "mprotect(0x40004000,0x4000,0x5)",
  ]);
  // Single mapping: always in place, never writable and executable.
  assert.deepEqual(writeOn(executable).calls, [
    "mprotect(0x40004000,0x4000,0x3)",
    "memmove(" + destination + ",0x9000,0x40)",
    "mprotect(0x40004000,0x4000,0x5)",
  ]);
  // PaX MPROTECT refuses making the executable view writable: the write
  // fails explicitly before copying anything.
  const refused = writeOn(executable, 0n, -13n);
  assert.equal(refused.result, "rejected");
  assert.deepEqual(refused.calls, ["mprotect(0x40004000,0x4000,0x3)"]);
});
