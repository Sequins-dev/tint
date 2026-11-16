import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindHostOperations,
  hostParameters,
  instructionEffects,
  effectUnknown,
  verify,
  type ModuleIR,
} from "@tint/ir/scalar";
function stub(type: "number" | "string" = "number"): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "close",
        exported: true,
        parameters: [0],
        slots: [type],
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
}
test("host binding validates signatures and leaves input IR immutable", () => {
  const input = stub(),
    before = structuredClone(input);
  const result = bindHostOperations(input, [
    { function: 0, operation: "close" },
  ]);
  assert.ok(result.ok);
  assert.ok(verify(result.value).ok);
  assert.deepEqual(input, before);
  assert.equal(
    result.value.functions[0]?.blocks[0]?.instructions[1]?.kind,
    "host-call",
  );
  assert.equal(
    bindHostOperations(stub("string"), [{ function: 0, operation: "close" }])
      .ok,
    false,
  );
  assert.equal(
    bindHostOperations(input, [
      { function: 0, operation: "close" },
      { function: 0, operation: "close" },
    ]).ok,
    false,
  );
  assert.equal(
    bindHostOperations(input, [{ function: 99, operation: "close" }]).ok,
    false,
  );
});
test("IR verification rejects unknown host operations and mismatched arguments", () => {
  const input = stub();
  const fn = input.functions[0]!;
  for (const operation of ["not-a-host-operation", "read"]) {
    const invalid: ModuleIR = {
      functions: [
        {
          ...fn,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
                {
                  kind: "host-call",
                  operation: operation as never,
                  id: 1,
                  arguments: [0],
                  start: 0,
                  end: 0,
                },
              ],
              terminator: { kind: "return", value: 1, start: 0, end: 0 },
            },
          ],
        },
      ],
    };
    assert.equal(verify(invalid).ok, false);
  }
});

test("runtime memory operations require explicit numeric leaf contracts", () => {
  for (const [operation, arity] of [
    ["memory-map", 1],
    ["root-head", 0],
    ["memory-unmap", 2],
    ["memory-release", 2],
    ["memory-read-word", 3],
    ["memory-write-word", 4],
    ["memory-move", 5],
    ["memory-compare-exchange-word", 5],
    ["memory-fetch-add-word", 4],
    ["memory-load-acquire-word", 3],
    ["memory-store-release-word", 4],
  ] as const) {
    const input = stub(),
      fn = input.functions[0]!;
    const module: ModuleIR = {
      functions: [
        {
          ...fn,
          parameters: Array.from({ length: arity }, (_, i) => i),
          slots: Array.from({ length: arity }, () => "number" as const),
        },
      ],
    };
    const bound = bindHostOperations(module, [
      { function: 0, operation: operation as never },
    ]);
    assert.ok(bound.ok, operation);
    assert.ok(verify(bound.value).ok);
  }
});

test("collector worker capabilities have explicit signatures", () => {
  assert.deepEqual(hostParameters("collector-worker-entry" as never), []);
  assert.deepEqual(hostParameters("permanent-function-address" as never), [
    "reference",
  ]);
  assert.deepEqual(hostParameters("permanent-array-address" as never), [
    "Uint32Array",
  ]);
});

test("process argument capabilities have finite explicit signatures", () => {
  assert.deepEqual(hostParameters("argument-count" as never), []);
  assert.deepEqual(hostParameters("argument-length" as never), ["number"]);
  assert.deepEqual(hostParameters("argument-copy" as never), [
    "number",
    "Uint8Array",
  ]);
});
test("linear allocation publication requires two typed control buffers", () => {
  assert.deepEqual(hostParameters("allocation-state" as never), [
    "Uint32Array",
    "Uint32Array",
  ]);
});
test("generational publication requires state, starts, dirty bits and a bounded queue", () => {
  assert.deepEqual(hostParameters("generational-state" as never), [
    "Uint32Array",
    "Uint32Array",
    "Uint8Array",
    "Float64Array",
  ]);
});

test("readlink accepts a NUL-terminated path view and a destination byte view", () => {
  assert.deepEqual(hostParameters("read-link"), ["Uint8Array", "Uint8Array"]);
});

test("published value calls retain the tagged general signature", () => {
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "callPublished",
        exported: true,
        parameters: [0, 1],
        slots: ["number", "general"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 1, start: 0, end: 0 }],
            terminator: { kind: "return", value: 0, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  const result = bindHostOperations(input, [
    { function: 0, operation: "executable-call-value" },
  ]);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value).ok, JSON.stringify(verify(result.value)));
  const fn = input.functions[0]!;
  assert.equal(
    bindHostOperations({ functions: [{ ...fn, returnType: "number" }] }, [
      { function: 0, operation: "executable-call-value" },
    ]).ok,
    false,
  );
  assert.equal(
    bindHostOperations(
      { functions: [{ ...fn, slots: ["number", "number"] }] },
      [{ function: 0, operation: "executable-call-value" }],
    ).ok,
    false,
  );
});

test("external memory capabilities check registrar references and numeric windows", () => {
  assert.deepEqual(hostParameters("external-memory-configure" as never), [
    "reference",
  ]);
  assert.deepEqual(hostParameters("external-memory-register" as never), [
    "number",
    "number",
  ]);
});

test("trusted native function identities bind reference arguments without executing them", () => {
  for (const operation of [
    "native-function-descriptor",
    "native-function-signature",
  ] as const) {
    assert.deepEqual(hostParameters(operation), ["reference"]);
    assert.equal(
      instructionEffects({
        kind: "host-call",
        operation,
        id: 0,
        arguments: [0],
        start: 0,
        end: 0,
      }),
      effectUnknown,
    );
    const module = stub();
    const fn = module.functions[0]!;
    const reference = { functions: [{ ...fn, slots: ["reference" as const] }] };
    const bound = bindHostOperations(reference, [{ function: 0, operation }]);
    assert.ok(bound.ok);
    assert.ok(verify(bound.value).ok);
    assert.equal(
      bindHostOperations(module, [{ function: 0, operation }]).ok,
      false,
    );
  }
});
test("diagnostics host operations have fixed scalar contracts", async () => {
  const { hostReturnType } = await import("@tint/ir/scalar");
  assert.deepEqual(hostParameters("memory-write-bytes"), [
    "number",
    "number",
    "number",
    "Uint8Array",
  ]);
  assert.equal(hostReturnType("memory-write-bytes"), "number");
  for (const operation of [
    "jit-debug-descriptor",
    "jit-debug-register",
    "process-id",
  ] as const)
    assert.deepEqual(hostParameters(operation), []);
  assert.equal(hostReturnType("jit-debug-descriptor"), "number");
  assert.equal(hostReturnType("jit-debug-register"), "void");
  assert.equal(hostReturnType("process-id"), "number");
});
