import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import {
  encode,
  type Instruction as MachineInstruction,
} from "@tint/codegen/aarch64/isa";
import {
  bindHostOperations,
  hostParameters,
  hostReturnType,
  instructionMayThrow,
  instructionEffects,
  effectUnknown,
  provenNoSafepoints,
  stableRecordLayouts,
  verify,
  type ModuleIR,
  type HostOperation,
} from "@tint/ir/scalar";
import { optimizeModule } from "@tint/ir/optimization";
import { callExecutableManaged } from "@tint/native-runtime/intrinsics/memory";
const span = { start: 0, end: 0 };
const operation = "executable-call-managed";
function fixture(op: HostOperation = operation): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "invoke",
        exported: true,
        parameters: [0, 1],
        slots: [
          "number",
          op === "executable-call-value" ? "general" : "reference",
        ],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              {
                kind: "host-call",
                id: 2,
                operation: op,
                arguments: [0, 1],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
}
function word(op: MachineInstruction): number {
  const result = encode(op);
  assert.ok(result.ok);
  return result.value;
}
test("managed invocation stub cannot execute callbacks in Node", () => {
  let called = false;
  assert.equal(typeof callExecutableManaged, "function");
  assert.throws(
    () =>
      callExecutableManaged(1, () => {
        called = true;
      }),
    (e) => e === "HOST_UNAVAILABLE",
  );
  assert.equal(called, false);
});
test("managed host ABI binds only number/reference to general and remains opaque", () => {
  assert.deepEqual(hostParameters(operation), ["number", "reference"]);
  assert.equal(hostReturnType(operation), "general");
  const module = fixture();
  assert.ok(verify(module).ok);
  assert.ok(bindHostOperations(module, [{ function: 0, operation }]).ok);
  for (const fn of [
    { ...module.functions[0]!, slots: ["number", "general"] as const },
    { ...module.functions[0]!, returnType: "number" as const },
    { ...module.functions[0]!, parameters: [0] },
    { ...module.functions[0]!, closureEnvironment: 0 },
  ])
    assert.equal(
      bindHostOperations({ functions: [fn] }, [{ function: 0, operation }]).ok,
      false,
    );
  assert.equal(
    bindHostOperations(module, [
      { function: 0, operation },
      { function: 0, operation },
    ]).ok,
    false,
  );
  const op = module.functions[0]!.blocks[0]!.instructions[2]!;
  assert.equal(instructionMayThrow(op), true);
  assert.equal(instructionEffects(op), effectUnknown);
  assert.equal(provenNoSafepoints(module)?.[0], 0);
  assert.equal(stableRecordLayouts(module), false);
  const optimized = optimizeModule(module).module;
  assert.ok(verify(optimized).ok);
  assert.equal(provenNoSafepoints(optimized)?.[0], 0);
  assert.equal(stableRecordLayouts(optimized), false);
  assert.ok(
    optimized.functions[0]!.blocks.some((block) =>
      block.instructions.some(
        (op) => op.kind === "host-call" && op.operation === operation,
      ),
    ),
  );

  assert.equal(
    instructionMayThrow({
      ...op,
      operation: "executable-call-value",
    } as typeof op),
    false,
  );
});
test("managed entry initializes completion, passes raw callback, roots result and routes throws", () => {
  const result = emitModule(fixture(), { hostABI: darwinHostABI() });
  assert.ok(result.ok, JSON.stringify(result));
  const root = result.value.roots.find((r) => r.function === 0);
  assert.ok(root);
  assert.ok(root.offsets.length > 0);
  assert.ok(root.generalOffsets.length > 0);
  const view = new DataView(
    result.value.code.buffer,
    result.value.code.byteOffset,
    result.value.code.byteLength,
  );
  const words = Array.from({ length: result.value.code.length / 4 }, (_, i) =>
    view.getUint32(i * 4, true),
  );
  const call = words.indexOf(word({ op: "blr", rn: 16 }));
  assert.ok(call >= 0);
  for (const offset of [0, 8, 16, 24])
    assert.ok(
      words
        .slice(0, call)
        .includes(word({ op: "str", width: 64, rt: "zr", rn: "sp", offset })),
    );
  assert.ok(
    words
      .slice(0, call)
      .some(
        (w) =>
          (w & 0xffc003ff) ===
          (word({ op: "ldr", width: 64, rt: 4, rn: "sp", offset: 0 }) &
            0xffc003ff),
      ),
    "x4 loads callback itself",
  );
  // A non-normal status takes one in-reach conditional branch to dispatch.
  assert.equal(
    (words[call + 2]! & 0xff00001f) >>> 0,
    (word({ op: "b.cond", condition: "ne", displacement: 0 }) & 0xff00001f) >>>
      0,
    "non-normal completion branches to common dispatch",
  );
  assert.deepEqual(
    words.slice(call + 3, call + 5),
    [
      word({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 16 }),
      word({ op: "ldr", width: 64, rt: 10, rn: "sp", offset: 24 }),
    ],
    "normal completion payload and tag load immediately after status dispatch",
  );
  assert.ok(
    words.includes(word({ op: "brk", immediate: 0 })),
    "invalid throw completion traps",
  );
  const { executableMemory, ...host } = darwinHostABI();
  assert.ok(executableMemory);
  assert.equal(emitModule(fixture(), { hostABI: host }).ok, false);
  assert.equal(
    emitModule(fixture(), {
      linearAllocation: true,
      generationalBarriers: true,
    }).ok,
    false,
  );
});
test("borrowed general entry keeps a reproducible byte image", () => {
  const result = emitModule(fixture("executable-call-value"), {
    hostABI: darwinHostABI(),
  });
  assert.ok(result.ok);
  assert.equal(
    createHash("sha256").update(result.value.code).digest("hex"),
    "834f236bf463054acbbc728ed6e80c0f4eb3616c54b002b32a63e870858bdebf",
  );
});

test("throw edge does not inherit stores following a managed host call", () => {
  const fn = fixture().functions[0]!;
  const first = fn.blocks[0]!;
  const module: ModuleIR = {
    functions: [
      {
        ...fn,
        slots: [...fn.slots, "number", "general"],
        returnType: "number",
        blocks: [
          {
            ...first,
            exception: { target: 1, slot: 3 },
            instructions: [
              ...first.instructions,
              { kind: "constant", id: 3, value: 42, ...span },
              { kind: "store", slot: 2, value: 3, ...span },
            ],
            terminator: { kind: "return", value: 3, ...span },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 4, slot: 2, ...span }],
            terminator: { kind: "return", value: 4, ...span },
          },
        ],
      },
    ],
  };
  const result = verify(module);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "INITIALIZATION");
});
test("managed catch dispatch copies completion payload into a rooted handler slot", () => {
  const fn = fixture().functions[0]!,
    first = fn.blocks[0]!;
  const module: ModuleIR = {
    functions: [
      {
        ...fn,
        slots: [...fn.slots, "general"],
        blocks: [
          { ...first, exception: { target: 1, slot: 2 } },
          {
            id: 1,
            instructions: [{ kind: "load", id: 3, slot: 2, ...span }],
            terminator: { kind: "return", value: 3, ...span },
          },
        ],
      },
    ],
  };
  const result = emitModule(module, { hostABI: darwinHostABI() });
  assert.ok(result.ok, JSON.stringify(result));
  const view = new DataView(
    result.value.code.buffer,
    result.value.code.byteOffset,
    result.value.code.byteLength,
  );
  const words = Array.from({ length: result.value.code.length / 4 }, (_, i) =>
    view.getUint32(i * 4, true),
  );
  assert.ok(
    words.includes(
      word({
        op: "sub-imm",
        width: 32,
        rd: "zr",
        rn: 0,
        immediate: 2,
        shift: 0,
        setFlags: true,
      }),
    ),
  );
  assert.ok(result.value.roots[0]!.generalOffsets.length >= 2);
});
