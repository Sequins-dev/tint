import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
import { createRegionAllocator } from "@tint/native-runtime/allocators/region";
// Source-to-native closure entry gate. Environment allocation and entry calls are test adapters.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
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
const directory = mkdtempSync(join(tmpdir(), "tint-native-allocator-"));
try {
  const allocatorSource = readFileSync(
    new URL(
      "../packages/native-runtime/src/allocators/region/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const cases = [
    { name: "split-and-coalesce", words: 24 + 96 },
    { name: "metadata-exhaustion", words: 3 + 96 },
  ];
  for (const fixture of cases) {
    const bytes = new TextEncoder().encode(allocatorSource),
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

    assert.ok(environment.layout.size <= 256);
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
      immediate: 2048,
      shift: 0,
      setFlags: false,
    });
    for (let offset = 0; offset < 2048; offset += 8)
      emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
    const metadata = [
      new Uint32Array(fixture.words),
      new Uint32Array(fixture.words),
    ];
    const model = metadata.map((m, i) => {
      const a = createRegionAllocator(i === 0 ? 64 : 128, 8, m);
      assert.ok(a);
      return a;
    });
    for (let instance = 0; instance < 2; instance++) {
      addr(9, 640 + instance * 512);
      emit({
        op: "str",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: 600 + instance * 32,
      });
      imm(9, 4n);
      emit({
        op: "str",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: 576 + instance * 32,
      });
      imm(9, 1n);
      emit({
        op: "str",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: 584 + instance * 32,
      });
      imm(9, BigInt(fixture.words));
      emit({
        op: "str",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: 592 + instance * 32,
      });
    }
    function invoke(
      instance: number,
      id: number,
      arg: number,
      expected: number | boolean | undefined,
      limit = 8,
    ) {
      for (let offset = 0; offset < 32; offset += 8)
        emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
      imm(9, bits(arg));
      emit({ op: "fmov-d-x", rd: 0, rn: 9 });
      imm(9, bits(limit));
      emit({ op: "fmov-d-x", rd: 1, rn: 9 });
      addr(0, 1792);
      addr(1, 64 + instance * 256);
      imm(2, 0n);
      addr(3, 0);
      addr(4, 576 + instance * 32);
      branch(id, { op: "bl" });
      compare(0, 1n);
      const type = compiled.module.functions[id]?.returnType;
      compare(
        16,
        typeof expected === "boolean"
          ? BigInt(Number(expected))
          : expected === undefined
            ? 0n
            : bits(expected),
      );
      if (type === "optional-number")
        compare(24, expected === undefined ? 0n : 1n);
      // Compare both complete metadata buffers after every call, catching aliasing and unintended mutation.
      for (let owner = 0; owner < 2; owner++)
        for (let i = 0; i < fixture.words; i += 2) {
          const m = metadata[owner];
          assert.ok(m);
          compare(
            640 + owner * 512 + i * 4,
            BigInt(m[i] ?? 0) | (BigInt(m[i + 1] ?? 0) << 32n),
          );
        }
    }
    // Initialize one at a time: the second buffer is still all zero before its factory runs.
    metadata[1]!.fill(0);
    invoke(0, 0, 64, true);
    const second = createRegionAllocator(128, 8, metadata[1]!);
    assert.ok(second);
    model[1] = second;
    invoke(1, 0, 128, true);
    const methods = new Map(compiled.exports.map((e) => [e.name, e.function]));
    function operation(
      instance: number,
      name:
        | "allocate"
        | "allocateFromEnd"
        | "allocateBelow"
        | "allocateAbove"
        | "release"
        | "allocationSize"
        | "usedBytes",
      arg: number,
      limit = 8,
    ) {
      const allocator = model[instance],
        id = methods.get(name);
      assert.ok(allocator);
      assert.notEqual(id, undefined);
      const expected = allocator[name](arg, limit);
      invoke(instance, id!, arg, expected, limit);
    }
    for (const instance of [0, 1]) {
      operation(instance, "usedBytes", 0);
      operation(instance, "allocate", 0);
      operation(instance, "allocateBelow", 16, 8);
      operation(instance, "allocateAbove", 16, instance === 0 ? 64 : 128);
      operation(instance, "allocate", 1);
      operation(instance, "allocate", 17);
      operation(instance, "allocateFromEnd", 16);
      operation(instance, "allocateFromEnd", 32);
      operation(instance, "release", instance === 0 ? 48 : 112);
      operation(instance, "allocationSize", 0);
      operation(instance, "release", 3);
      operation(instance, "release", 0);
      operation(instance, "allocate", 8);
      operation(instance, "allocate", 128);
      operation(instance, "release", 8);
      operation(instance, "release", 0);
      operation(instance, "allocate", 64);
      operation(instance, "usedBytes", 0);
      operation(instance, "allocationSize", 0);
      operation(instance, "release", 0);
      operation(instance, "allocate", NaN);
      operation(instance, "allocate", Infinity);
      operation(instance, "allocate", -1);
    }
    let seed = 12345;
    for (let i = 0; i < 80; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const instance = seed & 1,
        selector = (seed >>> 1) % 7,
        arg = ((seed >>> 4) % 20) * 8;
      operation(
        instance,
        selector === 0
          ? "allocate"
          : selector === 1
            ? "release"
            : selector === 2
              ? "allocationSize"
              : selector === 3
                ? "usedBytes"
                : selector === 4
                  ? "allocateFromEnd"
                  : selector === 5
                    ? "allocateBelow"
                    : "allocateAbove",
        arg,
        (seed >>> 16) % 129,
      );
    }
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
      immediate: 2048,
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
      identifier: "tint.verify.native-allocator",
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
    if (process.env.TINT_BUILD_ONLY === "1") {
      console.log(path);
      continue;
    }
    for (let i = 0; i < 2; i++) {
      const run = spawnSync(path, [], { timeout: 10000 });
      assert.equal(run.error, undefined, name);
      assert.equal(run.signal, null, name);
      assert.equal(run.status, 0, name);
    }
  }
  if (process.env.TINT_BUILD_ONLY !== "1")
    console.log(
      "Verified unchanged region allocator source natively: 2 metadata capacities, 2 independent instances each, 128 calls per fixture, exact returns and both metadata buffers checked after every call; each executable ran twice.",
    );
} finally {
  if (
    process.env.TINT_BUILD_ONLY !== "1" &&
    process.env.TINT_KEEP_NATIVE !== "1"
  )
    rmSync(directory, { recursive: true, force: true });
}
