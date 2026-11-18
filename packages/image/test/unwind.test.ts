import test from "node:test";
import assert from "node:assert/strict";
import type { UnwindRange } from "@tint/abi/unwind";
import { buildEhFrame, type CallFrameTarget } from "@tint/image/eh-frame";
import { buildAArch64Executable } from "../../../tools/aarch64-executable.ts";

const arm64: CallFrameTarget = {
  stackPointer: 31,
  framePointer: 29,
  returnAddress: 30,
  dataAlignment: 8,
};

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Minimal `.eh_frame` reader: each entry's offset, kind, pc range (resolved
 * against `sectionAddress`) and instruction bytes. */
function readEhFrame(bytes: Uint8Array, sectionAddress: number) {
  const v = view(bytes),
    entries: {
      offset: number;
      cie: boolean;
      begin: number;
      length: number;
      instructions: number[];
    }[] = [];
  let at = 0;
  while (at < bytes.length) {
    const length = v.getUint32(at, true);
    assert.equal((length + 4) % 8, 0, "entries span whole words");
    const id = v.getUint32(at + 4, true);
    if (id === 0) {
      entries.push({
        offset: at,
        cie: true,
        begin: 0,
        length: 0,
        instructions: [],
      });
    } else {
      assert.equal(at + 4 - id, 0, "FDE points back to the CIE");
      const begin = sectionAddress + at + 8 + v.getInt32(at + 8, true);
      const range = v.getUint32(at + 12, true);
      assert.equal(bytes[at + 16], 0, "no augmentation data");
      const instructions = [...bytes.subarray(at + 17, at + 4 + length)];
      while (instructions.at(-1) === 0) instructions.pop();
      entries.push({
        offset: at,
        cie: false,
        begin,
        length: range,
        instructions,
      });
    }
    at += 4 + length;
  }
  assert.equal(at, bytes.length);
  return entries;
}

test("eh_frame encodes a zR CIE and pc-relative FDEs for frames and rows", () => {
  const sectionAddress = 0x10000;
  const frame = buildEhFrame(
    [
      {
        address: 0x1000,
        byteLength: 64,
        rule: {
          kind: "frame",
          saves: [
            { register: 72, offset: -40 },
            { register: 73, offset: -32 },
          ],
        },
      },
      {
        address: 0x2000,
        byteLength: 300,
        rule: {
          kind: "rows",
          rows: [
            { offset: 0, cfaRegister: 31, cfaOffset: 0, saves: [] },
            {
              offset: 4,
              cfaRegister: 31,
              cfaOffset: 16,
              saves: [
                { register: 29, offset: -16 },
                { register: 30, offset: -8 },
              ],
            },
            {
              offset: 200,
              cfaRegister: 19,
              cfaOffset: 16,
              saves: [
                { register: 29, offset: -16 },
                { register: 30, offset: -8 },
              ],
            },
          ],
        },
      },
    ],
    sectionAddress,
    arm64,
  );
  assert.deepEqual(
    [...frame.bytes.subarray(8, 24)],
    // version 1, "zR", code align 1, data align -8, RA x30, aug "R"=pcrel|sdata4,
    // DW_CFA_def_cfa sp, 0, then padding.
    [1, 0x7a, 0x52, 0, 1, 0x78, 30, 1, 0x1b, 0x0c, 31, 0, 0, 0, 0, 0],
  );
  const entries = readEhFrame(frame.bytes, sectionAddress);
  assert.deepEqual(
    entries.map((entry) => entry.offset),
    [0, ...frame.offsets],
  );
  const [, body, rows] = entries;
  assert.ok(body !== undefined && rows !== undefined);
  assert.equal(body.begin, 0x1000);
  assert.equal(body.length, 64);
  assert.deepEqual(body.instructions, [
    0x0c,
    29,
    16, // def_cfa x29, 16
    0x80 + 29,
    2, // x29 at cfa-16
    0x80 + 30,
    1, // x30 at cfa-8
    0x05,
    72,
    5, // d8 at cfa-40 (offset_extended: register >= 64)
    0x05,
    73,
    4, // d9 at cfa-32
  ]);
  assert.equal(rows.begin, 0x2000);
  assert.equal(rows.length, 300);
  assert.deepEqual(rows.instructions, [
    0x0c,
    31,
    0, // def_cfa sp, 0
    0x40 + 4, // advance 4
    0x0c,
    31,
    16, // def_cfa sp, 16
    0x80 + 29,
    2,
    0x80 + 30,
    1,
    0x02,
    196, // advance_loc1 196 (to offset 200)
    0x0c,
    19,
    16, // def_cfa x19, 16; saves unchanged
  ]);
});

test("the outermost frame leaves its return address undefined", () => {
  const frame = buildEhFrame(
    [{ address: 0x1000, byteLength: 32, rule: { kind: "outermost" } }],
    0x10000,
    arm64,
  );
  const [, outermost] = readEhFrame(frame.bytes, 0x10000);
  assert.ok(outermost !== undefined);
  assert.equal(outermost.begin, 0x1000);
  assert.deepEqual(outermost.instructions, [
    0x0c,
    31,
    0, // def_cfa sp, 0
    0x07,
    30, // DW_CFA_undefined x30: the chain ends here
  ]);
});

test("eh_frame rejects saves that are not word-aligned or rows out of order", () => {
  assert.throws(() =>
    buildEhFrame(
      [
        {
          address: 0,
          byteLength: 8,
          rule: { kind: "frame", saves: [{ register: 72, offset: -36 }] },
        },
      ],
      0,
      arm64,
    ),
  );
  assert.throws(() =>
    buildEhFrame(
      [
        {
          address: 0,
          byteLength: 8,
          rule: {
            kind: "rows",
            rows: [{ offset: 4, cfaRegister: 31, cfaOffset: 0, saves: [] }],
          },
        },
      ],
      0,
      arm64,
    ),
  );
});

function code(words: number): Uint8Array {
  const bytes = new Uint8Array(words * 4);
  for (let i = 0; i < words; i++)
    view(bytes).setUint32(i * 4, 0xd65f03c0, true);
  return bytes;
}

function request(unwind: readonly UnwindRange[], words = 64) {
  return {
    code: code(words),
    entryOffset: 0,
    identifier: "tint.test",
    minimumOS: { major: 26, minor: 6, patch: 2 },
    sdk: { major: 26, minor: 6, patch: 0 },
    maxByteLength: 16 * 1024 * 1024,
    unwind,
  };
}

/** Locate a `__TEXT` section of a built image by name. */
function textSection(bytes: Uint8Array, name: string) {
  const v = view(bytes);
  let at = 32;
  for (let i = 0; i < v.getUint32(16, true); i++) {
    const cmd = v.getUint32(at, true);
    const segment = new TextDecoder()
      .decode(bytes.subarray(at + 8, at + 24))
      .split("\0")[0];
    if (cmd === 0x19 && segment === "__TEXT") {
      for (let s = 0; s < v.getUint32(at + 64, true); s++) {
        const header = at + 72 + s * 80;
        const sectionName = new TextDecoder()
          .decode(bytes.subarray(header, header + 16))
          .split("\0")[0];
        if (sectionName === name) {
          const address = Number(
            v.getBigUint64(header + 32, true) - 0x100000000n,
          );
          const size = Number(v.getBigUint64(header + 40, true));
          assert.equal(
            v.getUint32(header + 48, true),
            address,
            "file offset = address",
          );
          return {
            address,
            size,
            bytes: bytes.subarray(address, address + size),
          };
        }
      }
    }
    at += v.getUint32(at + 4, true);
  }
  return undefined;
}

/** Decode `__unwind_info` into (function offset, encoding) entries. */
function readUnwindInfo(section: Uint8Array): [number, number][] {
  const v = view(section);
  assert.equal(v.getUint32(0, true), 1);
  const commonOffset = v.getUint32(4, true),
    commonCount = v.getUint32(8, true),
    indexOffset = v.getUint32(20, true),
    indexCount = v.getUint32(24, true);
  const common = Array.from({ length: commonCount }, (_, i) =>
    v.getUint32(commonOffset + i * 4, true),
  );
  const entries: [number, number][] = [];
  for (let i = 0; i < indexCount; i++) {
    const start = v.getUint32(indexOffset + i * 12, true),
      page = v.getUint32(indexOffset + i * 12 + 4, true);
    if (i === indexCount - 1) {
      assert.equal(page, 0);
      entries.push([start, -1]);
      break;
    }
    assert.equal(v.getUint32(page, true), 3, "compressed page");
    const entryOffset = v.getUint16(page + 4, true),
      count = v.getUint16(page + 6, true),
      localOffset = v.getUint16(page + 8, true);
    assert.ok(entryOffset + (count + v.getUint16(page + 10, true)) * 4 <= 4096);
    for (let e = 0; e < count; e++) {
      const word = v.getUint32(page + entryOffset + e * 4, true);
      const index = word >>> 24;
      const encoding =
        index < commonCount
          ? (common[index] ?? -1)
          : v.getUint32(page + localOffset + (index - commonCount) * 4, true);
      entries.push([start + (word & 0xffffff), encoding]);
    }
  }
  return entries;
}

test("Mach-O images carry compact unwind with DWARF fallbacks in __TEXT", () => {
  const unwind: UnwindRange[] = [
    { offset: 0, byteLength: 16, rule: { kind: "frame", saves: [] } },
    { offset: 16, byteLength: 16, rule: { kind: "frame", saves: [] } },
    { offset: 32, byteLength: 8, rule: { kind: "leaf" } },
    {
      offset: 40,
      byteLength: 24,
      rule: { kind: "frame", saves: [{ register: 72, offset: -24 }] },
    },
    // 64..96 has no unwind information (literal data).
    { offset: 96, byteLength: 32, rule: { kind: "leaf" } },
  ];
  const built = buildAArch64Executable(request(unwind));
  assert.ok(built.ok);
  const { bytes, codeFileOffset } = built.value;
  const frames = textSection(bytes, "__eh_frame"),
    info = textSection(bytes, "__unwind_info");
  assert.ok(frames !== undefined && info !== undefined);
  assert.ok(frames.address >= codeFileOffset + 256);
  assert.ok(info.address >= frames.address + frames.size);
  const at = (offset: number) => codeFileOffset + offset;
  const entries = readUnwindInfo(info.bytes);
  const dwarf = entries[2]?.[1] ?? 0;
  assert.deepEqual(entries, [
    [at(0), 0x04000000], // two frames folded into one entry
    [at(32), 0x02000000],
    [at(40), dwarf],
    [at(64), 0], // gap
    [at(96), 0x02000000],
    [at(128), -1], // sentinel: end of described code
  ]);
  assert.equal(dwarf >>> 24, 0x03, "DWARF mode");
  const fdes = readEhFrame(frames.bytes, frames.address);
  const fde = fdes.find((entry) => entry.offset === (dwarf & 0xffffff));
  assert.ok(fde !== undefined && !fde.cie);
  assert.equal(fde.begin, at(40));
  assert.equal(fde.length, 24);
});

test("compact unwind splits pages by size and local encodings", () => {
  // 600 frames with distinct FP saves: each needs its own DWARF encoding.
  const unwind: UnwindRange[] = [];
  for (let i = 0; i < 600; i++)
    unwind.push({
      offset: i * 8,
      byteLength: 4,
      rule:
        i % 2 === 0
          ? { kind: "leaf" }
          : { kind: "frame", saves: [{ register: 72, offset: -24 }] },
    });
  const built = buildAArch64Executable(request(unwind, 1200));
  assert.ok(built.ok);
  const info = textSection(built.value.bytes, "__unwind_info");
  assert.ok(info !== undefined);
  const entries = readUnwindInfo(info.bytes),
    base = built.value.codeFileOffset;
  // Each range but the last is followed by a 4-byte gap without unwind
  // information; the sentinel ends the last range.
  assert.equal(entries.length, 1200);
  for (let i = 0; i < 600; i++) {
    const [start, encoding] = entries[i * 2] ?? [0, 0];
    assert.equal(start, base + i * 8);
    if (i % 2 === 0) assert.equal(encoding, 0x02000000);
    else assert.equal(encoding >>> 24, 0x03);
    assert.deepEqual(entries[i * 2 + 1], [base + i * 8 + 4, i < 599 ? 0 : -1]);
  }
});

test("Mach-O rejects unwind ranges outside the code or out of order", () => {
  for (const unwind of [
    [{ offset: 0, byteLength: 300, rule: { kind: "leaf" } }],
    [{ offset: 2, byteLength: 4, rule: { kind: "leaf" } }],
    [
      { offset: 8, byteLength: 8, rule: { kind: "leaf" } },
      { offset: 4, byteLength: 4, rule: { kind: "leaf" } },
    ],
  ] satisfies UnwindRange[][]) {
    const built = buildAArch64Executable(request(unwind));
    assert.deepEqual(built, { ok: false, error: "INVALID_UNWIND" });
  }
});

test("eh_frame uses signed 64-bit fields when a displacement exceeds sdata4", () => {
  const address = 0x140000000;
  const frame = buildEhFrame(
    [{ address: 0x1000, byteLength: 8, rule: { kind: "leaf" } }],
    address,
    arm64,
  );
  const fde = frame.offsets[0]!;
  assert.equal(frame.bytes[16], 0x1c);
  assert.equal(
    address + fde + 8 + Number(view(frame.bytes).getBigInt64(fde + 8, true)),
    0x1000,
  );
  assert.equal(view(frame.bytes).getBigInt64(fde + 16, true), 8n);
});
