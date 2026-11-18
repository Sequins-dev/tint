// Precise stack maps: each call that may collect lists exactly the frame
// words holding references live across it, so a slot dead at one safepoint
// and live at another, a temporary spanning one call, and a slot read only by
// an exception handler each appear where (and only where) they must.
import assert from "node:assert/strict";
import test from "node:test";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import {
  decodeStackMaps,
  emitModule,
  type DecodedSafepoint,
  type NativeModule,
} from "../src/aarch64/scalar/index.ts";
import { encodeStackMapTable } from "../src/aarch64/scalar/stack-maps.ts";
import {
  nativeStackMapMagic,
  nativeStackMapCompactVersion,
  nativeStackMapWideVersion,
} from "@tint/abi/host";
const s = { start: 0, end: 0 };
const record = {
  byteLength: 32,
  fields: [{ offset: 16, type: "number" as const, mutable: true }],
};
/** Allocates and returns a record (the collecting callee). */
const allocate = {
  id: 1,
  name: "allocate",
  exported: false,
  parameters: [],
  slots: [],
  returnType: "reference" as const,
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "constant" as const, id: 0, value: 1, ...s },
        {
          kind: "record-new" as const,
          id: 1,
          record: 0,
          arguments: [0],
          ...s,
        },
      ],
      terminator: { kind: "return" as const, value: 1, ...s },
    },
  ],
};
function call(id: number | undefined) {
  return { kind: "call" as const, id, target: 1, arguments: [], ...s };
}
/** The collecting call sites of function 0, in code order. */
function sites(native: NativeModule): DecodedSafepoint[] {
  const fn = native.functions[0]!;
  return (decodeStackMaps(native) ?? []).filter(
    (site) =>
      site.offset > fn.offset && site.offset <= fn.offset + fn.byteLength,
  );
}
function emit(module: ModuleIR, precise = true): NativeModule {
  assert.deepEqual(verify(module), { ok: true });
  const emitted = emitModule(module, {
    aliasSlotLoads: false,
    preciseStackMaps: precise,
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  return emitted.value;
}

test("a slot is listed at the safepoints it is live across, not after its last read", () => {
  const module: ModuleIR = {
    records: [record],
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              call(1),
              { kind: "load", id: 2, slot: 0, ...s },
              call(3),
            ],
            terminator: { kind: "return", value: 2, ...s },
          },
        ],
      },
      allocate,
    ],
  };
  const native = emit(module),
    [first, second] = sites(native),
    roots = native.functions[0]!.frameRoots!;
  assert.ok(first && second);
  // The parameter slot is read after the first call only; the loaded value
  // (a temporary) carries it across the second.
  assert.equal(first.references.length, 1);
  assert.equal(second.references.length, 1);
  assert.notEqual(first.references[0], second.references[0]);
  for (const word of [...first.references, ...second.references])
    assert.ok(roots.references.includes(word));
  // The conservative regime lists every root word at both.
  const conservative = sites(emit(module, false));
  for (const site of conservative)
    assert.deepEqual(site.references, roots.references);
});

test("a temporary is listed only at the calls inside its lifetime", () => {
  const module: ModuleIR = {
    records: [record],
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [call(0), call(1), call(2)],
            terminator: { kind: "return", value: 1, ...s },
          },
        ],
      },
      allocate,
    ],
  };
  const [first, second, third] = sites(emit(module));
  assert.ok(first && second && third);
  assert.deepEqual(first.references, []);
  // Result 1 spans the third call only.
  assert.deepEqual(second.references, []);
  assert.equal(third.references.length, 1);
});

test("a slot read only by an exception handler is listed at calls that may throw", () => {
  const module: ModuleIR = {
    records: [record],
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0],
        slots: ["reference", "reference", "general"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "store", slot: 1, value: 0, ...s },
              call(1),
            ],
            terminator: { kind: "return", value: 1, ...s },
            exception: { target: 1, slot: 2 },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 2, slot: 1, ...s }],
            terminator: { kind: "return", value: 2, ...s },
          },
        ],
      },
      allocate,
    ],
  };
  const native = emit(module),
    [site] = sites(native);
  assert.ok(site);
  // Slot 1 holds the parameter's value for the handler; the normal path
  // never reads it again.
  assert.equal(site.references.length, 1);
  assert.ok(
    native.functions[0]!.frameRoots!.references.includes(site.references[0]!),
  );
});

test("a slot a later guarded read overwrites is not a root while dead", () => {
  // Slot 1 holds a stale reference across the call; the record read after
  // it writes slot 1 on success and traps otherwise, so the stale value is
  // dead at the call. When the failure edge reads slot 1, it stays live.
  const holder = {
    byteLength: 32,
    fields: [{ offset: 16, type: "reference" as const, mutable: true }],
  };
  function module(alternateReads: boolean): ModuleIR {
    return {
      records: [record, holder],
      functions: [
        {
          id: 0,
          name: "caller",
          exported: true,
          parameters: [0],
          slots: ["reference", "reference"],
          returnType: "reference",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...s },
                { kind: "store", slot: 1, value: 0, ...s },
                call(1),
                { kind: "load", id: 2, slot: 0, ...s },
              ],
              terminator: {
                kind: "record",
                object: 2,
                record: 1,
                field: 0,
                operation: "read",
                slot: 1,
                consequent: 1,
                alternate: 2,
                ...s,
              },
            },
            {
              id: 1,
              instructions: [{ kind: "load", id: 3, slot: 1, ...s }],
              terminator: { kind: "return", value: 3, ...s },
            },
            alternateReads
              ? {
                  id: 2,
                  instructions: [{ kind: "load", id: 4, slot: 1, ...s }],
                  terminator: { kind: "return", value: 4, ...s },
                }
              : { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
          ],
        },
        allocate,
      ],
    };
  }
  const [dead] = sites(emit(module(false))),
    [kept] = sites(emit(module(true)));
  assert.ok(dead && kept);
  // Slot 1 (in a frame word or a callee-saved register) is listed only when
  // the failure edge reads it; the parameter is listed at both.
  const roots = (site: DecodedSafepoint): number =>
    site.references.length + site.registers.length;
  assert.equal(roots(dead), 1);
  assert.equal(roots(kept), 2);
});

test("a register-homed reference stays in its register across calls", () => {
  const module: ModuleIR = {
    records: [record],
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              call(1),
              { kind: "load", id: 2, slot: 0, ...s },
              call(3),
              { kind: "load", id: 4, slot: 0, ...s },
            ],
            terminator: { kind: "return", value: 4, ...s },
          },
        ],
      },
      allocate,
    ],
  };
  const native = emit(module),
    [first, second] = sites(native);
  assert.ok(first && second);
  // The parameter slot takes a callee-saved home, live across both calls:
  // each map lists its register and the frame's save of it, not a word.
  const register = first.registers[0];
  assert.ok(register !== undefined && register >= 22 && register <= 28);
  for (const site of [first, second]) {
    assert.deepEqual(site.registers, [register]);
    assert.deepEqual(site.references, []);
    assert.deepEqual(
      site.saves.map((save) => save.register),
      [register],
    );
  }
  // Only epilogues reload the register, from its save slot: calls are not
  // followed by reloads from the slot's frame word.
  const fn = native.functions[0]!,
    view = new DataView(
      native.code.buffer,
      native.code.byteOffset,
      native.code.byteLength,
    );
  let loads = 0;
  for (let at = fn.offset; at < fn.offset + fn.byteLength; at += 4) {
    const word = view.getUint32(at, true);
    // LDR Xr, [SP, #imm] (64-bit, unsigned offset).
    if ((word & 0xffc003ff) >>> 0 === (0xf94003e0 | register) >>> 0) {
      loads++;
      assert.equal(((word >>> 10) & 0xfff) * 8, first.saves[0]!.offset);
    }
  }
  assert.ok(loads >= 1);
});

test("callers of the root-head binding save every callee-saved register", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "collect",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "call", id: 0, target: 1, arguments: [], ...s },
            ],
            terminator: { kind: "return", value: 0, ...s },
          },
        ],
      },
      {
        id: 1,
        name: "currentRootHead",
        exported: false,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "host-call",
                operation: "root-head",
                id: 0,
                arguments: [],
                ...s,
              },
            ],
            terminator: { kind: "return", value: 0, ...s },
          },
        ],
      },
    ],
  };
  const native = emit(module),
    [site] = decodeStackMaps(native) ?? [];
  assert.ok(site);
  // The walk starts at the caller: its map at the binding's return address
  // describes saves of all of x19..x28.
  assert.deepEqual(
    site.saves.map((save) => save.register),
    [19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
  );
  assert.deepEqual(site.registers, []);
});

/** Table words as module bytes at `tableOffset`, decoded. */
function decodeTable(words: readonly number[], tableOffset = 0) {
  const code = new Uint8Array(tableOffset + words.length * 8),
    view = new DataView(code.buffer);
  words.forEach((word, index) => {
    assert.ok(Number.isSafeInteger(word) && word >= 0, String(word));
    view.setBigUint64(tableOffset + index * 8, BigInt(word), true);
  });
  return decodeStackMaps({
    code,
    stackMaps: [{ codeOffset: 100, tableOffset }],
  });
}

test("compact tables group safepoints by function, keep exact maps and reject duplicates", () => {
  // Function at 0: frame 32, saves x22 at sp + 8, holds a reference in it.
  const held = [32, 1, 16, 0, 2 ** 3 + 2 ** 13, 8];
  const words = encodeStackMapTable(
    [
      { offset: 40, start: 0, map: held },
      { offset: 8, start: 0, map: held },
      { offset: 64, start: 48, map: [48, 0, 1, 16, 0] },
    ],
    96,
  );
  assert.ok(words);
  assert.deepEqual(words.slice(0, 3), [
    nativeStackMapMagic,
    nativeStackMapCompactVersion,
    2,
  ]);
  const register = {
    frameBytes: 32,
    references: [16],
    generals: [],
    registers: [22],
    saves: [{ register: 22, offset: 8 }],
  };
  assert.deepEqual(decodeTable(words, 96), [
    { offset: 108, ...register },
    { offset: 140, ...register },
    {
      offset: 164,
      frameBytes: 48,
      references: [],
      generals: [16],
      registers: [],
      saves: [],
    },
  ]);
  assert.equal(
    encodeStackMapTable(
      [
        { offset: 8, start: 0, map: [16, 0, 0, 0] },
        { offset: 8, start: 0, map: [16, 0, 0, 0] },
      ],
      64,
    ),
    undefined,
  );
  // A function's maps must agree on its frame.
  assert.equal(
    encodeStackMapTable(
      [
        { offset: 8, start: 0, map: [16, 0, 0, 0] },
        { offset: 12, start: 0, map: [32, 0, 0, 0] },
      ],
      64,
    ),
    undefined,
  );
});

test("long-lived words are encoded once as runs, so maps of growing live sets stay linear", () => {
  // An initializer-like function: safepoint k keeps every word defined
  // before it live (word i from safepoint i on), plus one short-lived word.
  const count = 400,
    entries: { offset: number; start: number; map: number[] }[] = [];
  let listed = 0;
  for (let k = 0; k < count; k++) {
    const references: number[] = [];
    for (let word = 0; word <= k; word++) references.push(16 + word * 8);
    if (k % 2 === 0) references.push(16 + 1000 * 8);
    references.sort((left, right) => left - right);
    listed += references.length;
    entries.push({
      offset: 4 + k * 4,
      start: 0,
      map: [16 * 1024, references.length, ...references, 0, 0],
    });
  }
  const words = encodeStackMapTable(entries, count * 4 + 64);
  assert.ok(words);
  // Full-word maps would need a word per listed offset; runs need a few
  // bytes per word.
  assert.ok(words.length * 8 < listed / 10, String(words.length));
  const decoded = decodeTable(words, count * 4 + 64);
  assert.ok(decoded);
  assert.equal(decoded.length, count);
  for (let k = 0; k < count; k++)
    assert.deepEqual(
      decoded[k]?.references,
      entries[k]!.map.slice(2, 2 + entries[k]!.map[1]!),
    );
});

test("modules whose offsets reach 2^32 switch to wide tables", () => {
  const small = [48, 0, 1, 16, 0];
  const far = 2 ** 32 + 8;
  const words = encodeStackMapTable(
    [
      { offset: 8, start: 0, map: small },
      { offset: far, start: far - 8, map: small },
    ],
    far + 64,
  );
  assert.ok(words);
  assert.deepEqual(words.slice(0, 3), [
    nativeStackMapMagic,
    nativeStackMapWideVersion,
    2,
  ]);
  // Header, two words per entry, then the shared map once.
  assert.equal(words.length, 3 + 2 * 2 + small.length);
  assert.deepEqual(words.slice(3, 7), [8, 7, far, 7]);
  const decoded = decodeTable(words);
  assert.deepEqual(
    decoded?.map((site) => [site.offset, site.frameBytes, site.generals]),
    [
      [108, 48, [16]],
      [100 + far, 48, [16]],
    ],
  );
});

test("return offsets past 4 GiB switch to wide entries instead of truncating", () => {
  // A module beyond 4 GiB (docs/large-images.md) has safepoints whose return
  // offsets a packed word's low 32 bits cannot hold.
  const map = [48, 0, 1, 16, 0],
    far = 2 ** 32 + 40;
  const words = encodeStackMapTable([
    { offset: 8, map },
    { offset: far, map },
  ]);
  assert.ok(words);
  assert.deepEqual(words.slice(0, 3), [nativeStackMapMagic, 3, 2]);
  assert.deepEqual(words.slice(3, 7), [8, 7, far, 7]);
  const code = new Uint8Array(words.length * 8),
    view = new DataView(code.buffer);
  words.forEach((word, index) =>
    view.setBigUint64(index * 8, BigInt(word), true),
  );
  const decoded = decodeStackMaps({
    code,
    stackMaps: [{ codeOffset: 16, tableOffset: 0 }],
  });
  assert.deepEqual(
    decoded?.map((site) => site.offset),
    [24, far + 16],
  );
  // Below 4 GiB the packed encoding is unchanged.
  assert.deepEqual(
    encodeStackMapTable([{ offset: 0xfffffff0, map }])?.slice(0, 2),
    [nativeStackMapMagic, nativeStackMapVersion],
  );
});
