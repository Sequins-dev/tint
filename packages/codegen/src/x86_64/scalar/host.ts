import {
  nativeArrayDataOffset,
  nativeArrayLengthOffset,
  nativeStackMapRegistryOffset,
  nativeStackMapSaveBlockOffset,
  nativeTargetOSLinux,
  nativeTargetArchX86_64,
  type PosixHostFacts,
} from "@tint/abi/host";
import type { HostOperation } from "@tint/ir/scalar";
import type { Condition, Gpr, Memory } from "../isa.ts";
import {
  argumentCountOffset,
  argumentsOffset,
  bits,
  gpr,
  imm,
  label,
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
  readonly scratch: Memory<64>;
  readonly scratchNext: Memory<64>;
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

  switch (operation) {
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
    case "memory-write-word": {
      const invalid = site + ":word-invalid";
      const done = site + ":word-done";
      const length = gpr(8);
      const offset = gpr(9);
      const write = operation === "memory-write-word";
      emit({ op: "mov", dst: r11, src: bits(0xffffffff, 0x1fffff) });
      const args = [r10, length, offset, rdi];
      for (let index = 0; index < (write ? 4 : 3); index++) {
        const dst = args[index];
        if (dst === undefined) throw "memory word argument invariant";
        exactInteger(emit, argument(index), dst, invalid);
        emit({ op: "cmp", dst, src: r11 });
        branch(emit, "a", invalid);
      }
      emit({ op: "test", dst: r10, src: r10 });
      branch(emit, "e", invalid);
      emit({ op: "sub", dst: length, src: imm(8) });
      branch(emit, "b", invalid);
      emit({ op: "cmp", dst: offset, src: length });
      branch(emit, "a", invalid);
      emit({ op: "add", dst: r10, src: offset });
      emit({ op: "cmp", dst: r10, src: r11 });
      branch(emit, "a", invalid);
      emit({ op: "test", dst: r10, src: imm(7) });
      branch(emit, "ne", invalid);
      if (write) {
        emit({ op: "mov", dst: mem(10, 0), src: rdi });
        emit({ op: "xor", dst: eax, src: eax });
      } else {
        emit({ op: "mov", dst: rax, src: mem(10, 0) });
        emit({ op: "cmp", dst: rax, src: r11 });
        branch(emit, "a", invalid);
      }
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "label", name: done });
      numberResult(rax);
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
