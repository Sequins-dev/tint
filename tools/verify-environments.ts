import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
// Native IR-to-code gate. The environment allocation and entry calls are test adapters.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  writeInstruction,
  patchBranch,
  type Instruction,
  type Branch,
} from "@tint/codegen/aarch64/isa";

import type { ModuleIR, FunctionIR } from "@tint/ir/scalar";

const span = { start: 0, end: 0 };
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const directory = mkdtempSync(join(tmpdir(), "tint-environments-"));
try {
  for (const type of ["number", "boolean", "optional-number"] as const)
    for (const mutable of [false, true]) {
      const functions: FunctionIR[] = [];
      for (const [id, operation] of ["initialize", "read", "write"].entries()) {
        assert.ok(
          operation === "initialize" ||
            operation === "read" ||
            operation === "write",
        );
        functions.push({
          id,
          name: operation,
          exported: true,
          parameters: [0],
          slots: [type],
          returnType: type,
          entry: 0,
          environment: {
            byteLength: 32,
            cells: [{ type, stateOffset: 0, valueOffset: 8, mutable }],
          },
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "call", id: 0, target: 3, arguments: [], ...span },
              ],
              terminator: {
                kind: "cell",
                cell: 0,
                operation,
                slot: 0,
                consequent: 1,
                alternate: 2,
                ...span,
              },
            },
            {
              id: 1,
              instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
              terminator: { kind: "return", value: 1, ...span },
            },
            {
              id: 2,
              instructions: [
                type === "optional-number"
                  ? { kind: "undefined", id: 2, ...span }
                  : {
                      kind: "constant",
                      id: 2,
                      value: type === "number" ? -1 : false,
                      ...span,
                    },
              ],
              terminator: { kind: "return", value: 2, ...span },
            },
          ],
        });
      }
      functions.push({
        id: 3,
        name: "ordinary",
        exported: false,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 3, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      });
      for (let target = 0; target < 3; target++) {
        const environment = functions[target]?.environment;
        assert.ok(environment);
        functions.push({
          id: functions.length,
          name: "forward_" + target,
          exported: true,
          parameters: [0],
          slots: [type],
          returnType: type,
          entry: 0,
          environment,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                {
                  kind: "call",
                  id: 1,
                  target,
                  arguments: [0],
                  environment: "inherit",
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        });
      }
      const module: ModuleIR = { functions },
        native = emitDarwinModule(module);
      assert.ok(native.ok);
      const instructions: Instruction[] = [],
        fixups: { offset: number; branch: Branch; target: number | string }[] =
          [],
        labels = new Map<string, number>();
      const emit = (i: Instruction) => instructions.push(i);
      const imm = (rd: number, bits: bigint) => {
        for (const shift of [0, 16, 32, 48] as const)
          emit({
            op: shift === 0 ? "movz" : "movk",
            width: 64,
            rd,
            immediate: Number((bits >> BigInt(shift)) & 65535n),
            shift,
          });
      };
      const branch = (target: number | string, b: Branch = { op: "b" }) => {
        fixups.push({ offset: instructions.length * 4, target, branch: b });
        emit({ ...b, displacement: 0 });
      };
      const addr = (rd: number, offset: number) =>
        emit({
          op: "add-imm",
          width: 64,
          rd,
          rn: "sp",
          immediate: offset,
          shift: 0,
          setFlags: false,
        });
      const compare = (offset: number, bits: bigint) => {
        emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset });
        imm(10, bits);
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: 9,
          rm: 10,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        branch("fail", { op: "b.cond", condition: "ne" });
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
        immediate: 128,
        shift: 0,
        setFlags: false,
      });
      for (let offset = 0; offset < 128; offset += 8)
        emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
      const a =
        type === "boolean"
          ? 1n
          : type === "number"
            ? 0x4045000000000000n
            : 0x7ff8000000001234n;
      const b =
        type === "boolean" ? 0n : type === "number" ? 0x4058c00000000000n : 0n;
      const failure = type === "number" ? 0xbff0000000000000n : 0n;
      function invoke(
        id: number,
        value: bigint,
        tag: number,
        expected: bigint,
        expectedTag: number,
      ) {
        for (let offset = 0; offset < 32; offset += 8)
          emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
        imm(9, value);
        imm(10, BigInt(tag));
        if (type === "number") emit({ op: "fmov-d-x", rd: 0, rn: 9 });
        else if (type === "boolean") imm(4, value);
        else {
          emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 32 });
          emit({ op: "str", width: 64, rt: 10, rn: "sp", offset: 40 });
          addr(4, 32);
        }
        imm(0, 0n);
        addr(1, 64);
        imm(2, 0n);
        addr(3, 0);
        branch(id + 4, { op: "bl" });
        compare(0, 1n);
        compare(16, expected);
        if (type === "optional-number") compare(24, BigInt(expectedTag));
      }
      invoke(1, a, 1, failure, 0); // Uninitialized read follows the explicit failure edge.
      invoke(0, a, 1, a, 1); // Initialize, including a noncanonical NaN bit pattern.
      invoke(0, b, 0, failure, 0); // Reinitialization cannot replace the value.
      invoke(1, b, 0, a, 1);
      invoke(2, b, 0, mutable ? b : failure, 0);
      invoke(1, a, 1, mutable ? b : a, mutable ? 0 : 1);
      compare(64, 1n);
      compare(72, mutable ? b : a);
      if (type === "optional-number") compare(80, mutable ? 0n : 1n);
      imm(9, 2n);
      emit({ op: "strb", rt: 9, rn: "sp", offset: 64 });
      invoke(1, a, 1, failure, 0); // Corrupt state must also take the failure edge.
      compare(64, 2n);
      compare(72, mutable ? b : a);
      imm(0, 0n);
      branch("done");
      labels.set("fail", instructions.length * 4);
      imm(0, 1n);
      labels.set("done", instructions.length * 4);
      emit({
        op: "add-imm",
        width: 64,
        rd: "sp",
        rn: "sp",
        immediate: 128,
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
      const base = instructions.length * 4,
        code = new Uint8Array(base + native.value.code.length);
      instructions.forEach((i, n) =>
        assert.ok(writeInstruction(code, n * 4, i).ok),
      );
      code.set(native.value.code, base);
      for (const f of fixups) {
        const targetOffset =
          typeof f.target === "number"
            ? base + native.value.functions[f.target]!.offset
            : labels.get(f.target);
        assert.notEqual(targetOffset, undefined);
        assert.ok(
          patchBranch(code, {
            offset: f.offset,
            targetOffset: targetOffset!,
            branch: f.branch,
          }).ok,
        );
      }
      const image = buildAArch64Executable({
        code,
        entryOffset: 0,
        identifier: "tint.verify.environments",
        minimumOS: { major: 26, minor: 6, patch: 2 },
        sdk: { major: 26, minor: 6, patch: 0 },
        maxByteLength: 1048576,
      });
      assert.ok(image.ok);
      const name = type + "-" + mutable,
        path = join(directory, name);
      writeFileSync(path, image.value.bytes, { mode: 0o755 });
      const signature = spawnSync(
        "/usr/bin/codesign",
        ["--verify", "--strict", path],
        { encoding: "utf8" },
      );
      assert.equal(signature.status, 0, signature.stderr);
      for (let i = 0; i < 2; i++) {
        const run = spawnSync("lldb", ["--batch", "-o", "run", path], {
          timeout: 20000,
          encoding: "utf8",
        });
        assert.equal(run.error, undefined, name);
        assert.equal(run.signal, null, name);
        assert.equal(run.status, 0, name);
        assert.match(
          run.stdout,
          /exited with status = 0 /,
          run.stdout + run.stderr,
        );
      }
    }
  console.log(
    "Verified 6 internally signed IR environment fixtures, each executed twice: shared cells, explicit environment forwarding, ordinary-call preservation, guard branches, booleans and exact optional/NaN bits.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
