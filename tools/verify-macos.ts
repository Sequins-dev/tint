import type { AArch64AddressReference as AddressReference } from "@tint/codegen/aarch64/image-relocations";
import { buildAArch64Executable } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  writeInstruction,
  relativeAddress,
  patchBranch,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

assert.equal(process.platform, "darwin", "verification requires macOS");
assert.equal(process.arch, "arm64", "verification requires native arm64");

function encode(instructions: readonly Instruction[]): Uint8Array {
  const bytes = new Uint8Array(instructions.length * 4);
  instructions.forEach((instruction, index) => {
    assert.deepEqual(writeInstruction(bytes, index * 4, instruction), {
      ok: true,
      value: undefined,
    });
  });
  return bytes;
}
const ret: Instruction = { op: "ret", rn: 30 };
function constant(value: number): Uint8Array {
  return encode([
    { op: "movz", width: 32, rd: 0, immediate: value, shift: 0 },
    ret,
  ]);
}
const call = encode([
  { op: "stp", width: 64, rt: 29, rt2: 30, rn: "sp", offset: -16, mode: "pre" },
  {
    op: "add-imm",
    width: 64,
    rd: 29,
    rn: "sp",
    immediate: 0,
    shift: 0,
    setFlags: false,
  },
  { op: "bl", displacement: 0 },
  { op: "ldp", width: 64, rt: 29, rt2: 30, rn: "sp", offset: 16, mode: "post" },
  ret,
  { op: "movz", width: 32, rd: 0, immediate: 37, shift: 0 },
  ret,
]);
assert.deepEqual(
  patchBranch(call, { offset: 8, targetOffset: 20, branch: { op: "bl" } }),
  { ok: true, value: undefined },
);
const large = new Uint8Array(20_000);
for (let offset = 0; offset < large.length; offset += 4) {
  assert.equal(writeInstruction(large, offset, { op: "nop" }).ok, true);
}
large.set(constant(17), large.length - 8);
interface Fixture {
  name: string;
  code: Uint8Array;
  entry: number;
  args: string[];
  status: number;
  data?: Uint8Array;
  imports?: readonly string[];
  addressFixups?: readonly AddressReference[];
  stdout?: string;
}
function pointer(rd: number): readonly Instruction[] {
  const result = relativeAddress(rd, 17, 0);
  assert.ok(result.ok);
  return result.value;
}
const hostCall = encode([
  { op: "stp", width: 64, rt: 29, rt2: 30, rn: "sp", offset: -16, mode: "pre" },
  {
    op: "add-imm",
    width: 64,
    rd: 29,
    rn: "sp",
    immediate: 0,
    shift: 0,
    setFlags: false,
  },
  ...pointer(16),
  { op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 },
  { op: "blr", rn: 16 },
  { op: "cbz", width: 32, rt: 0, displacement: 0 },
  { op: "movz", width: 32, rd: 0, immediate: 1, shift: 0 },
  ...pointer(1),
  { op: "movz", width: 32, rd: 9, immediate: 0x6954, shift: 0 },
  { op: "movk", width: 32, rd: 9, immediate: 0x746e, shift: 16 },
  { op: "str", width: 32, rt: 9, rn: 1, offset: 0 },
  { op: "movz", width: 64, rd: 2, immediate: 12, shift: 0 },
  ...pointer(16),
  { op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 },
  { op: "blr", rn: 16 },
  { op: "ldp", width: 64, rt: 29, rt2: 30, rn: "sp", offset: 16, mode: "post" },
  ret,
]);
assert.equal(
  patchBranch(hostCall, {
    offset: 32,
    targetOffset: 96,
    branch: { op: "cbz", width: 32, rt: 0 },
  }).ok,
  true,
);
const fixtures: Fixture[] = [
  {
    name: "host-write",
    code: hostCall,
    entry: 0,
    args: [],
    status: 12,
    data: new TextEncoder().encode("xxxx native\n"),
    imports: ["_write", "_getpid"],
    stdout: "Tint native\n",
    addressFixups: [
      {
        offset: 8,
        rd: 16,
        scratch: 17,
        target: { kind: "import", name: "_getpid" },
      },
      { offset: 40, rd: 1, scratch: 17, target: { kind: "data", offset: 0 } },
      {
        offset: 72,
        rd: 16,
        scratch: 17,
        target: { kind: "import", name: "_write" },
      },
    ],
  },
  {
    name: "mutable-data",
    entry: 0,
    args: [],
    status: 43,
    data: new Uint8Array([42, 0, 0, 0]),
    code: encode([
      ...pointer(1),
      { op: "ldr", width: 32, rt: 0, rn: 1, offset: 0 },
      {
        op: "add-imm",
        width: 32,
        rd: 0,
        rn: 0,
        immediate: 1,
        shift: 0,
        setFlags: false,
      },
      { op: "str", width: 32, rt: 0, rn: 1, offset: 0 },
      { op: "ldr", width: 32, rt: 0, rn: 1, offset: 0 },
      ret,
    ]),
    addressFixups: [
      { offset: 0, rd: 1, scratch: 17, target: { kind: "data", offset: 0 } },
    ],
  },
  { name: "return-42", code: constant(42), entry: 0, args: [], status: 42 },
  {
    name: "argc",
    code: encode([ret]),
    entry: 0,
    args: ["one", "two"],
    status: 3,
  },
  { name: "internal-call", code: call, entry: 0, args: [], status: 37 },
  {
    name: "multi-page",
    code: large,
    entry: large.length - 8,
    args: [],
    status: 17,
  },
];
const directory = mkdtempSync(join(tmpdir(), "tint-native-"));
try {
  for (const fixture of fixtures) {
    const result = buildAArch64Executable({
      ...fixture,
      code: fixture.code,
      entryOffset: fixture.entry,
      identifier: `tint.verify.${fixture.name}`,
      minimumOS: { major: 26, minor: 6, patch: 2 },
      sdk: { major: 26, minor: 6, patch: 0 },
      maxByteLength: 1024 * 1024,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const file = join(directory, fixture.name);
    writeFileSync(file, result.value.bytes, { mode: 0o755 });
    const signature = spawnSync(
      "/usr/bin/codesign",
      ["--verify", "--strict", "--verbose=2", file],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(signature.status, 0, signature.stderr);
    const inspection = spawnSync("/usr/bin/otool", ["-l", file], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(inspection.status, 0, inspection.stderr);
    assert.match(inspection.stdout, /LC_MAIN/);
    assert.match(inspection.stdout, /LC_CODE_SIGNATURE/);
    assert.deepEqual(
      new Uint8Array(readFileSync(file)),
      result.value.bytes,
      "verification must not change generated bytes",
    );
    for (let run = 0; run < 2; run++) {
      const execution = spawnSync(file, fixture.args, {
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(execution.error, undefined);
      assert.equal(execution.signal, null, execution.stderr);
      assert.equal(execution.status, fixture.status, execution.stderr);
      assert.equal(execution.stdout, fixture.stdout ?? "");
    }
    const corrupt = result.value.bytes.slice();
    const offset = result.value.entryFileOffset;
    corrupt[offset] = (corrupt[offset] ?? 0) ^ 1;
    const corruptFile = join(directory, `${fixture.name}-tampered`);
    writeFileSync(corruptFile, corrupt);
    const rejected = spawnSync(
      "/usr/bin/codesign",
      ["--verify", "--strict", corruptFile],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(rejected.error, undefined);
    assert.equal(rejected.signal, null, rejected.stderr);
    assert.notEqual(rejected.status, null);
    assert.notEqual(
      rejected.status,
      0,
      "signature must reject a changed instruction",
    );
    console.log(
      `${fixture.name}: signature verified, executed twice with exit ${fixture.status}, tampering rejected`,
    );
  }
  console.log(
    `${fixtures.length} TypeScript-generated Mach-O executables verified; no external compiler, linker or signer used.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
