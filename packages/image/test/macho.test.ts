import type { AArch64ExecutableRequest } from "../../../tools/aarch64-executable.ts";
import { buildAArch64Executable } from "../../../tools/aarch64-executable.ts";
import {
  relativeAddress,
  writeInstruction,
  type Instruction,
} from "@tint/codegen/aarch64/isa";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
function pointers(registers: readonly number[], tail = true): Uint8Array {
  const instructions: Instruction[] = [];
  for (const rd of registers) {
    const result = relativeAddress(rd, 17, 0);
    assert.ok(result.ok);
    instructions.push(...result.value);
  }
  if (tail) instructions.push({ op: "ret", rn: 30 });
  const bytes = new Uint8Array(instructions.length * 4);
  instructions.forEach((instruction, index) =>
    assert.ok(writeInstruction(bytes, index * 4, instruction).ok),
  );
  return bytes;
}
function request(): AArch64ExecutableRequest {
  return {
    code: new Uint8Array([0x40, 5, 0x80, 0x52, 0xc0, 3, 0x5f, 0xd6]),
    entryOffset: 0,
    identifier: "tint.test",
    minimumOS: { major: 26, minor: 6, patch: 2 },
    sdk: { major: 26, minor: 6, patch: 0 },
    maxByteLength: 1024 * 1024,
  };
}
function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function commands(bytes: Uint8Array) {
  const v = view(bytes),
    out = new Map<number, number[]>();
  let offset = 32;
  for (let i = 0; i < v.getUint32(16, true); i++) {
    const cmd = v.getUint32(offset, true),
      size = v.getUint32(offset + 4, true);
    assert.ok(size >= 8 && size % 8 === 0);
    const list = out.get(cmd) ?? [];
    list.push(offset);
    out.set(cmd, list);
    offset += size;
  }
  assert.equal(offset, 32 + v.getUint32(20, true));
  return out;
}
test("serializes a PIE executable with bounded segments, entrypoint and loader commands", () => {
  const input = request(),
    r = buildAArch64Executable(input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const b = r.value.bytes,
    v = view(b),
    cmds = commands(b);
  assert.equal(v.getUint32(0, true), 0xfeedfacf);
  assert.equal(v.getUint32(4, true), 0x100000c);
  assert.equal(v.getUint32(8, true), 0);
  assert.equal(v.getUint32(12, true), 2);
  assert.equal(v.getUint32(24, true), 0x200085);
  assert.equal(v.getUint32(16, true), 10);
  assert.deepEqual(
    [...cmds.keys()].sort((a, b) => a - b),
    [0xc, 0xe, 0x19, 0x1b, 0x1d, 0x32, 0x80000028, 0x80000034],
  );
  const segments = cmds.get(0x19);
  assert.ok(segments);
  assert.equal(segments.length, 3);
  const names = segments.map((o) =>
    new TextDecoder().decode(b.subarray(o + 8, o + 24)).replace(/\0.*$/, ""),
  );
  assert.deepEqual(names, ["__PAGEZERO", "__TEXT", "__LINKEDIT"]);
  const text = segments[1],
    pagezero = segments[0],
    linkedit = segments[2];
  assert.ok(
    text !== undefined && pagezero !== undefined && linkedit !== undefined,
  );
  assert.equal(v.getBigUint64(pagezero + 32, true), 0x100000000n);
  assert.equal(v.getBigUint64(pagezero + 48, true), 0n);
  assert.equal(v.getUint32(text + 60, true), 5);
  assert.equal(v.getBigUint64(text + 24, true), 0x100000000n);
  assert.equal(v.getBigUint64(text + 48, true), 16384n);
  assert.equal(v.getUint32(linkedit + 60, true), 1);
  assert.equal(
    v.getBigUint64(linkedit + 40, true) + v.getBigUint64(linkedit + 48, true),
    BigInt(b.length),
  );
  const main = cmds.get(0x80000028)?.[0];
  assert.ok(main !== undefined);
  assert.equal(v.getBigUint64(main + 8, true), BigInt(r.value.entryFileOffset));
  const platform = cmds.get(0x32)?.[0];
  assert.ok(platform !== undefined);
  assert.equal(v.getUint32(platform + 8, true), 1);
  assert.equal(v.getUint32(platform + 12, true), 0x1a0602);
  assert.deepEqual(
    b.subarray(
      r.value.codeFileOffset,
      r.value.codeFileOffset + input.code.length,
    ),
    input.code,
  );
  assert.equal(r.value.signatureFileOffset % 16, 0);
});
test("final headers and padding are covered by independently recomputed signature hashes", () => {
  const r = buildAArch64Executable(request());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const b = r.value.bytes,
    v = view(b),
    cmds = commands(b),
    s = cmds.get(0x1d)?.[0];
  assert.ok(s !== undefined);
  const sig = v.getUint32(s + 8, true),
    length = v.getUint32(s + 12, true);
  assert.equal(sig, r.value.signatureFileOffset);
  assert.equal(sig + length, b.length);
  assert.equal(v.getUint32(sig), 0xfade0cc0);
  const cd = sig + 20,
    hashOffset = v.getUint32(cd + 16),
    slots = v.getUint32(cd + 28);
  assert.equal(v.getUint32(cd + 32), sig);
  assert.equal(slots, Math.ceil(sig / 4096));
  for (let i = 0; i < slots; i++)
    assert.deepEqual(
      b.subarray(cd + hashOffset + i * 32, cd + hashOffset + (i + 1) * 32),
      new Uint8Array(
        createHash("sha256")
          .update(b.subarray(i * 4096, Math.min((i + 1) * 4096, sig)))
          .digest(),
      ),
    );
  assert.equal(v.getBigUint64(cd + 72), 16384n);
});
test("preserves inputs and determinism while handling multi-page code and nonzero entry", () => {
  const input = request(),
    large = { ...input, code: new Uint8Array(20000), entryOffset: 19996 };
  large.code.set(input.code);
  const before = large.code.slice(),
    a = buildAArch64Executable(large),
    b = buildAArch64Executable(large);
  assert.equal(a.ok, true);
  assert.deepEqual(a, b);
  assert.deepEqual(large.code, before);
  if (a.ok) {
    assert.equal(a.value.entryFileOffset - a.value.codeFileOffset, 19996);
    assert.ok(a.value.signatureFileOffset > 32768);
    a.value.bytes.fill(0);
    assert.deepEqual(large.code, before);
  }
});
test("rejects bad input and budgets without returning a partial executable", () => {
  const input = request();
  const variants: AArch64ExecutableRequest[] = [
    { ...input, code: new Uint8Array() },
    { ...input, code: new Uint8Array(3) },
    { ...input, entryOffset: -4 },
    { ...input, entryOffset: 2 },
    { ...input, entryOffset: 8 },
    { ...input, identifier: "bad\0id" },
    { ...input, minimumOS: { major: 26, minor: 256, patch: 0 } },
    { ...input, sdk: { major: 26, minor: 0, patch: 0.5 } },
    { ...input, maxByteLength: 16384 },
    { ...input, maxByteLength: NaN },
  ];
  for (const x of variants) {
    const r = buildAArch64Executable(x);
    assert.equal(r.ok, false);
    assert.equal("value" in r, false);
  }
});

test("UUID is deterministic and changes with code and signing identity", () => {
  function uuid(input: AArch64ExecutableRequest) {
    const r = buildAArch64Executable(input);
    assert.equal(r.ok, true);
    const offset = commands(r.value.bytes).get(0x1b)?.[0];
    assert.ok(offset !== undefined);
    const value = r.value.bytes.slice(offset + 8, offset + 24);
    assert.equal((value[6] ?? 0) >>> 4, 8);
    assert.equal((value[8] ?? 0) >>> 6, 2);
    return value;
  }
  const input = request();
  assert.deepEqual(uuid(input), uuid(input));
  assert.notDeepEqual(uuid(input), uuid({ ...input, identifier: "tint.best" }));
  assert.notDeepEqual(uuid(input), uuid({ ...input, code: new Uint8Array(8) }));
});

test("publishes RW data, eager imports, and resolved relative references before signing", () => {
  const input = {
    ...request(),
    code: pointers([0, 1]),
    data: new Uint8Array([42, 0, 0, 0]),
    imports: ["_write", "_getpid"],
    addressFixups: [
      {
        offset: 0,
        rd: 0,
        scratch: 17,
        target: { kind: "data" as const, offset: 0 },
      },
      {
        offset: 16,
        rd: 1,
        scratch: 17,
        target: { kind: "import" as const, name: "_write" },
      },
    ],
  };
  const before = input.code.slice(),
    r = buildAArch64Executable(input);
  assert.equal(r.ok, true);
  const b = r.value.bytes,
    v = view(b),
    cmds = commands(b);
  assert.deepEqual(input.code, before);
  assert.deepEqual(buildAArch64Executable(input), r);
  const segments = cmds.get(0x19)!;
  assert.equal(segments.length, 4);
  const data = segments[2]!;
  assert.equal(v.getUint32(data + 60, true), 3);
  assert.equal(v.getUint32(data + 56, true), 3);
  assert.ok(r.value.dataFileOffset !== undefined);
  assert.deepEqual(
    b.subarray(r.value.dataFileOffset, r.value.dataFileOffset + 4),
    input.data,
  );
  assert.equal(r.value.importSlots.length, 2);
  assert.equal(r.value.importSlots[0]?.name, "_write");
  function checkPointer(offset: number, rd: number, target: number) {
    const expected = relativeAddress(rd, 17, target - offset);
    assert.ok(expected.ok);
    const bytes = new Uint8Array(16);
    expected.value.forEach((instruction, index) =>
      assert.ok(writeInstruction(bytes, index * 4, instruction).ok),
    );
    assert.deepEqual(b.slice(offset, offset + 16), bytes);
  }
  checkPointer(r.value.codeFileOffset, 0, r.value.dataFileOffset);
  checkPointer(
    r.value.codeFileOffset + 16,
    1,
    r.value.importSlots[0]!.fileOffset,
  );
  const chain = cmds.get(0x80000034)![0]!,
    metadata = v.getUint32(chain + 8, true);
  assert.equal(v.getUint32(metadata + 16, true), 2);
  const sig = r.value.signatureFileOffset,
    cd = sig + 20,
    hash = v.getUint32(cd + 16),
    slots = v.getUint32(cd + 28);
  for (let i = 0; i < slots; i++)
    assert.deepEqual(
      b.subarray(cd + hash + i * 32, cd + hash + (i + 1) * 32),
      new Uint8Array(
        createHash("sha256")
          .update(b.subarray(i * 4096, Math.min((i + 1) * 4096, sig)))
          .digest(),
      ),
    );
});
test("rejects missing, conflicting and overflowing address references without mutation", () => {
  const base = {
    ...request(),
    code: pointers([0]),
    data: new Uint8Array(4),
  };
  const valid = {
    offset: 0,
    rd: 0,
    scratch: 17,
    target: { kind: "data" as const, offset: 0 },
  };
  const cases = [
    { ...base, imports: ["_write", "_write"] },
    { ...base, imports: ["bad\0name"] },
    {
      ...base,
      addressFixups: [
        { ...valid, target: { kind: "import" as const, name: "_absent" } },
      ],
    },
    { ...base, addressFixups: [valid, valid] },
    { ...base, addressFixups: [{ ...valid, offset: 4 }] },
    { ...base, addressFixups: [{ ...valid, offset: -4 }] },
    {
      ...base,
      addressFixups: [
        { ...valid, target: { kind: "data" as const, offset: 5 } },
      ],
    },
    { ...base, addressFixups: [{ ...valid, rd: 1 }] },
    { ...base, data: undefined, addressFixups: [valid] },
    {
      ...base,
      code: new Uint8Array(1048576),
      addressFixups: [valid],
      maxByteLength: 2 * 1024 * 1024,
    },
  ];
  for (const input of cases) {
    const code = input.code.slice(),
      data = input.data?.slice();
    assert.equal(buildAArch64Executable(input).ok, false);
    assert.deepEqual(input.code, code);
    assert.deepEqual(input.data, data);
  }
});

test("links native imports beyond the single-instruction ADR range", () => {
  const code = new Uint8Array(2 * 1024 * 1024);
  const pointer = relativeAddress(16, 17, 0);
  assert.ok(pointer.ok);
  pointer.value.forEach((instruction, index) =>
    assert.ok(writeInstruction(code, index * 4, instruction).ok),
  );
  const image = buildAArch64Executable({
    ...request(),
    code,
    imports: ["_write"],
    maxByteLength: 3 * 1024 * 1024,
    addressFixups: [
      {
        offset: 0,
        rd: 16,
        scratch: 17,
        target: { kind: "import", name: "_write" },
      },
    ],
  });
  assert.ok(image.ok, JSON.stringify(image));
});

test("optional native symbols describe code addresses in a signed Mach-O", () => {
  const built = buildAArch64Executable({
    ...request(),
    symbols: [
      { name: "compiler/check", offset: 0 },
      { name: "compiler/return", offset: 4 },
    ],
  });
  assert.ok(built.ok);
  const b = built.value.bytes,
    v = view(b),
    at = commands(b).get(2)?.[0];
  assert.notEqual(at, undefined);
  const sym = at!,
    records = v.getUint32(sym + 8, true),
    strings = v.getUint32(sym + 16, true);
  assert.equal(v.getUint32(sym + 12, true), 2);
  for (let i = 0; i < 2; i++) {
    const record = records + i * 16;
    assert.equal(b[record + 4], 0x0e); // N_SECT, local symbol
    assert.equal(b[record + 5], 1); // __TEXT,__text
    assert.equal(
      v.getBigUint64(record + 8, true),
      0x100000000n + BigInt(built.value.codeFileOffset + i * 4),
    );
    const name = new TextDecoder()
      .decode(b.subarray(strings + v.getUint32(record, true)))
      .split("\0")[0];
    assert.equal(name, i === 0 ? "compiler/check" : "compiler/return");
  }
  assert.ok(
    strings + v.getUint32(sym + 20, true) <= built.value.signatureFileOffset,
  );
});

test("native symbols reject invalid offsets and names", () => {
  for (const symbol of [
    { name: "x", offset: -4 },
    { name: "x", offset: 2 },
    { name: "x", offset: 8 },
    { name: "", offset: 0 },
    { name: "bad\0name", offset: 0 },
  ])
    assert.deepEqual(
      buildAArch64Executable({ ...request(), symbols: [symbol] }),
      {
        ok: false,
        error: "INVALID_SYMBOL",
      },
    );
});

test("DWARF sections are placed, relocated, and signed with the executable", () => {
  const result = buildAArch64Executable({
    ...request(),
    debug: {
      directory: "/project",
      functions: [{ name: "run", offset: 0, byteLength: 8 }],
      lines: [
        { file: "main.ts", offset: 0, byteLength: 8, line: 7, column: 2 },
      ],
    },
  });
  assert.ok(result.ok);
  const bytes = result.value.bytes,
    v = view(bytes);
  const segment = commands(bytes)
    .get(0x19)
    ?.find((at) =>
      new TextDecoder()
        .decode(bytes.subarray(at + 8, at + 24))
        .startsWith("__DWARF\0"),
    );
  assert.notEqual(segment, undefined);
  assert.equal(v.getUint32(segment! + 64, true), 3);
  const names = [];
  for (let i = 0; i < 3; i++) {
    const at = segment! + 72 + i * 80;
    names.push(
      new TextDecoder().decode(bytes.subarray(at, at + 16)).split("\0")[0],
    );
    assert.equal(v.getUint32(at + 64, true), 0x02000000);
    const offset = v.getUint32(at + 48, true),
      size = Number(v.getBigUint64(at + 40, true));
    assert.ok(offset + size <= result.value.signatureFileOffset);
  }
  assert.deepEqual(names, ["__debug_abbrev", "__debug_info", "__debug_line"]);
  const info = v.getUint32(segment! + 72 + 80 + 48, true),
    size = Number(v.getBigUint64(segment! + 72 + 80 + 40, true));
  const address = Buffer.alloc(8);
  address.writeBigUInt64LE(0x100000000n + BigInt(result.value.codeFileOffset));
  assert.ok(Buffer.from(bytes.subarray(info, info + size)).includes(address));
});

test("debugger permission embeds both signed entitlement formats independently of DWARF", () => {
  const ordinary = buildAArch64Executable(request());
  const debug = buildAArch64Executable({ ...request(), allowDebugger: true });
  assert.ok(ordinary.ok);
  assert.ok(debug.ok);
  const plain = view(
    ordinary.value.bytes.subarray(ordinary.value.signatureFileOffset),
  );
  assert.equal(plain.getUint32(8), 1);
  const bytes = debug.value.bytes.subarray(debug.value.signatureFileOffset),
    v = view(bytes);
  assert.equal(v.getUint32(8), 3);
  const blobs = new Map<number, number>();
  for (let i = 0; i < v.getUint32(8); i++)
    blobs.set(v.getUint32(12 + i * 8), v.getUint32(16 + i * 8));
  assert.deepEqual([...blobs.keys()], [0, 5, 7]);
  const xml = blobs.get(5)!,
    der = blobs.get(7)!;
  assert.equal(v.getUint32(xml), 0xfade7171);
  assert.equal(v.getUint32(der), 0xfade7172);
  assert.match(
    new TextDecoder().decode(
      bytes.subarray(xml + 8, xml + v.getUint32(xml + 4)),
    ),
    /<key>com\.apple\.security\.get-task-allow<\/key><true\/>/,
  );
  // Independent reference DER encoding emitted by Apple's codesign.
  assert.equal(
    Buffer.from(bytes.subarray(der + 8, der + v.getUint32(der + 4))).toString(
      "hex",
    ),
    "702d020101b02830260c21636f6d2e6170706c652e73656375726974792e6765742d7461736b2d616c6c6f770101ff",
  );
});

test("JIT permission is explicit and encoded independently of debugger access", () => {
  const cases = [
    [
      false,
      "702b020101b02630240c1f636f6d2e6170706c652e73656375726974792e63732e616c6c6f772d6a69740101ff",
    ],
    [
      true,
      "7053020101b04e30240c1f636f6d2e6170706c652e73656375726974792e63732e616c6c6f772d6a69740101ff30260c21636f6d2e6170706c652e73656375726974792e6765742d7461736b2d616c6c6f770101ff",
    ],
  ] as const;
  for (const [allowDebugger, expected] of cases) {
    const image = buildAArch64Executable({
      ...request(),
      allowDebugger,
      allowJit: true,
    });
    assert.ok(image.ok);
    const bytes = image.value.bytes.subarray(image.value.signatureFileOffset),
      v = view(bytes);
    assert.equal(v.getUint32(8), 3);
    const xml = v.getUint32(24),
      der = v.getUint32(32);
    assert.match(
      new TextDecoder().decode(
        bytes.subarray(xml + 8, xml + v.getUint32(xml + 4)),
      ),
      /<key>com.apple.security.cs.allow-jit<\/key><true\/>/,
    );
    // Independent encodings obtained from Apple's codesign, including key order.
    assert.equal(
      Buffer.from(bytes.subarray(der + 8, der + v.getUint32(der + 4))).toString(
        "hex",
      ),
      expected,
    );
  }
});
