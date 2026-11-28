import assert from "node:assert/strict";
import test from "node:test";
import type { Block, FunctionIR, ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { recordDispatchChains } from "../src/aarch64/scalar/record-dispatch.ts";
const s = { start: 0, end: 0 };
const field = (offset: number) => ({
  byteLength: 32,
  fields: [{ offset, type: "number" as const, mutable: false }],
});
const records = [field(16), field(16), field(16), field(24)];
/** A chain whose candidates all read field 0 at one offset. */
function oneGroup(candidates: number[], failure: number) {
  return {
    records: candidates,
    groups: [{ records: candidates, record: candidates[0], field: 0 }],
    failure,
  };
}
function candidate(
  id: number,
  record: number,
  alternate: number,
  consequent = 4,
): Block {
  return {
    id,
    instructions: [{ kind: "load", id, slot: 0, ...s }],
    terminator: {
      kind: "record",
      object: id,
      record,
      field: 0,
      operation: "read",
      slot: 1,
      consequent,
      alternate,
      ...s,
    },
  };
}
function chain(
  second: Block = candidate(1, 1, 2),
  third: Block = candidate(2, 2, 3),
  head: Block = candidate(0, 0, 1),
): FunctionIR {
  return {
    id: 0,
    name: "read",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      head,
      second,
      third,
      { id: 3, instructions: [], terminator: { kind: "trap", ...s } },
      {
        id: 4,
        instructions: [{ kind: "load", id: 4, slot: 1, ...s }],
        terminator: { kind: "return", value: 4, ...s },
      },
    ],
  };
}
test("union field reads with one placement fuse into one shared read", () => {
  const plan = recordDispatchChains(chain(), records, () => true);
  assert.ok(plan);
  assert.deepEqual([...plan.chains], [[0, oneGroup([0, 1, 2], 3)]]);
  assert.deepEqual([...plan.fused], [0, 1, 1, 0, 0]);
});
test("continuations that unwrap an optional receiver slot fuse", () => {
  // Copy propagation reads an optional source slot and unwraps it at each
  // load; the continuation's unwrap cannot fail (the head unwrapped the
  // same slot contents).
  const unwrapped = (id: number, record: number, alternate: number): Block => ({
    id,
    instructions: [
      { kind: "load", id: id + 10, slot: 0, ...s },
      { kind: "reference-value", id, value: id + 10, ...s },
    ],
    terminator: {
      kind: "record",
      object: id,
      record,
      field: 0,
      operation: "read",
      slot: 1,
      consequent: 4,
      alternate,
      ...s,
    },
  });
  const optional = (fn: FunctionIR): FunctionIR => ({
    ...fn,
    slots: ["optional-reference", "number"],
  });
  const fn = optional(
    chain(unwrapped(1, 1, 2), unwrapped(2, 2, 3), unwrapped(0, 0, 1)),
  );
  const plan = recordDispatchChains(fn, records, () => true);
  assert.deepEqual([...plan!.chains], [[0, oneGroup([0, 1, 2], 3)]]);
  assert.deepEqual([...plan!.fused], [0, 1, 1, 0, 0]);
  assert.ok(emitModule({ records, functions: [fn] }).ok);
  // An unwrap of anything but the reloaded value keeps the guard.
  const other = unwrapped(1, 1, 2);
  const mismatched = optional(
    chain(
      {
        ...other,
        instructions: [
          { kind: "load", id: 11, slot: 0, ...s },
          { kind: "reference-value", id: 1, value: 10, ...s },
        ],
      },
      unwrapped(2, 2, 3),
      unwrapped(0, 0, 1),
    ),
  );
  const kept = recordDispatchChains(mismatched, records, () => true);
  assert.deepEqual([...kept!.fused], [0, 0, 0, 0, 0]);
});
test("differently placed fields fuse into one test and read per offset", () => {
  const placed = recordDispatchChains(
    chain(candidate(1, 3, 2), candidate(2, 1, 3)),
    records,
    () => true,
  );
  assert.deepEqual(
    [...placed!.chains],
    [
      [
        0,
        {
          records: [0, 3, 1],
          groups: [
            { records: [0, 1], record: 0, field: 0 },
            { records: [3], record: 3, field: 0 },
          ],
          failure: 3,
        },
      ],
    ],
  );
  assert.deepEqual([...placed!.fused], [0, 1, 1, 0, 0]);
  // Both placements emit verified code that reads each offset.
  const emitted = emitModule({
    records,
    functions: [chain(candidate(1, 3, 2), candidate(2, 1, 3))],
  });
  assert.ok(emitted.ok);
});
test("dispatch fusion stops at any candidate that cannot share the read", () => {
  // A different continuation, an unguarded head, a second predecessor or a
  // store to the object slot after its load keep the original guards.
  const unfused = (fn: FunctionIR, guarded = true) => {
    const plan = recordDispatchChains(fn, records, () => guarded);
    assert.equal(plan!.chains.size, 0);
    assert.ok(plan!.fused.every((value) => value === 0));
  };
  unfused(chain(candidate(1, 1, 2, 3)));
  unfused(chain(), false);
  // A second predecessor keeps block 1 out of block 0's chain; block 1 then
  // heads its own chain with block 2.
  const shared = chain();
  const rejoined = recordDispatchChains(
    {
      ...shared,
      blocks: shared.blocks.map((block) =>
        block?.id === 4
          ? { ...block, terminator: { kind: "jump" as const, target: 1, ...s } }
          : block!,
      ),
    },
    records,
    () => true,
  );
  assert.deepEqual([...rejoined!.chains], [[1, oneGroup([1, 2], 3)]]);
  assert.deepEqual([...rejoined!.fused], [0, 0, 1, 0, 0]);
  // A store to the object slot after the head's load also keeps block 0
  // unfused; block 1 may still head its own chain.
  const head = candidate(0, 0, 1);
  const stored = recordDispatchChains(
    chain(undefined, undefined, {
      ...head,
      instructions: [
        ...head.instructions,
        { kind: "store", slot: 0, value: 0, ...s },
      ],
    }),
    records,
    () => true,
  );
  assert.equal(stored!.chains.has(0), false);
  assert.equal(stored!.fused[1], 0);
});
test("fused dispatch emits verified code smaller than the guard chain", () => {
  const emit = (fn: FunctionIR) => {
    const module: ModuleIR = { records, functions: [fn] };
    const emitted = emitModule(module);
    assert.ok(emitted.ok, JSON.stringify(emitted));
    return emitted.value.code.length;
  };
  // The broken chain keeps its last candidate as a separate guarded block.
  assert.ok(
    emit(chain()) < emit(chain(candidate(1, 1, 2), candidate(2, 3, 3))),
  );
});
test("a receiver known to be one of a fused group's layouts reads untested", () => {
  // Two union reads of one receiver: after the first dispatch the receiver
  // is layout 0 or `second`. With both in the second chain's placement
  // group (0 and 1), the second read needs no membership test.
  const reads = (second: number): FunctionIR => ({
    id: 0,
    name: "reads",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      candidate(0, 0, 1, 2),
      candidate(1, second, 5, 2),
      candidate(2, 0, 3, 4),
      candidate(3, 1, 5, 4),
      {
        id: 4,
        instructions: [{ kind: "load", id: 4, slot: 1, ...s }],
        terminator: { kind: "return", value: 4, ...s },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  });
  const size = (fn: FunctionIR) => {
    const emitted = emitModule({ records, functions: [fn] });
    assert.ok(emitted.ok, JSON.stringify(emitted));
    return emitted.value.code.length;
  };
  assert.ok(size(reads(1)) < size(reads(2)));
});
test("continuations reloading a copy of the head's object still fuse", () => {
  // The head reads its parameter slot but first copies the object into a
  // second slot, which every continuation reloads (lowering's usual shape).
  const copy = (id: number, record: number, alternate: number): Block => ({
    id,
    instructions: [{ kind: "load", id, slot: 2, ...s }],
    terminator: {
      kind: "record",
      object: id,
      record,
      field: 0,
      operation: "read",
      slot: 1,
      consequent: 4,
      alternate,
      ...s,
    },
  });
  const head: Block = {
    id: 0,
    instructions: [
      { kind: "load", id: 0, slot: 0, ...s },
      { kind: "store", slot: 2, value: 0, ...s },
    ],
    terminator: {
      kind: "record",
      object: 0,
      record: 0,
      field: 0,
      operation: "read",
      slot: 1,
      consequent: 4,
      alternate: 1,
      ...s,
    },
  };
  const fn = chain(copy(1, 1, 2), copy(2, 2, 3), head);
  const plan = recordDispatchChains(
    { ...fn, slots: ["reference", "number", "reference"] },
    records,
    () => true,
  );
  assert.ok(plan);
  assert.deepEqual([...plan.chains], [[0, oneGroup([0, 1, 2], 3)]]);
  // A later store of another value into the copy breaks the alias.
  const clobbered: Block = {
    ...head,
    instructions: [
      ...head.instructions,
      { kind: "constant", id: 9, value: 0, ...s },
      { kind: "store", slot: 2, value: 9, ...s },
    ],
  };
  const broken = recordDispatchChains(
    {
      ...chain(copy(1, 1, 2), copy(2, 2, 3), clobbered),
      slots: ["reference", "number", "reference"],
    },
    records,
    () => true,
  );
  assert.equal(broken!.chains.has(0), false);
  assert.equal(broken!.fused[1], 0);
});
test("a later head absorbs an earlier-visited head's fused chain", () => {
  // Block 1 heads its own chain (1 -> 2) when visited; block 4 (visited later)
  // copies the object into slot 2 and reaches block 1 as a continuation.
  const reload = (id: number, record: number, alternate: number): Block => ({
    id,
    instructions: [{ kind: "load", id, slot: 2, ...s }],
    terminator: {
      kind: "record",
      object: id,
      record,
      field: 0,
      operation: "read",
      slot: 1,
      consequent: 5,
      alternate,
      ...s,
    },
  });
  const fn: FunctionIR = {
    id: 0,
    name: "read",
    exported: true,
    parameters: [0],
    slots: ["reference", "number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "jump", target: 4, ...s },
      },
      reload(1, 1, 2),
      reload(2, 2, 3),
      { id: 3, instructions: [], terminator: { kind: "trap", ...s } },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...s },
          { kind: "store", slot: 2, value: 4, ...s },
        ],
        terminator: {
          kind: "record",
          object: 4,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 5,
          alternate: 1,
          ...s,
        },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 5, slot: 1, ...s }],
        terminator: { kind: "return", value: 5, ...s },
      },
    ],
  };
  const plan = recordDispatchChains(fn, records, () => true);
  assert.ok(plan);
  assert.deepEqual([...plan.chains], [[4, oneGroup([0, 1, 2], 3)]]);
  assert.deepEqual([...plan.fused], [0, 1, 1, 0, 0, 0]);
});
test("long fused chains test membership with one bitset lookup", () => {
  // Twelve layouts with the field in one place, then a trap.
  const many = Array.from({ length: 13 }, () => field(16));
  const blocks: Block[] = [];
  for (let index = 0; index < 12; index++)
    blocks.push(candidate(index, index, index + 1, 13));
  blocks.push({ id: 12, instructions: [], terminator: { kind: "trap", ...s } });
  blocks.push({
    id: 13,
    instructions: [{ kind: "load", id: 13, slot: 1, ...s }],
    terminator: { kind: "return", value: 13, ...s },
  });
  const fn: FunctionIR = {
    id: 0,
    name: "read",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks,
  };
  const plan = recordDispatchChains(fn, many, () => true);
  assert.equal(plan?.chains.get(0)?.records.length, 12);
  const emitted = emitModule({ records: many, functions: [fn] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const code = emitted.value.code;
  const view = new DataView(code.buffer, code.byteOffset);
  const own = emitted.value.functions[0]!;
  const words = Array.from({ length: own.byteLength / 4 }, (_, index) =>
    view.getUint32(own.offset + index * 4, true),
  );
  // The candidate set has a dispatch family: one LDR of the descriptor's
  // family word replaces the indexed bitset byte, and the chain no longer
  // compares the descriptor against each of the twelve layouts.
  assert.equal(
    words.filter((word) => (word & 0xffc00000) >>> 0 === 0x39400000).length,
    0,
  );
  assert.equal(
    words.filter((word) => word === 0xf940018c).length,
    1,
    "ldr x12, [x12]",
  );
  const compares = words.filter(
    (word) => (word & 0xff20001f) >>> 0 === 0xeb00001f,
  ).length;
  assert.ok(compares < 6, `descriptor comparisons: ${compares}`);
  // Each descriptor is preceded by its record index, and below that by its
  // family words: family 0 holds exactly the twelve candidates.
  for (const descriptor of emitted.value.records) {
    assert.equal(
      Number(view.getBigUint64(descriptor.offset - 8, true)),
      descriptor.record,
    );
    assert.equal(
      view.getBigUint64(descriptor.offset - 16, true),
      descriptor.record < 12 ? 1n : 0n,
    );
    assert.equal(view.getBigUint64(descriptor.offset - 24, true), 0n);
  }
});

test("placing typed fragments preserves dispatch families and cross-range calls", async () => {
  const { emitModuleInFragments } =
    await import("../src/aarch64/scalar/index.ts");
  const definition = chain();
  const functions: FunctionIR[] = [
    definition,
    { ...chain(candidate(1, 3, 2)), id: 1, name: "readOther" },
    {
      id: 2,
      name: "caller",
      exported: true,
      parameters: [0],
      slots: ["reference"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...s },
            { kind: "call", id: 1, target: 0, arguments: [0], ...s },
            { kind: "call", id: 2, target: 1, arguments: [0], ...s },
          ],
          terminator: { kind: "return", value: 2, ...s },
        },
      ],
    },
  ];
  const module: ModuleIR = { records, functions };
  const expected = emitModule(module, { operationRanges: true });
  assert.ok(expected.ok);
  for (const ranges of [
    [{ first: 0, end: 3 }],
    [
      { first: 2, end: 3 },
      { first: 0, end: 2 },
    ],
    [
      { first: 1, end: 2 },
      { first: 0, end: 1 },
      { first: 2, end: 3 },
    ],
  ]) {
    assert.deepEqual(
      emitModuleInFragments(module, ranges, { operationRanges: true }),
      expected,
    );
  }
});

test("fragment packet decoding rejects an incomplete header", async () => {
  const { decodeFragment } = await import("../src/aarch64/scalar/fragments.ts");
  assert.throws(() => decodeFragment(new Uint8Array(0), [], []));
});

test("a detached backend opens prepared bytes once and answers out of order", async () => {
  const { emitModuleFromStore, openFragmentActor } =
    await import("../src/aarch64/scalar/index.ts");
  const functions = [chain(), { ...chain(), id: 1, name: "other" }];
  const module: ModuleIR = { records, functions };
  const options = { operationRanges: true, closedRoots: [0, 1] };
  let sessions = 0;
  const result = emitModuleFromStore(
    module,
    {
      get: (id: number) => functions[id]!,
      put: (fn: FunctionIR) => {
        functions[fn.id] = fn;
      },
      release: () => {},
    },
    options,
    {
      ranges: [
        { first: 0, end: 1 },
        { first: 1, end: 2 },
      ],
      execute: (input, forms, ranges, publish) => {
        sessions++;
        const actor = openFragmentActor(input, options);
        for (const range of ranges.slice().reverse()) {
          const packet = actor(forms, range);
          assert.ok(packet);
          publish(packet);
        }
        return true;
      },
    },
  );
  assert.deepEqual(result, emitModule(module, options));
  assert.equal(sessions, 1);
});

test("fragment placement loads and releases spilled packets in canonical order", async () => {
  const { emitModuleInFragments } =
    await import("../src/aarch64/scalar/index.ts");
  const { createMemorySpillBackend } = await import("@tint/ir/storage");
  const module: ModuleIR = {
    records,
    functions: [chain(), { ...chain(), id: 1, name: "other" }],
  };
  const backing = createMemorySpillBackend();
  const events: string[] = [];
  const result = emitModuleInFragments(
    module,
    [
      { first: 1, end: 2 },
      { first: 0, end: 1 },
    ],
    {},
    {
      write(bytes: Uint8Array): number {
        return backing.write(bytes);
      },
      read(id: number): Uint8Array {
        events.push("read " + id);
        return backing.read(id);
      },
      release(id: number): void {
        backing.release(id);
        events.push("release " + id);
      },
      close(): void {
        backing.close();
      },
    },
  );
  assert.deepEqual(result, emitModule(module));
  assert.deepEqual(events, ["read 1", "release 1", "read 0", "release 0"]);
});

test("openPreparedEmission drives out-of-order attempts, retries on one wire, and releases spilled packets on abort", async () => {
  const { openPreparedEmission, openFragmentActor } =
    await import("../src/aarch64/scalar/index.ts");
  const { createMemorySpillBackend } = await import("@tint/ir/storage");
  const functions = [chain(), { ...chain(), id: 1, name: "other" }];
  const module: ModuleIR = { records, functions };
  // Force a far-model retry on the second attempt via a tiny farModuleBytes threshold.
  const options = {
    operationRanges: true,
    closedRoots: [0, 1],
    farModuleBytes: 1,
  };
  const backing = createMemorySpillBackend();
  const liveSegments = new Set<number>();
  const packets = {
    write(bytes: Uint8Array): number {
      const id = backing.write(bytes);
      liveSegments.add(id);
      return id;
    },
    read(id: number): Uint8Array {
      return backing.read(id);
    },
    release(id: number): void {
      liveSegments.delete(id);
      backing.release(id);
    },
    close(): void {
      backing.close();
    },
  };
  let retired = 0;
  let beforePackCalls = 0;
  const started = openPreparedEmission(
    module,
    {
      get: (id: number) => functions[id]!,
      put: (fn: FunctionIR) => {
        functions[fn.id] = fn;
      },
      release: () => {},
    },
    options,
    [
      { first: 1, end: 2 },
      { first: 0, end: 1 },
    ],
    packets,
    () => {
      beforePackCalls++;
    },
    () => {
      retired++;
    },
  );
  assert.equal(started.kind, "ready");
  assert.equal(beforePackCalls, 1);
  assert.equal(retired, 1);
  const actor = openFragmentActor(started.session.input, options);
  let attempt = started.session.attempt;
  let attempts = 0;
  let finalEmission;
  while (true) {
    attempts++;
    assert.equal(liveSegments.size, 0);
    for (const range of attempt.ranges.slice().reverse()) {
      const reply = actor(attempt.forms, range);
      assert.ok(reply);
      attempt.submit(reply);
    }
    assert.equal(liveSegments.size, 2);
    const outcome = attempt.finish();
    assert.equal(liveSegments.size, 0);
    if (outcome.kind === "done") {
      finalEmission = outcome.emission;
      break;
    }
    assert.equal(outcome.kind, "retry");
    assert.equal(outcome.attempt.forms.far, true);
    attempt = outcome.attempt;
  }
  assert.equal(attempts, 2);
  assert.deepEqual(finalEmission, emitModule(module, options));

  // Abort after submitting one packet must release its spilled segment.
  const aborted = openPreparedEmission(
    module,
    {
      get: (id: number) => functions[id]!,
      put: (fn: FunctionIR) => {
        functions[fn.id] = fn;
      },
      release: () => {},
    },
    {},
    [
      { first: 0, end: 1 },
      { first: 1, end: 2 },
    ],
    packets,
  );
  assert.equal(aborted.kind, "ready");
  const abortActor = openFragmentActor(aborted.session.input, {});
  const firstReply = abortActor(aborted.session.attempt.forms, {
    first: 0,
    end: 1,
  });
  assert.ok(firstReply);
  aborted.session.attempt.submit(firstReply);
  assert.equal(liveSegments.size, 1);
  aborted.session.attempt.abort();
  assert.equal(liveSegments.size, 0);
});

test("openPreparedEmission serial fallback reuses preparation and decodes packed wire bodies without re-reading retired bodies", async () => {
  const { openPreparedEmission } =
    await import("../src/aarch64/scalar/index.ts");
  const functions = [chain(), { ...chain(), id: 1, name: "other" }];
  const module: ModuleIR = { records, functions };
  const options = {
    operationRanges: true,
    closedRoots: [0, 1],
    farModuleBytes: 1,
  };
  let retired = false;
  let getsAfterRetire = 0;
  const started = openPreparedEmission(
    module,
    {
      get: (id: number) => {
        if (retired) {
          getsAfterRetire++;
          throw new Error(
            "retired body must not be read when packedBodies is passed",
          );
        }
        return functions[id]!;
      },
      put: (fn: FunctionIR) => {
        functions[fn.id] = fn;
      },
      release: () => {},
    },
    options,
    [
      { first: 0, end: 1 },
      { first: 1, end: 2 },
    ],
    undefined,
    undefined,
    () => {
      retired = true;
    },
  );
  assert.equal(started.kind, "ready");
  assert.equal(retired, true);
  const packedBodies = new Uint8Array(started.session.input.bodies);
  started.session.releaseInput();
  started.session.attempt.abort();

  // Falling back with packedBodies decodes from the wire directly and matches
  // direct serial emission byte-for-byte, including across a far-model retry.
  const fallbackFromWire = started.session.emitSerialFallback(packedBodies);
  assert.equal(getsAfterRetire, 0);
  assert.deepEqual(fallbackFromWire, emitModule(module, options));

  // Falling back without packedBodies still reuses preparation (1 read per
  // function per emission pass, with no repeated whole-module analysis reads).
  let fallbackGets = 0;
  let inFallback = false;
  const startedInMemory = openPreparedEmission(
    module,
    {
      get: (id: number) => {
        if (inFallback) fallbackGets++;
        return functions[id]!;
      },
      put: (fn: FunctionIR) => {
        functions[fn.id] = fn;
      },
      release: () => {},
    },
    { operationRanges: true, closedRoots: [0, 1] },
    [
      { first: 0, end: 1 },
      { first: 1, end: 2 },
    ],
  );
  assert.equal(startedInMemory.kind, "ready");
  inFallback = true;
  const fallbackInMemory = startedInMemory.session.emitSerialFallback();
  assert.equal(fallbackGets, functions.length);
  assert.deepEqual(
    fallbackInMemory,
    emitModule(module, { operationRanges: true, closedRoots: [0, 1] }),
  );
});
