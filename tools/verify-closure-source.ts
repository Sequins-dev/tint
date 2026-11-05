import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
// Source-to-native closure entry gate. Environment allocation and entry calls are test adapters.
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

import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { planClosures } from "@tint/ts-native/closure/layout";
import { lowerClosureEntries } from "@tint/ts-native/closure/lowering";

assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const directory = mkdtempSync(join(tmpdir(), "tint-closure-source-"));
try {
  const cases = [
    {
      name: "counter",
      source:
        "interface C { readonly add:(n:number)=>number; readonly get:()=>number } function make(start:number):C { let x=start; return {add:n=>{x+=n;return x;},get:()=>x}; }",
      entries: [1, 2],
      initial: 5,
      calls: [
        [0, 3, 8],
        [1, 0, 8],
        [0, -2, 6],
        [1, 0, 6],
      ],
      final: 6,
    },
    {
      name: "effects",
      source:
        "interface C { readonly run:(n:number)=>number } function make():C { let x=1; return {run:n=>{let total=0;for(let i=0;i<n;i++){total+=x++;}x+=(x=3);return total+x;}}; }",
      entries: [1],
      initial: 1,
      calls: [
        [0, 3, 13],
        [0, 0, 10],
      ],
      final: 10,
    },
    {
      name: "boolean",
      source:
        "interface C { readonly run:()=>number } function make():C {let x=true;return {run:()=>{x=!x;return x?1:0;}};}",
      entries: [1],
      initial: 1,
      calls: [
        [0, 0, 0],
        [0, 0, 1],
      ],
      final: 1,
      encoding: "boolean",
    },
    {
      name: "optional",
      source:
        "interface C { readonly set:(n:number)=>number; readonly get:()=>number } function make():C {let x:number|undefined=undefined;return {set:n=>{x=n;return x;},get:()=>x??9};}",
      entries: [1, 2],
      initial: 0,
      calls: [
        [1, 0, 9],
        [0, 7, 7],
        [1, 0, 7],
      ],
      final: 7,
      encoding: "optional",
    },
  ];
  for (const fixture of cases) {
    const bytes = new TextEncoder().encode(fixture.source),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseModule(source.value);
    assert.ok(parsed.ok);
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok);
    const layouts = planClosures(
      checked.value.bindings,
      checked.value.bindings.bindings
        .filter((b) => b.captured)
        .map((b) => ({
          binding: b.id,
          size: fixture.encoding === "optional" ? 16 : 8,
          alignment: 8,
        })),
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
    );
    assert.ok(layouts.ok);
    const environment = layouts.value.environments[0];
    assert.ok(environment);
    assert.equal(environment.cells.length, 1);
    assert.ok(environment.layout.size <= 64);
    const cell = environment.cells[0];
    assert.ok(cell);
    const lowered = lowerClosureEntries(
      checked.value,
      fixture.entries,
      environment,
    );
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const native = emitDarwinModule(lowered.value.module);
    assert.ok(native.ok, JSON.stringify(native));
    const bits = (n: number) => {
      const b = new ArrayBuffer(8),
        d = new DataView(b);
      d.setFloat64(0, n, true);
      return d.getBigUint64(0, true);
    };
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
    imm(9, 1n);
    emit({ op: "strb", rt: 9, rn: "sp", offset: 64 + cell.stateOffset });
    imm(
      9,
      fixture.encoding === "boolean"
        ? BigInt(fixture.initial)
        : bits(fixture.initial),
    );
    emit({
      op: "str",
      width: 64,
      rt: 9,
      rn: "sp",
      offset: 64 + cell.valueOffset,
    });
    for (const call of fixture.calls) {
      const [id, arg, expected] = call;
      assert.notEqual(id, undefined);
      assert.notEqual(arg, undefined);
      assert.notEqual(expected, undefined);
      for (let offset = 0; offset < 32; offset += 8)
        emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
      imm(9, bits(arg!));
      emit({ op: "fmov-d-x", rd: 0, rn: 9 });
      imm(0, 0n);
      addr(1, 64);
      imm(2, 0n);
      addr(3, 0);
      branch(id!, { op: "bl" });
      compare(0, 1n);
      compare(16, bits(expected!));
    }
    compare(
      64 + cell.valueOffset,
      fixture.encoding === "boolean"
        ? BigInt(fixture.final)
        : bits(fixture.final),
    );
    if (fixture.encoding === "optional") compare(64 + cell.valueOffset + 8, 1n);
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
      identifier: "tint.verify.closure-source",
      minimumOS: { major: 26, minor: 6, patch: 2 },
      sdk: { major: 26, minor: 6, patch: 0 },
      maxByteLength: 1048576,
    });
    assert.ok(image.ok);
    const name = fixture.name,
      path = join(directory, name);
    writeFileSync(path, image.value.bytes, { mode: 0o755 });
    const signature = spawnSync(
      "/usr/bin/codesign",
      ["--verify", "--strict", path],
      { encoding: "utf8" },
    );
    assert.equal(signature.status, 0, signature.stderr);
    for (let i = 0; i < 2; i++) {
      const run = spawnSync(path, [], { timeout: 10000 });
      assert.equal(run.error, undefined, name);
      assert.equal(run.signal, null, name);
      assert.equal(run.status, 0, name);
    }
  }
  console.log(
    "Verified 4 internally signed source closure fixtures, each executed twice: shared captures, repeated calls, loops, postfix snapshots and assignment evaluation order.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
