import assert from "node:assert/strict";
import test from "node:test";
import {
  bindHostOperations,
  hostParameters,
  type HostOperation,
  type ModuleIR,
} from "@tint/ir/scalar";
import { linuxX86_64HostFacts } from "@tint/platform/linux/host-abi";
import { encode, type Instruction } from "../src/x86_64/isa.ts";
import { emitModule } from "../src/x86_64/scalar/index.ts";

// The x86-64 shared leaves follow the standard sequentially consistent
// mapping for TSO: seq-cst stores use XCHG (implicitly locked, a full
// barrier), compare-exchange uses LOCK CMPXCHG, and loads use MOV. An
// unordered store is a plain MOV. The leaves are inline in their caller, and
// the backend has no instruction scheduler that could move them.
type Width = 8 | 16 | 32 | 64;
const cell = (width: Width) =>
  ({
    kind: "mem",
    width,
    address: { kind: "base", base: 10, disp: 0 },
  }) as const;
const register = (index: number, width: Width) =>
  ({ kind: "gpr", width, index }) as const;
const bytes = (instruction: Instruction): string =>
  Buffer.from(encode([instruction])).toString("hex");
const orderedStore = (width: Width) =>
  bytes({ op: "xchg", dst: cell(width), src: register(2, width) });
const plainStore = (width: Width) =>
  bytes({ op: "mov", dst: cell(width), src: register(2, width) });
const exchange = (width: Width) =>
  bytes({ op: "lock-cmpxchg", dst: cell(width), src: register(2, width) });
const load = (width: Width) =>
  bytes({ op: "mov", dst: register(0, width), src: cell(width) });

function emitted(kind: HostOperation): string {
  const parameters = hostParameters(kind);
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
  const bound = bindHostOperations(source, [{ function: 0, operation: kind }]);
  assert.ok(bound.ok);
  const module = emitModule(bound.value, linuxX86_64HostFacts());
  assert.ok(module.ok, JSON.stringify(module));
  const fn = module.value.functions.find((entry) => entry.name === kind);
  assert.ok(fn);
  return Buffer.from(
    module.value.code.subarray(fn.offset, fn.offset + fn.byteLength),
  ).toString("hex");
}

/** Counts byte-aligned occurrences. A 16-bit form is the 32-bit form behind a
 * 66 operand-size prefix, so a match after that prefix belongs to the wider
 * pattern. Callers only assert patterns long enough to be unambiguous. */
function occurrences(code: string, pattern: string): number {
  let count = 0;
  for (
    let at = code.indexOf(pattern);
    at >= 0;
    at = code.indexOf(pattern, at + 1)
  )
    if (at % 2 === 0 && code.slice(at - 2, at) !== "66") count++;
  return count;
}

const unsignedWidths: readonly Width[] = [8, 16, 32];

test("x86-64 shared stores use XCHG when ordered and MOV when unordered", () => {
  const unsigned = emitted("shared-write-unsigned");
  for (const width of unsignedWidths) {
    assert.equal(
      occurrences(unsigned, orderedStore(width)),
      1,
      `xchg ${width}`,
    );
    assert.equal(occurrences(unsigned, plainStore(width)), 1, `mov ${width}`);
  }
  const word64 = emitted("shared-write-word64");
  assert.equal(occurrences(word64, orderedStore(64)), 1);
  assert.equal(occurrences(word64, plainStore(64)), 1);
});

test("x86-64 shared compare-exchange is one LOCK CMPXCHG per width", () => {
  const unsigned = emitted("shared-compare-exchange-unsigned");
  for (const width of unsignedWidths) {
    assert.equal(occurrences(unsigned, exchange(width)), 1, `width ${width}`);
    assert.equal(occurrences(unsigned, orderedStore(width)), 0);
    assert.equal(occurrences(unsigned, plainStore(width)), 0);
  }
  const word64 = emitted("shared-compare-exchange-word64");
  assert.equal(occurrences(word64, exchange(64)), 1);
  assert.equal(occurrences(word64, plainStore(64)), 0);
});

test("x86-64 shared loads are single MOVs that never store to the cell", () => {
  const unsigned = emitted("shared-read-unsigned");
  for (const width of unsignedWidths) {
    assert.equal(occurrences(unsigned, load(width)), 1, `width ${width}`);
    assert.equal(occurrences(unsigned, orderedStore(width)), 0);
    assert.equal(occurrences(unsigned, plainStore(width)), 0);
  }
  const word64 = emitted("shared-read-word64");
  assert.equal(occurrences(word64, load(64)), 1);
  assert.equal(occurrences(word64, orderedStore(64)), 0);
  assert.equal(occurrences(word64, plainStore(64)), 0);
});
