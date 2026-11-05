import { emitDarwinModule } from "./aarch64-executable.ts";
import type { AArch64AddressReference as AddressReference } from "@tint/codegen/aarch64/image-relocations";
/** Fixture-only Darwin thread policy. Workers execute raw scalar code, never
 * Tint's managed function ABI, allocation callbacks or another thread's context. */
import assert from "node:assert/strict";
import { auditContentionLeaf } from "./native-contention-leaf-audit.ts";
import { bindHostOperations, type ModuleIR } from "@tint/ir/scalar";

import {
  relativeAddress,
  writeInstruction,
  type Instruction,
  type Condition,
} from "@tint/codegen/aarch64/isa";
export const contentionLayout = {
  bytes: 16384,
  start: 0,
  abort: 4,
  ready0: 8,
  ready1: 12,
  loaded0: 16,
  loaded1: 20,
  attempted0: 24,
  attempted1: 28,
  counter: 64,
  record0: 128,
  record1: 192,
  base: 0,
  readyAddress: 8,
  thread: 16,
  returned: 24,
  completed: 32,
  status: 40,
  mismatches: 48,
  peerLoadedAddress: 56,
} as const;
const frameBytes = 96;
export function contentionCode(
  width: 1 | 2 | 4,
  iterations: number = 1000,
  firstAttemptGate = true,
) {
  assert.ok(
    (width === 1 || width === 2 || width === 4) &&
      Number.isInteger(iterations) &&
      iterations >= 1 &&
      iterations <= 100000,
    "bounded contention policy",
  );
  const source: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "cas",
        exported: true,
        parameters: [0, 1, 2, 3, 4, 5],
        slots: ["number", "number", "number", "number", "number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 0, start: 0, end: 0 },
            ],
            terminator: { kind: "return", value: 0, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  const bound = bindHostOperations(source, [
    { function: 0, operation: "shared-compare-exchange-unsigned" },
  ]);
  assert.ok(bound.ok);
  const native = emitDarwinModule(bound.value);
  assert.ok(native.ok);
  assert.equal(native.value.imports.length, 0);
  assert.equal(native.value.helpers.length, 1);
  const leaf = native.value.helpers[0]!;
  assert.equal(leaf.kind, "shared-compare-exchange-unsigned");
  assert.ok(
    leaf.offset >= 0 &&
      leaf.byteLength > 0 &&
      leaf.offset + leaf.byteLength <= native.value.code.length,
  );
  assert.ok(
    native.value.functions.every(
      (fn) => fn.offset + fn.byteLength <= leaf.offset,
    ),
  );
  assert.equal(native.value.managedImports.length, 0);
  assert.equal(native.value.functionDescriptorImport, undefined);
  const fn = native.value.functions[0]!;
  assert.equal(fn.signature.parameters.length, 6);
  assert.ok(
    fn.signature.parameters.every(
      (p, index) => p.kind === "float" && p.index === index,
    ),
  );
  assert.equal(fn.signature.stackBytes, 0);
  const casLeafBytes = native.value.code.slice(
    leaf.offset,
    leaf.offset + leaf.byteLength,
  );
  const leafAudit = auditContentionLeaf(casLeafBytes);
  const instructions: Instruction[] = [],
    labels = new Map<string, number>(),
    branches: {
      at: number;
      name: string;
      condition: Condition | undefined;
      link: boolean;
    }[] = [],
    addresses: { at: number; name: string; rd: number }[] = [],
    addressFixups: AddressReference[] = [],
    calls: { offset: number; name: string }[] = [];
  const emit = (i: Instruction) => {
    instructions.push(i);
  };
  const label = (name: string) => {
    assert.ok(!labels.has(name));
    labels.set(name, instructions.length * 4);
  };
  function branch(name: string, condition?: Condition, link = false) {
    branches.push({ at: instructions.length, name, condition, link });
    emit(
      condition === undefined
        ? { op: link ? "bl" : "b", displacement: 0 }
        : { op: "b.cond", condition, displacement: 0 },
    );
  }
  function imm(rd: number, value: number) {
    assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff);
    emit({ op: "movz", width: 64, rd, immediate: value % 65536, shift: 0 });
    if (value >= 65536)
      emit({
        op: "movk",
        width: 64,
        rd,
        immediate: Math.floor(value / 65536),
        shift: 16,
      });
  }
  function move(rd: number, rn: number) {
    emit({ op: "orr-reg", width: 64, rd, rn: "zr", rm: rn });
  }
  function add(rd: number, rn: number | "sp", immediate: number) {
    emit({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate: immediate > 4095 ? immediate / 4096 : immediate,
      shift: immediate > 4095 ? 12 : 0,
      setFlags: false,
    });
  }
  function compare(rn: number, rm: number | "zr", bits: 32 | 64 = 64) {
    emit({
      op: "sub-reg",
      width: bits,
      rd: "zr",
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  }
  function compareImm(rn: number, value: number, bits: 32 | 64 = 64) {
    const scratch = rn === 9 ? 11 : 9;
    imm(scratch, value);
    compare(rn, scratch, bits);
  }
  function load(
    rt: number,
    rn: number | "sp",
    offset: number,
    bits: 32 | 64 = 64,
  ) {
    emit({ op: "ldr", width: bits, rt, rn, offset });
  }
  function store(
    rt: number,
    rn: number | "sp",
    offset: number,
    bits: 32 | 64 = 64,
  ) {
    emit({ op: "str", width: bits, rt, rn, offset });
  }
  function address(rd: number, name: string) {
    const result = relativeAddress(rd, 17, 0);
    assert.ok(result.ok);
    addresses.push({ at: instructions.length, name, rd });
    for (const i of result.value) emit(i);
  }
  function foreign(name: string) {
    const result = relativeAddress(16, 17, 0);
    assert.ok(result.ok);
    addressFixups.push({
      offset: instructions.length * 4,
      rd: 16,
      scratch: 17,
      target: { kind: "import", name },
    });
    for (const i of result.value) emit(i);
    load(16, 16, 0);
    calls.push({ offset: instructions.length * 4, name });
    emit({ op: "blr", rn: 16 });
  }
  function prologue() {
    emit({
      op: "stp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: -frameBytes,
      mode: "pre",
    });
    add(29, "sp", 0);
    for (let r = 19; r <= 27; r += 2)
      emit({
        op: "stp",
        width: 64,
        rt: r,
        rt2: r + 1,
        rn: "sp",
        offset: 16 + (r - 19) * 8,
        mode: "offset",
      });
  }
  function epilogue() {
    for (let r = 19; r <= 27; r += 2)
      emit({
        op: "ldp",
        width: 64,
        rt: r,
        rt2: r + 1,
        rn: "sp",
        offset: 16 + (r - 19) * 8,
        mode: "offset",
      });
    emit({
      op: "ldp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: frameBytes,
      mode: "post",
    });
    emit({ op: "ret", rn: 30 });
  }
  function publish(offset: number, value: number) {
    add(10, 19, offset);
    imm(9, value);
    emit({ op: "stlr", width: 32, rt: 9, rn: 10 });
  }
  function fail(code: number, target = "abort-workers") {
    imm(21, code);
    branch(target);
  }
  const entryOffset = 0;
  label("main");
  prologue();
  imm(20, 0);
  imm(21, 42);
  imm(22, 0);
  imm(0, 0);
  imm(1, contentionLayout.bytes);
  imm(2, 3);
  imm(3, 0x1002);
  emit({ op: "orn-reg", width: 64, rd: 4, rn: "zr", rm: "zr" });
  imm(5, 0);
  foreign("_mmap");
  move(19, 0);
  compareImm(19, 0);
  branch("map-failed", "le");
  // Private exact address domain matches the trusted leaves; no pointer is boxed.
  emit({ op: "orn-reg", width: 64, rd: 9, rn: "zr", rm: "zr" });
  emit({ op: "ubfm", width: 64, rd: 9, rn: 9, immr: 0, imms: 52 });
  add(10, 19, contentionLayout.bytes);
  compare(10, 9);
  branch("map-invalid", "hi");
  imm(9, 0xa5a5a5a5);
  store(9, 19, 60, 32);
  for (let i = width; i < width + 8; i++) {
    imm(9, 165);
    emit({ op: "strb", rt: 9, rn: 19, offset: 64 + i });
  }
  for (const [record, ready, peer] of [
    [128, 8, 20],
    [192, 12, 16],
  ]) {
    store(19, 19, record!);
    add(9, 19, ready!);
    store(9, 19, record! + 8);
    add(9, 19, peer!);
    store(9, 19, record! + 56);
  }
  for (let index = 0; index < 2; index++) {
    add(0, 19, 128 + index * 64 + 16);
    imm(1, 0);
    address(2, "worker");
    add(3, 19, 128 + index * 64);
    foreign("_pthread_create");
    compare(0, "zr", 32);
    branch("create-failed-" + index, "ne");
    imm(20, index + 1);
  }
  imm(23, 0x3fffffff);
  label("parent-ready");
  add(10, 19, 8);
  emit({ op: "ldar", width: 32, rt: 9, rn: 10 });
  add(11, 19, 12);
  emit({ op: "ldar", width: 32, rt: 10, rn: 11 });
  emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
  compareImm(9, 1, 32);
  branch("start-workers", "eq");
  emit({ op: "yield" });
  emit({
    op: "sub-imm",
    width: 64,
    rd: 23,
    rn: 23,
    immediate: 1,
    shift: 0,
    setFlags: true,
  });
  branch("parent-ready", "ne");
  fail(5);
  label("create-failed-0");
  fail(3);
  label("create-failed-1");
  fail(4);
  label("abort-workers");
  publish(4, 1);
  label("start-workers");
  publish(0, 1);
  // Join every successfully created thread before releasing its mapping.
  compareImm(20, 0);
  branch("unmap", "eq");
  load(0, 19, 144);
  add(1, 19, 152);
  foreign("_pthread_join");
  compare(0, "zr", 32);
  branch("joined-first", "eq");
  imm(22, 1);
  imm(21, 6);
  label("joined-first");
  compareImm(20, 2);
  branch("joined-all", "ne");
  load(0, 19, 208);
  add(1, 19, 216);
  foreign("_pthread_join");
  compare(0, "zr", 32);
  branch("joined-all", "eq");
  imm(22, 1);
  imm(21, 6);
  label("joined-all");
  compareImm(22, 0);
  branch("return-main", "ne"); // Unknown join status: retain mapping through process exit.
  compareImm(21, 42);
  branch("unmap", "ne");
  for (const record of [128, 192]) {
    load(9, 19, record + 24);
    compareImm(9, 0);
    branch("worker-failed", "ne");
    load(9, 19, record + 40, 32);
    compareImm(9, 0, 32);
    branch("worker-failed", "ne");
    load(9, 19, record + 32, 32);
    compareImm(9, iterations, 32);
    branch("worker-failed", "ne");
  }
  load(9, 19, 176, 32);
  load(10, 19, 240, 32);
  emit({
    op: "add-reg",
    width: 64,
    rd: 9,
    rn: 9,
    rm: 10,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  compareImm(9, 0);
  branch("no-contention", "eq");
  const memoryWidth = width === 1 ? 8 : width === 2 ? 16 : 32;
  add(10, 19, 64);
  emit({ op: "ldar", width: memoryWidth, rt: 10, rn: 10 });
  compareImm(
    10,
    (iterations * 2) % (width === 1 ? 256 : width === 2 ? 65536 : 4294967296),
  );
  branch("wrong-counter", "ne");
  load(10, 19, 60, 32);
  compareImm(10, 0xa5a5a5a5, 32);
  branch("wrong-counter", "ne");
  for (let i = width; i < width + 8; i++) {
    emit({ op: "ldrb", rt: 10, rn: 19, offset: 64 + i });
    compareImm(10, 165);
    branch("wrong-counter", "ne");
  }
  branch("unmap");
  label("worker-failed");
  imm(21, 7);
  branch("unmap");
  label("no-contention");
  imm(21, 8);
  branch("unmap");
  label("wrong-counter");
  imm(21, 9);
  branch("unmap");
  label("map-invalid");
  imm(21, 2);
  label("unmap");
  move(0, 19);
  imm(1, 16384);
  foreign("_munmap");
  compare(0, "zr", 32);
  branch("return-main", "eq");
  imm(21, 10);
  branch("return-main");
  label("map-failed");
  imm(21, 1);
  label("return-main");
  move(0, 21);
  epilogue();
  const workerOffset = instructions.length * 4;
  label("worker");
  prologue();
  move(20, 0);
  load(19, 20, 0);
  imm(21, iterations);
  imm(22, iterations * 1024);
  imm(24, 0);
  imm(26, width === 1 ? 255 : width === 2 ? 65535 : 0xffffffff);
  load(10, 20, 8);
  imm(9, 1);
  emit({ op: "stlr", width: 32, rt: 9, rn: 10 });
  function waitFor(name: string, pointer: () => void) {
    imm(25, 0x3fffffff);
    label(name);
    add(10, 19, 4);
    emit({ op: "ldar", width: 32, rt: 9, rn: 10 });
    compareImm(9, 0);
    branch("worker-fail", "ne");
    pointer();
    emit({ op: "ldar", width: 32, rt: 10, rn: 10 });
    compareImm(10, 1);
    branch(name + "-done", "eq");
    emit({ op: "yield" });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 25,
      rn: 25,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    branch(name, "ne");
    branch("worker-fail");
    label(name + "-done");
  }
  waitFor("worker-start", () => add(10, 19, 0));
  add(27, 19, 64);
  emit({ op: "ldar", width: memoryWidth, rt: 23, rn: 27 });
  load(10, 20, 8);
  add(10, 10, 8);
  imm(9, 1);
  emit({ op: "stlr", width: 32, rt: 9, rn: 10 });
  waitFor("worker-loaded", () => load(10, 20, 56));
  label("increment");
  move(0, 19);
  imm(1, 16384);
  imm(2, 64);
  imm(3, width);
  move(4, 23);
  add(5, 23, 1);
  emit({ op: "and-reg", width: 64, rd: 5, rn: 5, rm: 26 });
  branch("cas-leaf", undefined, true);
  if (firstAttemptGate) {
    // Preserve raw observed x0. The initial winner cannot wrap the narrow word
    // before its peer's first CAS; later attempts skip this completed gate.
    load(10, 20, 8);
    add(10, 10, 16);
    emit({ op: "ldar", width: 32, rt: 9, rn: 10 });
    compareImm(9, 0);
    branch("first-attempt-complete", "ne");
    imm(9, 1);
    emit({ op: "stlr", width: 32, rt: 9, rn: 10 });
    waitFor("first-attempt-peer", () => {
      load(10, 20, 56);
      add(10, 10, 8);
    });
    label("first-attempt-complete");
  }
  emit({ op: "orn-reg", width: 64, rd: 9, rn: "zr", rm: "zr" });
  compare(0, 9);
  branch("worker-fail", "eq");
  compare(0, 23);
  branch("incremented", "eq");
  move(23, 0);
  add(24, 24, 1);
  emit({
    op: "sub-imm",
    width: 64,
    rd: 22,
    rn: 22,
    immediate: 1,
    shift: 0,
    setFlags: true,
  });
  branch("increment", "ne");
  branch("worker-fail");
  label("incremented");
  emit({
    op: "sub-imm",
    width: 64,
    rd: 21,
    rn: 21,
    immediate: 1,
    shift: 0,
    setFlags: true,
  });
  branch("worker-success", "eq");
  emit({ op: "ldar", width: memoryWidth, rt: 23, rn: 27 });
  branch("increment");
  label("worker-success");
  imm(9, iterations);
  store(9, 20, 32, 32);
  imm(0, 0);
  branch("worker-return");
  label("worker-fail");
  imm(0, 1);
  label("worker-return");
  store(0, 20, 40, 32);
  store(24, 20, 48, 32);
  epilogue();
  const casLeafOffset = instructions.length * 4;
  labels.set("cas-leaf", casLeafOffset);
  for (const fix of branches) {
    const target = labels.get(fix.name);
    assert.notEqual(target, undefined);
    instructions[fix.at] =
      fix.condition === undefined
        ? { op: fix.link ? "bl" : "b", displacement: target! - fix.at * 4 }
        : {
            op: "b.cond",
            condition: fix.condition,
            displacement: target! - fix.at * 4,
          };
  }
  for (const fix of addresses) {
    const result = relativeAddress(
      fix.rd,
      17,
      labels.get(fix.name)! - fix.at * 4,
    );
    assert.ok(result.ok);
    for (let i = 0; i < 4; i++) instructions[fix.at + i] = result.value[i]!;
  }
  const code = new Uint8Array(casLeafOffset + casLeafBytes.length);
  instructions.forEach((i, index) =>
    assert.ok(writeInstruction(code, index * 4, i).ok, JSON.stringify(i)),
  );
  code.set(casLeafBytes, casLeafOffset);
  return {
    firstAttemptGate,
    leafAudit,
    code,
    instructions,
    addressFixups,
    imports: ["_mmap", "_munmap", "_pthread_create", "_pthread_join"],
    calls,
    entryOffset,
    workerOffset,
    casLeafOffset,
    casLeafBytes,
    casLeafByteLength: casLeafBytes.length,
    frameBytes,
    width,
    iterations,
    layout: contentionLayout,
  };
}
export type ContentionCode = ReturnType<typeof contentionCode>;
