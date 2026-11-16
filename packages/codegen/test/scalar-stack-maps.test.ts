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
import { nativeStackMapMagic, nativeStackMapVersion } from "@tint/abi/host";
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

test("safepoint tables sort by return offset, share equal maps and reject duplicates", () => {
  // The first map's frame saves x22 at sp + 8 and holds a reference in it.
  const held = [32, 1, 16, 0, 2 ** 3 + 2 ** 13, 8];
  const words = encodeStackMapTable([
    { offset: 40, map: held },
    { offset: 8, map: held },
    { offset: 24, map: [48, 0, 1, 16, 0] },
  ]);
  assert.ok(words);
  const code = new Uint8Array(words.length * 8),
    view = new DataView(code.buffer);
  words.forEach((word, index) =>
    view.setBigUint64(index * 8, BigInt(word), true),
  );
  const decoded = decodeStackMaps({
    code,
    stackMaps: [{ codeOffset: 100, tableOffset: 0 }],
  });
  const register = {
    frameBytes: 32,
    references: [16],
    generals: [],
    registers: [22],
    saves: [{ register: 22, offset: 8 }],
  };
  assert.deepEqual(decoded, [
    { offset: 108, ...register },
    {
      offset: 124,
      frameBytes: 48,
      references: [],
      generals: [16],
      registers: [],
      saves: [],
    },
    { offset: 140, ...register },
  ]);
  // Header, three entries, two distinct maps.
  assert.equal(words.length, 3 + 3 + 11);
  assert.equal(
    encodeStackMapTable([
      { offset: 8, map: [16, 0, 0, 0] },
      { offset: 8, map: [16, 0, 0, 0] },
    ]),
    undefined,
  );
});

test("tables whose maps pass the packed 2^21-word index range switch to wide entries", () => {
  // Distinct maps of a very large frame (a test262 unit host function) can
  // exceed what a packed index * 2^32 + offset word encodes exactly.
  const many = 2 ** 21,
    large = [many * 8 + 16, many];
  for (let at = 0; at < many; at++) large.push(16 + at * 8);
  large.push(0, 0);
  const small = [48, 0, 1, 16, 0];
  const words = encodeStackMapTable([
    { offset: 8, map: large },
    { offset: 24, map: small },
    { offset: 40, map: large },
  ]);
  assert.ok(words);
  assert.deepEqual(words.slice(0, 3), [nativeStackMapMagic, 3, 3]);
  // Header, two words per entry, then both maps once.
  assert.equal(words.length, 3 + 3 * 2 + large.length + small.length);
  assert.deepEqual(words.slice(3, 9), [8, 9, 24, 9 + large.length, 40, 9]);
  const code = new Uint8Array(words.length * 8),
    view = new DataView(code.buffer);
  words.forEach((word, index) =>
    view.setBigUint64(index * 8, BigInt(word), true),
  );
  const decoded = decodeStackMaps({
    code,
    stackMaps: [{ codeOffset: 100, tableOffset: 0 }],
  });
  assert.ok(decoded);
  assert.deepEqual(
    decoded.map((site) => [
      site.offset,
      site.frameBytes,
      site.references.length,
    ]),
    [
      [108, many * 8 + 16, many],
      [124, 48, 0],
      [140, many * 8 + 16, many],
    ],
  );
  assert.deepEqual(decoded[1]?.generals, [16]);
  // Below the range the packed layout is unchanged.
  assert.equal(
    encodeStackMapTable([{ offset: 8, map: small }])?.[1],
    nativeStackMapVersion,
  );
});
