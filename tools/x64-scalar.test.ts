import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createFunctionBuilder,
  type FunctionBuilder,
  type FunctionIR,
  type ModuleIR,
  type ScalarType,
} from "@tint/ir/scalar";
import { decodeStackMaps, emitModule } from "@tint/codegen/aarch64/scalar";
import {
  nativeStackMapWideVersion,
  nativeStackMapTransitionTable,
} from "@tint/abi/host";
import { createNativeRootScan } from "@tint/native-runtime/tracing";
import type { ImageAddressTarget } from "@tint/abi/relocation";
import { encodeLayout, type Instruction } from "@tint/codegen/x86_64/isa";
import {
  emitModule as emitX64Module,
  imageRelocations,
} from "@tint/codegen/x86_64/scalar";
import { appendHostedEntry } from "@tint/codegen/x86_64/startup";
import { buildElfExecutable } from "@tint/image/linux/elf";
import {
  darwinAArch64Target,
  linuxAArch64Target,
  linuxX86_64Target,
} from "@tint/platform/target";
import {
  buildFreestandingScalarProgram,
  compileScalarModule,
} from "@tint/compiler/native/scalar";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";

const span = { start: 0, end: 0 };
class Fixture {
  readonly ir: FunctionBuilder;
  constructor(id = 0, types: readonly ScalarType[] = []) {
    this.ir = createFunctionBuilder(id, "fixture" + id, types, "number");
  }
  constant(value: number | boolean): number {
    const id = this.ir.next();
    this.ir.emit({ ...span, kind: "constant", id, value });
    return id;
  }
  unary(operator: string, operand: number): number {
    const id = this.ir.next();
    this.ir.emit({ ...span, kind: "unary", id, operator, operand });
    return id;
  }
  binary(operator: string, left: number, right: number): number {
    const id = this.ir.next();
    this.ir.emit({ ...span, kind: "binary", id, operator, left, right });
    return id;
  }
  wrap(value: number): number {
    const id = this.ir.next();
    this.ir.emit({ ...span, kind: "general-wrap", id, value });
    return id;
  }
  unboxNumber(value: number): number {
    const id = this.ir.next();
    this.ir.emit({ ...span, kind: "general-value", type: "number", id, value });
    return id;
  }
  call(target: number, args: number[]): number {
    const id = this.ir.next();
    this.ir.emit({ ...span, kind: "call", target, id, arguments: args });
    return id;
  }
  branch(condition: number, consequent: number, alternate: number): void {
    this.ir.end({ ...span, kind: "branch", condition, consequent, alternate });
  }
  finish(value: number): FunctionIR {
    this.ir.end({ ...span, kind: "return", value });
    return this.ir.finish();
  }
  check(checks: number[]): FunctionIR {
    let passed = this.constant(0);
    for (const check of checks)
      passed = this.binary("+", passed, this.unary("boolean-number", check));
    const success = this.ir.block();
    const failure = this.ir.block();
    this.branch(
      this.binary("===", passed, this.constant(checks.length)),
      success,
      failure,
    );
    this.ir.at(success);
    this.ir.end({ ...span, kind: "return", value: this.constant(42) });
    this.ir.at(failure);
    // Checks are accumulated in the entry. Give each group its own image.
    return this.finish(this.constant(1));
  }
}

function pressure(): ModuleIR {
  const main = new Fixture();
  const helper = new Fixture(1, ["number"]);
  const live = Array.from({ length: 48 }, (_, i) => main.constant(i + 1));
  const result = main.call(1, [main.constant(7)]);
  const sum = live.reduce((a, b) => main.binary("+", a, b), result);
  return {
    functions: [
      main.check([main.binary("===", sum, main.constant(1183))]),
      helper.finish(helper.ir.load(0)),
    ],
  };
}

function overflow(): ModuleIR {
  const types: ScalarType[] = ["general", "number", "boolean", "general"];
  types.push(
    ...Array<ScalarType>(8).fill("number"),
    "boolean",
    "number",
    "boolean",
  );
  const values = [
    31,
    19,
    false,
    37,
    2,
    3,
    5,
    7,
    11,
    13,
    17,
    23,
    false,
    29,
    true,
  ];
  const main = new Fixture();
  const helper = new Fixture(1, types);
  return {
    functions: [
      main.finish(
        main.call(
          1,
          values.map((value, i) => {
            const id = main.constant(value);
            return types[i] === "general" ? main.wrap(id) : id;
          }),
        ),
      ),
      helper.check(
        values.map((value, i) => {
          const id = helper.ir.load(i);
          return helper.binary(
            "===",
            types[i] === "general" ? helper.unboxNumber(id) : id,
            helper.constant(value),
          );
        }),
      ),
    ],
  };
}

function numbers(): ModuleIR {
  const f = new Fixture();
  const checks: number[] = [];
  for (const [operator, left, right, expected] of [
    ["+", 0.25, 0.5, 0.75],
    ["-", 3.5, 1.25, 2.25],
    ["*", -0.5, 2, -1],
    ["/", 1, -0, -Infinity],
    ["/", -2147483648, -1, 2147483648],
    ["/", 1, 0, Infinity],
    ["%", -2147483648, -1, -0],
    ["%", 1, 0, NaN],
    ["%", Infinity, 2, NaN],
    ["%", 3, Infinity, 3],
    ["%", Number.MAX_VALUE, 7, Number.MAX_VALUE % 7],
    ["%", Number.MIN_VALUE * 7, Number.MIN_VALUE * 3, Number.MIN_VALUE],
    ["min", -0, 0, -0],
    ["min", 1, NaN, NaN],
    ["max", -0, 0, 0],
    ["max", NaN, 1, NaN],
  ] as const) {
    const value = f.binary(operator, f.constant(left), f.constant(right));
    if (Number.isNaN(expected)) checks.push(f.binary("!==", value, value));
    else if (expected === 0)
      checks.push(
        f.binary(
          "===",
          f.binary("/", f.constant(1), value),
          f.constant(1 / expected),
        ),
      );
    else checks.push(f.binary("===", value, f.constant(expected)));
  }
  for (const [operator, input, expected] of [
    ["-", 0, -0],
    ["sqrt", -0, -0],
    ["sqrt", 9, 3],
    ["ceil", -0.5, -0],
    ["ceil", 0.25, 1],
    ["ceil", Infinity, Infinity],
    ["trunc", -0.5, -0],
    ["trunc", -2.75, -2],
    ["trunc", -(2 ** 60), -(2 ** 60)],
    ["is-integer", Infinity, false],
    ["is-integer", NaN, false],
    ["is-integer", 0.5, false],
    ["is-integer", 2 ** 60, true],
    ["is-integer", -0, true],
    ["!", NaN, true],
    ["!", -0, true],
    ["truthy", Infinity, true],
  ] as const) {
    const value = f.unary(operator, f.constant(input));
    checks.push(
      Object.is(expected, -0)
        ? f.binary(
            "===",
            f.binary("/", f.constant(1), value),
            f.constant(-Infinity),
          )
        : f.binary("===", value, f.constant(expected)),
    );
  }
  for (const operator of ["===", "==", "<", "<=", ">", ">="])
    checks.push(
      f.unary("!", f.binary(operator, f.constant(NaN), f.constant(1))),
    );
  for (const operator of ["!==", "!="])
    checks.push(f.binary(operator, f.constant(1), f.constant(NaN)));
  checks.push(f.binary("===", f.constant(-0), f.constant(0)));
  return { functions: [f.check(checks)] };
}

function words(): ModuleIR {
  const f = new Fixture();
  const checks: number[] = [];
  for (const [operator, left, right, expected] of [
    ["imul", 0x7fffffff, 2, -2],
    ["imul", -2147483648, -1, -2147483648],
    ["imul", 0xffffffff, 0, 0],
    ["imul", 2 ** 83 + 2 ** 31, 1, -2147483648],
    ["imul", 2 ** 84, 1, 0],
    ["|", -(2 ** 63 + 2048), 0, -2048],
    ["|", -123.9, 0, -123],
    ["|", NaN, 7, 7],
    ["&", Infinity, -1, 0],
    ["^", -1, 0x80000000, 0x7fffffff],
    ["<<", 1, 63, -2147483648],
    [">>", 0x80000000, 63, -1],
    [">>>", -1, 0, 0xffffffff],
  ] as const) {
    checks.push(
      f.binary(
        "===",
        f.binary(operator, f.constant(left), f.constant(right)),
        f.constant(expected),
      ),
    );
  }
  checks.push(f.binary("===", f.unary("~", f.constant(-0)), f.constant(-1)));
  return { functions: [f.check(checks)] };
}

function completion(caught: boolean): ModuleIR {
  const entry = new Fixture();
  const relay = new Fixture(1);
  const thrower = new Fixture(2);
  const value = thrower.constant(42);
  const boxed = thrower.wrap(value);
  thrower.ir.end({ ...span, kind: "throw", value: boxed });
  if (!caught)
    return {
      functions: [
        entry.finish(entry.call(1, [])),
        relay.finish(relay.call(2, [])),
        thrower.ir.finish(),
      ],
    };
  const exception = entry.ir.slot("general");
  const handler = entry.ir.block();
  entry.ir.end({ ...span, kind: "return", value: entry.call(1, []) });
  entry.ir.at(handler);
  const fn = entry.finish(entry.unboxNumber(entry.ir.load(exception)));
  return {
    functions: [
      {
        ...fn,
        blocks: [
          { ...fn.blocks[0]!, exception: { target: handler, slot: exception } },
          fn.blocks[1]!,
        ],
      },
      relay.finish(relay.call(2, [])),
      thrower.ir.finish(),
    ],
  };
}

function switchAndLoop(): ModuleIR {
  const f = new Fixture();
  const slot = f.ir.slot("number");
  const loop = f.ir.block();
  const secondCase = f.ir.block();
  const fallback = f.ir.block();
  const hit = f.ir.block();
  f.ir.save(slot, f.constant(0));
  f.ir.end({ ...span, kind: "jump", target: loop });
  // Scalar IR represents a lowered switch as a chain of conditional branches.
  f.ir.at(loop);
  f.branch(f.binary("===", f.ir.load(slot), f.constant(1)), hit, secondCase);
  f.ir.at(secondCase);
  f.branch(f.binary("===", f.ir.load(slot), f.constant(0)), fallback, hit);
  f.ir.at(fallback);
  f.ir.save(slot, f.binary("+", f.ir.load(slot), f.constant(1)));
  f.ir.end({ ...span, kind: "jump", target: loop });
  f.ir.at(hit);
  return {
    functions: [f.finish(f.binary("+", f.ir.load(slot), f.constant(41)))],
  };
}

function gotImportImage(): Uint8Array {
  const eax = { kind: "gpr", width: 32, index: 0 } as const;
  const edi = { kind: "gpr", width: 32, index: 7 } as const;
  const external = new Map<string, ImageAddressTarget>([
    ["pid", { kind: "import", name: "getpid" }],
  ]);
  const instructions: Instruction[] = [
    {
      op: "call",
      target: {
        kind: "mem",
        width: 64,
        address: { kind: "rip", disp: { kind: "label", label: "pid" } },
      },
    },
    { op: "mov", dst: edi, src: { kind: "imm32", value: 1 } },
    { op: "test", dst: eax, src: eax },
    { op: "jcc", cc: "le", target: { kind: "label", label: "exit" } },
    { op: "mov", dst: edi, src: { kind: "imm32", value: 42 } },
    { op: "label", name: "exit" },
    { op: "mov", dst: eax, src: { kind: "imm32", value: 60 } },
    { op: "syscall" },
  ];
  const encoded = encodeLayout(instructions, (name) => external.has(name));
  const image = buildElfExecutable({
    code: encoded.bytes,
    entryOffset: 0,
    maxByteLength: 1 << 20,
    linux: { arch: "x86_64" },
    imports: ["getpid"],
    ...imageRelocations(encoded.externalFixups, external),
  });
  assert.ok(image.ok, JSON.stringify(!image.ok && image.error));
  return image.value.bytes;
}

test("external RIP fixups use the complete instruction length and check signed reach", () => {
  const external = new Map<string, ImageAddressTarget>([
    ["data", { kind: "data", offset: 0 }],
  ]);
  const encoded = encodeLayout(
    [
      {
        op: "mov",
        dst: {
          kind: "mem",
          width: 32,
          address: {
            kind: "rip",
            disp: { kind: "label", label: "data", addend: 2 },
          },
        },
        src: { kind: "imm32", value: 42 },
      },
    ],
    (name) => external.has(name),
  );
  const { addressFixups, patchAddress } = imageRelocations(
    encoded.externalFixups,
    external,
  );
  const field = addressFixups[0]!.offset;
  const site = 0x100000000;
  const next = site + encoded.bytes.length - field;
  const view = new DataView(encoded.bytes.buffer);
  assert.equal(
    patchAddress(encoded.bytes, 0, field, next - 2 - 0x80000000, site),
    "complete",
  );
  assert.equal(view.getInt32(field, true), -0x80000000);
  assert.equal(
    patchAddress(encoded.bytes, 0, field, next - 2 + 0x7fffffff, site),
    "complete",
  );
  assert.equal(view.getInt32(field, true), 0x7fffffff);
  assert.equal(
    patchAddress(encoded.bytes, 0, field, next - 2 + 0x80000000, site),
    "range",
  );
  assert.equal(
    patchAddress(encoded.bytes, 0, field, next - 2 - 0x80000001, site),
    "range",
  );
  assert.equal(view.getInt32(encoded.bytes.length - 4, true), 42);
});

const fixtures = [
  {
    name: "call and live values across a branch",
    module: pressure(),
    status: 42,
  },
  { name: "mixed overflow arguments", module: overflow(), status: 42 },
  {
    name: "lowered switch and backward branch",
    module: switchAndLoop(),
    status: 42,
  },
  { name: "binary64 and unordered comparisons", module: numbers(), status: 42 },
  { name: "ToInt32 and wrapping arithmetic", module: words(), status: 42 },
  {
    name: "caught completion across two calls",
    module: completion(true),
    status: 42,
  },
  {
    name: "uncaught completion across two calls",
    module: completion(false),
    status: 1,
  },
];

test("freestanding scalar dispatch emits x86-64 ELF images", () => {
  for (const fixture of fixtures) {
    const image = buildFreestandingScalarProgram(
      fixture.module,
      0,
      linuxX86_64Target,
    );
    assert.ok(image.ok, fixture.name + " " + JSON.stringify(image));
    assert.equal(new DataView(image.value.buffer).getUint16(18, true), 62);
  }
});

test("ARM scalar dispatch preserves bytes and metadata on both output targets", () => {
  const module = pressure();
  for (const target of [darwinAArch64Target, linuxAArch64Target]) {
    const emission = compileScalarModule(module, target);
    assert.deepEqual(emission, {
      arch: "aarch64",
      emission: emitModule(module, { hostABI: target.hostABI }),
    });
  }
});

test("x86-64 byte-PC maps relocate live homes across managed and transition frames", () => {
  const entry = new Fixture(0, ["Uint8Array", "general", "Uint8Array"]);
  const relay = new Fixture(1, ["Uint8Array", "general"]);
  const leaf = new Fixture(2);
  function keepAcrossCall(f: Fixture, target: number, args: number[]) {
    const array = f.ir.load(0);
    const value = f.call(target, args);
    const length = f.ir.next();
    f.ir.emit({ ...span, kind: "array-length", id: length, array });
    const number = f.unboxNumber(f.ir.load(1));
    return f.finish(f.binary("+", value, f.binary("+", length, number)));
  }
  const emitted = emitX64Module(
    {
      functions: [
        keepAcrossCall(entry, 1, [entry.ir.load(0), entry.ir.load(1)]),
        keepAcrossCall(relay, 2, []),
        leaf.finish(leaf.constant(0)),
      ],
    },
    linuxX86_64Target.hostABI,
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const native = emitted.value;
  const table = native.stackMaps[0];
  assert.ok(table);
  const code = Buffer.from(native.code);
  assert.equal(
    code.readBigUInt64LE(table.tableOffset + 8),
    BigInt(nativeStackMapWideVersion),
  );
  const maps = decodeStackMaps(native);
  assert.equal(maps?.length, 2);
  const [outer, inner] = maps ?? [];
  assert.ok(outer && inner);
  assert.ok([outer, inner].some((map) => map.offset % 4 !== 0));
  for (const [map, roots] of [
    [outer, 2],
    [inner, 1],
  ] as const) {
    assert.equal(code[map.offset - 5], 0xe8);
    assert.equal(map.references.length, roots);
    assert.equal(map.generals.length, roots);
    assert.deepEqual(map.registers, []);
    assert.deepEqual(map.saves, []);
  }
  const memory = new Map<number, number>();
  const load = (address: number) => memory.get(address);
  const scan = createNativeRootScan(load);
  const codeBase = 0x10000,
    registry = 0x20000,
    thunk = 0x30000;
  const start = 0x40000,
    transition = 0x40100;
  const outerFrame = 0x42000,
    entryFrame = 0x43000;
  const innerFrame = outerFrame - outer.frameBytes - 16;
  function words(address: number, values: number[]) {
    values.forEach((value, index) => memory.set(address + index * 8, value));
  }
  for (let offset = table.tableOffset; offset < code.length; offset += 8)
    memory.set(codeBase + offset, Number(code.readBigUInt64LE(offset)));
  words(registry, [
    2,
    2,
    start,
    0,
    codeBase,
    table.tableOffset,
    codeBase + table.tableOffset,
    thunk,
    16,
    nativeStackMapTransitionTable,
  ]);
  words(start, [transition, thunk + 5]);
  words(transition, [innerFrame]);
  memory.set(transition + 48, transition + 64);
  words(transition + 64, [innerFrame, codeBase + inner.offset]);
  words(innerFrame, [outerFrame, codeBase + outer.offset]);
  words(outerFrame, [entryFrame, 0]);
  words(entryFrame, [0]);
  const roots = new Map<number, number>();
  for (const [fp, map] of [
    [innerFrame, inner],
    [outerFrame, outer],
  ] as const) {
    const base = fp - map.frameBytes;
    for (const offset of map.references) {
      const ref = base + offset;
      words(ref, [0x50000]);
      roots.set(ref, 0x50010);
    }
    for (const offset of map.generals) {
      const tag = base + offset;
      words(tag, [5, 0x50008]);
      roots.set(tag + 8, 0x50018);
    }
  }
  assert.equal(
    scan(registry, (address, slot) => {
      memory.set(slot, address + 16);
      return true;
    }),
    "complete",
  );
  for (const [slot, expected] of roots) assert.equal(load(slot), expected);
  memory.set(innerFrame + 8, codeBase + outer.offset + 1);
  assert.equal(
    scan(registry, () => true),
    "invalid",
  );
});

test("x86-64 marks the thrown tag as a root only after the transfer", () => {
  const module = completion(true);
  const entry = module.functions[0]!;
  const handler = entry.blocks[1]!;
  const collect = createFunctionBuilder(3, "collect", [], "void");
  collect.end({ ...span, kind: "return", value: undefined });
  const compiled = emitX64Module(
    {
      functions: [
        {
          ...entry,
          blocks: [
            entry.blocks[0]!,
            {
              ...handler,
              instructions: [
                {
                  ...span,
                  kind: "call",
                  id: undefined,
                  target: 3,
                  arguments: [],
                },
                ...handler.instructions,
              ],
            },
          ],
        },
        ...module.functions.slice(1),
        collect.finish(),
      ],
    },
    linuxX86_64Target.hostABI,
  );
  assert.ok(compiled.ok, JSON.stringify(compiled));
  const [before, after] = decodeStackMaps(compiled.value) ?? [];
  assert.deepEqual(before?.generals, []);
  assert.equal(after?.generals.length, 1);
});

test("unsupported operations identify the operation and its source location", () => {
  const fn = new Fixture();
  const id = fn.ir.next();
  fn.ir.emit({
    kind: "string-literal",
    value: "unsupported",
    id,
    start: 2,
    end: 5,
  });
  const result = compileScalarModule(
    { functions: [fn.finish(fn.constant(0))] },
    linuxX86_64Target,
  );
  assert.deepEqual(result, {
    arch: "x86_64",
    emission: {
      ok: false,
      error: {
        code: "UNSUPPORTED",
        message: "x86-64 scalar: unsupported instruction string-literal",
        function: 0,
        block: 0,
        span: { start: 2, end: 5 },
      },
    },
  });
});

function overlappingArrayCopyImage(): Uint8Array {
  const f = new Fixture();
  const array = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "array-new",
    id: array,
    type: "Uint32Array",
    length: f.constant(4),
  });
  for (const [index, value] of [1, 2, 42, 4].entries())
    f.ir.emit({
      ...span,
      kind: "array-write",
      array,
      index: f.constant(index),
      value: f.constant(value),
    });
  const source = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "array-subarray",
    id: source,
    array,
    begin: f.constant(0),
    length: f.constant(3),
  });
  function copyAt(offset: number): number {
    const id = f.ir.next();
    f.ir.emit({
      ...span,
      kind: "array-copy",
      id,
      array,
      source,
      offset: f.constant(offset),
    });
    return id;
  }
  const copied = copyAt(1);
  const rejected = f.binary("===", copyAt(2), f.constant(false));
  const contents = [1, 1, 2, 42].map((expected, index) => {
    const id = f.ir.next();
    f.ir.emit({
      ...span,
      kind: "array-element",
      id,
      array,
      index: f.constant(index),
    });
    return f.binary("===", id, f.constant(expected));
  });
  return hostedFixtureImage({
    functions: [f.check([copied, rejected, ...contents])],
  });
}

function hostedFixtureImage(module: ModuleIR): Uint8Array {
  const target = linuxX86_64Target;
  const compiled = emitX64Module(module, target.hostABI);
  assert.ok(compiled.ok, JSON.stringify(compiled));
  const image = appendHostedEntry({
    native: compiled.value,
    host: target.hostABI,
    invocation: compiled.value.functions[0]!.offset,
    returnType: "number",
    managedBytes: 4096,
    stackBytes: 1048576,
    pageBytes: target.memoryPageBytes,
  });
  const written = buildElfExecutable({
    ...image,
    code: new Uint8Array(0),
    linux: { arch: "x86_64" },
  });
  assert.ok(written.ok, JSON.stringify(written));
  return written.value.bytes;
}

function guardedRecordImage(): Uint8Array {
  const f = new Fixture();
  const objectSlot = f.ir.slot("reference");
  const transfer = f.ir.slot("number");
  const failed = f.ir.block();
  const uninitialized = f.ir.block();
  const initialized = f.ir.block();
  const alreadyInitialized = f.ir.block();
  const rejectedLayout = f.ir.block();
  const read = f.ir.block();
  const object = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "record-new",
    id: object,
    record: 0,
    arguments: [undefined],
  });
  f.ir.save(objectSlot, object);
  f.ir.save(transfer, f.constant(42));
  function cell(
    operation: "read" | "initialize",
    consequent: number,
    alternate: number,
  ): void {
    f.ir.end({
      ...span,
      kind: "record-cell",
      operation,
      object: f.ir.load(objectSlot),
      record: 0,
      field: 0,
      slot: transfer,
      consequent,
      alternate,
    });
  }
  cell("read", failed, uninitialized);
  f.ir.at(uninitialized);
  cell("initialize", initialized, failed);
  f.ir.at(initialized);
  f.ir.save(transfer, f.constant(1));
  cell("initialize", failed, alreadyInitialized);
  f.ir.at(alreadyInitialized);
  f.ir.end({
    ...span,
    kind: "record",
    operation: "write",
    object: f.ir.load(objectSlot),
    record: 1,
    field: 0,
    slot: transfer,
    consequent: failed,
    alternate: rejectedLayout,
  });
  f.ir.at(rejectedLayout);
  cell("read", read, failed);
  f.ir.at(failed);
  f.ir.end({ ...span, kind: "return", value: f.constant(1) });
  f.ir.at(read);
  return hostedFixtureImage({
    records: [
      {
        byteLength: 24,
        fields: [{ type: "number", offset: 8, stateOffset: 16, mutable: true }],
      },
      {
        byteLength: 24,
        fields: [{ type: "number", offset: 8, mutable: true }],
      },
    ],
    functions: [f.finish(f.ir.load(transfer))],
  });
}

function referenceVectorImage(): Uint8Array {
  const f = new Fixture();
  const length = f.constant(3);
  const first = f.ir.next();
  f.ir.emit({ ...span, kind: "reference-vector-new", length, id: first });
  const other = f.ir.next();
  f.ir.emit({ ...span, kind: "reference-vector-new", length, id: other });
  function wrap(value: number): number {
    const id = f.ir.next();
    f.ir.emit({ ...span, kind: "reference-wrap", id, value });
    return id;
  }
  const self = wrap(first),
    destination = wrap(other);
  const zero = f.constant(0);
  f.ir.emit({
    ...span,
    kind: "reference-vector-write",
    vector: first,
    index: zero,
    value: self,
  });
  f.ir.emit({
    ...span,
    kind: "reference-vector-copy",
    source: first,
    target: other,
    count: length,
    rebase: true,
  });
  const value = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "reference-vector-read",
    vector: other,
    index: zero,
    id: value,
  });
  const invalid = f.ir.next();
  const fractional = f.constant(0.5);
  f.ir.emit({
    ...span,
    kind: "reference-vector-read",
    vector: other,
    index: fractional,
    id: invalid,
  });
  const absent = f.ir.next();
  f.ir.emit({ ...span, kind: "reference-none", id: absent });
  const branded = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "reference-vector-is",
    vector: destination,
    id: branded,
  });
  const capacity = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "reference-vector-length",
    vector: other,
    id: capacity,
  });
  return hostedFixtureImage({
    functions: [
      f.check([
        branded,
        f.binary("===", value, destination),
        f.binary("===", invalid, absent),
        f.binary("===", length, capacity),
      ]),
    ],
  });
}

const runnerFixtures = [
  ...fixtures.map(({ name, module, status }) => ({
    name,
    status,
    bytes: () => {
      const image = buildFreestandingScalarProgram(
        module,
        0,
        linuxX86_64Target,
      );
      assert.ok(image.ok, JSON.stringify(image));
      return image.value;
    },
  })),
  {
    name: "reference vector copies rebase the source identity",
    status: 42,
    bytes: referenceVectorImage,
  },
  {
    name: "guarded record and cell operations",
    status: 42,
    bytes: guardedRecordImage,
  },
  { name: "RIP-relative GOT import", status: 42, bytes: gotImportImage },
  {
    name: "overlapping hosted typed-array copy",
    status: 42,
    bytes: overlappingArrayCopyImage,
  },
];

test("x86-64 emits bytes-load, bytes-store, and bytes-word64 ops for every DataView element", () => {
  const elements = [
    "i8",
    "u8",
    "i16",
    "u16",
    "i32",
    "u32",
    "f16",
    "f32",
    "f64",
  ] as const;
  const f = new Fixture(0, ["Uint8Array", "number", "boolean", "Uint32Array"]);
  const bytes = f.ir.next();
  f.ir.emit({ ...span, kind: "load", id: bytes, slot: 0 });
  const offset = f.ir.next();
  f.ir.emit({ ...span, kind: "load", id: offset, slot: 1 });
  const le = f.ir.next();
  f.ir.emit({ ...span, kind: "load", id: le, slot: 2 });
  const scratch = f.ir.next();
  f.ir.emit({ ...span, kind: "load", id: scratch, slot: 3 });
  let acc = f.constant(0);
  for (const element of elements) {
    f.ir.emit({
      ...span,
      kind: "bytes-store",
      array: bytes,
      offset,
      value: acc,
      element,
      littleEndian: le,
    });
    const loaded = f.ir.next();
    f.ir.emit({
      ...span,
      kind: "bytes-load",
      id: loaded,
      array: bytes,
      offset,
      element,
      littleEndian: le,
    });
    acc = f.binary("+", acc, loaded);
  }
  f.ir.emit({
    ...span,
    kind: "bytes-word64-load",
    array: bytes,
    offset,
    scratch,
    littleEndian: le,
  });
  f.ir.emit({
    ...span,
    kind: "bytes-word64-store",
    array: bytes,
    offset,
    scratch,
    littleEndian: le,
  });
  const module: ModuleIR = { functions: [f.finish(acc)] };
  const emitted = emitX64Module(module, linuxX86_64Target.hostABI);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  assert.ok(emitted.value.code.length > 0);
});

test("x86-64 emits all unboxed word64 instructions cleanly", () => {
  const f = new Fixture(0, ["BigInt64Array", "number"]);
  const arr = f.ir.next();
  f.ir.emit({ ...span, kind: "load", id: arr, slot: 0 });
  const idx = f.ir.next();
  f.ir.emit({ ...span, kind: "load", id: idx, slot: 1 });
  const c1 = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "word64-constant",
    id: c1,
    low: 0x12345678,
    high: 0x9abcdef0,
  });
  const fromN = f.ir.next();
  f.ir.emit({ ...span, kind: "word64-from-number", id: fromN, value: idx });
  const loaded = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "array-word64-element",
    id: loaded,
    array: arr,
    index: idx,
  });
  const ops = [
    "add",
    "sub",
    "mul",
    "and",
    "or",
    "xor",
    "shl",
    "sar",
    "shr",
  ] as const;
  let cur = loaded;
  for (const operator of ops) {
    const next = f.ir.next();
    f.ir.emit({
      ...span,
      kind: "word64-binary",
      id: next,
      operator,
      left: cur,
      right: operator === "add" ? fromN : c1,
    });
    cur = next;
  }
  const neg = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "word64-unary",
    id: neg,
    operator: "neg",
    operand: cur,
  });
  const not = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "word64-unary",
    id: not,
    operator: "not",
    operand: neg,
  });
  f.ir.emit({
    ...span,
    kind: "array-word64-store",
    array: arr,
    index: idx,
    value: not,
    unchecked: true,
  });
  f.ir.emit({
    ...span,
    kind: "array-word64-store",
    array: arr,
    index: idx,
    value: not,
  });
  const lo = f.ir.next();
  f.ir.emit({ ...span, kind: "word64-part", id: lo, value: not, half: "low" });
  const hi = f.ir.next();
  f.ir.emit({ ...span, kind: "word64-part", id: hi, value: not, half: "high" });
  const packed = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "word64-from-parts",
    id: packed,
    low: lo,
    high: hi,
  });
  const asSigned = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "word64-to-number",
    id: asSigned,
    value: packed,
    signed: true,
  });
  const asUnsigned = f.ir.next();
  f.ir.emit({
    ...span,
    kind: "word64-to-number",
    id: asUnsigned,
    value: packed,
    signed: false,
  });
  const module: ModuleIR = {
    functions: [f.finish(f.binary("+", asSigned, asUnsigned))],
  };
  const emitted = emitX64Module(module, linuxX86_64Target.hostABI);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  assert.ok(emitted.value.code.length > 0);
});

const runner = process.env.TINT_X64_SCALAR_RUNNER;
test(
  "x86-64 runner executes freestanding scalar fixtures",
  {
    skip:
      runner !== "x64-local" &&
      runner !== "x64-qemu-dev" &&
      runner !== "x64-ssh",
  },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "tint-x64-scalar-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const artifacts = runnerFixtures.map(({ bytes }, i) => {
      const path = join(directory, String(i));
      writeFileSync(path, bytes(), { mode: 0o755 });
      return nativeArtifact("linux-x86_64", path);
    });
    const results = runNativeBatch(
      artifacts.map((artifact) => ({ artifact, timeoutMs: 5000 })),
      { ...process.env, TINT_NATIVE_RUNNER: runner },
    );
    for (const [i, result] of results.entries()) {
      const fixture = runnerFixtures[i]!;
      assert.equal(result.executor?.runner, runner, JSON.stringify(result));
      assert.equal(
        result.kind,
        "exited",
        fixture.name + " " + JSON.stringify(result),
      );
      if (result.kind === "exited")
        assert.equal(result.status, fixture.status, fixture.name);
      assert.equal(result.stdout, "", fixture.name);
    }
    assert.equal(results.length, runnerFixtures.length);
    console.log(JSON.stringify(results));
  },
);
