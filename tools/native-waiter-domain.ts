import type { AArch64AddressReference as AddressReference } from "@tint/codegen/aarch64/image-relocations";
/** Bounded two-record waiter prototype, never a production host capability.
 * Darwin mutex/condition ABI and raw platform entries stay in fixture tooling. */
import assert from "node:assert/strict";
import {
  relativeAddress,
  writeInstruction,
  type Instruction,
  type Condition,
} from "@tint/codegen/aarch64/isa";
import { contentionCode } from "./native-contention-fixture.ts";
export const waiterLayout = {
  bytes: 16384,
  mutex: 0,
  conditions: [64, 112, 160],
  sequence: 208,
  active: 212,
  signals: 216,
  abort: 220,
  completed: 224,
  payload: 256,
  records: [512, 640],
  controllerTimespec: 320,
  record: {
    base: 0,
    condition: 8,
    thread: 16,
    joined: 24,
    state: 32,
    result: 36,
    parks: 40,
    sequence: 44,
    block: 48,
    offset: 56,
    width: 64,
    expected: 72,
    timespec: 80,
    deadline: 104,
    durationNanoseconds: 112,
  },
} as const;
export function waiterCode() {
  const t1 = contentionCode(4, 1),
    prologue = t1.instructions.slice(0, 7),
    epilogue = t1.instructions.slice(
      t1.casLeafOffset / 4 - 7,
      t1.casLeafOffset / 4,
    );
  assert.equal(prologue[0]?.op, "stp");
  assert.equal(epilogue[6]?.op, "ret");
  const instructions: Instruction[] = [],
    labels = new Map<string, number>(),
    fixes: {
      at: number;
      label: string;
      condition: Condition | undefined;
      link: boolean;
    }[] = [],
    addresses: { at: number; label: string; rd: number }[] = [],
    addressFixups: AddressReference[] = [],
    calls: { offset: number; name: string }[] = [],
    imports: string[] = [];
  const e = (i: Instruction) => instructions.push(i),
    label = (s: string) => {
      assert.ok(!labels.has(s));
      labels.set(s, instructions.length * 4);
    };
  function b(s: string, condition?: Condition, link = false) {
    fixes.push({ at: instructions.length, label: s, condition, link });
    e(
      condition
        ? { op: "b.cond", condition, displacement: 0 }
        : { op: link ? "bl" : "b", displacement: 0 },
    );
  }
  function imm(rd: number, n: number | bigint) {
    assert.ok(typeof n === "bigint" || Number.isSafeInteger(n));
    let v = BigInt(n);
    assert.ok(v >= 0n && v < 1n << 64n);
    e({ op: "movz", width: 64, rd, immediate: Number(v & 65535n), shift: 0 });
    for (const shift of [16, 32, 48] as const)
      if (v >> BigInt(shift) !== 0n)
        e({
          op: "movk",
          width: 64,
          rd,
          immediate: Number((v >> BigInt(shift)) & 65535n),
          shift,
        });
  }
  function mov(rd: number, rn: number) {
    e({ op: "orr-reg", width: 64, rd, rn: "zr", rm: rn });
  }
  function add(rd: number, rn: number, n: number) {
    assert.ok(n >= 0 && n <= 4095);
    e({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate: n,
      shift: 0,
      setFlags: false,
    });
  }
  function regadd(rd: number, rn: number, rm: number) {
    e({
      op: "add-reg",
      width: 64,
      rd,
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  }
  function cmp(rn: number, rm: number | "zr", width: 32 | 64 = 64) {
    e({
      op: "sub-reg",
      width,
      rd: "zr",
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  }
  function ci(rn: number, n: number, width: 32 | 64 = 64) {
    const scratch = rn === 15 ? 14 : 15;
    imm(scratch, n);
    cmp(rn, scratch, width);
  }
  function load(rt: number, rn: number, offset: number, width: 32 | 64 = 64) {
    e({ op: "ldr", width, rt, rn, offset });
  }
  function store(rt: number, rn: number, offset: number, width: 32 | 64 = 64) {
    e({ op: "str", width, rt, rn, offset });
  }
  function put(rn: number, offset: number, n: number, width: 32 | 64 = 32) {
    imm(9, n);
    store(9, rn, offset, width);
  }
  function increment(offset: number, delta: 1 | -1) {
    load(9, 19, offset, 32);
    e({
      op: delta === 1 ? "add-imm" : "sub-imm",
      width: 32,
      rd: 9,
      rn: 9,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    store(9, 19, offset, 32);
  }
  function foreign(name: string) {
    if (!imports.includes(name)) imports.push(name);
    const a = relativeAddress(16, 17, 0);
    assert.ok(a.ok);
    addressFixups.push({
      offset: instructions.length * 4,
      rd: 16,
      scratch: 17,
      target: { kind: "import", name },
    });
    a.value.forEach(e);
    load(16, 16, 0);
    calls.push({ offset: instructions.length * 4, name });
    e({ op: "blr", rn: 16 });
  }
  function address(rd: number, name: string) {
    const a = relativeAddress(rd, 17, 0);
    assert.ok(a.ok);
    addresses.push({ at: instructions.length, label: name, rd });
    a.value.forEach(e);
  }
  function start() {
    prologue.forEach(e);
  }
  function finish() {
    epilogue.forEach(e);
  }
  function failure(code: number, target = "abort-main") {
    imm(22, code);
    b(target);
  }
  function checkC(code: number, target = "abort-main") {
    cmp(0, "zr", 32);
    const name = "check-ok-" + instructions.length;
    b(name, "eq");
    failure(code, target);
    label(name);
  }
  // Main owns all initialized-object and successfully-created-thread counts.
  label("main");
  start();
  imm(20, 0);
  imm(21, 0);
  imm(22, 42);
  imm(23, 0);
  imm(24, 0);
  imm(25, 0);
  imm(0, 0);
  imm(1, 16384);
  imm(2, 3);
  imm(3, 0x1002);
  imm(4, (1n << 64n) - 1n);
  imm(5, 0);
  foreign("_mmap");
  mov(19, 0);
  ci(19, 0);
  b("map-failed", "le");
  mov(0, 19);
  imm(1, 0);
  foreign("_pthread_mutex_init");
  cmp(0, "zr", 32);
  b("mutex-init-failed", "ne");
  imm(23, 1);
  for (const offset of waiterLayout.conditions) {
    add(0, 19, offset);
    imm(1, 0);
    foreign("_pthread_cond_init");
    cmp(0, "zr", 32);
    b("condition-init-failed", "ne");
    e({
      op: "add-imm",
      width: 64,
      rd: 20,
      rn: 20,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
  }
  put(19, 320, 5, 64);
  put(19, 328, 0, 64);
  put(19, 252, 0xa5a5a5a5);
  put(19, 272, 0xa5a5a5a5);
  for (const [index, record] of waiterLayout.records.entries()) {
    store(19, 19, record);
    add(9, 19, waiterLayout.conditions[index]!);
    store(9, 19, record + 8);
    put(19, record + 48, 7, 64);
    put(19, record + 56, 0, 64);
    put(19, record + 64, index === 0 ? 4 : 8, 64);
  }
  // Same wait entry is used for mismatch, zero park and pthread starts.
  put(19, 512 + 72, 1, 64);
  add(0, 19, 512);
  b("wait", undefined, true);
  ci(0, 2);
  b("mismatch-failed", "ne");
  load(9, 19, 512 + 40, 32);
  ci(9, 0);
  b("mismatch-failed", "ne");
  load(9, 19, 212, 32);
  ci(9, 0);
  b("mismatch-failed", "ne");
  put(19, 512 + 72, 0, 64);
  add(0, 19, 512);
  b("wait", undefined, true);
  ci(0, 3);
  b("zero-failed", "ne");
  load(9, 19, 512 + 40, 32);
  ci(9, 1);
  b("zero-failed", "cc");
  load(9, 19, 212, 32);
  ci(9, 0);
  b("zero-failed", "ne");
  for (const record of waiterLayout.records) {
    for (const offset of [32, 36, 40, 44, 96]) put(19, record + offset, 0);
    put(19, record + 80, 5, 64);
    put(19, record + 88, 0, 64);
    put(19, record + 112, 5000000000, 64);
  }
  for (const offset of [208, 212, 216, 220, 224]) put(19, offset, 0);
  mov(0, 19);
  foreign("_pthread_mutex_lock");
  checkC(7, "unsafe-main");
  imm(25, 1);
  for (let index = 0; index < 2; index++) {
    const record = waiterLayout.records[index]!;
    add(0, 19, record + 16);
    imm(1, 0);
    address(2, "wait");
    add(3, 19, record);
    foreign("_pthread_create");
    checkC(8 + index);
    imm(21, index + 1);
    awaitCount("registered-" + index, 212, index + 1);
  }
  load(9, 19, 512 + 44, 32);
  load(10, 19, 640 + 44, 32);
  cmp(9, 10, 32);
  b("registration-failed", "cs");
  for (const record of waiterLayout.records) {
    load(9, 19, record + 40, 32);
    ci(9, 1);
    b("registration-failed", "cc");
  }
  mov(0, 19);
  foreign("_pthread_mutex_unlock");
  checkC(12, "unsafe-main");
  imm(25, 0);
  // All notify calls take the real domain mutex, including zero/absent keys.
  callNotify(7, 0, 0, 4, 0);
  callNotify(7, 4, 2, 4, 0);
  callNotify(8, 0, 2, 8, 0);
  mov(0, 19);
  foreign("_pthread_mutex_lock");
  checkC(13, "unsafe-main");
  imm(25, 1);
  load(9, 19, 212, 32);
  ci(9, 2);
  b("notify-failed", "ne");
  load(9, 19, 216, 32);
  ci(9, 0);
  b("notify-failed", "ne");
  for (const record of waiterLayout.records) {
    load(9, 19, record + 32, 32);
    ci(9, 1);
    b("notify-failed", "ne");
  }
  mov(0, 19);
  foreign("_pthread_mutex_unlock");
  checkC(14, "unsafe-main");
  imm(25, 0);
  callNotify(7, 0, 1, 8, 1); // FIFO worker0 width4 is selected by width8 notify.
  mov(0, 19);
  foreign("_pthread_mutex_lock");
  checkC(15, "unsafe-main");
  imm(25, 1);
  awaitCount("completed-first", 224, 1);
  load(9, 19, 512 + 32, 32);
  ci(9, 2);
  b("notify-failed", "ne");
  load(9, 19, 640 + 32, 32);
  ci(9, 1);
  b("notify-failed", "ne");
  load(9, 19, 212, 32);
  ci(9, 1);
  b("notify-failed", "ne");
  mov(0, 19);
  foreign("_pthread_mutex_unlock");
  checkC(16, "unsafe-main");
  imm(25, 0);
  callNotify(7, 0, 0xffffffff, 4, 1); // Remaining width8 worker is selected by width4.
  mov(0, 19);
  foreign("_pthread_mutex_lock");
  checkC(17, "unsafe-main");
  imm(25, 1);
  awaitCount("completed-all", 224, 2);
  load(9, 19, 212, 32);
  ci(9, 0);
  b("notify-failed", "ne");
  load(9, 19, 216, 32);
  ci(9, 2);
  b("notify-failed", "ne");
  mov(0, 19);
  foreign("_pthread_mutex_unlock");
  checkC(18, "unsafe-main");
  imm(25, 0);
  b("join-main");
  function awaitCount(name: string, offset: number, expected: number) {
    imm(26, 16);
    label(name);
    load(9, 19, offset, 32);
    ci(9, expected);
    b(name + "-done", "eq");
    add(0, 19, 160);
    mov(1, 19);
    add(2, 19, 320);
    foreign("_pthread_cond_timedwait_relative_np");
    cmp(0, "zr", 32);
    b("controller-timeout", "ne");
    e({
      op: "sub-imm",
      width: 64,
      rd: 26,
      rn: 26,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    b(name, "ne");
    b("controller-timeout");
    label(name + "-done");
  }
  function callNotify(
    block: number,
    offset: number,
    count: number,
    width: number,
    expected: number,
  ) {
    mov(0, 19);
    imm(1, block);
    imm(2, offset);
    imm(3, count);
    imm(4, width);
    b("notify", undefined, true);
    ci(0, expected);
    b("notify-failed", "ne");
  }
  label("mismatch-failed");
  failure(4);
  label("zero-failed");
  failure(5);
  label("registration-failed");
  failure(10);
  label("controller-timeout");
  failure(11);
  label("notify-failed");
  failure(19);
  label("abort-main");
  ci(23, 1);
  b("cleanup-main", "ne");
  ci(25, 1);
  b("abort-locked", "eq");
  mov(0, 19);
  foreign("_pthread_mutex_lock");
  checkC(20, "unsafe-main");
  imm(25, 1);
  label("abort-locked");
  put(19, 220, 1);
  for (const record of waiterLayout.records) {
    load(9, 19, record + 32, 32);
    ci(9, 1);
    b("abort-next-" + record, "ne");
    put(19, record + 32, 4);
    increment(212, -1);
    label("abort-next-" + record);
    load(0, 19, record + 8);
    foreign("_pthread_cond_signal");
  }
  mov(0, 19);
  foreign("_pthread_mutex_unlock");
  checkC(21, "unsafe-main");
  imm(25, 0);
  label("join-main");
  for (let index = 0; index < 2; index++) {
    ci(21, index + 1);
    b("join-next-" + index, "cc");
    const record = waiterLayout.records[index]!;
    load(0, 19, record + 16);
    add(1, 19, record + 24);
    foreign("_pthread_join");
    cmp(0, "zr", 32);
    b("join-next-" + index, "eq");
    imm(24, 1);
    imm(22, 22);
    label("join-next-" + index);
  }
  ci(24, 0);
  b("return-main", "ne");
  ci(22, 42);
  b("cleanup-main", "ne");
  for (const record of waiterLayout.records) {
    load(9, 19, record + 24);
    ci(9, 0);
    b("result-failed", "ne");
    load(9, 19, record + 36, 32);
    ci(9, 0);
    b("result-failed", "ne");
    load(9, 19, record + 32, 32);
    ci(9, 2);
    b("result-failed", "ne");
  }
  for (const offset of [252, 272]) {
    load(9, 19, offset, 32);
    imm(10, 0xa5a5a5a5);
    cmp(9, 10, 32);
    b("result-failed", "ne");
  }
  load(9, 19, 256);
  ci(9, 0);
  b("result-failed", "ne");
  b("cleanup-main");
  label("result-failed");
  imm(22, 23);
  label("cleanup-main");
  for (let index = 2; index >= 0; index--) {
    ci(20, index + 1);
    b("destroy-next-" + index, "cc");
    add(0, 19, waiterLayout.conditions[index]!);
    foreign("_pthread_cond_destroy");
    cmp(0, "zr", 32);
    b("destroy-next-" + index, "eq");
    imm(22, 24);
    imm(24, 1);
    label("destroy-next-" + index);
  }
  ci(23, 1);
  b("unmap-main", "ne");
  mov(0, 19);
  foreign("_pthread_mutex_destroy");
  cmp(0, "zr", 32);
  b("unmap-main", "eq");
  imm(22, 25);
  imm(24, 1);
  label("unmap-main");
  ci(24, 0);
  b("return-main", "ne");
  mov(0, 19);
  imm(1, 16384);
  foreign("_munmap");
  cmp(0, "zr", 32);
  b("return-main", "eq");
  imm(22, 26);
  b("return-main");
  label("condition-init-failed");
  imm(22, 3);
  b("cleanup-main");
  label("mutex-init-failed");
  imm(22, 2);
  b("unmap-main");
  label("map-failed");
  imm(22, 1);
  b("return-main");
  label("unsafe-main");
  imm(22, 27);
  label("return-main");
  mov(0, 22);
  finish();
  // pthread-compatible wait entry; all mutable domain records are mutex-owned.
  const waitOffset = instructions.length * 4;
  label("wait");
  start();
  mov(20, 0);
  load(19, 20, 0);
  imm(22, 1);
  mov(0, 19);
  foreign("_pthread_mutex_lock");
  cmp(0, "zr", 32);
  b("wait-unlocked-return", "ne");
  load(9, 19, 220, 32);
  ci(9, 0);
  b("wait-error", "ne");
  e({ op: "dmb", domain: "ish" });
  add(27, 19, 256);
  load(9, 20, 56);
  regadd(27, 27, 9);
  load(9, 20, 64);
  ci(9, 4);
  b("wait-load64", "ne");
  e({ op: "ldar", width: 32, rt: 9, rn: 27 });
  b("wait-loaded");
  label("wait-load64");
  e({ op: "ldar", width: 64, rt: 9, rn: 27 });
  label("wait-loaded");
  e({ op: "dmb", domain: "ish" });
  load(10, 20, 72);
  cmp(9, 10);
  b("wait-mismatch", "ne");
  increment(208, 1);
  load(9, 19, 208, 32);
  store(9, 20, 44, 32);
  put(20, 32, 1);
  increment(212, 1);
  imm(0, 4);
  foreign("_clock_gettime_nsec_np");
  mov(24, 0);
  load(9, 20, 112);
  regadd(24, 24, 9);
  store(24, 20, 104);
  add(0, 19, 160);
  foreign("_pthread_cond_signal");
  cmp(0, "zr", 32);
  b("wait-error", "ne");
  imm(21, 1000000);
  label("wait-park");
  load(9, 20, 40, 32);
  e({
    op: "add-imm",
    width: 32,
    rd: 9,
    rn: 9,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  store(9, 20, 40, 32);
  load(0, 20, 8);
  mov(1, 19);
  add(2, 20, 80);
  foreign("_pthread_cond_timedwait_relative_np");
  mov(23, 0);
  load(9, 20, 32, 32);
  ci(9, 2);
  b("wait-notified", "eq");
  ci(9, 4);
  b("wait-error", "eq");
  ci(23, 60, 32);
  b("wait-timeout", "eq");
  ci(23, 0, 32);
  b("wait-recompute", "eq");
  ci(23, 4, 32);
  b("wait-error", "ne");
  label("wait-recompute");
  imm(0, 4);
  foreign("_clock_gettime_nsec_np");
  cmp(0, 24);
  b("wait-timeout", "cs");
  e({
    op: "sub-reg",
    width: 64,
    rd: 26,
    rn: 24,
    rm: 0,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  imm(10, 1000000000);
  // Fixed prototype deadlines are at most five seconds: exact integer division
  // by repeated subtraction needs at most five iterations, no new ISA surface.
  imm(9, 0);
  label("wait-split-seconds");
  cmp(26, 10);
  b("wait-split-done", "cc");
  e({
    op: "sub-reg",
    width: 64,
    rd: 26,
    rn: 26,
    rm: 10,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  e({
    op: "add-imm",
    width: 64,
    rd: 9,
    rn: 9,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  b("wait-split-seconds");
  label("wait-split-done");
  store(9, 20, 80);
  store(26, 20, 88);
  e({
    op: "sub-imm",
    width: 64,
    rd: 21,
    rn: 21,
    immediate: 1,
    shift: 0,
    setFlags: true,
  });
  b("wait-park", "ne");
  b("wait-error");
  label("wait-notified");
  imm(22, 0);
  b("wait-complete");
  label("wait-mismatch");
  imm(22, 2);
  b("wait-complete");
  label("wait-timeout");
  put(20, 32, 3);
  increment(212, -1);
  imm(22, 3);
  b("wait-complete");
  label("wait-error");
  load(9, 20, 32, 32);
  ci(9, 1);
  b("wait-error-marked", "ne");
  put(20, 32, 4);
  increment(212, -1);
  label("wait-error-marked");
  imm(22, 1);
  label("wait-complete");
  store(22, 20, 36, 32);
  increment(224, 1);
  add(0, 19, 160);
  foreign("_pthread_cond_signal");
  mov(0, 19);
  foreign("_pthread_mutex_unlock");
  cmp(0, "zr", 32);
  b("wait-unlocked-return", "eq");
  imm(22, 1);
  label("wait-unlocked-return");
  mov(0, 22);
  finish();
  // count/width are native integers. Width validates the view, not queue identity.
  const notifyOffset = instructions.length * 4;
  label("notify");
  start();
  mov(19, 0);
  mov(20, 1);
  mov(21, 2);
  mov(22, 3);
  imm(23, 0);
  ci(4, 4);
  b("notify-width-valid", "eq");
  ci(4, 8);
  b("notify-bad", "ne");
  label("notify-width-valid");
  mov(0, 19);
  foreign("_pthread_mutex_lock");
  cmp(0, "zr", 32);
  b("notify-bad", "ne");
  label("notify-next");
  ci(22, 0);
  b("notify-unlock", "eq");
  imm(24, 0);
  imm(25, 0xffffffff);
  for (const record of waiterLayout.records) {
    load(9, 19, record + 32, 32);
    ci(9, 1);
    b("candidate-next-" + record, "ne");
    load(9, 19, record + 48);
    cmp(9, 20);
    b("candidate-next-" + record, "ne");
    load(9, 19, record + 56);
    cmp(9, 21);
    b("candidate-next-" + record, "ne");
    load(9, 19, record + 44, 32);
    cmp(9, 25);
    b("candidate-next-" + record, "cs");
    add(24, 19, record);
    mov(25, 9);
    label("candidate-next-" + record);
  }
  ci(24, 0);
  b("notify-unlock", "eq");
  put(24, 32, 2);
  increment(212, -1);
  load(0, 24, 8);
  foreign("_pthread_cond_signal");
  cmp(0, "zr", 32);
  b("notify-signal-error", "ne");
  increment(216, 1);
  e({
    op: "add-imm",
    width: 64,
    rd: 23,
    rn: 23,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  e({
    op: "sub-imm",
    width: 64,
    rd: 22,
    rn: 22,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  b("notify-next");
  label("notify-signal-error");
  imm(23, (1n << 64n) - 1n);
  label("notify-unlock");
  mov(0, 19);
  foreign("_pthread_mutex_unlock");
  cmp(0, "zr", 32);
  b("notify-return", "eq");
  label("notify-bad");
  imm(23, (1n << 64n) - 1n);
  label("notify-return");
  mov(0, 23);
  finish();
  for (const f of fixes) {
    const target = labels.get(f.label);
    assert.notEqual(target, undefined, f.label);
    instructions[f.at] = f.condition
      ? {
          op: "b.cond",
          condition: f.condition,
          displacement: target! - f.at * 4,
        }
      : { op: f.link ? "bl" : "b", displacement: target! - f.at * 4 };
  }
  for (const f of addresses) {
    const result = relativeAddress(f.rd, 17, labels.get(f.label)! - f.at * 4);
    assert.ok(result.ok);
    result.value.forEach((i, n) => (instructions[f.at + n] = i));
  }
  const code = new Uint8Array(instructions.length * 4);
  instructions.forEach((i, n) =>
    assert.ok(writeInstruction(code, n * 4, i).ok, JSON.stringify(i)),
  );
  return {
    code,
    instructions,
    addressFixups,
    imports,
    calls,
    entryOffset: 0,
    waitOffset,
    notifyOffset,
    frameBytes: 96,
    layout: waiterLayout,
    sdkLayout: {
      mutexBytes: 64,
      conditionBytes: 48,
      alignment: 8,
      timespecBytes: 16,
      etimedout: 60,
      eintr: 4,
    },
    bridge: {
      source: "tools/native-contention-fixture.ts",
      prologue,
      epilogue,
    },
  };
}
