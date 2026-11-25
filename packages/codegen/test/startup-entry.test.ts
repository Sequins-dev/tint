import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { linuxHostABI } from "@tint/platform/linux/host-abi";
import { test } from "node:test";
import assert from "node:assert/strict";
import { emitHostedEntry, type HostRequest } from "../src/aarch64/startup.ts";
import type { NativeModule } from "@tint/codegen/aarch64/scalar";
import type { UnwindRow } from "@tint/abi/unwind";
function module(
  parameters: readonly { kind: "float" | "integer" | "stack"; index: number }[],
  count = 1,
): NativeModule {
  return {
    sourceRanges: [],
    imports: [],
    signatures: [],
    functionDescriptor: undefined,
    functionDescriptorImport: undefined,
    linkage: "local",
    managedImports: [],
    records: [],
    stackMaps: [],
    strings: [],
    cellHelpers: [],
    helpers: [],
    code: new Uint8Array(count * 16),
    functions: Array.from({ length: count }, (_, id) => ({
      id,
      name: "stub",
      exported: true,
      offset: id * 16,
      byteLength: 16,
      frameBytes: 0,
      signature: {
        parameters: id === 0 ? parameters : [{ kind: "float", index: 0 }],
        stackBytes: parameters.filter((p) => p.kind === "stack").length
          ? 32
          : 0,
      },
    })),
  };
}
function request(): HostRequest {
  return {
    abi: darwinHostABI(),
    allocator: {
      native: module(
        [
          { kind: "float", index: 0 },
          { kind: "float", index: 1 },
          { kind: "integer", index: 4 },
        ],
        2,
      ),
      initialize: 0,
      allocate: 1,
      environmentBytes: 256,
    },
    runtime: {
      native: module([
        ...Array.from({ length: 8 }, (_, index) => ({
          kind: "float" as const,
          index,
        })),
        ...Array.from({ length: 4 }, (_, index) => ({
          kind: "integer" as const,
          index: index + 4,
        })),
        ...Array.from({ length: 3 }, (_, index) => ({
          kind: "stack" as const,
          index: index * 8,
        })),
      ]),
      entry: 0,
    },
    program: { native: module([]), entry: 0 },
    managedBytes: 65536,
    controlBytes: 16384,
    allocationCapacity: 128,
    rootCapacity: 256,
    stackBytes: 1048576,
    pageSize: 16384,
  };
}
test("host entry composes aligned modules and explicit memory imports", () => {
  const result = emitHostedEntry(request());
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.entryOffset, 0);
  assert.ok(result.value.code.length > 64);
  assert.deepEqual(
    [...new Set(result.value.imports.map((i) => i.target.name))].sort(),
    ["_mmap", "_mprotect", "_munmap"],
  );
  for (const fixup of result.value.imports) {
    assert.equal(fixup.offset % 4, 0);
    assert.ok(fixup.offset + 16 <= result.value.code.length);
  }
});
test("glibc targets enter through _start and __libc_start_main", () => {
  const darwin = emitHostedEntry(request());
  assert.ok(darwin.ok);
  assert.equal(darwin.value.processStartOffset, undefined);
  const result = emitHostedEntry({
    ...request(),
    abi: linuxHostABI(),
    pageSize: 65536,
  });
  assert.ok(result.ok, JSON.stringify(result));
  // The hosted entry stays `main`; the process entry follows the entry code
  // and precedes the first module.
  assert.equal(result.value.entryOffset, 0);
  const start = result.value.processStartOffset;
  assert.ok(start !== undefined && start > 0);
  assert.ok(start < (result.value.moduleOffsets[0] ?? 0));
  assert.ok(start >= result.value.entryUnwind.byteLength);
  // Unwinders stop at _start: its return address is undefined.
  assert.equal(darwin.value.processStartUnwind, undefined);
  assert.deepEqual(result.value.processStartUnwind, {
    offset: start,
    byteLength: result.value.processStartUnwind?.byteLength ?? 0,
    rule: { kind: "outermost" },
  });
  assert.ok(
    start + (result.value.processStartUnwind?.byteLength ?? 0) <=
      (result.value.moduleOffsets[0] ?? 0),
  );
  assert.deepEqual(
    [...new Set(result.value.imports.map((i) => i.target.name))].sort(),
    ["__libc_start_main", "mmap", "mprotect", "munmap"],
  );
  const word = (offset: number): number =>
    (result.value.code[offset] ?? 0) +
    (result.value.code[offset + 1] ?? 0) * 256 +
    (result.value.code[offset + 2] ?? 0) * 65536 +
    (result.value.code[offset + 3] ?? 0) * 16777216;
  // mov x29, xzr; mov x30, xzr: the outermost frame has no caller.
  assert.equal(word(start), 0xaa1f03fd);
  assert.equal(word(start + 4), 0xaa1f03fe);
  // _start goes straight to libc: kernels of every page size (4, 16 or
  // 64 KiB) are accepted, the runtime querying the size itself.
  const calls = result.value.imports
    .filter((i) => i.offset >= start)
    .map((i) => i.target.name);
  assert.deepEqual(calls, ["__libc_start_main"]);
});
test("invalid host budgets and entry contracts fail before emission", () => {
  const input = request();
  for (const managedBytes of [0, -1, 17, 0x100000000])
    assert.equal(emitHostedEntry({ ...input, managedBytes }).ok, false);
  assert.equal(emitHostedEntry({ ...input, rootCapacity: 0 }).ok, false);
  assert.equal(
    emitHostedEntry({ ...input, program: { ...input.program, entry: 9 } }).ok,
    false,
  );
  assert.equal(
    emitHostedEntry({ ...input, runtime: { native: module([]), entry: 0 } }).ok,
    false,
  );
});

test("hosted context reserves external registration without overlapping allocator state", async () => {
  const backend = await import("@tint/codegen/aarch64/scalar");
  const { encode } = await import("@tint/codegen/aarch64/isa");
  assert.equal(backend.nativeContextBytes, 104);
  assert.equal(backend.nativeExternalMemoryOffset, 64);
  const emitted = emitHostedEntry(request());
  assert.ok(emitted.ok);
  const address = encode({
    op: "add-imm",
    width: 64,
    rd: 1,
    rn: "sp",
    immediate: 96 + 104,
    shift: 0,
    setFlags: false,
  });
  assert.ok(address.ok);
  const view = new DataView(
    emitted.value.code.buffer,
    emitted.value.code.byteOffset,
    emitted.value.code.byteLength,
  );
  let found = false;
  for (let offset = 0; offset + 4 <= view.byteLength; offset += 4)
    if (view.getUint32(offset, true) === address.value) found = true;
  assert.ok(
    found,
    "allocator environment follows the complete runtime context",
  );
});

test("standard hosted composition rejects unresolved managed modules in every image role", () => {
  for (const role of ["allocator", "runtime", "program"] as const) {
    const r = request();
    const part = r[role];
    const invalid = {
      ...r,
      [role]: {
        ...part,
        native: { ...part.native, linkage: "unresolved-managed" as const },
      },
    };
    const emitted = emitHostedEntry(invalid);
    assert.equal(emitted.ok, false);
    if (!emitted.ok) assert.match(emitted.error, /unresolved managed/);
  }
});
test("hosted entries issue a permanent, non-reusable identity mapping for each context", () => {
  const emitted = emitHostedEntry(request());
  assert.ok(emitted.ok);
  assert.equal(
    emitted.value.imports.filter((i) => i.target.name === "_mmap").length,
    4,
  );
  assert.equal(
    emitted.value.imports.filter((i) => i.target.name === "_munmap").length,
    3,
    "identity tombstones stay reserved after context cleanup",
  );
});

test("threaded hosted entry initializes a fresh context before forwarding its raw scalar", () => {
  const input = request();
  const program = module([{ kind: "float", index: 0 }]);
  const result = emitHostedEntry({
    ...input,
    program: { native: program, entry: 0 },
    threaded: true,
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.workerEntryOffset !== undefined);
  assert.ok(result.value.workerEntryOffset > 0);
  assert.ok(result.value.workerEntryOffset < result.value.moduleOffsets[0]!);
  assert.equal(emitHostedEntry({ ...input, threaded: true }).ok, false);
});

test("threaded startup refuses a target without thread lifecycle authority", () => {
  const input = request();
  const { threads: _threads, ...abi } = input.abi;
  const program = module([{ kind: "float", index: 0 }]);
  assert.equal(
    emitHostedEntry({
      ...input,
      abi,
      program: { native: program, entry: 0 },
      threaded: true,
    }).ok,
    false,
  );
});
test("host entry unwind rows follow each register save and then anchor on x19", async () => {
  const { encode } = await import("@tint/codegen/aarch64/isa");
  const result = emitHostedEntry(request());
  assert.ok(result.ok, JSON.stringify(result));
  const { entryUnwind, moduleOffsets, code } = result.value;
  assert.equal(entryUnwind.offset, 0);
  assert.ok(entryUnwind.byteLength <= (moduleOffsets[0] ?? 0));
  const rule = entryUnwind.rule;
  if (rule.kind !== "rows") throw new Error("entry unwind uses rows");
  const rows: readonly UnwindRow[] = rule.rows;
  const view = new DataView(code.buffer, code.byteOffset);
  assert.deepEqual(rows[0], {
    offset: 0,
    cfaRegister: 31,
    cfaOffset: 0,
    saves: [],
  });
  const pairs = [29, 19, 21, 23, 25, 27];
  for (let index = 0; index < pairs.length; index++) {
    const row = rows[index + 1]!;
    const first = pairs[index]!;
    const save = encode({
      op: "stp",
      width: 64,
      rt: first,
      rt2: first + 1,
      rn: "sp",
      offset: -16,
      mode: "pre",
    });
    assert.ok(save.ok);
    assert.equal(view.getUint32(row.offset - 4, true), save.value);
    assert.equal(row.cfaRegister, 31);
    assert.equal(row.cfaOffset, (index + 1) * 16);
    assert.equal(row.saves.length, (index + 1) * 2);
  }
  const anchored = rows[pairs.length + 1]!;
  assert.equal(rows.length, pairs.length + 2);
  assert.equal(anchored.cfaRegister, 19);
  assert.equal(anchored.cfaOffset, 96);
  // x29/x30 sit just below the CFA; x27/x28 are the last pair saved.
  assert.deepEqual(anchored.saves.slice(0, 2), [
    { register: 29, offset: -16 },
    { register: 30, offset: -8 },
  ]);
  assert.deepEqual(anchored.saves.slice(-2), [
    { register: 27, offset: -96 },
    { register: 28, offset: -88 },
  ]);
});
test("module unwind ranges cover functions, leaf helpers and cell helpers in order", async () => {
  const { unwindRanges } = await import("@tint/codegen/aarch64/unwind");
  const base = module([], 2);
  const native: NativeModule = {
    ...base,
    functions: [
      { ...base.functions[0]!, unwind: { kind: "frame", saves: [] } },
      { ...base.functions[1]!, import: true, byteLength: 0, offset: 0 },
    ],
    helpers: [{ kind: "memory-move", offset: 48, byteLength: 8 }],
    cellHelpers: [
      {
        access: {
          operation: "read",
          stateOffset: 0,
          valueOffset: 8,
          byteLength: 8,
          mutable: true,
        },
        offset: 32,
        byteLength: 12,
      },
    ],
  };
  assert.deepEqual(unwindRanges(native, 4096), [
    { offset: 4096, byteLength: 16, rule: { kind: "frame", saves: [] } },
    { offset: 4128, byteLength: 12, rule: { kind: "leaf" } },
    { offset: 4144, byteLength: 8, rule: { kind: "leaf" } },
  ]);
  assert.throws(() => unwindRanges(base, 0), /unwind rule invariant/);
});

test("forced far startup reserves full-width import windows", () => {
  const result = emitHostedEntry({ ...request(), forceFarReach: true });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.imports.length > 0);
  assert.ok(result.value.imports.every((reference) => reference.far === true));
});
