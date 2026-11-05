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

import {
  lowerClosureFactory,
  planScalarClosures,
} from "@tint/ts-native/closure/lowering";

assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const directory = mkdtempSync(join(tmpdir(), "tint-closure-factory-"));
try {
  const cases = [
    {
      name: "numeric-standard-globals",
      source:
        "interface C {readonly get:()=>number;readonly run:(n:number)=>number;readonly safe:()=>number;readonly valid:(n:number)=>boolean} function make(start:number):C {let x=start;return {get:()=>Math.floor(x),run:n=>Math.floor(n),safe:()=>Number.MAX_SAFE_INTEGER,valid:n=>Number.isInteger(Math.floor(n))};}",
      initial: [-0, 3.75],
      calls: [
        [0, 1, 0, -0],
        [1, 1, 0, 3],
        [0, 2, -3.75, -4],
        [1, 2, 0, 0],
        [0, 2, -0, -0],
        [0, 2, Infinity, Infinity],
        [0, 2, -Infinity, -Infinity],
        [0, 2, -Number.MIN_VALUE, -1],
        [0, 3, 0, Number.MAX_SAFE_INTEGER],
        [0, 4, NaN, 0],
        [1, 4, 3.75, 1],
      ],
    },
    {
      name: "generic-contract",
      source:
        "interface Reader<T>{readonly get:()=>T} interface Counter<T> extends Reader<T>{readonly add:(n:T)=>T} function make(start:number):Counter<number> {let x=start;return {get:()=>x,add:n=>{x+=n;return x;}};}",
      initial: [2, 11],
      calls: [
        [0, 1, 0, 2],
        [1, 1, 0, 11],
        [0, 2, 5, 7],
        [0, 1, 0, 7],
        [1, 1, 0, 11],
      ],
    },
    {
      name: "inherited-intersection-contract",
      source:
        "interface Reader {readonly get:()=>number} interface C extends Reader {} type Counter=C & {readonly add:(n:number)=>number}; function make(start:number):Counter {let x=start;return {get:()=>x,add:n=>{x+=n;return x;}};}",
      initial: [3, 10],
      calls: [
        [0, 1, 0, 3],
        [1, 1, 0, 10],
        [0, 2, 5, 8],
        [0, 1, 0, 8],
        [1, 1, 0, 10],
      ],
    },
    {
      name: "parameter-const-and-mutable",
      source:
        "interface C {readonly add:(n:number)=>number;readonly get:()=>number} function make(start:number):C {const step=2;let x=start+step;start++;x+=start;return {add:n=>{x+=n+step;return x;},get:()=>x+start};}",
      initial: [3, 10],
      calls: [
        [0, 2, 0, 13],
        [1, 2, 0, 34],
        [0, 1, 5, 16],
        [0, 2, 0, 20],
        [1, 2, 0, 34],
      ],
    },
    {
      name: "ordered-effects",
      source:
        "interface C {readonly run:()=>number} function make(start:number):C {let x=start;for(let i=0;i<3;i++)x+=i; x+=(x=2);return {run:()=>x++};}",
      initial: [3, 10],
      calls: [
        [0, 1, 0, 8],
        [1, 1, 0, 15],
        [0, 1, 0, 9],
        [1, 1, 0, 16],
      ],
    },
    {
      name: "optional-cell",
      source:
        "interface C {readonly set:(n:number)=>number;readonly get:()=>number} function make(start:number):C {let x:number|undefined=undefined;if(start>0)x=start;return {set:n=>{x=n;return x;},get:()=>x??9};}",
      initial: [0, 4],
      calls: [
        [0, 2, 0, 9],
        [1, 2, 0, 4],
        [0, 1, 7, 7],
        [0, 2, 0, 7],
        [1, 2, 0, 4],
      ],
    },
    {
      name: "boolean-cell",
      source:
        "interface C {readonly run:()=>number} function make(start:number):C {let x=start>0;return {run:()=>{x=!x;return x?1:0;}};}",
      initial: [0, 1],
      calls: [
        [0, 1, 0, 1],
        [1, 1, 0, 0],
        [0, 1, 0, 0],
        [1, 1, 0, 1],
      ],
    },
    {
      name: "recursive-helper",
      source:
        "interface C {readonly run:(n:number)=>number} function make(start:number):C {let x=start;function add(n:number):number {if(n<=0)return x;x++;return add(n-1);}return {run:n=>add(n)};}",
      initial: [3, 10],
      calls: [
        [0, 1, 4, 7],
        [1, 1, 2, 12],
        [0, 1, 1, 8],
        [1, 1, 0, 12],
      ],
    },
    {
      name: "mutual-and-void",
      source:
        "interface C {readonly run:(n:number)=>number} function make(start:number):C {let x=start;function even(n:number):void {if(n<=0)return;x+=2;odd(n-1);}function odd(n:number):void {if(n<=0)return;x++;even(n-1);}return {run:n=>{even(n);return x;}};}",
      initial: [3, 10],
      calls: [
        [0, 1, 4, 9],
        [1, 1, 2, 13],
        [0, 1, 1, 11],
        [1, 1, 0, 13],
      ],
    },
    {
      name: "borrowed-array",
      source:
        "interface C {readonly run:(n:number)=>number} function make(start:number,data:Uint32Array):C {let x=start;data.fill(start);return {run:n=>{data[1]=n+x;x++;return (data[1]??0)+data.length;}};}",
      initial: [3, 10],
      calls: [
        [0, 1, 3, 14],
        [1, 1, 4, 22],
        [0, 1, 1, 13],
        [1, 1, 0, 19],
      ],
    },
    {
      name: "failed-construction",
      source:
        "interface C {readonly run:()=>number} function make(start:number):C|undefined {if(start<0)return undefined;let x=start;return {run:()=>x++};}",
      initial: [-1, 4],
      statuses: [0, 1],
      calls: [
        [1, 1, 0, 4],
        [1, 1, 0, 5],
      ],
    },
    {
      name: "throw-propagation",
      source:
        'interface C {readonly run:(n:number)=>number} function make(start:number):C {let x=start;function leaf(n:number):number {if(n<0)throw "invalid index";return n;}function check(n:number):number {return leaf(n);}return {run:n=>{x+=check(n);return x;}};}',
      initial: [3, 10],
      throws: [[0, 1, -1, "invalid index"]] as const,
      calls: [
        [0, 1, 2, 5],
        [1, 1, 0, 10],
      ],
    },
    {
      name: "Uint8Array",
      source:
        "interface C {readonly run:(n:number)=>number;readonly get:()=>number;readonly outside:()=>number} function make(start:number,data:Uint8Array):C {let x=start;data.fill(start);return {run:n=>{data[1]=n+x;x++;return (data[1]??0)+data.length;},get:()=>data[0]??0,outside:()=>{data[8]=77;return data[8]??9;}};}",
      initial: [253, 250],
      calls: [
        [0, 2, 0, 253],
        [1, 2, 0, 250],
        [0, 1, 10, 15],
        [1, 1, 10, 12],
        [0, 1, -255, 263],
        [0, 3, 0, 9],
        [1, 3, 0, 9],
      ],
      elementBytes: 1,
    },
    {
      name: "Uint16Array",
      source:
        "interface C {readonly run:(n:number)=>number;readonly get:()=>number;readonly outside:()=>number} function make(start:number,data:Uint16Array):C {let x=start;data.fill(start);return {run:n=>{data[1]=n+x;x++;return (data[1]??0)+data.length;},get:()=>data[0]??0,outside:()=>{data[8]=77;return data[8]??9;}};}",
      initial: [65533, 65530],
      calls: [
        [0, 2, 0, 65533],
        [1, 2, 0, 65530],
        [0, 1, 10, 15],
        [1, 1, 10, 12],
        [0, 1, -65535, 65543],
        [0, 3, 0, 9],
        [1, 3, 0, 9],
      ],
      elementBytes: 2,
    },
    {
      name: "type-aliases",
      source:
        "type Count=number;type C={readonly add:(n:Count)=>Count;readonly get:()=>Count};function make(start:Count):C {let x=start;return {add:n=>{x+=n;return x;},get:()=>x};}",
      initial: [3, 10],
      calls: [
        [0, 1, 4, 7],
        [1, 1, 2, 12],
        [0, 2, 0, 7],
        [1, 2, 0, 12],
      ],
    },
    {
      name: "literal-types",
      source:
        "type Count=1|2;type C={readonly get:()=>Count;readonly value:()=>Count;readonly flag:()=>true};function make(start:number):C {let x:Count=1;const flag:true=true;return {get:()=>{x=2;return x;},value:()=>x,flag:()=>flag};}",
      initial: [3, 10],
      calls: [
        [0, 2, 0, 1],
        [0, 1, 0, 2],
        [0, 2, 0, 2],
        [1, 2, 0, 1],
        [0, 3, 0, 1],
      ],
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
    const layouts = planScalarClosures(
      checked.value,
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

    assert.ok(environment.layout.size <= 64);
    const cell = environment.cells[0];
    assert.ok(cell);
    const lowered = lowerClosureFactory(checked.value, 0, environment);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const compiled = lowered.value;
    const native = emitDarwinModule(compiled.module);
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
      immediate: 512,
      shift: 0,
      setFlags: false,
    });
    for (let offset = 0; offset < 512; offset += 8)
      emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
    for (let instance = 0; instance < 2; instance++) {
      addr(9, 256 + instance * 32);
      emit({
        op: "str",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: 216 + instance * 32,
      });
      imm(
        9,
        fixture.elementBytes === 1 ? 2n : fixture.elementBytes === 2 ? 3n : 4n,
      );
      emit({
        op: "str",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: 192 + instance * 32,
      });
      imm(9, 1n);
      emit({
        op: "str",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: 200 + instance * 32,
      });
      imm(9, 8n);
      emit({
        op: "str",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: 208 + instance * 32,
      });
    }
    function invoke(
      instance: number,
      id: number,
      arg: number,
      expected: number | undefined,
      thrown?: string,
    ) {
      for (let offset = 0; offset < 32; offset += 8)
        emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
      imm(9, bits(arg));
      emit({ op: "fmov-d-x", rd: 0, rn: 9 });
      addr(0, 448);
      addr(1, 64 + instance * 64);
      imm(2, 0n);
      addr(3, 0);
      addr(4, 192 + instance * 32);
      branch(id, { op: "bl" });
      if (thrown !== undefined) {
        compare(0, 2n);
        compare(16, 3n);
        emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 24 });
        const check = (offset: number, expected: bigint, byte: boolean) => {
          emit(
            byte
              ? { op: "ldrb", rt: 11, rn: 9, offset }
              : { op: "ldr", width: 64, rt: 11, rn: 9, offset },
          );
          imm(10, expected);
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 11,
            rm: 10,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          branch("fail", { op: "b.cond", condition: "ne" });
        };
        check(0, 1n, false);
        check(8, 1n, false);
        check(16, BigInt(thrown.length), false);
        for (let i = 0; i < thrown.length; i++) {
          const unit = thrown.charCodeAt(i);
          check(24 + i * 2, BigInt(unit % 256), true);
          check(25 + i * 2, BigInt(Math.floor(unit / 256)), true);
        }
        return;
      }
      compare(0, 1n);
      if (expected !== undefined)
        compare(
          16,
          compiled.module.functions[id]?.returnType === "boolean"
            ? BigInt(expected)
            : bits(expected),
        );
    }
    fixture.initial.forEach((arg, instance) =>
      invoke(
        instance,
        compiled.initializer,
        arg,
        fixture.statuses?.[instance] ?? 1,
      ),
    );
    for (const [instance, id, arg, message] of fixture.throws ?? [])
      invoke(instance, id, arg, undefined, message);
    for (const [instance, id, arg, expected] of fixture.calls) {
      assert.notEqual(instance, undefined);
      assert.notEqual(id, undefined);
      assert.notEqual(arg, undefined);
      invoke(instance!, id!, arg!, expected);
    }
    if (fixture.elementBytes !== undefined)
      for (let instance = 0; instance < 2; instance++)
        compare(256 + instance * 32 + fixture.elementBytes * 8, 0n);
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
      immediate: 512,
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
      identifier: "tint.verify.closure-factory",
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
    "Verified 16 source factory initializer fixtures, each executed twice: two independent environments, parameter/const/mutable initialization, ordered effects, boolean and optional captures, recursive and mutually recursive helpers, byte/halfword/word array captures, failed construction and literal throw propagation.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
