import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import {
  devirtualizeClosureCalls,
  optimizeModule,
} from "@tint/ir/optimization";

const span = { start: 0, end: 0 };
/** `run(n)` creates a closure over a one-field environment record holding
 * `n`, stores it in a slot and calls it through that slot with 1. The
 * closure returns its argument plus the captured value. */
function closureModule(secondTarget: boolean = false): ModuleIR {
  const run: FunctionIR = {
    id: 0,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
          { kind: "function-new", id: 2, target: 1, environment: 1, ...span },
          { kind: "store", slot: 1, value: 2, ...span },
          ...(secondTarget
            ? [
                { kind: "function-new" as const, id: 6, target: 2, ...span },
                { kind: "store" as const, slot: 1, value: 6, ...span },
              ]
            : []),
          { kind: "load", id: 3, slot: 1, ...span },
          { kind: "constant", id: 4, value: 1, ...span },
          {
            kind: "call-indirect",
            id: 5,
            target: 1,
            callee: 3,
            arguments: [4],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 5, ...span },
      },
    ],
  };
  const captured: FunctionIR = {
    id: 1,
    name: "captured",
    exported: false,
    parameters: [0],
    slots: ["number", "number"],
    returnType: "number",
    closureEnvironment: 0,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "closure-environment", id: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 0, ...span },
          { kind: "load", id: 2, slot: 1, ...span },
          { kind: "binary", id: 3, operator: "+", left: 1, right: 2, ...span },
        ],
        terminator: { kind: "return", value: 3, ...span },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  const plain: FunctionIR = {
    id: 2,
    name: "plain",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: false }],
      },
    ],
    functions: [run, captured, plain],
  };
}

test("indirect calls of a known closure become direct calls of an environment-passing twin", () => {
  const input = closureModule();
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = devirtualizeClosureCalls(input, 1000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
  const twin = result.module.functions[3]!;
  assert.equal(twin.name, "captured$direct");
  assert.equal(twin.closureEnvironment, undefined);
  assert.deepEqual(twin.parameters, [0, 2]);
  assert.deepEqual(twin.blocks[0]!.instructions[0], {
    kind: "load",
    id: 0,
    slot: 2,
    ...span,
  });
  const call = result.module.functions[0]!.blocks[0]!.instructions.find(
    (op) => op.kind === "call",
  );
  assert.ok(call?.kind === "call");
  assert.equal(call.target, 3);
  assert.equal(call.arguments.length, 2);
  // The original closure body stays for other (escaping) uses.
  assert.equal(result.module.functions[1], input.functions[1]);
});

test("slots that may hold closures of different functions keep indirect calls", () => {
  const input = closureModule(true);
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = devirtualizeClosureCalls(input, 1000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
  assert.equal(result.module, input);
});

test("devirtualized closures inline through the ordinary optimizer", () => {
  const optimized = optimizeModule(closureModule(), 20000000, {
    devirtualizeClosures: true,
  });
  assert.ok(verify(optimized.module).ok);
  const pass = optimized.passes.find((p) => p.pass === "devirtualize-closures");
  assert.equal(pass?.rewritten, 1);
  const run = optimized.module.functions[0]!;
  assert.ok(
    !run.blocks.some((block) =>
      block.instructions.some(
        (op) => op.kind === "call-indirect" || op.kind === "call",
      ),
    ),
    "the closure body is inlined into its caller",
  );
});

test("devirtualization is an explicit closed-program option", () => {
  const optimized = optimizeModule(closureModule());
  assert.ok(!optimized.passes.some((p) => p.pass === "devirtualize-closures"));
});

/** closureModule with the closure copied from slot 1 to slot 2 (as an
 * inlined factory's result reaches its caller's variable) and called
 * through slot 2. */
function slotCopyModule(): ModuleIR {
  const base = closureModule();
  const run = base.functions[0]!;
  const block = run.blocks[0]!;
  return {
    ...base,
    functions: [
      {
        ...run,
        slots: ["number", "reference", "reference"],
        blocks: [
          {
            ...block,
            instructions: block.instructions.flatMap((op) =>
              op.kind === "load" && op.slot === 1
                ? [
                    { kind: "load" as const, id: 7, slot: 1, ...span },
                    { kind: "store" as const, slot: 2, value: 7, ...span },
                    { kind: "load" as const, id: 3, slot: 2, ...span },
                  ]
                : [op],
            ),
          },
        ],
      },
      ...base.functions.slice(1),
    ],
  };
}

test("closures copied between slots devirtualize, and a later run reuses the twin", () => {
  const input = slotCopyModule();
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const first = devirtualizeClosureCalls(input, 1000);
  assert.ok(first);
  assert.equal(first.rewritten, 1);
  assert.ok(verify(first.module).ok, JSON.stringify(verify(first.module)));
  // The pass runs again after inlining: a new indirect call of the same
  // closure targets the existing twin instead of building another.
  const run = first.module.functions[0]!;
  const block = run.blocks[0]!;
  const again: ModuleIR = {
    ...first.module,
    functions: [
      {
        ...run,
        blocks: [
          {
            ...block,
            instructions: [
              ...block.instructions,
              { kind: "load", id: 20, slot: 2, ...span },
              { kind: "constant", id: 21, value: 2, ...span },
              {
                kind: "call-indirect",
                id: 22,
                target: 1,
                callee: 20,
                arguments: [21],
                ...span,
              },
            ],
          },
        ],
      },
      ...first.module.functions.slice(1),
    ],
  };
  assert.ok(verify(again).ok, JSON.stringify(verify(again)));
  const second = devirtualizeClosureCalls(again, 1000);
  assert.ok(second);
  assert.equal(second.rewritten, 1);
  assert.equal(
    second.module.functions.length,
    first.module.functions.length,
    "no second twin",
  );
  assert.ok(verify(second.module).ok, JSON.stringify(verify(second.module)));
  const calls = second.module.functions[0]!.blocks[0]!.instructions.filter(
    (op) => op.kind === "call",
  );
  assert.deepEqual(
    calls.map((op) => (op.kind === "call" ? op.target : -1)),
    [3, 3],
  );
});

test("a closure whose result shape differs from the call's stays indirect", () => {
  // The call expects a number (its witness, captured, returns one) but the
  // known closure is a void function.
  const base = closureModule();
  const sink: FunctionIR = {
    id: 3,
    name: "sink",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...span },
      },
    ],
  };
  const run = base.functions[0]!;
  const block = run.blocks[0]!;
  const input: ModuleIR = {
    ...base,
    functions: [
      {
        ...run,
        blocks: [
          {
            ...block,
            instructions: block.instructions.map((op) =>
              op.kind === "function-new"
                ? {
                    kind: "function-new" as const,
                    id: op.id,
                    target: 3,
                    ...span,
                  }
                : op,
            ),
          },
        ],
      },
      ...base.functions.slice(1),
      sink,
    ],
  };
  const result = devirtualizeClosureCalls(input, 1000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
});

test("a closure factory inlines, and its closure then devirtualizes and inlines", () => {
  // run(n) = make(n)(1), where make(n) returns a closure of `captured` over
  // an environment holding n.
  const base = closureModule();
  const make: FunctionIR = {
    id: 3,
    name: "make",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
          { kind: "function-new", id: 2, target: 1, environment: 1, ...span },
        ],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  };
  const run: FunctionIR = {
    id: 0,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "call", id: 1, target: 3, arguments: [0], ...span },
          { kind: "store", slot: 1, value: 1, ...span },
          { kind: "load", id: 3, slot: 1, ...span },
          { kind: "constant", id: 4, value: 1, ...span },
          {
            kind: "call-indirect",
            id: 5,
            target: 1,
            callee: 3,
            arguments: [4],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 5, ...span },
      },
    ],
  };
  const input: ModuleIR = {
    ...base,
    functions: [run, ...base.functions.slice(1), make],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const optimized = optimizeModule(input, 20000000, {
    devirtualizeClosures: true,
  });
  assert.ok(verify(optimized.module).ok);
  const passes = optimized.passes.filter(
    (p) => p.pass === "devirtualize-closures",
  );
  assert.ok(passes.length >= 2, "devirtualization runs again after inlining");
  assert.equal(
    passes.reduce((sum, p) => sum + p.rewritten, 0),
    1,
  );
  const body = optimized.module.functions[0]!;
  assert.ok(
    !body.blocks.some((b) =>
      b.instructions.some(
        (op) => op.kind === "call-indirect" || op.kind === "call",
      ),
    ),
    "factory and closure are inlined into run",
  );
});

test("a callee calling a closure parameter inlines, and the cloned call devirtualizes", () => {
  // run(n) = apply(closure, 1), where apply(f, x) = f(x): the indirect call
  // clones into run, where the closure is known.
  const base = closureModule();
  const apply: FunctionIR = {
    id: 3,
    name: "apply",
    exported: false,
    parameters: [0, 1],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          {
            kind: "call-indirect",
            id: 2,
            target: 1,
            callee: 0,
            arguments: [1],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  };
  const run: FunctionIR = {
    id: 0,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
          { kind: "function-new", id: 2, target: 1, environment: 1, ...span },
          { kind: "constant", id: 4, value: 1, ...span },
          { kind: "call", id: 5, target: 3, arguments: [2, 4], ...span },
        ],
        terminator: { kind: "return", value: 5, ...span },
      },
    ],
  };
  const input: ModuleIR = {
    ...base,
    functions: [run, ...base.functions.slice(1), apply],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const optimized = optimizeModule(input, 20000000, {
    devirtualizeClosures: true,
  });
  assert.ok(verify(optimized.module).ok);
  const body = optimized.module.functions[0]!;
  assert.ok(
    !body.blocks.some((b) =>
      b.instructions.some(
        (op) => op.kind === "call-indirect" || op.kind === "call",
      ),
    ),
    "apply and the closure are inlined into run",
  );
});

test("exhausted devirtualization reports no partial result", () => {
  assert.equal(devirtualizeClosureCalls(closureModule(), 2), undefined);
});

/** `run(n)` stores a closure of `captured` in a cell box (record 1), reads it
 * back through the box and calls it: the box field is written only with that
 * closure, so the call devirtualizes. With `conflicting`, the box is also
 * written with a closure of `plain`, and the call stays indirect. */
function boxedModule(conflicting: boolean): ModuleIR {
  const base = closureModule();
  const run: FunctionIR = {
    id: 0,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "reference", "reference", "reference", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
          { kind: "function-new", id: 2, target: 1, environment: 1, ...span },
          { kind: "store", slot: 1, value: 2, ...span },
          {
            kind: "record-new",
            id: 3,
            record: 1,
            arguments: [undefined],
            ...span,
          },
          { kind: "store", slot: 2, value: 3, ...span },
          { kind: "load", id: 4, slot: 2, ...span },
        ],
        terminator: {
          kind: "record-cell",
          object: 4,
          record: 1,
          field: 0,
          operation: "initialize",
          slot: 1,
          consequent: conflicting ? 4 : 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 5, slot: 2, ...span }],
        terminator: {
          kind: "record-cell",
          object: 5,
          record: 1,
          field: 0,
          operation: "read",
          slot: 3,
          consequent: 3,
          alternate: 2,
          ...span,
        },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 3, ...span },
          { kind: "constant", id: 7, value: 1, ...span },
          {
            kind: "call-indirect",
            id: 8,
            target: 1,
            callee: 6,
            arguments: [7],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 8, ...span },
      },
      {
        id: 4,
        instructions: [
          { kind: "function-new", id: 9, target: 2, ...span },
          { kind: "store", slot: 4, value: 9, ...span },
          { kind: "load", id: 10, slot: 2, ...span },
        ],
        terminator: {
          kind: "record-cell",
          object: 10,
          record: 1,
          field: 0,
          operation: "write",
          slot: 4,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
    ],
  };
  const blocks = conflicting ? run.blocks : run.blocks.slice(0, 4);
  return {
    records: [
      ...(base.records ?? []),
      {
        byteLength: 32,
        fields: [
          { offset: 24, type: "reference", mutable: true, stateOffset: 16 },
        ],
      },
    ],
    functions: [{ ...run, blocks }, base.functions[1]!, base.functions[2]!],
  };
}

test("closures read back from cell boxes written only with them devirtualize", () => {
  const input = boxedModule(false);
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = devirtualizeClosureCalls(input, 10000, true);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
  // Without closed records (foreign code may write fields), nothing changes.
  const open = devirtualizeClosureCalls(input, 10000);
  assert.ok(open);
  assert.equal(open.rewritten, 0);
  const conflicting = boxedModule(true);
  assert.ok(verify(conflicting).ok, JSON.stringify(verify(conflicting)));
  const kept = devirtualizeClosureCalls(conflicting, 10000, true);
  assert.ok(kept);
  assert.equal(kept.rewritten, 0);
});

/** `run` creates a closure in one block, copies it (from its slot, in a later
 * block) into an immutable environment-style record field, reads the field
 * back and calls it: a function declaration captured by value. With
 * `conflicting`, the slot may also hold a closure of `plain`. */
function copiedModule(conflicting: boolean): ModuleIR {
  const base = closureModule();
  const run: FunctionIR = {
    id: 0,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "reference", "reference", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
          { kind: "function-new", id: 2, target: 1, environment: 1, ...span },
          { kind: "store", slot: 1, value: 2, ...span },
          ...(conflicting
            ? [
                { kind: "function-new" as const, id: 11, target: 2, ...span },
                { kind: "store" as const, slot: 1, value: 11, ...span },
              ]
            : []),
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 3, slot: 1, ...span },
          { kind: "record-new", id: 4, record: 1, arguments: [3], ...span },
          { kind: "store", slot: 2, value: 4, ...span },
          { kind: "load", id: 5, slot: 2, ...span },
        ],
        terminator: {
          kind: "record",
          object: 5,
          record: 1,
          field: 0,
          operation: "read",
          slot: 3,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 6, slot: 3, ...span },
          { kind: "constant", id: 7, value: 1, ...span },
          {
            kind: "call-indirect",
            id: 8,
            target: 1,
            callee: 6,
            arguments: [7],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 8, ...span },
      },
      { id: 3, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  return {
    records: [
      ...(base.records ?? []),
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "reference", mutable: false }],
      },
    ],
    functions: [run, base.functions[1]!, base.functions[2]!],
  };
}

test("closures copied into environment fields from slots devirtualize", () => {
  const input = copiedModule(false);
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = devirtualizeClosureCalls(input, 10000, true);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
  const conflicting = copiedModule(true);
  assert.ok(verify(conflicting).ok, JSON.stringify(verify(conflicting)));
  const kept = devirtualizeClosureCalls(conflicting, 10000, true);
  assert.ok(kept);
  assert.equal(kept.rewritten, 0);
});

/** `run()` creates a closure of `method`, a function with a receiver, and
 * calls it through a slot with a receiver (or without one). The method tests
 * its receiver as class methods do on entry. */
function methodModule(receiver: boolean): ModuleIR {
  const run: FunctionIR = {
    id: 0,
    name: "run",
    exported: true,
    parameters: [],
    slots: ["reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "function-new", id: 0, target: 1, ...span },
          { kind: "store", slot: 0, value: 0, ...span },
          { kind: "load", id: 1, slot: 0, ...span },
          { kind: "general-none", id: 2, ...span },
          { kind: "constant", id: 3, value: 41, ...span },
          {
            kind: "call-indirect",
            id: 4,
            target: 1,
            callee: 1,
            ...(receiver ? { receiver: 2 } : {}),
            arguments: [3],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 4, ...span },
      },
    ],
  };
  const method: FunctionIR = {
    id: 1,
    name: "method",
    exported: false,
    parameters: [0],
    slots: ["number", "general"],
    receiverSlot: 1,
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 1, ...span },
          { kind: "general-is", id: 1, value: 0, type: "object", ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 1,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 2, slot: 0, ...span }],
        terminator: { kind: "return", value: 2, ...span },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 3, slot: 0, ...span },
          { kind: "constant", id: 4, value: 1, ...span },
          { kind: "binary", id: 5, operator: "+", left: 3, right: 4, ...span },
        ],
        terminator: { kind: "return", value: 5, ...span },
      },
    ],
  };
  return { functions: [run, method] };
}

test("method calls with receivers become direct calls of a receiver-passing twin", () => {
  const input = methodModule(true);
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = devirtualizeClosureCalls(input, 1000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
  const twin = result.module.functions[2]!;
  assert.equal(twin.name, "method$direct");
  assert.equal(twin.receiverSlot, undefined);
  assert.deepEqual(twin.parameters, [0, 1]);
  const call = result.module.functions[0]!.blocks[0]!.instructions.find(
    (op) => op.kind === "call",
  );
  assert.ok(call?.kind === "call");
  assert.equal(call.target, 2);
  assert.deepEqual(call.arguments, [3, 2]);
  // The twin (receiver test included) inlines into its caller.
  const optimized = optimizeModule(input, 20000000, {
    devirtualizeClosures: true,
  });
  assert.ok(verify(optimized.module).ok);
  assert.ok(
    !optimized.module.functions[0]!.blocks.some((block) =>
      block.instructions.some(
        (op) => op.kind === "call-indirect" || op.kind === "call",
      ),
    ),
  );
});

test("calls without a receiver keep methods indirect", () => {
  const input = methodModule(false);
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const result = devirtualizeClosureCalls(input, 1000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
});

test("closure environment with a reference cell field is scalar replaced and promoted out of a loop", () => {
  // Record 0: cell { value: number } (cell-backed field 0).
  // Record 1: closure env { step: number, countCell: reference }.
  // run(step): allocates countCell, initializes it to 0, allocates env { step,
  // countCell }, builds closure, calls it 8 times in a loop and returns sum.
  const run: FunctionIR = {
    id: 0,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "reference", "reference", "number", "number", "number"],
    // 0: step, 1: countCell, 2: closure, 3: i, 4: sum, 5: initZero
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 1, value: 0, ...span },
          { kind: "record-new", id: 0, record: 0, arguments: [1], ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          { kind: "store", slot: 5, value: 1, ...span },
        ],
        terminator: {
          kind: "record-cell",
          object: 0,
          record: 0,
          field: 0,
          operation: "initialize",
          slot: 5,
          consequent: 1,
          alternate: 5,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 0, ...span },
          { kind: "load", id: 3, slot: 1, ...span },
          { kind: "record-new", id: 4, record: 1, arguments: [2, 3], ...span },
          { kind: "function-new", id: 5, target: 1, environment: 4, ...span },
          { kind: "store", slot: 2, value: 5, ...span },
          { kind: "constant", id: 6, value: 0, ...span },
          { kind: "store", slot: 3, value: 6, ...span },
          { kind: "store", slot: 4, value: 6, ...span },
        ],
        terminator: { kind: "jump", target: 2, ...span },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 7, slot: 3, ...span },
          { kind: "constant", id: 8, value: 8, ...span },
          { kind: "binary", id: 9, operator: "<", left: 7, right: 8, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 9,
          consequent: 3,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 10, slot: 2, ...span },
          {
            kind: "call-indirect",
            id: 11,
            target: 1,
            callee: 10,
            arguments: [],
            ...span,
          },
          { kind: "load", id: 12, slot: 4, ...span },
          {
            kind: "binary",
            id: 13,
            operator: "+",
            left: 12,
            right: 11,
            ...span,
          },
          { kind: "store", slot: 4, value: 13, ...span },
          { kind: "load", id: 14, slot: 3, ...span },
          { kind: "constant", id: 15, value: 1, ...span },
          {
            kind: "binary",
            id: 16,
            operator: "+",
            left: 14,
            right: 15,
            ...span,
          },
          { kind: "store", slot: 3, value: 16, ...span },
        ],
        terminator: { kind: "jump", target: 2, ...span },
      },
      {
        id: 4,
        instructions: [{ kind: "load", id: 17, slot: 4, ...span }],
        terminator: { kind: "return", value: 17, ...span },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  const stepClosure: FunctionIR = {
    id: 1,
    name: "next",
    exported: false,
    parameters: [],
    slots: ["number", "reference", "number"],
    returnType: "number",
    closureEnvironment: 1,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "closure-environment", id: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 1,
          field: 0,
          operation: "read",
          slot: 0,
          consequent: 1,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "closure-environment", id: 1, ...span }],
        terminator: {
          kind: "record",
          object: 1,
          record: 1,
          field: 1,
          operation: "read",
          slot: 1,
          consequent: 2,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 2, slot: 1, ...span }],
        terminator: {
          kind: "record-cell",
          object: 2,
          record: 0,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 3,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 3, slot: 2, ...span },
          { kind: "load", id: 4, slot: 0, ...span },
          { kind: "binary", id: 5, operator: "+", left: 3, right: 4, ...span },
          { kind: "store", slot: 2, value: 5, ...span },
          { kind: "load", id: 6, slot: 1, ...span },
        ],
        terminator: {
          kind: "record-cell",
          object: 6,
          record: 0,
          field: 0,
          operation: "write",
          slot: 2,
          consequent: 5,
          alternate: 4,
          ...span,
        },
      },
      { id: 4, instructions: [], terminator: { kind: "trap", ...span } },
      {
        id: 5,
        instructions: [{ kind: "load", id: 7, slot: 2, ...span }],
        terminator: { kind: "return", value: 7, ...span },
      },
    ],
  };
  const input: ModuleIR = {
    records: [
      {
        byteLength: 24,
        fields: [{ offset: 8, type: "number", mutable: true, stateOffset: 16 }],
      },
      {
        byteLength: 24,
        fields: [
          { offset: 8, type: "number", mutable: false },
          { offset: 16, type: "reference", mutable: false },
        ],
      },
    ],
    functions: [run, stepClosure],
  };
  assert.ok(verify(input).ok, JSON.stringify(verify(input)));
  const optimized = optimizeModule(input, 20000000, {
    devirtualizeClosures: true,
    closedCalls: true,
  });
  assert.ok(
    verify(optimized.module).ok,
    JSON.stringify(verify(optimized.module)),
  );
  const out = optimized.module.functions[0]!;
  // Closure environment record 1 is scalar-replaced (no record-new of record 1).
  assert.ok(
    !out.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "record-new" && op.record === 1),
    ),
    "closure environment with reference field must be scalar-replaced",
  );
  // The cell read/write in the loop is promoted out (one read before, one write
  // after; no record-cell terminator inside the loop back-edge cycle).
  const promoted = optimized.passes.find(
    (p) => p.pass === "promote-loop-cells",
  );
  assert.ok(
    (promoted?.rewritten ?? 0) >= 1,
    "cell must be promoted out of loop",
  );
});
