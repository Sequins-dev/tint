import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { encode } from "../src/aarch64/isa.ts";
import { hostParameters, hostReturnType } from "@tint/ir/scalar";
import {
  nativeEngineThrowOffset,
  nativeStackLimitOffset,
  nativeStackOverflowPayload,
} from "@tint/abi/host";

const s = { start: 0, end: 0 };
function leaf(id: number): FunctionIR {
  return {
    id,
    name: "leaf" + id,
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "constant", id: 0, value: 1, ...s }],
        terminator: { kind: "return", value: 0, ...s },
      },
    ],
  };
}
function caller(id: number, target: number): FunctionIR {
  return {
    id,
    name: "caller" + id,
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "call", id: 0, target, arguments: [], ...s }],
        terminator: { kind: "return", value: 0, ...s },
      },
    ],
  };
}
function words(code: Uint8Array, offset: number, byteLength: number) {
  const view = new DataView(code.buffer, code.byteOffset);
  return Array.from({ length: byteLength / 4 }, (_, index) =>
    view.getUint32(offset + index * 4, true),
  );
}
const limitLoad = encode({
  op: "ldr",
  width: 64,
  rt: 16,
  rn: 0,
  offset: nativeStackLimitOffset,
});

test("functions that call check the context stack limit; small leaves do not", () => {
  assert.ok(limitLoad.ok);
  const module: ModuleIR = { functions: [leaf(0), caller(1, 0)] };
  const emitted = emitModule(module);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const [callee, calling] = emitted.value.functions;
  assert.ok(callee && calling);
  const leafCode = words(emitted.value.code, callee.offset, callee.byteLength),
    callerCode = words(emitted.value.code, calling.offset, calling.byteLength);
  assert.ok(
    !leafCode.includes(limitLoad.value),
    "leaf frame relies on headroom",
  );
  assert.ok(callerCode.includes(limitLoad.value), "caller checks its frame");
  // One shared helper records the overflow and completes the call by throwing.
  const helper = emitted.value.helpers.find(
    (item) => item.kind === "stack-overflow",
  );
  assert.ok(helper, "stack-overflow helper is emitted once");
  const body = words(emitted.value.code, helper.offset, helper.byteLength);
  const pendingLoad = encode({
    op: "ldr",
    width: 64,
    rt: 16,
    rn: 0,
    offset: nativeEngineThrowOffset,
  });
  assert.ok(pendingLoad.ok);
  assert.equal(body[0], pendingLoad.value);
});

test("the stack check precedes every frame store and branches over the overflow exit", () => {
  assert.ok(limitLoad.ok);
  const emitted = emitModule({ functions: [leaf(0), caller(1, 0)] });
  assert.ok(emitted.ok);
  const calling = emitted.value.functions[1]!;
  const code = words(emitted.value.code, calling.offset, calling.byteLength);
  const check = code.indexOf(limitLoad.value);
  // stp fp/lr; mov fp; sub sp: the check comes before any store to the frame
  // (other than the frame record pushed by the stp).
  for (let index = 1; index < check; index++)
    assert.notEqual(
      (code[index]! & 0xffc00000) >>> 0,
      0xf9000000,
      "no STR before the stack check",
    );
  const branch = code[check + 3]!;
  assert.equal((branch & 0xff00001f) >>> 0, 0x54000002, "B.CS over the exit");
});

function encoded(instruction: Parameters<typeof encode>[0]): number {
  const result = encode(instruction);
  assert.ok(result.ok, JSON.stringify(instruction));
  return result.value;
}
const payloadLow = nativeStackOverflowPayload % 65536;

test("the overflow throws undefined carrying the reserved payload", () => {
  // The value identifies the overflow itself, so no context word has to
  // outlive the unwind. It is odd and nonzero: never a JavaScript undefined
  // (payload 0) and never an aligned address.
  assert.equal(nativeStackOverflowPayload % 2, 1);
  assert.ok(Number.isSafeInteger(nativeStackOverflowPayload));
  const emitted = emitModule({ functions: [leaf(0), caller(1, 0)] });
  assert.ok(emitted.ok);
  const helper = emitted.value.helpers.find(
    (item) => item.kind === "stack-overflow",
  )!;
  const body = words(emitted.value.code, helper.offset, helper.byteLength);
  const tag = body.indexOf(
      encoded({ op: "str", width: 64, rt: "zr", rn: 3, offset: 16 }),
    ),
    low = body.indexOf(
      encoded({
        op: "movz",
        width: 64,
        rd: 16,
        immediate: payloadLow,
        shift: 0,
      }),
    ),
    store = body.indexOf(
      encoded({ op: "str", width: 64, rt: 16, rn: 3, offset: 24 }),
    );
  assert.ok(tag >= 0 && low > tag && store === low + 4, "tag 0, then payload");
  let value = 0;
  for (let index = 0; index < 4; index++)
    value += ((body[low + index]! >>> 5) & 0xffff) * 65536 ** index;
  assert.equal(value, nativeStackOverflowPayload);
});

test("stack-overflow-is reads only the thrown value", () => {
  assert.deepEqual(hostParameters("stack-overflow-is"), ["general"]);
  assert.equal(hostReturnType("stack-overflow-is"), "number");
  const emitted = emitModule({
    functions: [
      {
        id: 0,
        name: "isStackOverflow",
        exported: true,
        parameters: [0],
        slots: ["general"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              {
                kind: "host-call",
                operation: "stack-overflow-is",
                id: 1,
                arguments: [0],
                ...s,
              },
            ],
            terminator: { kind: "return", value: 1, ...s },
          },
        ],
      },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!;
  const code = words(emitted.value.code, fn.offset, fn.byteLength);
  assert.ok(
    code.includes(
      encoded({
        op: "movz",
        width: 64,
        rd: 11,
        immediate: payloadLow,
        shift: 0,
      }),
    ),
    "compares the payload with the reserved value",
  );
  for (const offset of [nativeEngineThrowOffset, nativeStackLimitOffset])
    for (const rt of [9, 10] as const)
      assert.ok(
        !code.includes(encoded({ op: "ldr", width: 64, rt, rn: 9, offset })),
        "never consults context stack state",
      );
  assert.equal(emitted.value.imports.length, 0);
});
