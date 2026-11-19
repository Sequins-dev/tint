import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildElfExecutable,
  type ElfExecutableRequest,
} from "@tint/image/linux/elf";
import { buildElfJitObject } from "@tint/image/linux/elf/jit-object";
import { cString, readElf } from "./support/elf-read.ts";

const entryOffset = 1;

// Linux starts _start with RSP 16-byte aligned, as required before the
// SysV call to write. Both disp32 fields are based at the next instruction.
const code = Uint8Array.from([
  0xcc, // int3 (skipped by the byte-aligned entry)
  0xbf,
  1,
  0,
  0,
  0, // mov edi, 1
  0x48,
  0x8d,
  0x35,
  0,
  0,
  0,
  0, // lea rsi, [rip + data]
  0xba,
  3,
  0,
  0,
  0, // mov edx, 3
  0xff,
  0x15,
  0,
  0,
  0,
  0, // call [rip + GOT(write)]
  0xbf,
  42,
  0,
  0,
  0, // mov edi, 42
  0xb8,
  60,
  0,
  0,
  0, // mov eax, SYS_exit
  0x0f,
  0x05, // syscall
  0x0f,
  0x0b, // ud2 if the syscall returns
]);

function executableRequest(): ElfExecutableRequest {
  return {
    linux: { arch: "x86_64" },
    code,
    entryOffset,
    symbols: [{ name: "_start", offset: entryOffset }],
    maxByteLength: 1 << 20,
    data: new TextEncoder().encode("hi\n"),
    imports: ["write"],
    addressFixups: [
      {
        offset: 9,
        byteLength: 4,
        alignment: 1,
        target: { kind: "data", offset: 0 },
      },
      {
        offset: 20,
        byteLength: 4,
        alignment: 1,
        target: { kind: "import", name: "write" },
      },
    ],
    patchAddress(bytes, _reference, site, target) {
      const displacement = target - (site + 4);
      if (displacement < -0x80000000 || displacement > 0x7fffffff)
        return "range";
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(
        site,
        displacement,
        true,
      );
      return "complete";
    },
  };
}

test("x86-64 PIE uses byte offsets, 4 KiB segments and eager GOT binding", (t) => {
  const built = buildElfExecutable(executableRequest());
  assert.ok(built.ok, JSON.stringify(!built.ok && built.error));
  const { bytes, codeFileOffset, importSlots } = built.value;
  const elf = readElf(bytes);
  assert.equal(elf.type, 3); // ET_DYN
  assert.equal(elf.machine, 62); // EM_X86_64
  assert.equal(elf.entry, codeFileOffset + entryOffset);
  assert.equal(
    cString(bytes, elf.section(".interp").offset),
    "/lib64/ld-linux-x86-64.so.2",
  );
  const loads = elf.segments.filter((segment) => segment.type === 1);
  assert.equal(loads.length, 2);
  for (const load of loads) {
    assert.equal(load.alignment, 4096);
    assert.equal(load.address % load.alignment, load.offset % load.alignment);
  }
  const rela = elf.section(".rela.dyn");
  assert.equal(rela.size, 24);
  assert.equal(
    Number(elf.view.getBigUint64(rela.offset, true)),
    importSlots[0]?.address,
  );
  assert.equal(elf.view.getUint32(rela.offset + 8, true), 6); // R_X86_64_GLOB_DAT
  assert.equal(elf.view.getUint32(rela.offset + 12, true), 1); // write
  assert.equal(elf.symbols(".dynsym")[1]?.name, "write");

  const directory = mkdtempSync(join(tmpdir(), "tint-elf-x64-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const program = join(directory, "probe");
  writeFileSync(program, bytes, { mode: 0o755 });
  const qemu = process.env.TINT_X64_QEMU;
  const sysroot = process.env.TINT_X64_SYSROOT;
  if (qemu !== undefined || sysroot !== undefined) {
    assert.ok(qemu && sysroot, "set both TINT_X64_QEMU and TINT_X64_SYSROOT");
    checkReadelf(program);
    runProbe(qemu, ["-L", sysroot, program]);
  } else if (process.platform === "linux" && process.arch === "x64") {
    checkReadelf(program);
    runProbe(program, []);
  }
});

function checkReadelf(program: string): void {
  const result = spawnSync("readelf", ["-hlSdrsW", program], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, String(result.error ?? result.stderr));
  assert.equal(result.stderr, "");
  for (const expected of [
    "Advanced Micro Devices X86-64",
    "Requesting program interpreter: /lib64/ld-linux-x86-64.so.2",
    "Shared library: [libc.so.6]",
    "R_X86_64_GLOB_DAT",
    "BIND_NOW",
  ])
    assert.ok(result.stdout.includes(expected), expected);
}

function runProbe(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10000 });
  assert.equal(result.signal, null);
  assert.equal(result.status, 42, String(result.error ?? result.stderr));
  assert.equal(result.stdout, "hi\n");
}

test("x86-64 JIT objects use EM_X86_64 and preserve byte-granular symbols", () => {
  const result = buildElfJitObject(
    {
      address: 0x12340000,
      code: Uint8Array.of(0x90, 0x31, 0xc0, 0xc3), // nop; xor eax,eax; ret
      functions: [{ name: "jit:zero", offset: 1, byteLength: 3 }],
      lines: [],
      directory: "/",
      maxByteLength: 1 << 20,
    },
    "x86_64",
  );
  assert.ok(result.ok, JSON.stringify(!result.ok && result.error));
  const elf = readElf(result.value);
  assert.equal(elf.type, 1); // ET_REL
  assert.equal(elf.machine, 62);
  assert.equal(elf.section(".text").alignment, 1);
  assert.deepEqual(elf.symbols(".symtab").at(-1), {
    name: "jit:zero",
    info: 0x12,
    section: 1,
    value: 1,
    size: 3,
  });
});

test("x86-64 PIE rejects unwind rules until x86-64 frame emission is available", () => {
  assert.deepEqual(
    buildElfExecutable({
      ...executableRequest(),
      unwind: [
        {
          offset: entryOffset,
          byteLength: code.length - entryOffset,
          rule: { kind: "outermost" },
        },
      ],
    }),
    { ok: false, error: "UNSUPPORTED_UNWIND" },
  );
});
