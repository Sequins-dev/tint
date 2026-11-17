import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildElfJitObject } from "@tint/image/linux/elf/jit-object";

// nop; nop; ret
const code = new Uint8Array([
  0x1f, 0x20, 0x03, 0xd5, 0x1f, 0x20, 0x03, 0xd5, 0xc0, 0x03, 0x5f, 0xd6,
]);
const address = 0xffff8a3c4000;

interface Section {
  readonly name: string;
  readonly type: number;
  readonly flags: number;
  readonly address: number;
  readonly offset: number;
  readonly size: number;
  readonly link: number;
  readonly info: number;
  readonly entrySize: number;
}
function cString(bytes: Uint8Array, at: number): string {
  let end = at;
  while (bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(at, end));
}
function sections(bytes: Uint8Array): Section[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = Number(v.getBigUint64(40, true)),
    count = v.getUint16(60, true),
    names = v.getUint16(62, true);
  const raw = [];
  for (let index = 0; index < count; index++) {
    const o = at + index * 64;
    raw.push({
      nameOffset: v.getUint32(o, true),
      type: v.getUint32(o + 4, true),
      flags: Number(v.getBigUint64(o + 8, true)),
      address: Number(v.getBigUint64(o + 16, true)),
      offset: Number(v.getBigUint64(o + 24, true)),
      size: Number(v.getBigUint64(o + 32, true)),
      link: v.getUint32(o + 40, true),
      info: v.getUint32(o + 44, true),
      entrySize: Number(v.getBigUint64(o + 56, true)),
    });
  }
  const table = raw[names];
  assert.ok(table);
  return raw.map(({ nameOffset, ...rest }) => ({
    name: cString(bytes, table.offset + nameOffset),
    ...rest,
  }));
}

test("ELF JIT objects are relocated in place: live .text, relative symbols, absolute DWARF", () => {
  const built = buildElfJitObject({
    address,
    code,
    functions: [
      { name: "jit:first", offset: 0, byteLength: 4 },
      { name: "jit:second", offset: 4, byteLength: 8 },
    ],
    lines: [{ offset: 4, byteLength: 4, file: "jit.ts", line: 3, column: 5 }],
    directory: "/",
    maxByteLength: 1 << 20,
  });
  assert.ok(built.ok);
  const bytes = built.value,
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.deepEqual(
    Array.from(bytes.subarray(0, 7)),
    [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1],
  );
  assert.equal(v.getUint16(16, true), 1, "ET_REL");
  assert.equal(v.getUint16(18, true), 183, "EM_AARCH64");
  assert.equal(v.getUint16(56, true), 0, "no program headers");
  const list = sections(bytes);
  assert.deepEqual(
    list.map((s) => s.name),
    [
      "",
      ".text",
      ".debug_abbrev",
      ".debug_info",
      ".debug_line",
      ".symtab",
      ".strtab",
      ".shstrtab",
    ],
  );
  const text = list[1],
    symtab = list[5],
    strtab = list[6];
  assert.ok(text && symtab && strtab);
  assert.equal(text.address, address);
  assert.equal(text.flags, 6, "SHF_ALLOC | SHF_EXECINSTR");
  assert.deepEqual(
    Array.from(bytes.subarray(text.offset, text.offset + text.size)),
    Array.from(code),
  );
  for (const debug of list.slice(2, 5)) assert.equal(debug.address, 0);
  assert.equal(symtab.link, 6);
  assert.equal(
    symtab.info,
    2,
    "first global after the null and section symbols",
  );
  assert.equal(symtab.entrySize, 24);
  const symbols = [];
  for (let index = 0; index < symtab.size / 24; index++) {
    const o = symtab.offset + index * 24;
    symbols.push({
      name: cString(bytes, strtab.offset + v.getUint32(o, true)),
      info: bytes[o + 4],
      section: v.getUint16(o + 6, true),
      value: Number(v.getBigUint64(o + 8, true)),
      size: Number(v.getBigUint64(o + 16, true)),
    });
  }
  assert.deepEqual(symbols, [
    { name: "", info: 0, section: 0, value: 0, size: 0 },
    { name: "", info: 3, section: 1, value: 0, size: 0 },
    { name: "jit:first", info: 0x12, section: 1, value: 0, size: 4 },
    { name: "jit:second", info: 0x12, section: 1, value: 4, size: 8 },
  ]);
  // DW_AT_low_pc of the compilation unit is the live address.
  const info = list[3];
  assert.ok(info);
  const infoBytes = bytes.subarray(info.offset, info.offset + info.size);
  const low = new DataView(infoBytes.buffer, infoBytes.byteOffset);
  let found = false;
  for (let at = 0; at + 8 <= infoBytes.length; at++)
    if (low.getBigUint64(at, true) === BigInt(address)) found = true;
  assert.ok(found, "DWARF carries absolute addresses");

  const withoutLines = buildElfJitObject({
    address,
    code,
    functions: [{ name: "jit:first", offset: 0, byteLength: 12 }],
    lines: [],
    directory: "/",
    maxByteLength: 1 << 20,
  });
  assert.ok(withoutLines.ok);
  assert.deepEqual(
    sections(withoutLines.value).map((s) => s.name),
    ["", ".text", ".symtab", ".strtab", ".shstrtab"],
  );
  assert.equal(sections(withoutLines.value)[2]?.link, 3);
});

test("ELF JIT objects reject invalid input and honour the size limit", () => {
  const request = {
    address,
    code,
    functions: [{ name: "jit:first", offset: 0, byteLength: 12 }],
    lines: [],
    directory: "/",
    maxByteLength: 1 << 20,
  };
  for (const invalid of [
    { ...request, address: address + 2 },
    { ...request, address: 0 },
    { ...request, code: new Uint8Array(0) },
    { ...request, functions: [{ name: "", offset: 0, byteLength: 4 }] },
    { ...request, functions: [{ name: "a\0b", offset: 0, byteLength: 4 }] },
    { ...request, functions: [{ name: "x", offset: 12, byteLength: 4 }] },
  ])
    assert.deepEqual(buildElfJitObject(invalid), {
      ok: false,
      error: "INVALID_INPUT",
    });
  const size = buildElfJitObject(request);
  assert.ok(size.ok);
  assert.ok(
    buildElfJitObject({ ...request, maxByteLength: size.value.length }).ok,
  );
  assert.deepEqual(
    buildElfJitObject({ ...request, maxByteLength: size.value.length - 1 }),
    { ok: false, error: "SIZE_LIMIT" },
  );
});

const readelf = ["llvm-readelf", "readelf"].find(
  (candidate) =>
    spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0,
);
test(
  "a system ELF reader accepts the JIT object",
  { skip: readelf === undefined ? "no readelf on this host" : false },
  () => {
    const built = buildElfJitObject({
      address,
      code,
      functions: [{ name: "jit:first", offset: 0, byteLength: 12 }],
      lines: [{ offset: 0, byteLength: 4, file: "jit.ts", line: 1, column: 1 }],
      directory: "/",
      maxByteLength: 1 << 20,
    });
    assert.ok(built.ok);
    const directory = mkdtempSync(join(tmpdir(), "tint-elf-jit-"));
    try {
      const path = join(directory, "jit.o");
      writeFileSync(path, built.value);
      const result = spawnSync(
        readelf ?? "readelf",
        ["--wide", "--file-header", "--sections", "--symbols", path],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /REL \(Relocatable file\)/);
      assert.match(result.stdout, /\.text\s+PROGBITS\s+0*ffff8a3c4000/);
      assert.match(result.stdout, /FUNC\s+GLOBAL\s+DEFAULT\s+1 jit:first/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
