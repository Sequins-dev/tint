// An image probing Mach-O library loading (docs/native-ffi.md,
// "Libraries"): libSystem, libz and an absent optional library.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  relativeAddress,
  writeInstruction,
  type Instruction,
} from "@tint/codegen/aarch64/isa";
import {
  buildAArch64Executable,
  type AArch64ExecutableRequest,
} from "./aarch64-executable.ts";
/** An image importing `_getpid` (libSystem), `_zlibVersion` (libz) and a
 * symbol of an absent optional library; its code exits 42 exactly when the
 * first two slots are bound and the weak one is zero. */
export function dylibProbeRequest(): AArch64ExecutableRequest {
  const instructions: Instruction[] = [];
  for (const rd of [0, 1, 2]) {
    const address = relativeAddress(rd, 17, 0);
    assert.ok(address.ok);
    instructions.push(...address.value);
    instructions.push({ op: "ldr", width: 64, rt: rd, rn: rd, offset: 0 });
  }
  // cbz x0/x1 and cbnz x2 jump to the failure exit (two instructions on).
  const branches = instructions.length;
  instructions.push(
    { op: "cbz", width: 64, rt: 0, displacement: 0 },
    { op: "cbz", width: 64, rt: 1, displacement: 0 },
    { op: "cbnz", width: 64, rt: 2, displacement: 0 },
    { op: "movz", width: 32, rd: 0, immediate: 42, shift: 0 },
    { op: "ret", rn: 30 },
    { op: "movz", width: 32, rd: 0, immediate: 1, shift: 0 },
    { op: "ret", rn: 30 },
  );
  const failure = instructions.length - 2;
  for (let index = 0; index < 3; index++) {
    const at = branches + index,
      branch = instructions[at]!;
    instructions[at] = {
      ...branch,
      displacement: (failure - at) * 4,
    } as Instruction;
  }
  const code = new Uint8Array(instructions.length * 4);
  instructions.forEach((instruction, index) =>
    assert.ok(writeInstruction(code, index * 4, instruction).ok),
  );
  return {
    entryOffset: 0,
    identifier: "tint.ffi.dylib-probe",
    minimumOS: { major: 14, minor: 0, patch: 0 },
    sdk: { major: 15, minor: 0, patch: 0 },
    maxByteLength: 1024 * 1024,
    code,
    imports: ["_getpid", "_zlibVersion", "_tint_absent_symbol"],
    dylibs: [
      {
        installName: "/usr/lib/libz.1.dylib",
        weak: false,
        currentVersion: 0x10000,
        compatibilityVersion: 0x10000,
        symbols: ["_zlibVersion"],
      },
      {
        installName: "/usr/lib/libtint-absent.dylib",
        weak: true,
        currentVersion: 0x10000,
        compatibilityVersion: 0x10000,
        symbols: ["_tint_absent_symbol"],
      },
    ],
    addressFixups: ["_getpid", "_zlibVersion", "_tint_absent_symbol"].map(
      (name, index) => ({
        offset: index * 20,
        rd: index,
        scratch: 17,
        target: { kind: "import" as const, name },
      }),
    ),
  };
}
/** Build the probe and run it under LLDB: stopped at entry, then exit 42
 * (libSystem and libz bound, the weak import of the absent library 0). */
export function verifyDylibProbe(): void {
  const built = buildAArch64Executable(dylibProbeRequest());
  assert.ok(built.ok, JSON.stringify(built));
  const directory = mkdtempSync(join(tmpdir(), "tint-dylib-probe-"));
  try {
    const path = join(directory, "probe");
    writeFileSync(path, built.value.bytes, { mode: 0o755 });
    const result = spawnSync(
      "lldb",
      [
        "--no-lldbinit",
        "--batch",
        "-o",
        "process launch --stop-at-entry",
        "-o",
        "script assert lldb.process.GetState() == lldb.eStateStopped",
        "-o",
        "continue",
        "-o",
        "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
        path,
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /exited with status = 42 /, result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
