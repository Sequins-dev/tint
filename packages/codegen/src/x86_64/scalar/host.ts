import {
  nativeArrayDataOffset,
  nativeArrayLengthOffset,
  nativeContextDomainOffset,
  nativeGenerationalStateWords,
  nativeIdentityReleasableBaseOffset,
  nativeIdentityReleasableLengthOffset,
  nativeHeaderFlagsShift,
  nativeStackMapRegistryOffset,
  nativeStackMapSaveBlockOffset,
  nativeStackMapRegistryHeaderBytes,
  nativeStackMapRegistryEntryBytes,
  nativeStringDataOffset,
  nativeStringLengthOffset,
  nativeStringMinimumDataBytes,
  nativeStringOneByteFlag,
  nativeStringParentOffset,
  nativeStringSlicedFlag,
  nativeStringSlicedStartOffset,
  nativeTargetOSLinux,
  nativeTargetArchX86_64,
  type PosixHostFacts,
} from "@tint/abi/host";
import {
  nativeFunctionEnvironmentOffset,
  nativeFunctionEntryOffset,
} from "@tint/abi/function";
import type { HostOperation } from "@tint/ir/scalar";
import type { Condition, Gpr, IntegerWidth, Memory } from "../isa.ts";
import {
  allocationStateOffset,
  argumentCountOffset,
  argumentsOffset,
  bits,
  byte,
  externalMemoryOffset,
  gpr,
  imm,
  label,
  managedBaseOffset,
  managedLengthOffset,
  mem,
  word,
  xmm,
  type Emit,
} from "./machine.ts";

import { floatBits } from "./numbers.ts";

const rax = gpr(0),
  rdx = gpr(2),
  rsi = gpr(6),
  rdi = gpr(7);
const eax = word(0),
  edx = word(2),
  edi = word(7);
const r10 = gpr(10),
  r11 = gpr(11);
const x0 = xmm(0),
  x1 = xmm(1);

export function branch(emit: Emit, cc: Condition, target: string): void {
  emit({ op: "jcc", cc, target: label(target) });
}

export function exactInteger(
  emit: Emit,
  source: Memory<64>,
  target: Gpr<32 | 64>,
  invalid: string,
): void {
  emit({ op: "movsd", dst: x0, src: source });
  emit({ op: "cvttsd2si", dst: target, src: x0 });
  emit({ op: "cvtsi2sd", dst: x1, src: target });
  emit({ op: "ucomisd", dst: x0, src: x1 });
  branch(emit, "p", invalid);
  branch(emit, "ne", invalid);
}

interface HostCall {
  readonly operation: HostOperation;
  readonly emit: Emit;
  readonly policy: PosixHostFacts;
  readonly argument: (index: number) => Memory<64>;
  readonly call: (symbol: string) => void;
  readonly threadEntry: (
    operation: "collector-worker-entry" | "hosted-thread-entry",
  ) => Memory<64>;
  readonly scratch: Memory<64>;
  readonly scratchNext: Memory<64>;
  readonly scratchResult: Memory<64>;
  readonly context: Memory<64>;
  readonly ownRootHead: boolean;
  readonly constant: (value: number) => Memory<64>;
  readonly site: string;
  readonly trap: string;
}

/** Emits compiler-authorized host operations through the SysV integer and
 * pointer ABI. A Number result is returned as binary64 bits in RAX. */
export function emitHostCall(request: HostCall): boolean {
  const operation = request.operation,
    policy = request.policy,
    emit = request.emit,
    argument = request.argument,
    call = request.call,
    context = request.context,
    scratch = request.scratch,
    scratchNext = request.scratchNext,
    site = request.site,
    trap = request.trap;

  function libc(symbol: string): void {
    call(policy.symbolPrefix + symbol);
  }
  function numberResult(src: Gpr<32 | 64>): void {
    emit({ op: "cvtsi2sd", dst: x0, src });
    floatBits(emit, rax, x0);
  }
  function integer(
    index: number,
    target: Gpr<32>,
    invalid: string = trap,
  ): void {
    exactInteger(emit, argument(index), target, invalid);
  }
  function array(index: number): void {
    emit({ op: "mov", dst: r10, src: argument(index) });
    emit({
      op: "mov",
      dst: edx,
      src: { ...mem(10, nativeArrayLengthOffset), width: 32 },
    });
    emit({ op: "mov", dst: r10, src: mem(10, nativeArrayDataOffset) });
  }
  function path(index: number, target: Gpr<64>): void {
    array(index);
    emit({ op: "test", dst: edx, src: edx });
    branch(emit, "e", trap);
    emit({
      op: "cmp",
      dst: {
        kind: "mem",
        width: 8,
        address: { kind: "base", base: 10, index: 2, disp: -1 },
      },
      src: { kind: "imm8", value: 0 },
    });
    branch(emit, "ne", trap);
    emit({ op: "mov", dst: target, src: r10 });
  }
  const invalidWord = site + ":word-invalid";
  const wordDone = site + ":word-done";
  function checkedWord(index: number, dst: Gpr<64>, safe: boolean): void {
    exactInteger(emit, argument(index), dst, invalidWord);
    if (safe) {
      emit({ op: "cmp", dst, src: r11 });
      branch(emit, "a", invalidWord);
    }
  }
  function wordWindow(bytes: number, shared: boolean): void {
    const length = gpr(8);
    const offset = gpr(9);
    emit({ op: "mov", dst: r11, src: bits(0xffffffff, 0x1fffff) });
    checkedWord(0, r10, true);
    checkedWord(1, length, true);
    checkedWord(2, offset, true);
    emit({ op: "test", dst: r10, src: r10 });
    branch(emit, "e", invalidWord);
    if (shared) {
      emit({
        op: "lea",
        dst: rax,
        src: {
          kind: "mem",
          width: 64,
          address: { kind: "base", base: 10, index: 8, disp: 0 },
        },
      });
      emit({ op: "cmp", dst: rax, src: r11 });
      branch(emit, "a", invalidWord);
    }
    emit({ op: "sub", dst: length, src: imm(bytes) });
    branch(emit, "b", invalidWord);
    emit({ op: "cmp", dst: offset, src: length });
    branch(emit, "a", invalidWord);
    emit({ op: "add", dst: r10, src: offset });
    emit({ op: "cmp", dst: r10, src: r11 });
    branch(emit, "a", invalidWord);
    emit({ op: "test", dst: r10, src: imm(bytes - 1) });
    branch(emit, "ne", invalidWord);
  }
  function finishWord(): boolean {
    emit({ op: "jmp", target: label(wordDone) });
    emit({ op: "label", name: invalidWord });
    emit({ op: "mov", dst: rax, src: imm(-1) });
    emit({ op: "label", name: wordDone });
    numberResult(rax);
    return true;
  }

  switch (operation) {
    case "context-domain": {
      emit({ op: "mov", dst: rax, src: context });
      emit({ op: "mov", dst: rax, src: mem(0, nativeContextDomainOffset) });
      numberResult(rax);
      return true;
    }
    case "root-head": {
      const done = site + ":root-head";
      emit({ op: "mov", dst: rax, src: context });
      emit({ op: "mov", dst: rax, src: mem(0, nativeStackMapRegistryOffset) });
      emit({ op: "test", dst: rax, src: rax });
      branch(emit, "e", done);
      // The walk visits callers of this frame. When the binding has its
      // own frame, that frame is gone by the time its caller starts a walk.
      emit({
        op: "mov",
        dst: r10,
        src: request.ownRootHead ? mem(5, 0) : gpr(5),
      });
      emit({ op: "mov", dst: mem(0, 16), src: r10 });
      emit({
        op: "mov",
        dst: mem(0, nativeStackMapSaveBlockOffset),
        src: imm(0),
      });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "memory-read-word":
    case "memory-write-word":
    case "memory-load-acquire-word":
    case "memory-store-release-word":
    case "memory-compare-exchange-word":
    case "memory-fetch-add-word": {
      wordWindow(8, false);
      const read =
        operation === "memory-read-word" ||
        operation === "memory-load-acquire-word";
      const store =
        operation === "memory-write-word" ||
        operation === "memory-store-release-word";
      if (!read) checkedWord(3, rdi, operation !== "memory-fetch-add-word");
      if (store) {
        // On TSO MOV already supplies release ordering. The public shared
        // leaves use XCHG for seq-cst stores.
        emit({ op: "mov", dst: mem(10, 0), src: rdi });
        emit({ op: "xor", dst: eax, src: eax });
      } else {
        if (read) emit({ op: "mov", dst: rax, src: mem(10, 0) });
        else if (operation === "memory-fetch-add-word") {
          emit({ op: "lock-xadd", dst: mem(10, 0), src: rdi });
          emit({ op: "mov", dst: rax, src: rdi });
        } else {
          checkedWord(4, rdx, true);
          emit({ op: "mov", dst: rax, src: rdi });
          emit({ op: "lock-cmpxchg", dst: mem(10, 0), src: rdx });
        }
        emit({ op: "cmp", dst: rax, src: r11 });
        branch(emit, "a", invalidWord);
      }
      return finishWord();
    }
    case "shared-read-unsigned":
    case "shared-write-unsigned":
    case "shared-compare-exchange-unsigned":
    case "shared-read-word64":
    case "shared-write-word64":
    case "shared-compare-exchange-word64": {
      const cas =
        operation === "shared-compare-exchange-unsigned" ||
        operation === "shared-compare-exchange-word64";
      const read =
        operation === "shared-read-unsigned" ||
        operation === "shared-read-word64";
      const unsigned =
        operation === "shared-read-unsigned" ||
        operation === "shared-write-unsigned" ||
        operation === "shared-compare-exchange-unsigned";
      const order = gpr(6);
      function checkedPayload(
        index: number,
        dst: Gpr<64>,
        limit: Gpr<64>,
      ): void {
        exactInteger(emit, argument(index), dst, invalidWord);
        emit({ op: "cmp", dst, src: limit });
        branch(emit, "a", invalidWord);
      }
      function halves(index: number, dst: Gpr<64>): void {
        checkedPayload(index, dst, r11);
        checkedPayload(index + 1, rdi, r11);
        emit({ op: "shl", dst: rdi, count: 32 });
        emit({ op: "or", dst, src: rdi });
      }
      function access(width: IntegerWidth): void {
        const cell = { ...mem(10, 0), width };
        const payload = { ...rdx, width };
        const observed = { ...rax, width };
        if (cas) {
          // The locked instruction supplies SC order even on mismatch.
          emit({ op: "lock-cmpxchg", dst: cell, src: payload });
        } else if (read) emit({ op: "mov", dst: observed, src: cell });
        else {
          const plain = site + ":shared-plain-" + width;
          const stored = site + ":shared-stored-" + width;
          emit({ op: "test", dst: order, src: order });
          branch(emit, "e", plain);
          emit({ op: "xchg", dst: cell, src: payload });
          emit({ op: "jmp", target: label(stored) });
          emit({ op: "label", name: plain });
          emit({ op: "mov", dst: cell, src: payload });
          emit({ op: "label", name: stored });
          emit({ op: "xor", dst: eax, src: eax });
        }
        if (width === 8 || width === 16)
          emit({ op: "movzx", dst: eax, src: { ...rax, width } });
      }
      if (!cas) {
        exactInteger(
          emit,
          argument(unsigned ? (read ? 4 : 5) : 3),
          order,
          invalidWord,
        );
        emit({ op: "cmp", dst: order, src: imm(1) });
        branch(emit, "a", invalidWord);
      }
      if (unsigned) {
        const widthArg = gpr(1);
        exactInteger(emit, argument(3), widthArg, invalidWord);
        function unsignedAccess(width: IntegerWidth): void {
          const next = site + ":atomic-width-" + width;
          emit({ op: "cmp", dst: widthArg, src: imm(width / 8) });
          branch(emit, "ne", next);
          wordWindow(width / 8, true);
          if (!read) {
            const limit =
              width === 8 ? 0xff : width === 16 ? 0xffff : 0xffffffff;
            emit({ op: "mov", dst: word(11), src: imm(limit) });
            checkedPayload(cas ? 5 : 4, rdx, r11);
            if (cas) checkedPayload(4, rax, r11);
          }
          access(width);
          emit({ op: "jmp", target: label(wordDone) });
          emit({ op: "label", name: next });
        }
        unsignedAccess(8);
        unsignedAccess(16);
        unsignedAccess(32);
        emit({ op: "jmp", target: label(invalidWord) });
      } else {
        wordWindow(8, true);
        const buffer = gpr(9);
        if (read || cas) {
          emit({ op: "mov", dst: buffer, src: argument(cas ? 7 : 4) });
          emit({ op: "test", dst: buffer, src: buffer });
          branch(emit, "e", invalidWord);
          emit({
            op: "cmp",
            dst: mem(9, nativeArrayLengthOffset),
            src: imm(2),
          });
          branch(emit, "b", invalidWord);
          emit({ op: "mov", dst: buffer, src: mem(9, nativeArrayDataOffset) });
          emit({ op: "test", dst: buffer, src: buffer });
          branch(emit, "e", invalidWord);
          emit({ op: "test", dst: buffer, src: imm(3) });
          branch(emit, "ne", invalidWord);
          emit({ op: "lea", dst: rax, src: mem(9, 8) });
          emit({ op: "cmp", dst: rax, src: r11 });
          branch(emit, "a", invalidWord);
          emit({ op: "cmp", dst: rax, src: r10 });
          const disjoint = site + ":scratch-disjoint";
          branch(emit, "be", disjoint);
          emit({ op: "lea", dst: rax, src: mem(10, 8) });
          emit({ op: "cmp", dst: buffer, src: rax });
          branch(emit, "b", invalidWord);
          emit({ op: "label", name: disjoint });
        }
        if (!read) {
          emit({ op: "mov", dst: word(11), src: imm(0xffffffff) });
          halves(cas ? 5 : 4, rdx);
          if (cas) halves(3, rax);
        }
        access(64);
        if (read || cas) {
          emit({ op: "mov", dst: { ...mem(9, 0), width: 32 }, src: eax });
          emit({ op: "shr", dst: rax, count: 32 });
          emit({ op: "mov", dst: { ...mem(9, 4), width: 32 }, src: eax });
          emit({ op: "xor", dst: eax, src: eax });
        }
      }
      return finishWord();
    }
    case "cpu-pause": {
      emit({ op: "pause" });
      return true;
    }
    case "permanent-function-address":
    case "permanent-array-address": {
      emit({ op: "mov", dst: rax, src: argument(0) });
      if (operation === "permanent-array-address")
        emit({ op: "mov", dst: rax, src: mem(0, nativeArrayDataOffset) });
      numberResult(rax);
      return true;
    }
    case "collector-worker-entry":
    case "hosted-thread-entry": {
      emit({ op: "lea", dst: rax, src: request.threadEntry(operation) });
      numberResult(rax);
      return true;
    }
    case "thread-start":
    case "thread-join": {
      const threads = policy.threads;
      if (threads === undefined) return false;
      const start = operation === "thread-start";
      emit({ op: "mov", dst: r11, src: bits(0xffffffff, 0x1fffff) });
      checkedWord(0, start ? rdx : rdi, true);
      emit({ op: "mov", dst: scratch, src: imm(0) });
      if (start) {
        checkedWord(1, gpr(1), true);
        emit({ op: "test", dst: rdx, src: rdx });
        branch(emit, "e", invalidWord);
        emit({ op: "lea", dst: rdi, src: scratch });
        emit({ op: "xor", dst: word(6), src: word(6) });
        libc(threads.createSymbol);
      } else {
        emit({ op: "test", dst: rdi, src: rdi });
        branch(emit, "e", invalidWord);
        emit({ op: "lea", dst: rsi, src: scratch });
        libc(threads.joinSymbol);
      }
      emit({ op: "neg", dst: eax });
      // pthread returns the error number directly as a C int.
      emit({ op: "movsx", dst: rax, src: eax });
      branch(emit, "ne", wordDone);
      emit({ op: "mov", dst: rax, src: scratch });
      return finishWord();
    }
    case "word-park":
    case "word-wake": {
      const parking = policy.parking;
      if (parking?.kind !== "linux-futex") return false;
      const wait = operation === "word-park";
      const ready = site + ":futex-ready";
      const fourth = gpr(1);
      const timeout = gpr(8);
      emit({ op: "mov", dst: r11, src: bits(0xffffffff, 0x1fffff) });
      checkedWord(0, rsi, true);
      emit({ op: "test", dst: rsi, src: rsi });
      branch(emit, "e", invalidWord);
      emit({ op: "test", dst: rsi, src: imm(3) });
      branch(emit, "ne", invalidWord);
      checkedWord(1, fourth, true);
      emit({ op: "xor", dst: word(8), src: word(8) });
      if (wait) {
        emit({ op: "mov", dst: word(10), src: imm(0xffffffff) });
        emit({ op: "cmp", dst: fourth, src: r10 });
        branch(emit, "a", invalidWord);
        checkedWord(2, rax, true);
        emit({ op: "test", dst: rax, src: rax });
        branch(emit, "e", ready);
        emit({ op: "xor", dst: edx, src: edx });
        emit({ op: "mov", dst: r10, src: imm(1000000000) });
        emit({ op: "div", dst: r10 });
        emit({ op: "mov", dst: scratch, src: rax });
        emit({ op: "mov", dst: scratchNext, src: rdx });
        emit({ op: "lea", dst: timeout, src: scratch });
      } else {
        emit({ op: "cmp", dst: fourth, src: imm(1) });
        branch(emit, "a", invalidWord);
        emit({ op: "test", dst: fourth, src: fourth });
        emit({ op: "mov", dst: fourth, src: imm(1) });
        branch(emit, "e", ready);
        emit({ op: "mov", dst: fourth, src: imm(2147483647) });
      }
      emit({ op: "label", name: ready });
      emit({ op: "mov", dst: edi, src: imm(parking.futexSyscall) });
      emit({
        op: "mov",
        dst: edx,
        src: imm(wait ? parking.waitOperation : parking.wakeOperation),
      });
      emit({ op: "xor", dst: word(9), src: word(9) });
      // syscall is variadic. No floating point arguments and no bitset.
      emit({ op: "xor", dst: eax, src: eax });
      libc(parking.syscallSymbol);
      emit({ op: "test", dst: rax, src: rax });
      branch(emit, "ns", wordDone);
      libc(policy.errnoSymbol);
      emit({ op: "mov", dst: eax, src: { ...mem(0, 0), width: 32 } });
      emit({ op: "neg", dst: rax });
      return finishWord();
    }
    case "generational-state": {
      const invalid = site + ":invalid-state";
      const done = site + ":state-published";
      const old = gpr(8);
      const young = gpr(9);
      emit({ op: "mov", dst: r11, src: context });
      emit({ op: "cmp", dst: mem(11, allocationStateOffset), src: imm(0) });
      branch(emit, "ne", invalid);
      array(0);
      emit({ op: "cmp", dst: edx, src: imm(nativeGenerationalStateWords) });
      branch(emit, "b", invalid);
      emit({ op: "cmp", dst: { ...mem(10, 0), width: 32 }, src: imm(0) });
      branch(emit, "ne", invalid);
      emit({ op: "cmp", dst: { ...mem(10, 12), width: 32 }, src: imm(0) });
      branch(emit, "ne", invalid);
      emit({ op: "mov", dst: word(8), src: { ...mem(10, 28), width: 32 } });
      emit({ op: "cmp", dst: old, src: imm(512) });
      branch(emit, "b", invalid);
      emit({ op: "test", dst: old, src: imm(511) });
      branch(emit, "ne", invalid);
      emit({ op: "cmp", dst: { ...mem(10, 8), width: 32 }, src: word(8) });
      branch(emit, "ne", invalid);
      emit({ op: "mov", dst: word(9), src: { ...mem(10, 4), width: 32 } });
      emit({ op: "cmp", dst: young, src: imm(16) });
      branch(emit, "b", invalid);
      emit({ op: "test", dst: young, src: imm(7) });
      branch(emit, "ne", invalid);
      emit({ op: "mov", dst: rax, src: old });
      emit({ op: "add", dst: rax, src: young });
      emit({ op: "cmp", dst: rax, src: imm(0x7ffffff0) });
      branch(emit, "a", invalid);
      emit({ op: "cmp", dst: rax, src: mem(11, managedLengthOffset) });
      branch(emit, "a", invalid);

      // Compute the required bitmap capacities before any publication.
      emit({ op: "mov", dst: rdi, src: r10 });
      array(1);
      emit({ op: "add", dst: young, src: imm(255) });
      emit({ op: "shr", dst: young, count: 8 });
      emit({ op: "cmp", dst: rdx, src: young });
      branch(emit, "b", invalid);
      emit({ op: "mov", dst: rsi, src: r10 });
      array(2);
      emit({ op: "shr", dst: old, count: 6 });
      emit({ op: "cmp", dst: rdx, src: old });
      branch(emit, "b", invalid);
      emit({ op: "mov", dst: old, src: r10 });
      array(3);
      emit({ op: "test", dst: edx, src: edx });
      branch(emit, "e", invalid);
      emit({ op: "mov", dst: mem(7, 16), src: rsi });
      emit({ op: "mov", dst: { ...mem(7, 24), width: 32 }, src: imm(1) });
      emit({ op: "mov", dst: mem(7, 32), src: old });
      emit({ op: "mov", dst: mem(7, 40), src: r10 });
      emit({ op: "mov", dst: { ...mem(7, 48), width: 32 }, src: imm(0) });
      emit({ op: "mov", dst: { ...mem(7, 52), width: 32 }, src: edx });
      emit({ op: "mov", dst: mem(7, 56), src: imm(0) });
      emit({ op: "mov", dst: mem(11, allocationStateOffset), src: rdi });
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "external-memory-configure": {
      const invalid = site + ":registrar-invalid";
      const done = site + ":registrar-done";
      emit({ op: "mov", dst: r11, src: context });
      emit({ op: "cmp", dst: mem(11, externalMemoryOffset), src: imm(0) });
      branch(emit, "ne", invalid);
      emit({ op: "mov", dst: rax, src: argument(0) });
      emit({ op: "test", dst: rax, src: rax });
      branch(emit, "e", invalid);
      emit({ op: "mov", dst: mem(11, externalMemoryOffset), src: rax });
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "external-memory-register": {
      const invalid = site + ":registrar-invalid";
      const done = site + ":registrar-done";
      emit({ op: "mov", dst: rdi, src: context });
      emit({ op: "mov", dst: r10, src: mem(7, externalMemoryOffset) });
      emit({ op: "test", dst: r10, src: r10 });
      branch(emit, "e", invalid);
      emit({
        op: "mov",
        dst: rsi,
        src: mem(10, nativeFunctionEnvironmentOffset),
      });
      emit({ op: "mov", dst: r10, src: mem(10, nativeFunctionEntryOffset) });
      emit({ op: "xor", dst: edx, src: edx });
      emit({ op: "lea", dst: gpr(1), src: scratch });
      emit({ op: "mov", dst: scratch, src: imm(0) });
      emit({ op: "movsd", dst: x0, src: argument(0) });
      emit({ op: "movsd", dst: x1, src: argument(1) });
      emit({ op: "call", target: r10 });
      emit({ op: "cmp", dst: eax, src: imm(1) });
      branch(emit, "ne", invalid);
      emit({ op: "cmp", dst: request.scratchResult, src: imm(1) });
      branch(emit, "ne", invalid);
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "stack-maps-register": {
      const bad = site + ":register-maps-invalid";
      const done = site + ":register-maps-done";
      const start = gpr(8),
        length = gpr(9),
        table = rdx;
      const limit = rsi,
        entry = rdi,
        count = r10,
        registry = r11;
      emit({ op: "mov", dst: limit, src: bits(0, 0x10000) });
      const numbers = [start, length, table];
      for (let at = 0; at < numbers.length; at++) {
        const value = numbers[at];
        if (value === undefined)
          throw "stack map registration argument invariant";
        exactInteger(emit, argument(at), value, bad);
        emit({ op: "test", dst: value, src: value });
        branch(emit, "le", bad);
        emit({ op: "cmp", dst: value, src: limit });
        branch(emit, "ae", bad);
      }
      emit({ op: "test", dst: table, src: imm(7) });
      branch(emit, "ne", bad);
      emit({ op: "mov", dst: rax, src: start });
      emit({ op: "add", dst: rax, src: length });
      emit({ op: "cmp", dst: rax, src: limit });
      branch(emit, "ae", bad);
      emit({ op: "cmp", dst: table, src: start });
      branch(emit, "b", bad);
      emit({ op: "cmp", dst: table, src: rax });
      branch(emit, "ae", bad);
      emit({ op: "mov", dst: registry, src: context });
      emit({
        op: "mov",
        dst: registry,
        src: mem(11, nativeStackMapRegistryOffset),
      });
      emit({ op: "test", dst: registry, src: registry });
      branch(emit, "e", bad);
      emit({ op: "mov", dst: count, src: mem(11, 0) });
      emit({ op: "cmp", dst: count, src: mem(11, 8) });
      branch(emit, "ae", bad);
      emit({
        op: "imul-imm",
        dst: entry,
        src: count,
        immediate: imm(nativeStackMapRegistryEntryBytes),
      });
      emit({ op: "add", dst: entry, src: registry });
      emit({
        op: "mov",
        dst: mem(7, nativeStackMapRegistryHeaderBytes),
        src: start,
      });
      emit({
        op: "mov",
        dst: mem(7, nativeStackMapRegistryHeaderBytes + 8),
        src: length,
      });
      emit({
        op: "mov",
        dst: mem(7, nativeStackMapRegistryHeaderBytes + 16),
        src: table,
      });
      emit({ op: "add", dst: count, src: imm(1) });
      emit({ op: "mov", dst: mem(11, 0), src: count });
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: bad });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "memory-read-float64":
    case "memory-write-float64": {
      // The memory-read-word window contract for one aligned binary64; a
      // read of an invalid window yields NaN.
      wordWindow(8, false);
      if (operation === "memory-read-float64") {
        emit({ op: "movsd", dst: x0, src: mem(10, 0) });
        floatBits(emit, rax, x0);
        emit({ op: "jmp", target: label(wordDone) });
        emit({ op: "label", name: invalidWord });
        emit({ op: "mov", dst: rax, src: bits(0, 0x7ff80000) });
        emit({ op: "label", name: wordDone });
        return true;
      }
      emit({ op: "movsd", dst: x0, src: argument(3) });
      emit({ op: "movsd", dst: mem(10, 0), src: x0 });
      emit({ op: "xor", dst: eax, src: eax });
      return finishWord();
    }
    case "memory-write-string": {
      // Every code unit of the string, two bytes each, into the window.
      const failed = site + ":string-invalid",
        done = site + ":string-done";
      const limit = r11;
      emit({ op: "mov", dst: limit, src: bits(0, 0x10000) });
      const args = [rdi, rsi, rdx];
      for (let index = 0; index < args.length; index++) {
        const target = args[index];
        if (target === undefined) throw "write-string argument invariant";
        exactInteger(emit, argument(index), target, failed);
        emit({ op: "cmp", dst: target, src: limit });
        branch(emit, "ae", failed);
      }
      emit({ op: "test", dst: rdi, src: rdi });
      branch(emit, "e", failed);
      emit({ op: "sub", dst: limit, src: rdi });
      emit({ op: "cmp", dst: rsi, src: limit });
      branch(emit, "a", failed);
      emit({ op: "sub", dst: rsi, src: rdx });
      branch(emit, "b", failed);
      emit({ op: "add", dst: rdi, src: rdx });
      emit({ op: "mov", dst: r10, src: argument(3) });
      emit({
        op: "mov",
        dst: edx,
        src: { ...mem(10, nativeStringLengthOffset), width: 32 },
      });
      emit({ op: "shl", dst: rdx, count: 1 });
      emit({ op: "cmp", dst: rdx, src: rsi });
      branch(emit, "a", failed);
      const flat = site + ":string-flat",
        sourceReady = site + ":string-src",
        twoByte = site + ":string-two-byte",
        widenLoop = site + ":string-widen",
        copied = site + ":string-copied";
      emit({ op: "mov", dst: rax, src: mem(10, 0) });
      emit({ op: "shr", dst: rax, count: nativeHeaderFlagsShift });
      emit({ op: "and", dst: rax, src: imm(3) });
      emit({ op: "cmp", dst: rax, src: imm(nativeStringSlicedFlag) });
      branch(emit, "b", flat);
      emit({
        op: "mov",
        dst: rsi,
        src: mem(10, nativeStringSlicedStartOffset),
      });
      emit({ op: "mov", dst: r10, src: mem(10, nativeStringParentOffset) });
      emit({
        op: "lea",
        dst: rsi,
        src: {
          kind: "mem",
          width: 64,
          address: {
            kind: "base",
            base: 10,
            index: 6,
            scale: 1,
            disp: nativeStringDataOffset,
          },
        },
      });
      emit({ op: "jmp", target: label(sourceReady) });
      emit({ op: "label", name: flat });
      emit({ op: "lea", dst: rsi, src: mem(10, nativeStringDataOffset) });
      emit({ op: "label", name: sourceReady });
      emit({ op: "test", dst: rax, src: imm(nativeStringOneByteFlag) });
      branch(emit, "e", twoByte);
      emit({ op: "shr", dst: rdx, count: 1 });
      emit({ op: "label", name: widenLoop });
      emit({ op: "test", dst: rdx, src: rdx });
      branch(emit, "e", copied);
      emit({ op: "movzx", dst: eax, src: { ...mem(6, 0), width: 8 } });
      emit({
        op: "mov",
        dst: { ...mem(7, 0), width: 16 },
        src: { kind: "gpr", width: 16, index: 0 },
      });
      emit({ op: "add", dst: rsi, src: imm(1) });
      emit({ op: "add", dst: rdi, src: imm(2) });
      emit({ op: "sub", dst: rdx, src: imm(1) });
      emit({ op: "jmp", target: label(widenLoop) });
      emit({ op: "label", name: twoByte });
      libc("memmove");
      emit({ op: "label", name: copied });
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: failed });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "string-address":
      emit({ op: "mov", dst: rax, src: argument(0) });
      numberResult(rax);
      return true;
    case "string-copy": {
      // Copies a string into its canonical flat form (header, length and
      // units, flattening slices) into the window; returns the extent, or -1.
      const failed = site + ":copy-invalid",
        done = site + ":copy-done";
      const limit = r11,
        rcx = gpr(1),
        ecx = word(1),
        r8 = gpr(8);
      /** Computes R10 = flat extent, RAX = flat header, RCX = length,
       * RSI = units pointer, RDX = data bytes (or branches to -1). */
      function extent(tag: string): void {
        const flat = site + ":copy-flat-" + tag,
          oneByte = site + ":copy-one-" + tag;
        emit({ op: "mov", dst: r10, src: argument(3) });
        emit({ op: "mov", dst: rax, src: mem(10, 0) });
        emit({ op: "mov", dst: r8, src: rax });
        emit({ op: "shl", dst: r8, count: 16 });
        emit({ op: "shr", dst: r8, count: 16 });
        emit({ op: "cmp", dst: r8, src: imm(1) });
        branch(emit, "ne", failed);
        emit({ op: "mov", dst: r8, src: rax });
        emit({ op: "shr", dst: r8, count: nativeHeaderFlagsShift });
        emit({ op: "and", dst: r8, src: imm(7) });
        emit({
          op: "cmp",
          dst: r8,
          src: imm(nativeStringOneByteFlag | nativeStringSlicedFlag),
        });
        branch(emit, "a", failed);
        emit({
          op: "mov",
          dst: ecx,
          src: { ...mem(10, nativeStringLengthOffset), width: 32 },
        });
        emit({ op: "lea", dst: rsi, src: mem(10, nativeStringDataOffset) });
        emit({ op: "test", dst: r8, src: imm(nativeStringSlicedFlag) });
        branch(emit, "e", flat);
        emit({
          op: "mov",
          dst: rdx,
          src: mem(10, nativeStringSlicedStartOffset),
        });
        emit({ op: "mov", dst: r10, src: mem(10, nativeStringParentOffset) });
        emit({
          op: "lea",
          dst: rsi,
          src: {
            kind: "mem",
            width: 64,
            address: {
              kind: "base",
              base: 10,
              index: 2,
              scale: 1,
              disp: nativeStringDataOffset,
            },
          },
        });
        emit({ op: "mov", dst: rdx, src: imm(1) });
        emit({ op: "shl", dst: rdx, count: nativeHeaderFlagsShift + 1 });
        emit({ op: "sub", dst: rax, src: rdx });
        emit({ op: "label", name: flat });
        emit({ op: "mov", dst: rdx, src: rcx });
        emit({ op: "test", dst: r8, src: imm(nativeStringOneByteFlag) });
        branch(emit, "ne", oneByte);
        emit({ op: "shl", dst: rdx, count: 1 });
        emit({ op: "label", name: oneByte });
        emit({ op: "mov", dst: r10, src: rdx });
        emit({ op: "mov", dst: r8, src: imm(nativeStringMinimumDataBytes) });
        emit({ op: "cmp", dst: r10, src: r8 });
        emit({ op: "cmovcc", cc: "b", dst: r10, src: r8 });
        emit({ op: "add", dst: r10, src: imm(nativeStringDataOffset + 7) });
        emit({ op: "shr", dst: r10, count: 3 });
        emit({ op: "shl", dst: r10, count: 3 });
      }
      emit({ op: "mov", dst: limit, src: bits(0, 0x10000) });
      const args = [rdi, rsi, rdx];
      for (let index = 0; index < args.length; index++) {
        const target = args[index];
        if (target === undefined) throw "copy-string argument invariant";
        exactInteger(emit, argument(index), target, failed);
        emit({ op: "cmp", dst: target, src: limit });
        branch(emit, "ae", failed);
      }
      emit({ op: "test", dst: rdi, src: rdi });
      branch(emit, "e", failed);
      emit({ op: "sub", dst: limit, src: rdi });
      emit({ op: "cmp", dst: rsi, src: limit });
      branch(emit, "a", failed);
      emit({ op: "sub", dst: rsi, src: rdx });
      branch(emit, "b", failed);
      emit({ op: "add", dst: rdi, src: rdx });
      // RSI is the room after the offset; the extent must fit it.
      emit({ op: "mov", dst: limit, src: rsi });
      extent("a");
      emit({ op: "cmp", dst: r10, src: limit });
      branch(emit, "a", failed);
      // Zero the last two words (padding, at most 15 bytes), then write the
      // flat header, length, and units.
      const padding = (disp: number): Memory<64> => ({
        kind: "mem",
        width: 64,
        address: { kind: "base", base: 7, index: 10, scale: 1, disp },
      });
      emit({ op: "mov", dst: padding(-8), src: imm(0) });
      emit({ op: "mov", dst: padding(-16), src: imm(0) });
      emit({ op: "mov", dst: mem(7, 0), src: rax });
      emit({ op: "mov", dst: mem(7, nativeStringLengthOffset), src: rcx });
      emit({ op: "lea", dst: rdi, src: mem(7, nativeStringDataOffset) });
      libc("memmove");
      // The call clobbers R10: read the extent again.
      extent("b");
      emit({ op: "mov", dst: rax, src: r10 });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: failed });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "memory-write-bytes": {
      const failed = site + ":write-invalid",
        done = site + ":write-done";
      const limit = r11;
      emit({ op: "mov", dst: limit, src: bits(0, 0x10000) });
      const args = [rdi, rsi, rdx];
      for (let index = 0; index < args.length; index++) {
        const target = args[index];
        if (target === undefined) throw "write-byte argument invariant";
        exactInteger(emit, argument(index), target, failed);
        emit({ op: "cmp", dst: target, src: limit });
        branch(emit, "ae", failed);
      }
      emit({ op: "test", dst: rdi, src: rdi });
      branch(emit, "e", failed);
      emit({ op: "sub", dst: limit, src: rdi });
      emit({ op: "cmp", dst: rsi, src: limit });
      branch(emit, "a", failed);
      emit({ op: "sub", dst: rsi, src: rdx });
      branch(emit, "b", failed);
      emit({ op: "add", dst: rdi, src: rdx });
      array(3);
      emit({ op: "cmp", dst: rdx, src: rsi });
      branch(emit, "a", failed);
      emit({ op: "mov", dst: rsi, src: r10 });
      libc("memmove");
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: failed });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "memory-move": {
      const invalid = site + ":move-invalid";
      const done = site + ":move-done";
      const base = gpr(8);
      const length = gpr(9);
      const numbers = [base, length, rdi, rsi, rdx];
      emit({ op: "mov", dst: r11, src: bits(0xffffffff, 0x1fffff) });
      for (let i = 0; i < numbers.length; i++) {
        const register = numbers[i];
        if (register === undefined) throw "memory move argument invariant";
        exactInteger(emit, argument(i), register, invalid);
        emit({ op: "cmp", dst: register, src: r11 });
        branch(emit, "a", invalid);
      }
      emit({ op: "test", dst: base, src: base });
      branch(emit, "e", invalid);
      emit({ op: "sub", dst: r11, src: base });
      emit({ op: "cmp", dst: length, src: r11 });
      branch(emit, "a", invalid);
      emit({ op: "sub", dst: length, src: rdx });
      branch(emit, "b", invalid);
      emit({ op: "cmp", dst: rdi, src: length });
      branch(emit, "a", invalid);
      emit({ op: "cmp", dst: rsi, src: length });
      branch(emit, "a", invalid);
      emit({ op: "add", dst: rdi, src: base });
      emit({ op: "add", dst: rsi, src: base });
      libc("memmove");
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "memory-map":
    case "memory-unmap":
    case "memory-release": {
      const invalid = site + ":mapping-invalid";
      const failed = site + ":mapping-failed";
      const done = site + ":mapping-done";
      const mapping = operation === "memory-map";
      const release = operation === "memory-release";
      const fixed = policy.fixedMappingFlag;
      if (release && fixed === undefined) return false;
      exactInteger(emit, argument(mapping ? 0 : 1), rsi, invalid);
      emit({ op: "test", dst: rsi, src: rsi });
      branch(emit, "le", invalid);
      if (mapping) emit({ op: "xor", dst: edi, src: edi });
      else {
        exactInteger(emit, argument(0), rdi, invalid);
        emit({ op: "test", dst: rdi, src: rdi });
        branch(emit, "le", invalid);
      }
      if (release) {
        // MAP_FIXED only within the managed mapping or the releasable window
        // the identity page records (the shared string arena).
        const page = policy.pageSize;
        if (page.kind !== "fixed") return false;
        const window = site + ":release-window",
          inside = site + ":release-inside";
        emit({ op: "test", dst: rdi, src: imm(page.bytes - 1) });
        branch(emit, "ne", invalid);
        emit({ op: "test", dst: rsi, src: imm(page.bytes - 1) });
        branch(emit, "ne", invalid);
        emit({ op: "mov", dst: r11, src: context });
        emit({ op: "mov", dst: rax, src: rdi });
        emit({ op: "sub", dst: rax, src: mem(11, managedBaseOffset) });
        branch(emit, "b", window);
        emit({ op: "mov", dst: r10, src: mem(11, managedLengthOffset) });
        emit({ op: "sub", dst: r10, src: rsi });
        branch(emit, "b", window);
        emit({ op: "cmp", dst: rax, src: r10 });
        branch(emit, "be", inside);
        emit({ op: "label", name: window });
        emit({ op: "mov", dst: r11, src: mem(11, nativeContextDomainOffset) });
        emit({ op: "test", dst: r11, src: r11 });
        branch(emit, "e", invalid);
        emit({ op: "mov", dst: rax, src: rdi });
        emit({
          op: "sub",
          dst: rax,
          src: mem(11, nativeIdentityReleasableBaseOffset),
        });
        branch(emit, "b", invalid);
        emit({
          op: "mov",
          dst: r10,
          src: mem(11, nativeIdentityReleasableLengthOffset),
        });
        emit({ op: "sub", dst: r10, src: rsi });
        branch(emit, "b", invalid);
        emit({ op: "cmp", dst: rax, src: r10 });
        branch(emit, "a", invalid);
        emit({ op: "label", name: inside });
      }
      if (mapping || release) {
        emit({ op: "mov", dst: edx, src: imm(3) });
        emit({
          op: "mov",
          dst: word(1),
          src: imm(policy.anonymousPrivateFlags | (release ? (fixed ?? 0) : 0)),
        });
        emit({ op: "mov", dst: word(8), src: imm(-1) });
        emit({ op: "xor", dst: word(9), src: word(9) });
        libc("mmap");
        emit({ op: "cmp", dst: rax, src: imm(-1) });
        branch(emit, "e", failed);
        if (release) emit({ op: "xor", dst: eax, src: eax });
      } else {
        libc("munmap");
        emit({ op: "test", dst: eax, src: eax });
        branch(emit, "ne", failed);
      }
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: failed });
      call(policy.errnoSymbol);
      emit({ op: "mov", dst: eax, src: { ...mem(0, 0), width: 32 } });
      emit({ op: "neg", dst: rax });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "processor-count": {
      const processor = policy.processors;
      if (processor.kind !== "affinity") return false;
      const done = site + ":affinity-done";
      const loop = site + ":affinity-loop";
      const bits = site + ":affinity-bits";
      const next = site + ":affinity-next";
      const area = Math.ceil(processor.maskBytes / 16) * 16;
      emit({ op: "sub", dst: gpr(4), src: imm(area) });
      emit({ op: "xor", dst: edi, src: edi });
      emit({ op: "mov", dst: word(6), src: imm(processor.maskBytes) });
      emit({ op: "mov", dst: rdx, src: gpr(4) });
      libc(processor.symbol);
      emit({ op: "test", dst: eax, src: eax });
      emit({ op: "mov", dst: eax, src: imm(0) });
      branch(emit, "ne", done);
      emit({ op: "xor", dst: word(9), src: word(9) });
      emit({ op: "label", name: loop });
      emit({
        op: "movzx",
        dst: word(8),
        src: {
          kind: "mem",
          width: 8,
          address: { kind: "base", base: 4, index: 9, disp: 0 },
        },
      });
      emit({ op: "label", name: bits });
      emit({ op: "test", dst: byte(8), src: byte(8) });
      branch(emit, "e", next);
      emit({ op: "shr", dst: word(8), count: 1 });
      emit({ op: "adc", dst: eax, src: imm(0) });
      emit({ op: "jmp", target: label(bits) });
      emit({ op: "label", name: next });
      emit({ op: "inc", dst: word(9) });
      emit({ op: "cmp", dst: word(9), src: imm(processor.maskBytes) });
      branch(emit, "b", loop);
      emit({ op: "label", name: done });
      emit({ op: "add", dst: gpr(4), src: imm(area) });
      numberResult(eax);
      return true;
    }
    case "target-os":
    case "target-architecture":
    case "memory-page-bytes":
    case "cpu-sha256": {
      const pageSize = policy.pageSize;
      if (pageSize.kind !== "fixed") return false;
      emit({
        op: "mov",
        dst: eax,
        src: imm(
          operation === "target-os"
            ? nativeTargetOSLinux
            : operation === "target-architecture"
              ? nativeTargetArchX86_64
              : operation === "cpu-sha256"
                ? 0
                : pageSize.bytes,
        ),
      });
      numberResult(eax);
      return true;
    }
    case "process-id":
      libc("getpid");
      numberResult(eax);
      return true;
    case "argument-count":
      emit({ op: "mov", dst: r11, src: context });
      emit({
        op: "mov",
        dst: eax,
        src: { ...mem(11, argumentCountOffset), width: 32 },
      });
      numberResult(eax);
      return true;
    case "argument-length":
    case "argument-copy":
    case "environment-copy": {
      const invalid = site + ":invalid";
      const done = site + ":done";
      if (operation === "environment-copy") {
        path(0, rdi);
        libc("getenv");
        emit({ op: "mov", dst: rdi, src: rax });
        emit({ op: "test", dst: rax, src: rax });
        branch(emit, "e", invalid);
      } else {
        integer(0, eax, invalid);
        emit({ op: "mov", dst: r11, src: context });
        emit({
          op: "cmp",
          dst: eax,
          src: { ...mem(11, argumentCountOffset), width: 32 },
        });
        branch(emit, "ae", invalid);
        emit({ op: "mov", dst: r11, src: mem(11, argumentsOffset) });
        emit({
          op: "mov",
          dst: rdi,
          src: {
            kind: "mem",
            width: 64,
            address: { kind: "base", base: 11, index: 0, scale: 8, disp: 0 },
          },
        });
      }
      emit({ op: "mov", dst: scratch, src: rdi });
      libc("strlen");
      emit({ op: "mov", dst: word(11), src: imm(0xffffffff) });
      emit({ op: "cmp", dst: rax, src: r11 });
      branch(emit, "a", invalid);
      if (operation !== "argument-length") {
        array(1);
        emit({ op: "cmp", dst: rax, src: rdx });
        branch(emit, "a", invalid);
        emit({ op: "mov", dst: scratchNext, src: rax });
        emit({ op: "mov", dst: rdi, src: r10 });
        emit({ op: "mov", dst: rsi, src: scratch });
        emit({ op: "mov", dst: rdx, src: rax });
        libc("memcpy");
        emit({ op: "mov", dst: rax, src: scratchNext });
      }
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
      return true;
    }
    case "monotonic-time":
    case "wall-clock-time": {
      const clock = policy.clock;
      if (clock.kind !== "timespec") return false;
      emit({
        op: "mov",
        dst: edi,
        src: imm(
          operation === "monotonic-time" ? clock.monotonicId : clock.wallId,
        ),
      });
      emit({ op: "lea", dst: rsi, src: scratch });
      call(clock.symbol);
      emit({ op: "test", dst: eax, src: eax });
      branch(emit, "ne", trap);
      emit({ op: "cvtsi2sd", dst: x0, src: scratch });
      emit({ op: "mulsd", dst: x0, src: request.constant(1000) });
      emit({ op: "cvtsi2sd", dst: x1, src: scratchNext });
      emit({ op: "divsd", dst: x1, src: request.constant(1000000) });
      emit({ op: "addsd", dst: x0, src: x1 });
      floatBits(emit, rax, x0);
      return true;
    }
    case "random-word": {
      const random = policy.random;
      if (random.kind !== "fill") return false;
      emit({ op: "lea", dst: rdi, src: scratch });
      emit({ op: "mov", dst: word(6), src: imm(4) });
      emit({ op: "xor", dst: edx, src: edx });
      call(random.symbol);
      emit({ op: "cmp", dst: rax, src: imm(4) });
      branch(emit, "ne", trap);
      emit({ op: "mov", dst: eax, src: { ...scratch, width: 32 } });
      numberResult(rax);
      return true;
    }
  }

  let symbol: string;
  let wide = false;
  switch (operation) {
    case "open-read":
    case "open-exclusive":
      if (policy.creationModeOnStack) return false;
      path(0, rdi);
      emit({
        op: "mov",
        dst: word(6),
        src: imm(
          operation === "open-read" ? policy.readFlags : policy.exclusiveFlags,
        ),
      });
      if (operation === "open-exclusive") integer(1, edx);
      // SysV variadic calls carry the number of vector arguments in AL.
      emit({ op: "xor", dst: eax, src: eax });
      symbol = "open";
      break;
    case "read":
    case "write":
    case "read-link":
      if (operation === "read-link") path(0, rdi);
      else integer(0, edi);
      array(1);
      emit({ op: "mov", dst: rsi, src: r10 });
      symbol = operation === "read-link" ? "readlink" : operation;
      wide = true;
      break;
    case "chmod":
      integer(0, edi);
      integer(1, word(6));
      symbol = "fchmod";
      break;
    case "close":
      integer(0, edi);
      symbol = "close";
      break;
    case "rename":
      path(0, rdi);
      path(1, rsi);
      symbol = "rename";
      break;
    case "unlink":
      path(0, rdi);
      symbol = "unlink";
      break;
    default:
      return false;
  }
  libc(symbol);
  const done = site + ":errno";
  const status = wide ? rax : eax;
  emit({ op: "test", dst: status, src: status });
  branch(emit, "ns", done);
  call(policy.errnoSymbol);
  emit({ op: "mov", dst: eax, src: { ...mem(0, 0), width: 32 } });
  emit({ op: "neg", dst: status });
  emit({ op: "label", name: done });
  numberResult(status);
  return true;
}
