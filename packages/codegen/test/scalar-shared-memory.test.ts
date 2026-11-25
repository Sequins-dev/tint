import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { encode } from "../src/aarch64/isa.ts";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import {
  hostParameters,
  bindHostOperations,
  type HostOperation,
  type ModuleIR,
} from "@tint/ir/scalar";
const kinds = [
  "shared-compare-exchange-unsigned",
  "shared-read-unsigned",
  "shared-write-unsigned",
  "shared-read-word64",
  "shared-write-word64",
  "shared-compare-exchange-word64",
] as const;
for (const kind of kinds)
  test(`${kind} emits a nonallocating leaf with valid encodings and conservative ordered fences`, async () => {
    assert.ok(
      existsSync("packages/codegen/src/aarch64/scalar/shared-memory.ts"),
      "shared access leaf must exist",
    );
    const { sharedMemoryPrimitive } =
      await import("../src/aarch64/scalar/shared-memory.ts");
    const instructions = sharedMemoryPrimitive(kind);
    for (const instruction of instructions)
      assert.ok(encode(instruction).ok, JSON.stringify(instruction));
    assert.ok(instructions.some((i) => i.op === "dmb" && i.domain === "ish"));
    assert.ok(
      !instructions.some(
        (i) => i.op === "bl" || i.op === "blr" || i.op.startsWith("svc"),
      ),
    );
    if (kind === "shared-compare-exchange-word64") {
      assert.equal(
        instructions.filter((i) => i.op === "ldaxr" && i.width === 64).length,
        1,
      );
      assert.equal(
        instructions.filter((i) => i.op === "stlxr" && i.width === 64).length,
        1,
      );
      assert.equal(instructions.filter((i) => i.op === "clrex").length, 1);
    }
    const parameters = hostParameters(kind as HostOperation);
    assert.ok(parameters);
    const source: ModuleIR = {
      functions: [
        {
          id: 0,
          name: kind,
          exported: true,
          parameters: parameters.map((_, index) => index),
          slots: [...parameters],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "constant", id: 0, value: 0, start: 0, end: 0 },
              ],
              terminator: { kind: "return", value: 0, start: 0, end: 0 },
            },
          ],
        },
      ],
    };
    const bound = bindHostOperations(source, [
      { function: 0, operation: kind as HostOperation },
    ]);
    assert.ok(bound.ok);
    const emitted = emitModule(bound.value);
    assert.ok(emitted.ok, JSON.stringify(emitted));
    assert.ok(emitted.value.helpers.some((helper) => helper.kind === kind));
  });

// The model tests guards/paths/bit transport; root owns actual native execution.
import { sharedLeafMachine } from "./shared-leaf-machine.ts";
import { sharedMemoryPrimitive } from "../src/aarch64/scalar/shared-memory.ts";
const invalid = (1n << 64n) - 1n;
test("shared integer leaves touch one whole selected width with distinct ordered and unordered paths", () => {
  for (const width of [1, 2, 4])
    for (const order of [0, 1]) {
      const maximum = (1n << BigInt(width * 8)) - 1n;
      const read = sharedLeafMachine(
        sharedMemoryPrimitive("shared-read-unsigned"),
        [0x1000n, 16n, 0n, BigInt(width), BigInt(order)],
      );
      assert.equal(read.result, maximum);
      const loads = read.accesses.filter(
        (access) => access.address === 0x1000n,
      );
      assert.equal(loads.length, 1);
      assert.equal(loads[0]!.width, width);
      assert.equal(
        loads[0]!.op,
        order ? "ldar" : width === 1 ? "ldrb" : width === 2 ? "ldrh" : "ldr",
      );
      // A seq-cst load is fenced on both sides; an unordered one is not.
      assert.equal(
        read.accesses.filter((access) => access.op === "dmb").length,
        order ? 2 : 0,
      );
      const write = sharedLeafMachine(
        sharedMemoryPrimitive("shared-write-unsigned"),
        [0x1000n, 16n, 0n, BigInt(width), maximum, BigInt(order)],
        0n,
      );
      assert.equal(write.result, 0n);
      assert.equal(write.payload, maximum);
      assert.equal(
        write.accesses.filter((access) => access.address === 0x1000n).length,
        1,
      );
      assert.equal(
        write.accesses.filter((access) => access.op === "dmb").length,
        order ? 2 : 0,
      );
    }
});
test("shared leaves reject bad width/order/range/alignment/value before touching payload", () => {
  const code = sharedMemoryPrimitive("shared-write-unsigned");
  for (const args of [
    [0n, 16n, 0n, 4n, 1n, 0n],
    [0x1000n, 16n, 0n, 3n, 1n, 0n],
    [0x1000n, 16n, 0n, 8n, 1n, 0n],
    [0x1000n, 16n, 0n, 4n, 1n, 2n],
    [0x1000n, 16n, 1n, 4n, 1n, 0n],
    [0x1000n, 16n, 16n, 4n, 1n, 0n],
    [0x1000n, 16n, 17n, 4n, 1n, 0n],
    [0x1000n, 2n, 0n, 4n, 1n, 0n],
    [0x1000n, 16n, 0n, 1n, 256n, 0n],
    [0x1000n, 16n, 0n, 2n, 65536n, 0n],
    [0x1000n, 16n, 0n, 4n, 0x100000000n, 0n],
    [(1n << 53n) - 8n, 16n, 0n, 4n, 1n, 0n],
  ]) {
    const run = sharedLeafMachine(code, args);
    assert.equal(run.result, invalid, String(args));
    assert.equal(run.accesses.length, 0);
    assert.equal(run.payload, invalid);
  }
});
test("Word64 leaves capture/store one 64-bit word and split only after capture", () => {
  for (const order of [0n, 1n])
    for (const value of [
      0n,
      invalid,
      0x8000000000000001n,
      0x123456789abcdef0n,
    ]) {
      const read = sharedLeafMachine(
        sharedMemoryPrimitive("shared-read-word64"),
        [0x1000n, 16n, 0n, order, 0x2000n],
        value,
      );
      assert.equal(read.result, 0n);
      assert.equal(read.scratch, value);
      assert.equal(
        read.accesses.filter((access) => access.address === 0x1000n).length,
        1,
      );
      const write = sharedLeafMachine(
        sharedMemoryPrimitive("shared-write-word64"),
        [0x1000n, 16n, 0n, order, value & 0xffffffffn, value >> 32n],
        0n,
      );
      assert.equal(write.result, 0n);
      assert.equal(write.payload, value);
      assert.equal(
        write.accesses.filter((access) => access.address === 0x1000n).length,
        1,
      );
    }
});
test("Word64 scratch guards reject short, unaligned and overlapping output before payload access", () => {
  const code = sharedMemoryPrimitive("shared-read-word64");
  for (const [length, pointer] of [
    [1, 0x3000n],
    [2, 0x3001n],
    [2, 0x1000n],
    [2, 0x1004n],
    [2, 0xffcn],
  ] as const) {
    const run = sharedLeafMachine(
      code,
      [0x1000n, 16n, 0n, 0n, 0x2000n],
      invalid,
      0,
      length,
      pointer,
    );
    assert.equal(run.result, invalid);
    assert.equal(
      run.accesses.filter((access) => access.address < 0x2000n).length,
      0,
    );
    assert.equal(run.scratch, 0x123456789abcdef0n);
  }
});
test("seq-cst CAS preserves observed bits on success/mismatch, retries exclusive failure, and clears mismatch reservation", () => {
  const code = sharedMemoryPrimitive("shared-compare-exchange-word64");
  for (const failures of [0, 1]) {
    const run = sharedLeafMachine(
      code,
      [0x1000n, 16n, 0n, 0xffffffffn, 0xffffffffn, 1n, 0x80000000n, 0x2000n],
      invalid,
      failures,
    );
    assert.equal(run.result, 0n);
    assert.equal(run.scratch, invalid);
    assert.equal(run.payload, 0x8000000000000001n);
    assert.equal(
      run.accesses.filter((access) => access.op === "ldaxr").length,
      failures + 1,
    );
    assert.equal(
      run.accesses.filter((access) => access.op === "stlxr").length,
      failures + 1,
    );
    assert.equal(
      run.accesses.filter((access) => access.op === "dmb").length,
      2,
    );
  }
  const mismatch = sharedLeafMachine(
    code,
    [0x1000n, 16n, 0n, 1n, 0n, 0n, 0n, 0x2000n],
    invalid,
  );
  assert.equal(mismatch.payload, invalid);
  assert.equal(mismatch.scratch, invalid);
  assert.equal(
    mismatch.accesses.filter((access) => access.op === "stlxr").length,
    0,
  );
  assert.equal(
    mismatch.accesses.filter((access) => access.op === "clrex").length,
    1,
  );
  const equality = sharedLeafMachine(
    code,
    [
      0x1000n,
      16n,
      0n,
      0xffffffffn,
      0xffffffffn,
      0xffffffffn,
      0xffffffffn,
      0x2000n,
    ],
    invalid,
  );
  assert.equal(
    equality.accesses.filter((access) => access.op === "stlxr").length,
    1,
  );
  assert.equal(equality.payload, invalid);
});

test("unsigned CAS selects exact width, retries, clears mismatch and performs equal-value RMW", () => {
  const code = sharedMemoryPrimitive("shared-compare-exchange-unsigned");
  assert.ok(
    !code.some((i) => (i.op === "ldaxr" || i.op === "stlxr") && i.width === 64),
  );
  for (const width of [1, 2, 4]) {
    const maximum = (1n << BigInt(width * 8)) - 1n;
    const original = 0x12345678ffffffffn;
    for (const failures of [0, 1, 3]) {
      const run = sharedLeafMachine(
        code,
        [0x1000n, 8n, 0n, BigInt(width), maximum, 1n],
        original,
        failures,
      );
      assert.equal(run.result, maximum);
      assert.equal(run.payload, (original & ~maximum) | 1n);
      const accesses = run.accesses.filter(
        (a) => a.op === "ldaxr" || a.op === "stlxr",
      );
      assert.equal(accesses.length, (failures + 1) * 2);
      assert.ok(accesses.every((a) => a.width === width));
      assert.equal(run.accesses.filter((a) => a.op === "dmb").length, 2);
    }
    const mismatch = sharedLeafMachine(
      code,
      [0x1000n, 8n, 0n, BigInt(width), 0n, 1n],
      original,
    );
    assert.equal(mismatch.result, maximum);
    assert.equal(mismatch.payload, original);
    assert.equal(mismatch.accesses.filter((a) => a.op === "stlxr").length, 0);
    assert.equal(mismatch.accesses.filter((a) => a.op === "clrex").length, 1);
    const equality = sharedLeafMachine(
      code,
      [0x1000n, 8n, 0n, BigInt(width), maximum, maximum],
      original,
    );
    assert.equal(equality.result, maximum);
    assert.equal(equality.payload, original);
    assert.equal(equality.accesses.filter((a) => a.op === "stlxr").length, 1);
  }
});
test("unsigned CAS rejects width, bounds, alignment and either oversized operand before memory access", () => {
  const code = sharedMemoryPrimitive("shared-compare-exchange-unsigned");
  for (const args of [
    [0n, 8n, 0n, 1n, 0n, 1n],
    [0x1000n, 8n, 0n, 3n, 0n, 1n],
    [0x1000n, 8n, 0n, 8n, 0n, 1n],
    [0x1000n, 8n, 1n, 2n, 0n, 1n],
    [0x1000n, 8n, 8n, 1n, 0n, 1n],
    [0x1000n, 8n, 9n, 1n, 0n, 1n],
    [0x1000n, 1n, 0n, 2n, 0n, 1n],
    [(1n << 53n) - 8n, 16n, 0n, 4n, 0n, 1n],
    ...[1n, 2n, 4n].flatMap((width) => {
      const overflow = 1n << (width * 8n);
      return [
        [0x1000n, 8n, 0n, width, overflow, 0n],
        [0x1000n, 8n, 0n, width, 0n, overflow],
      ];
    }),
  ]) {
    const run = sharedLeafMachine(code, args);
    assert.equal(run.result, invalid, String(args));
    assert.equal(run.accesses.length, 0);
    assert.equal(run.payload, invalid);
  }
});

test("unsigned CAS can access aligned subwords away from the mapping base without touching neighbors", () => {
  const code = sharedMemoryPrimitive("shared-compare-exchange-unsigned");
  const original = 0x123456789abcdef0n;
  for (const [width, offset] of [
    [1, 1],
    [2, 2],
    [4, 4],
  ]) {
    const bits = BigInt(width! * 8),
      shift = BigInt(offset! * 8);
    const mask = (1n << bits) - 1n;
    const expected = (original >> shift) & mask;
    const run = sharedLeafMachine(
      code,
      [0x1000n, 8n, BigInt(offset!), BigInt(width!), expected, mask],
      original,
    );
    assert.equal(run.result, expected);
    assert.equal(run.payload, (original & ~(mask << shift)) | (mask << shift));
    assert.ok(
      run.accesses
        .filter((a) => a.op === "ldaxr" || a.op === "stlxr")
        .every(
          (a) => a.address === 0x1000n + BigInt(offset!) && a.width === width,
        ),
    );
  }
});
