import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
// Native root-chain probe; allocation/collection are not simulated by this gate.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  writeInstruction,
  patchBranch,
  patchAddress,
  type Instruction,
  type Branch,
} from "@tint/codegen/aarch64/isa";

import {
  type FunctionIR,
  type Instruction as IRInstruction,
} from "@tint/ir/scalar";

assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const directory = mkdtempSync(join(tmpdir(), "tint-roots-")),
  s = { start: 0, end: 0 };
try {
  for (const mode of [
    "reference",
    "optional-reference",
    "optional-none",
    "optional-string",
    "optional-string-none",
  ] as const)
    for (const count of [1, 6])
      for (const throwing of [false, true]) {
        const referenceType =
          mode === "reference"
            ? "reference"
            : mode === "optional-string" || mode === "optional-string-none"
              ? "optional-string"
              : "optional-reference";
        const functions: FunctionIR[] = [];
        for (const id of [0, 1]) {
          const instructions: IRInstruction[] = Array.from(
            { length: count },
            (_, slot) => ({ kind: "load", id: slot, slot, ...s }),
          );
          instructions.push(
            id === 0
              ? {
                  kind: "call",
                  id: count,
                  target: 1,
                  arguments: Array.from({ length: count }, (_, i) => i),
                  ...s,
                }
              : { kind: "call", id: undefined, target: 2, arguments: [], ...s },
          );
          functions.push({
            id,
            name: id === 0 ? "outer" : "inner",
            exported: id === 0,
            parameters: Array.from({ length: count }, (_, i) => i),
            slots: [
              ...Array.from({ length: count }, () => referenceType),
              "number",
            ],
            returnType: referenceType,
            entry: 0,
            blocks: [
              {
                id: 0,
                instructions,
                terminator:
                  id === 1 && throwing
                    ? { kind: "throw-literal", value: "root unwind", ...s }
                    : { kind: "return", value: id === 0 ? count : 0, ...s },
              },
            ],
          });
        }
        functions.push({
          id: 2,
          name: "probe",
          exported: false,
          parameters: [],
          slots: [],
          returnType: "void",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [],
              terminator: { kind: "return", value: undefined, ...s },
            },
          ],
        });
        const native = emitDarwinModule({ functions });
        assert.ok(native.ok, JSON.stringify(native));
        assert.equal(native.value.roots.length, 2);
        const instructions: Instruction[] = [],
          branches: {
            offset: number;
            target: string | number;
            branch: Branch;
          }[] = [],
          addresses: { offset: number; function: number }[] = [],
          labels = new Map<string, number>();
        const emit = (i: Instruction) => instructions.push(i);
        const imm = (rd: number, n: number) =>
          emit({ op: "movz", width: 64, rd, immediate: n, shift: 0 });
        const address = (rd: number, offset: number) =>
          emit({
            op: "add-imm",
            width: 64,
            rd,
            rn: "sp",
            immediate: offset,
            shift: 0,
            setFlags: false,
          });
        const move = (rd: number, rn: number) =>
          emit({ op: "orr-reg", width: 64, rd, rn: "zr", rm: rn });
        const eq = (a: number, b: number) => {
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: a,
            rm: b,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          emit({ op: "b.cond", condition: "eq", displacement: 8 });
          emit({ op: "brk", immediate: 1 });
        };
        const call = (target: number) => {
          branches.push({
            offset: instructions.length * 4,
            target,
            branch: { op: "bl" },
          });
          emit({ op: "bl", displacement: 0 });
        };
        emit({
          op: "stp",
          width: 64,
          rt: 29,
          rt2: 30,
          rn: "sp",
          offset: -16,
          mode: "pre",
        });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "sp",
          rn: "sp",
          immediate: 192,
          shift: 0,
          setFlags: false,
        });
        emit({ op: "str", width: 64, rt: 19, rn: "sp", offset: 160 });
        emit({ op: "str", width: 64, rt: 20, rn: "sp", offset: 168 });
        if (mode === "optional-none" || mode === "optional-string-none")
          imm(19, 0);
        else address(19, 128);
        address(20, 96);
        emit({ op: "str", width: 64, rt: 20, rn: "sp", offset: 64 });
        for (let run = 0; run < 2; run++) {
          address(0, 64);
          imm(1, 0);
          imm(2, 0);
          address(3, 32);
          for (let i = 0; i < count; i++)
            if (i < 4) move(4 + i, 19);
            else
              emit({
                op: "str",
                width: 64,
                rt: 19,
                rn: "sp",
                offset: (i - 4) * 8,
              });
          call(0);
          imm(9, throwing ? 2 : 1);
          eq(0, 9);
          emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 64 });
          eq(9, 20);
          if (!throwing) {
            emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 48 });
            eq(9, 19);
          }
        }
        emit({ op: "ldr", width: 64, rt: 19, rn: "sp", offset: 160 });
        emit({ op: "ldr", width: 64, rt: 20, rn: "sp", offset: 168 });
        imm(0, 0);
        emit({
          op: "add-imm",
          width: 64,
          rd: "sp",
          rn: "sp",
          immediate: 192,
          shift: 0,
          setFlags: false,
        });
        emit({
          op: "ldp",
          width: 64,
          rt: 29,
          rt2: 30,
          rn: "sp",
          offset: 16,
          mode: "post",
        });
        emit({ op: "ret", rn: 30 });
        labels.set("probe", instructions.length * 4);
        emit({ op: "ldr", width: 64, rt: 8, rn: 0, offset: 0 });
        for (const functionId of [1, 0]) {
          const root = native.value.roots.find(
            (r) => r.function === functionId,
          )!;
          emit({ op: "ldr", width: 64, rt: 9, rn: 8, offset: 8 });
          addresses.push({
            offset: instructions.length * 4,
            function: functionId,
          });
          emit({ op: "adr", rd: 11, displacement: 0 });
          eq(9, 11);
          emit({ op: "ldr", width: 64, rt: 9, rn: 11, offset: 0 });
          imm(12, root.offsets.length);
          eq(9, 12);
          root.offsets.forEach((offset, i) => {
            emit({ op: "ldr", width: 64, rt: 9, rn: 11, offset: 8 + i * 8 });
            imm(12, offset);
            eq(9, 12);
            emit({ op: "ldr", width: 64, rt: 9, rn: 8, offset });
            if (functionId === 0 && i === root.offsets.length - 1) {
              imm(12, 0);
              eq(9, 12);
            } else eq(9, 19);
          });
          emit({ op: "ldr", width: 64, rt: 8, rn: 8, offset: 0 });
        }
        eq(8, 20);
        imm(0, 1);
        emit({ op: "str", width: 32, rt: 0, rn: 3, offset: 0 });
        emit({ op: "ret", rn: 30 });
        const base = instructions.length * 4,
          code = new Uint8Array(base + native.value.code.length);
        instructions.forEach((i, n) =>
          assert.ok(writeInstruction(code, n * 4, i).ok),
        );
        code.set(native.value.code, base);
        for (const fixup of branches)
          assert.ok(
            patchBranch(code, {
              offset: fixup.offset,
              targetOffset:
                typeof fixup.target === "number"
                  ? base + native.value.functions[fixup.target]!.offset
                  : labels.get(fixup.target)!,
              branch: fixup.branch,
            }).ok,
          );
        for (const fixup of addresses)
          assert.ok(
            patchAddress(code, {
              offset: fixup.offset,
              targetOffset:
                base +
                native.value.roots.find((r) => r.function === fixup.function)!
                  .descriptorOffset,
              rd: 11,
            }).ok,
          );
        assert.ok(
          writeInstruction(code, base + native.value.functions[2]!.offset, {
            op: "b",
            displacement: 0,
          }).ok,
        );
        assert.ok(
          patchBranch(code, {
            offset: base + native.value.functions[2]!.offset,
            targetOffset: labels.get("probe")!,
            branch: { op: "b" },
          }).ok,
        );
        const image = buildAArch64Executable({
          code,
          entryOffset: 0,
          identifier: "tint.verify.roots",
          minimumOS: { major: 26, minor: 6, patch: 2 },
          sdk: { major: 26, minor: 6, patch: 0 },
          maxByteLength: 1048576,
        });
        assert.ok(image.ok);
        const path = join(
          directory,
          "roots-" + mode + "-" + count + "-" + throwing,
        );
        writeFileSync(path, image.value.bytes, { mode: 0o755 });
        const signature = spawnSync(
          "/usr/bin/codesign",
          ["--verify", "--strict", path],
          { encoding: "utf8" },
        );
        assert.equal(signature.status, 0, signature.stderr);
        for (let i = 0; i < 2; i++) {
          const run = spawnSync(
            "/usr/bin/lldb",
            ["--batch", "-o", "run", path],
            {
              encoding: "utf8",
              timeout: 90000,
            },
          );
          assert.equal(run.error, undefined);
          assert.equal(run.signal, null, path);
          assert.equal(run.status, 0, run.stderr);
          assert.match(run.stdout, /exited with status = 0 /, run.stdout);
        }
      }
  console.log(
    "Verified 20 native root-chain fixtures twice each: nested frames, precise descriptor offsets, zeroed result temporaries, register/stack required and optional reference/string arguments, including undefined, repeated calls, normal and throw restoration.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
