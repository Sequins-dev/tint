import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDebugInfo } from "@tint/image/dwarf";
import {
  buildElfExecutable,
  type ElfExecutableRequest,
} from "@tint/image/linux/elf";
import { elfHash, sysvHashTable } from "../src/linux/elf/sysv-hash.ts";
import { buildEhFrameHeader } from "../src/linux/elf/eh-frame-header.ts";
import {
  ABSENT_SYMBOL,
  helloRequest,
  MAIN_OFFSET,
} from "./support/elf-hello.ts";
import {
  cString,
  readElf,
  type ElfFile,
  type ElfSegment,
} from "./support/elf-read.ts";

const PT_LOAD = 1,
  PT_DYNAMIC = 2,
  PT_INTERP = 3,
  PT_NOTE = 4,
  PT_PHDR = 6,
  PT_GNU_EH_FRAME = 0x6474e550,
  PT_GNU_STACK = 0x6474e551,
  PT_GNU_RELRO = 0x6474e552;

function build(request: ElfExecutableRequest): Uint8Array {
  const result = buildElfExecutable(request);
  if (!result.ok) throw new Error(result.error);
  return result.value.bytes;
}
function minimal(): ElfExecutableRequest {
  // mov w0, #42; ret
  return {
    code: new Uint8Array([0x40, 5, 0x80, 0x52, 0xc0, 3, 0x5f, 0xd6]),
    entryOffset: 0,
    maxByteLength: 1 << 20,
  };
}
function dynamicValue(elf: ElfFile, tag: number): number[] {
  return elf
    .dynamic()
    .filter(([t]) => t === tag)
    .map(([, value]) => value);
}

test("writes an AArch64 PIE header with 64 KiB-aligned load segments", () => {
  const request = helloRequest();
  const result = buildElfExecutable(request);
  assert.ok(result.ok);
  const bytes = result.value.bytes,
    elf = readElf(bytes);
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0],
  );
  assert.equal(elf.type, 3); // ET_DYN
  assert.equal(elf.machine, 183); // EM_AARCH64
  assert.equal(result.value.codeFileOffset % 4096, 0);
  assert.equal(elf.entry, result.value.codeFileOffset + request.entryOffset);
  assert.equal(elf.sections[elf.sectionNameIndex]?.name, ".shstrtab");
  assert.deepEqual(
    elf.segments.map((s) => s.type),
    [
      PT_PHDR,
      PT_INTERP,
      PT_LOAD,
      PT_LOAD,
      PT_DYNAMIC,
      PT_GNU_RELRO,
      PT_NOTE,
      PT_GNU_EH_FRAME,
      PT_GNU_STACK,
    ],
  );
  const [phdr, interp, text, writable, dynamic, relro, note, ehFrame, stack] =
    elf.segments;
  assert.ok(phdr && interp && text && writable && dynamic && relro);
  assert.ok(note && ehFrame && stack);
  assert.deepEqual([phdr.offset, phdr.fileSize], [64, 9 * 56]);
  assert.equal(cString(bytes, interp.offset), "/lib/ld-linux-aarch64.so.1");
  assert.deepEqual(
    [text.flags, text.offset, text.address, text.alignment],
    [5, 0, 0, 65536],
  );
  assert.deepEqual([writable.flags, writable.alignment], [6, 65536]);
  // No file padding between segments; addresses stay congruent to offsets
  // modulo the largest page and never share a 64 KiB page with text.
  assert.ok(writable.offset - text.fileSize < 16);
  assert.equal(writable.address % 65536, writable.offset % 65536);
  assert.ok(writable.address >= Math.ceil(text.fileSize / 65536) * 65536);
  assert.equal(writable.fileSize, writable.memorySize);
  const dynamicSection = elf.section(".dynamic"),
    got = elf.section(".got");
  assert.deepEqual(
    [dynamic.offset, dynamic.address, dynamic.fileSize],
    [dynamicSection.offset, dynamicSection.address, dynamicSection.size],
  );
  assert.equal(relro.address, writable.address);
  assert.equal(relro.address + relro.memorySize, got.address + got.size);
  assert.equal(note.offset, elf.section(".note.gnu.build-id").offset);
  assert.equal(ehFrame.address, elf.section(".eh_frame_hdr").address);
  assert.deepEqual([stack.flags, stack.memorySize], [6, 0]);
  // Every allocated section lies in a load segment at a consistent address.
  for (const section of elf.sections.filter((s) => (s.flags & 2) !== 0)) {
    const segment: ElfSegment | undefined = [text, writable].find(
      (s: ElfSegment) =>
        section.offset >= s.offset &&
        section.offset + section.size <= s.offset + s.fileSize,
    );
    assert.ok(segment, section.name);
    assert.equal(
      section.address - segment.address,
      section.offset - segment.offset,
      section.name,
    );
    assert.equal(section.address % section.alignment, 0, section.name);
  }
  for (const section of elf.sections.filter(
    (s) => s.index > 0 && (s.flags & 2) === 0,
  ))
    assert.equal(section.address, 0, section.name);
});

test("lays out code, tail sections and data as requested", () => {
  const request = helloRequest(),
    result = buildElfExecutable(request);
  assert.ok(result.ok);
  const elf = readElf(result.value.bytes),
    tail = request.textSections![0]!;
  const text = elf.section(".text"),
    cstring = elf.section(".rodata.str1.1"),
    data = elf.section(".data");
  assert.deepEqual(
    [text.address, text.offset, text.size, text.flags],
    [result.value.codeFileOffset, result.value.codeFileOffset, tail.offset, 6],
  );
  assert.deepEqual(
    [cstring.address, cstring.size, cstring.flags, cstring.entrySize],
    [result.value.codeFileOffset + tail.offset, tail.byteLength, 0x32, 1],
  );
  assert.deepEqual(
    [...elf.contents(cstring)],
    [...request.code.subarray(tail.offset)],
  );
  assert.deepEqual([...elf.contents(data)], [...request.data!]);
  assert.equal(data.address, result.value.dataAddress);
  assert.equal(data.offset, result.value.dataFileOffset);
  assert.equal(data.address % 16, 0);
});

test("imports bind through GOT slots with GLOB_DAT relocations", () => {
  const request: ElfExecutableRequest = {
    ...helloRequest(),
    linux: {
      needed: ["libm.so.6", "libtint-test.so.1"],
      weakImports: [ABSENT_SYMBOL],
    },
  };
  const result = buildElfExecutable(request);
  assert.ok(result.ok);
  const elf = readElf(result.value.bytes),
    imports = request.imports!;
  const dynstr = elf.section(".dynstr"),
    dynsym = elf.section(".dynsym"),
    rela = elf.section(".rela.dyn"),
    got = elf.section(".got");
  assert.deepEqual(
    dynamicValue(elf, 1).map((o) => cString(elf.contents(dynstr), o)),
    ["libc.so.6", "libm.so.6", "libtint-test.so.1"],
  );
  assert.deepEqual(dynamicValue(elf, 4), [elf.section(".hash").address]);
  assert.deepEqual(dynamicValue(elf, 5), [dynstr.address]);
  assert.deepEqual(dynamicValue(elf, 6), [dynsym.address]);
  assert.deepEqual(dynamicValue(elf, 10), [dynstr.size]);
  assert.deepEqual(dynamicValue(elf, 11), [24]);
  assert.deepEqual(dynamicValue(elf, 7), [rela.address]);
  assert.deepEqual(dynamicValue(elf, 8), [imports.length * 24]);
  assert.deepEqual(dynamicValue(elf, 9), [24]);
  assert.deepEqual(dynamicValue(elf, 21), [0]); // DT_DEBUG
  assert.deepEqual(dynamicValue(elf, 30), [8]); // DF_BIND_NOW
  assert.deepEqual(dynamicValue(elf, 0x6ffffffb), [0x08000001]); // PIE | NOW
  assert.deepEqual(elf.dynamic().at(-1), [0, 0]);
  const symbols = elf.symbols(".dynsym");
  assert.deepEqual(
    symbols.map((s) => [s.name, s.info, s.section, s.value]),
    [
      ["", 0, 0, 0],
      ...imports.map((name) => [
        name,
        name === ABSENT_SYMBOL ? 0x20 : 0x10,
        0,
        0,
      ]),
    ],
  );
  assert.equal(dynsym.info, 1);
  assert.equal(got.size, imports.length * 8);
  assert.deepEqual([...elf.contents(got)], new Array(got.size).fill(0));
  imports.forEach((name, index) => {
    const at = rela.offset + index * 24;
    assert.equal(
      elf.view.getBigUint64(at, true),
      BigInt(got.address + index * 8),
    );
    assert.equal(elf.view.getUint32(at + 8, true), 1025, name); // GLOB_DAT
    assert.equal(elf.view.getUint32(at + 12, true), index + 1, name);
    assert.equal(elf.view.getBigInt64(at + 16, true), 0n, name);
    assert.deepEqual(result.value.importSlots[index], {
      name,
      fileOffset: got.offset + index * 8,
      address: got.address + index * 8,
    });
  });
});

test("the System V hash table finds every dynamic symbol", () => {
  const encode = (s: string) => new TextEncoder().encode(s);
  assert.equal(elfHash(encode("")), 0);
  assert.equal(elfHash(encode("printf")), 0x077905a6);
  assert.equal(elfHash(encode("write")), 0x007e90a5);
  assert.equal(elfHash(encode("__libc_start_main")), 0x0177ff8e);
  assert.equal(elfHash(encode("été_über_long_symbol_name_xyz")), 0x0467938a);
  assert.deepEqual([...sysvHashTable([])], [1, 1, 0, 0]);
  const request = helloRequest(),
    result = buildElfExecutable(request);
  assert.ok(result.ok);
  const elf = readElf(result.value.bytes),
    hash = elf.section(".hash"),
    symbols = elf.symbols(".dynsym");
  assert.equal(hash.link, elf.section(".dynsym").index);
  const word = (i: number) => elf.view.getUint32(hash.offset + i * 4, true);
  const buckets = word(0),
    chains = word(1);
  assert.equal(chains, symbols.length);
  assert.equal(hash.size, (2 + buckets + chains) * 4);
  for (const name of request.imports!) {
    let index = word(2 + (elfHash(encode(name)) % buckets));
    while (index !== 0 && symbols[index]?.name !== name)
      index = word(2 + buckets + index);
    assert.equal(symbols[index]?.name, name);
  }
});

test(".eh_frame_hdr indexes sorted FDEs for the PT_GNU_EH_FRAME unwinder", () => {
  const code = new Uint8Array(64);
  for (let at = 0; at < code.length; at += 4)
    code.set([0xc0, 0x03, 0x5f, 0xd6], at);
  const result = buildElfExecutable({
    code,
    entryOffset: 0,
    maxByteLength: 1 << 20,
    unwind: [
      { offset: 0, byteLength: 8, rule: { kind: "leaf" } },
      { offset: 8, byteLength: 0, rule: { kind: "leaf" } },
      { offset: 16, byteLength: 16, rule: { kind: "frame", saves: [] } },
      {
        offset: 32,
        byteLength: 32,
        rule: { kind: "frame", saves: [{ register: 19, offset: -24 }] },
      },
    ],
  });
  assert.ok(result.ok);
  const elf = readElf(result.value.bytes),
    view = elf.view;
  const header = elf.section(".eh_frame_hdr"),
    frames = elf.section(".eh_frame");
  assert.deepEqual(
    [...elf.contents(header).subarray(0, 4)],
    [1, 0x1b, 0x03, 0x3b],
  );
  assert.equal(
    header.address + 4 + view.getInt32(header.offset + 4, true),
    frames.address,
  );
  const count = view.getUint32(header.offset + 8, true);
  assert.equal(count, 3); // the empty range describes no code
  assert.equal(header.size, 12 + count * 8);
  const code0 = result.value.codeFileOffset;
  const expected = [code0, code0 + 16, code0 + 32];
  for (let i = 0; i < count; i++) {
    const location =
      header.address + view.getInt32(header.offset + 12 + i * 8, true);
    const fde =
      header.address + view.getInt32(header.offset + 16 + i * 8, true);
    assert.equal(location, expected[i]);
    // The FDE's pc-relative initial location agrees with the table.
    const fdeOffset = frames.offset + (fde - frames.address);
    assert.notEqual(view.getUint32(fdeOffset + 4, true), 0, "not a CIE");
    assert.equal(
      fdeOffset +
        8 -
        frames.offset +
        frames.address +
        view.getInt32(fdeOffset + 8, true),
      location,
    );
  }
  // A zero-length terminator closes .eh_frame.
  assert.equal(view.getUint32(frames.offset + frames.size - 4, true), 0);
  assert.throws(() =>
    buildEhFrameHeader(0, 0, [
      { location: 8, description: 0 },
      { location: 4, description: 0 },
    ]),
  );
});

test("relocates address fixups against the GOT and data addresses", () => {
  const calls: (readonly [number, number, number])[] = [];
  const result = buildElfExecutable({
    ...minimal(),
    code: new Uint8Array(32),
    data: new Uint8Array(24),
    imports: ["write", "getpid"],
    addressFixups: [
      {
        offset: 0,
        byteLength: 16,
        alignment: 4,
        target: { kind: "import", name: "getpid" },
      },
      {
        offset: 16,
        byteLength: 16,
        alignment: 4,
        target: { kind: "data", offset: 20 },
      },
    ],
    patchAddress: (_bytes, index, site, target) => {
      calls.push([index, site, target]);
      return "complete";
    },
  });
  assert.ok(result.ok);
  const elf = readElf(result.value.bytes),
    code = result.value.codeFileOffset;
  assert.deepEqual(calls, [
    [0, code, elf.section(".got").address + 8],
    [1, code + 16, elf.section(".data").address + 20],
  ]);
  const failing = (status: "invalid" | "range") =>
    buildElfExecutable({
      ...minimal(),
      code: new Uint8Array(16),
      imports: ["write"],
      addressFixups: [
        {
          offset: 0,
          byteLength: 16,
          alignment: 4,
          target: { kind: "import", name: "write" },
        },
      ],
      patchAddress: () => status,
    });
  assert.deepEqual(failing("range"), {
    ok: false,
    error: "ADDRESS_OUT_OF_RANGE",
  });
  assert.deepEqual(failing("invalid"), {
    ok: false,
    error: "INVALID_REFERENCE",
  });
});

test("static symbols are sized locals in .symtab", () => {
  const request = helloRequest(),
    result = buildElfExecutable(request);
  assert.ok(result.ok);
  const elf = readElf(result.value.bytes);
  const symtab = elf.section(".symtab");
  assert.equal(symtab.info, 5); // all locals
  assert.equal(elf.sections[symtab.link]?.name, ".strtab");
  const text = elf.section(".text"),
    data = elf.section(".data");
  assert.deepEqual(
    elf
      .symbols(".symtab")
      .map((s) => [s.name, s.info, s.section, s.value, s.size]),
    [
      ["", 0, 0, 0, 0],
      ["_start", 0x02, text.index, text.address, MAIN_OFFSET],
      [
        "main",
        0x02,
        text.index,
        text.address + MAIN_OFFSET,
        text.size - MAIN_OFFSET,
      ],
      ["greeting_tail", 0x01, data.index, data.address, 8],
      ["backtrace_buffer", 0x01, data.index, data.address + 8, data.size - 8],
    ],
  );
});

test("DWARF addresses use the code's virtual address", () => {
  const request = helloRequest(),
    result = buildElfExecutable(request);
  assert.ok(result.ok);
  const elf = readElf(result.value.bytes);
  const expected = buildDebugInfo({
    ...request.debug!,
    codeAddress: result.value.codeFileOffset,
    codeLength: request.code.length,
    maxByteLength: request.maxByteLength,
  });
  assert.ok(expected.ok);
  assert.deepEqual(
    [...elf.contents(elf.section(".debug_info"))],
    [...expected.value.info],
  );
  assert.deepEqual(
    [...elf.contents(elf.section(".debug_line"))],
    [...expected.value.line],
  );
  assert.deepEqual(
    [...elf.contents(elf.section(".debug_abbrev"))],
    [...expected.value.abbrev],
  );
  for (const name of [".debug_info", ".debug_line", ".symtab", ".strtab"])
    assert.equal(elf.section(name).flags, 0, name);
});

test("output is deterministic, with a content-derived build ID", () => {
  const first = build(helloRequest()),
    second = build(helloRequest());
  assert.deepEqual(first, second);
  const elf = readElf(first),
    note = elf.section(".note.gnu.build-id");
  const id = (bytes: Uint8Array) => [
    ...bytes.subarray(note.offset + 16, note.offset + 36),
  ];
  assert.deepEqual(
    [...first.subarray(note.offset, note.offset + 16)],
    [4, 0, 0, 0, 20, 0, 0, 0, 3, 0, 0, 0, 0x47, 0x4e, 0x55, 0],
  );
  assert.notDeepEqual(id(first), new Array(20).fill(0));
  const renamed = build({
    ...helloRequest(),
    linux: { weakImports: [ABSENT_SYMBOL], identifier: "other" },
  });
  assert.equal(renamed.length, first.length);
  assert.notDeepEqual(id(renamed), id(first));
  for (let i = 0; i < first.length; i++)
    if (i < note.offset + 16 || i >= note.offset + 36)
      assert.equal(renamed[i], first[i], `byte ${i}`);
});

test("minimal images omit relocations, unwind tables and symbols", () => {
  const elf = readElf(build(minimal()));
  const names = elf.sections.map((s) => s.name);
  for (const absent of [
    ".rela.dyn",
    ".got",
    ".data",
    ".eh_frame",
    ".symtab",
    ".debug_info",
  ])
    assert.ok(!names.includes(absent), absent);
  assert.ok(!elf.segments.some((s) => s.type === PT_GNU_EH_FRAME));
  assert.equal(dynamicValue(elf, 7).length, 0);
  assert.deepEqual(dynamicValue(elf, 1).length, 1);
});

test("rejects invalid requests without output", () => {
  const base = minimal();
  const cases: [ElfExecutableRequest, string][] = [
    [{ ...base, code: new Uint8Array(0) }, "INVALID_CODE"],
    [{ ...base, code: new Uint8Array(6) }, "INVALID_CODE"],
    [{ ...base, entryOffset: 2 }, "INVALID_ENTRY"],
    [{ ...base, entryOffset: 8 }, "INVALID_ENTRY"],
    [{ ...base, maxByteLength: -1 }, "INVALID_LIMIT"],
    [{ ...base, maxByteLength: 512 }, "SIZE_LIMIT"],
    [
      {
        ...base,
        textSections: [{ kind: "cstring", offset: 4, byteLength: 2 }],
      },
      "INVALID_CODE",
    ],
    [
      {
        ...base,
        textSections: [{ kind: "cstring", offset: 0, byteLength: 8 }],
      },
      "INVALID_CODE",
    ],
    [{ ...base, imports: ["write", "write"] }, "INVALID_IMPORT"],
    [{ ...base, imports: [""] }, "INVALID_IMPORT"],
    [{ ...base, imports: ["a\0b"] }, "INVALID_IMPORT"],
    [
      { ...base, imports: ["write"], linux: { weakImports: ["read"] } },
      "INVALID_IMPORT",
    ],
    [{ ...base, linux: { needed: ["libc.so.6"] } }, "INVALID_LIBRARY"],
    [{ ...base, linux: { needed: ["libx.so", "libx.so"] } }, "INVALID_LIBRARY"],
    [{ ...base, linux: { needed: ["lib\nx.so"] } }, "INVALID_LIBRARY"],
    [{ ...base, linux: { interpreter: "" } }, "INVALID_LIBRARY"],
    [{ ...base, symbols: [{ name: "f", offset: 2 }] }, "INVALID_SYMBOL"],
    [{ ...base, symbols: [{ name: "", offset: 0 }] }, "INVALID_SYMBOL"],
    [{ ...base, dataSymbols: [{ name: "d", offset: 0 }] }, "INVALID_SYMBOL"],
    [
      {
        ...base,
        unwind: [
          { offset: 4, byteLength: 4, rule: { kind: "leaf" } },
          { offset: 0, byteLength: 4, rule: { kind: "leaf" } },
        ],
      },
      "INVALID_UNWIND",
    ],
    [
      {
        ...base,
        unwind: [{ offset: 4, byteLength: 8, rule: { kind: "leaf" } }],
      },
      "INVALID_UNWIND",
    ],
    [
      {
        ...base,
        addressFixups: [
          {
            offset: 0,
            byteLength: 4,
            alignment: 4,
            target: { kind: "import", name: "x" },
          },
        ],
      },
      "INVALID_REFERENCE",
    ],
    [
      {
        ...base,
        imports: ["write"],
        addressFixups: [
          {
            offset: 0,
            byteLength: 4,
            alignment: 4,
            target: { kind: "import", name: "read" },
          },
        ],
        patchAddress: () => "complete",
      },
      "INVALID_REFERENCE",
    ],
    [
      {
        ...base,
        data: new Uint8Array(4),
        addressFixups: [
          {
            offset: 0,
            byteLength: 4,
            alignment: 4,
            target: { kind: "data", offset: 5 },
          },
        ],
        patchAddress: () => "complete",
      },
      "INVALID_REFERENCE",
    ],
    [
      {
        ...base,
        debug: {
          directory: ".",
          functions: [{ offset: 0, byteLength: 64, name: "f" }],
          lines: [],
        },
      },
      "INVALID_DEBUG",
    ],
  ];
  for (const [request, error] of cases)
    assert.deepEqual(buildElfExecutable(request), { ok: false, error }, error);
});

test("USDT probes are stapsdt notes relocated by .stapsdt.base", () => {
  const request = helloRequest();
  const plain = build(request);
  // No probes: the image is unchanged.
  assert.deepEqual(build({ ...request, probes: [] }), plain);
  const probes = [
    { provider: "tint", name: "gc__end", offset: 0, arguments: "8@x10 8@x9" },
    { provider: "tint", name: "alloc__sample", offset: 4, arguments: "" },
  ];
  const result = buildElfExecutable({ ...request, probes });
  assert.ok(result.ok);
  const elf = readElf(result.value.bytes);
  const base = elf.section(".stapsdt.base");
  assert.equal(base.size, 1);
  assert.equal(base.flags, 2); // SHF_ALLOC
  // The base byte is mapped by the read/execute segment.
  const text = elf.segments.filter((s) => s.type === PT_LOAD)[0];
  assert.ok(text !== undefined && text.flags === 5);
  assert.ok(base.address + 1 <= text.address + text.fileSize);
  const notes = elf.section(".note.stapsdt");
  assert.equal(notes.type, 7); // SHT_NOTE
  assert.equal(notes.flags, 0);
  const bytes = elf.contents(notes),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parsed: unknown[] = [];
  for (let at = 0; at < bytes.length;) {
    const nameSize = view.getUint32(at, true),
      descriptorSize = view.getUint32(at + 4, true);
    assert.equal(view.getUint32(at + 8, true), 3);
    assert.equal(cString(bytes, at + 12), "stapsdt");
    const descriptor = at + 12 + Math.ceil(nameSize / 4) * 4;
    const provider = cString(bytes, descriptor + 24),
      name = cString(bytes, descriptor + 25 + provider.length),
      specification = cString(
        bytes,
        descriptor + 26 + provider.length + name.length,
      );
    parsed.push({
      pc: Number(view.getBigUint64(descriptor, true)),
      base: Number(view.getBigUint64(descriptor + 8, true)),
      semaphore: Number(view.getBigUint64(descriptor + 16, true)),
      provider,
      name,
      specification,
    });
    at = descriptor + Math.ceil(descriptorSize / 4) * 4;
  }
  const code = result.value.codeFileOffset;
  assert.deepEqual(parsed, [
    {
      pc: code,
      base: base.address,
      semaphore: 0,
      provider: "tint",
      name: "gc__end",
      specification: "8@x10 8@x9",
    },
    {
      pc: code + 4,
      base: base.address,
      semaphore: 0,
      provider: "tint",
      name: "alloc__sample",
      specification: "",
    },
  ]);
  const base0 = minimal();
  for (const probe of [
    { provider: "tint", name: "x", offset: 2, arguments: "" },
    { provider: "tint", name: "x", offset: 8, arguments: "" },
    { provider: "", name: "x", offset: 0, arguments: "" },
    { provider: "tint", name: "a.b", offset: 0, arguments: "" },
    { provider: "tint", name: "x", offset: 0, arguments: "8@x0\n" },
  ])
    assert.deepEqual(buildElfExecutable({ ...base0, probes: [probe] }), {
      ok: false,
      error: "INVALID_PROBE",
    });
});
