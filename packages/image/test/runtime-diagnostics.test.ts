import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTraceTable,
  lookupTraceTable,
  traceTableMagic,
} from "../src/trace-table.ts";
import { buildJitObject } from "../src/darwin/macho/jit-object.ts";
import { buildExecutable } from "../src/darwin/macho/index.ts";

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function text(bytes: Uint8Array, offset: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[offset + i] ?? 0;
    if (byte === 0) break;
    result += String.fromCharCode(byte);
  }
  return result;
}

test("trace tables sort, drop overlaps and resolve the containing ranges", () => {
  const table = buildTraceTable(
    [
      { name: "outer", offset: 64, byteLength: 32 },
      { name: "inner", offset: 0, byteLength: 64 },
      { name: "shadowed", offset: 80, byteLength: 8 },
      { name: "empty", offset: 200, byteLength: 0 },
    ],
    [
      { offset: 68, byteLength: 4, file: "b.ts", line: 9, column: 3 },
      { offset: 4, byteLength: 8, file: "a.ts", line: 2, column: 1 },
      { offset: 6, byteLength: 8, file: "a.ts", line: 99, column: 1 },
    ],
    65536,
  );
  assert.ok(table.ok);
  const bytes = table.value,
    v = view(bytes);
  assert.equal(v.getUint32(0, true), traceTableMagic);
  assert.equal(v.getUint32(8, true), 2, "overlapping function dropped");
  assert.equal(v.getUint32(12, true), 2, "overlapping line dropped");
  assert.equal(v.getUint32(16, true), 2);
  assert.equal(bytes.length % 4, 0);
  assert.deepEqual(lookupTraceTable(bytes, 8), {
    name: "inner",
    file: "a.ts",
    line: 2,
    column: 1,
  });
  assert.deepEqual(lookupTraceTable(bytes, 70), {
    name: "outer",
    file: "b.ts",
    line: 9,
    column: 3,
  });
  // Mapped function, unmapped instruction: the name only.
  assert.deepEqual(lookupTraceTable(bytes, 90), {
    name: "outer",
    file: undefined,
    line: 0,
    column: 0,
  });
  assert.deepEqual(lookupTraceTable(bytes, 96), {
    name: undefined,
    file: undefined,
    line: 0,
    column: 0,
  });
  assert.deepEqual(buildTraceTable([], [], 8), {
    ok: false,
    error: "SIZE_LIMIT",
  });
  assert.deepEqual(
    buildTraceTable([{ name: "x", offset: -4, byteLength: 4 }], [], 1024),
    { ok: false, error: "INVALID_RANGE" },
  );
});

const code = new Uint8Array([
  0x1f, 0x20, 0x03, 0xd5, 0x1f, 0x20, 0x03, 0xd5, 0xc0, 0x03, 0x5f, 0xd6, 0, 0,
  0, 0,
]);
function executable(
  extra: Partial<Parameters<typeof buildExecutable>[0]>,
): ReturnType<typeof buildExecutable> {
  return buildExecutable({
    code,
    entryOffset: 0,
    identifier: "tint.diagnostics.test",
    minimumOS: { major: 14, minor: 0, patch: 0 },
    sdk: { major: 15, minor: 0, patch: 0 },
    maxByteLength: 1 << 24,
    imports: ["_write"],
    ...extra,
  });
}
function sections(bytes: Uint8Array): {
  name: string;
  segment: string;
  address: number;
  size: number;
  flags: number;
}[] {
  const v = view(bytes),
    result: {
      name: string;
      segment: string;
      address: number;
      size: number;
      flags: number;
    }[] = [];
  let offset = 32;
  for (let i = 0; i < v.getUint32(16, true); i++) {
    const cmd = v.getUint32(offset, true),
      size = v.getUint32(offset + 4, true);
    if (cmd === 0x19)
      for (let s = 0; s < v.getUint32(offset + 64, true); s++) {
        const at = offset + 72 + s * 80;
        result.push({
          name: text(bytes, at, 16),
          segment: text(bytes, at + 16, 16),
          address: Number(v.getBigUint64(at + 32, true)),
          size: Number(v.getBigUint64(at + 40, true)),
          flags: v.getUint32(at + 64, true),
        });
      }
    offset += size;
  }
  return result;
}
function symbols(
  bytes: Uint8Array,
): { name: string; section: number; value: number }[] {
  const v = view(bytes);
  let offset = 32;
  for (let i = 0; i < v.getUint32(16, true); i++) {
    const cmd = v.getUint32(offset, true);
    if (cmd === 2) {
      const symoff = v.getUint32(offset + 8, true),
        count = v.getUint32(offset + 12, true),
        stroff = v.getUint32(offset + 16, true),
        result: { name: string; section: number; value: number }[] = [];
      for (let s = 0; s < count; s++) {
        const at = symoff + s * 16;
        result.push({
          name: text(bytes, stroff + v.getUint32(at, true), 256),
          section: bytes[at + 5] ?? 0,
          value: Number(v.getBigUint64(at + 8, true)),
        });
      }
      return result;
    }
    offset += v.getUint32(offset + 4, true);
  }
  return [];
}

test("executables carve C-string and constant tail sections and name data words", () => {
  const plain = executable({});
  assert.ok(plain.ok);
  assert.deepEqual(
    sections(plain.value.bytes).map((s) => s.name),
    ["__text", "__data"],
  );
  const built = executable({
    readOnlySections: [
      { kind: "cstring", offset: 12, byteLength: 2 },
      { kind: "rodata", offset: 14, byteLength: 2 },
    ],
    data: new Uint8Array(32),
    dataSymbols: [{ name: "___jit_debug_descriptor", offset: 8 }],
    symbols: [{ name: "___jit_debug_register_code", offset: 4 }],
  });
  assert.ok(built.ok, JSON.stringify(built));
  const list = sections(built.value.bytes),
    text0 = list.find((s) => s.name === "__text"),
    cstring = list.find((s) => s.name === "__cstring"),
    constant = list.find((s) => s.name === "__const"),
    data = list.find((s) => s.name === "__data");
  assert.ok(text0 && cstring && constant && data);
  assert.equal(text0.size, 12);
  assert.equal(cstring.address, text0.address + 12);
  assert.equal(cstring.flags, 2);
  assert.equal(constant.address, text0.address + 14);
  assert.deepEqual(
    list.map((s) => s.name),
    ["__text", "__cstring", "__const", "__data"],
  );
  const named = symbols(built.value.bytes);
  assert.deepEqual(named[0], {
    name: "___jit_debug_register_code",
    section: 1,
    value: text0.address + 4,
  });
  assert.equal(named[1]?.name, "___jit_debug_descriptor");
  assert.equal(named[1]?.section, 4, "__data is the fourth section");
  assert.equal(
    named[1]?.value,
    0x100000000 + (built.value.dataFileOffset ?? 0) + 8,
  );
  // Tail sections must be contiguous, nonempty and end with the code.
  assert.deepEqual(
    executable({
      readOnlySections: [{ kind: "cstring", offset: 12, byteLength: 2 }],
    }),
    { ok: false, error: "INVALID_CODE" },
  );
  assert.deepEqual(
    executable({
      readOnlySections: [{ kind: "cstring", offset: 0, byteLength: 16 }],
    }),
    { ok: false, error: "INVALID_CODE" },
  );
  assert.deepEqual(
    executable({
      data: new Uint8Array(8),
      dataSymbols: [{ name: "x", offset: 8 }],
    }),
    { ok: false, error: "INVALID_SYMBOL" },
  );
});

test("JIT objects place code at its live address with symbols and optional DWARF", () => {
  const address = 0x10d834000;
  const withLines = buildJitObject({
    address,
    code: code.subarray(0, 12),
    functions: [{ name: "jit:sum", offset: 0, byteLength: 12 }],
    lines: [{ offset: 4, byteLength: 4, file: "jit.ts", line: 3, column: 5 }],
    directory: "/",
    maxByteLength: 1 << 20,
  });
  assert.ok(withLines.ok);
  const bytes = withLines.value,
    v = view(bytes);
  assert.equal(v.getUint32(0, true), 0xfeedfacf);
  assert.equal(v.getUint32(12, true), 1, "MH_OBJECT");
  const list = sections(bytes);
  assert.deepEqual(
    list.map((s) => s.segment + "," + s.name),
    [
      "__TEXT,__text",
      "__DWARF,__debug_abbrev",
      "__DWARF,__debug_info",
      "__DWARF,__debug_line",
    ],
  );
  assert.equal(list[0]?.address, address);
  assert.equal(list[1]?.address, 0, "debug sections are read in place");
  assert.deepEqual(symbols(bytes), [
    { name: "jit:sum", section: 1, value: address },
  ]);
  const withoutLines = buildJitObject({
    address,
    code: code.subarray(0, 12),
    functions: [{ name: "jit:sum", offset: 0, byteLength: 12 }],
    lines: [],
    directory: "/",
    maxByteLength: 1 << 20,
  });
  assert.ok(withoutLines.ok);
  assert.deepEqual(
    sections(withoutLines.value).map((s) => s.name),
    ["__text"],
  );
  assert.deepEqual(
    buildJitObject({
      address: address + 2,
      code,
      functions: [],
      lines: [],
      directory: "/",
      maxByteLength: 1 << 20,
    }),
    { ok: false, error: "INVALID_INPUT" },
  );
  assert.deepEqual(
    buildJitObject({
      address,
      code,
      functions: [{ name: "x", offset: 0, byteLength: 4 }],
      lines: [],
      directory: "/",
      maxByteLength: 64,
    }),
    { ok: false, error: "SIZE_LIMIT" },
  );
});

test("trace tables preserve ranges above 4 GiB", () => {
  const offset = 0x100001000;
  const table = buildTraceTable(
    [{ name: "far", offset, byteLength: 8 }],
    [{ file: "far.ts", line: 7, column: 3, offset, byteLength: 8 }],
    4096,
  );
  assert.ok(table.ok);
  assert.deepEqual(lookupTraceTable(table.value, offset + 4), {
    name: "far",
    file: "far.ts",
    line: 7,
    column: 3,
  });
  assert.equal(lookupTraceTable(table.value, 4096)?.name, undefined);
  assert.equal(lookupTraceTable(table.value, offset + 8)?.name, undefined);
});
