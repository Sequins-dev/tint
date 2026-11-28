import {
  nativeArrayDataOffset,
  nativeArrayLengthOffset,
  nativeArrayOwnerOffset,
  nativeBuiltinMarkerLimit,
  nativeContextDomainOffset,
  nativeContextManagedBaseOffset,
  nativeContextManagedLengthOffset,
  nativeGenerationalStateWords,
  nativeHeaderFlagsShift,
  nativeIdentityReleasableBaseOffset,
  nativeIdentityReleasableLengthOffset,
  nativeStackMapRegistryEntryBytes,
  nativeStackMapRegistryHeaderBytes,
  nativeStackMapRegistryOffset,
  nativeStackMapSaveBlockOffset,
  nativeStackOverflowPayload,
  nativeStringDataOffset,
  nativeStringLengthOffset,
  nativeStringMinimumDataBytes,
  nativeStringOneByteFlag,
  nativeStringParentOffset,
  nativeStringSlicedFlag,
  nativeStringSlicedStartOffset,
  nativeTargetArchAArch64,
  nativeTargetOSDarwin,
  nativeTargetOSLinux,
  type PosixHostABI,
} from "@tint/abi/host";
import {
  nativeFunctionDescriptorOffset,
  nativeFunctionSignatureOffset,
} from "@tint/abi/function";
import type { WordBuffer } from "@tint/foundation/binary/word-buffer";
import type { NumberIndex } from "@tint/foundation/collections/key-index";
import {
  executableHostOperation,
  maximumStringLength,
  type HostOperation,
  type ScalarType,
} from "@tint/ir/scalar";
import type { Branch, Condition, Instruction } from "../isa.ts";
import {
  dualMappingOf,
  emitDualMappingMap,
  emitDualMappingUnmap,
  emitDualMappingWrite,
  type InlineFixup,
  type InlineSequenceBuilder,
} from "./executable-memory.ts";
import { nativeAllocationStateOffset } from "./abi.ts";
import { externalMemoryCapability } from "./external-memory.ts";
import type { Diagnostic, LeafHelperKind, NativeStartupCall } from "./index.ts";

export interface HostCallValue {
  readonly offset: number;
  readonly type: ScalarType;
}

export interface HostCallEmitContext {
  readonly instructions: WordBuffer;
  readonly valueIds: NumberIndex;
  readonly wordKinds: Uint8Array;
  readonly wordConstants: Uint32Array;
  readonly allocationOffset: number;
  readonly calleeSaveOffset: number;
  readonly contextOffset: number;
  readonly functionRecord: number;
  readonly ownRootHead: boolean;
  readonly preservedCount: number;
  readonly resultOffset: number;
  readonly value: (id: number) => HostCallValue;
  readonly address: (rd: number, offset: number) => void;
  readonly allocate: (
    prepare: () => void,
    size: (rd: number) => void,
    preserveFloats?: boolean,
    constSize?: number,
  ) => void;
  readonly callHelper: (kind: LeafHelperKind) => void;
  readonly clearWordCaches: () => void;
  readonly descriptorPointer: (record: number) => void;
  readonly emit: (i: Instruction) => void;
  readonly exceptionalBranch: (condition: Branch) => void;
  readonly fail: (code: Diagnostic["code"], message: string) => never;
  readonly floatLoad: (rt: number, id: number, byteOffset?: number) => void;
  readonly floatOperand: (id: number, scratch: number) => number;
  readonly floatStore: (rt: number, id: number) => void;
  readonly guardDescriptor: (
    pointer: number,
    record: number,
    failure?: number,
    layoutKnown?: boolean,
    nonNullKnown?: boolean,
  ) => void;
  readonly host: () => PosixHostABI;
  readonly imm: (rd: number, value: number) => void;
  readonly imm64: (rd: number, lo: number, hi: number) => void;
  readonly importAddress: (rd: number, scratch: number, name: string) => void;
  readonly importCall: (name: string) => void;
  readonly markInteger: (id: number) => void;
  readonly numberConstant: (id: number) => number | undefined;
  readonly patchInstruction: (index: number, instruction: Instruction) => void;
  readonly pollWorkerStop: () => void;
  readonly prepareStringSize: (oneByte: number) => void;
  readonly rawLoad: (rt: number, offset: number) => void;
  readonly rawStore: (rt: number | "zr", offset: number) => void;
  readonly rawValue: (rt: number, id: number) => void;
  readonly safepoint: () => void;
  readonly saveRaw: (rt: number, id: number) => void;
  readonly startupCall: (target: NativeStartupCall["target"]) => void;
  readonly storedAsInteger: (id: number) => boolean;
  readonly trapIf: (branch: Branch) => void;
  readonly wantsInteger: (id: number) => boolean;
  readonly zeroWords: (offsets: readonly number[]) => void;
}

/** Inline raw-word host operations sharing the memory-read-word window
 * contract (address, byteLength, offset, ...). */
export function rawWordOperation(operation: string): boolean {
  return (
    operation === "memory-read-word" ||
    operation === "memory-write-word" ||
    operation === "memory-read-float64" ||
    operation === "memory-write-float64" ||
    operation === "memory-move" ||
    operation === "memory-compare-exchange-word" ||
    operation === "memory-fetch-add-word" ||
    operation === "memory-load-acquire-word" ||
    operation === "memory-store-release-word"
  );
}

export interface HostCallInstruction {
  readonly kind: "host-call";
  readonly operation: HostOperation;
  readonly id: number | undefined;
  readonly arguments: readonly number[];
}

interface HostCallHelpers {
  readonly operation: string;
  readonly foreign: (name: string) => void;
  readonly argument: (index: number) => number;
  readonly integer: (index: number, register: number, wide?: boolean) => void;
  readonly bytes: (index: number, register: number, path: boolean) => void;
  readonly futexCall: (
    wait: boolean,
    symbol: string,
    number: number,
    operation: number,
  ) => void;
  readonly sha256Rounds: (
    state: number,
    block: number,
    constants: number,
  ) => void;
  readonly inlineSequence: () => InlineSequenceBuilder;
}

function makeHostCallHelpers(
  ctx: HostCallEmitContext,
  op: HostCallInstruction,
): HostCallHelpers {
  const {
    instructions,
    resultOffset,
    address,
    clearWordCaches,
    emit,
    floatLoad,
    host,
    imm,
    imm64,
    importCall,
    patchInstruction,
    rawValue,
    trapIf,
  } = ctx;
  const args = op.arguments;
  function argument(index: number): number {
    const id = args[index];
    if (id === undefined) throw "host argument invariant";
    return id;
  }
  function integer(
    index: number,
    register: number,
    wide: boolean = false,
  ): void {
    floatLoad(0, argument(index));
    if (wide) {
      emit({ op: "fcvtzs-x-d", rd: register, rn: 0 });
      emit({ op: "scvtf-d-x", rd: 1, rn: register });
    } else {
      emit({ op: "fcvtzs-w-d", rd: register, rn: 0 });
      emit({ op: "scvtf-d-w", rd: 1, rn: register });
    }
    emit({ op: "fcmp", rn: 0, rm: 1 });
    trapIf({ op: "b.cond", condition: "ne" });
  }
  function bytes(index: number, register: number, path: boolean): void {
    rawValue(9, argument(index));
    emit({
      op: "ldr",
      width: 32,
      rt: 10,
      rn: 9,
      offset: nativeArrayLengthOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: register,
      rn: 9,
      offset: nativeArrayDataOffset,
    });
    if (path) {
      trapIf({ op: "cbz", width: 32, rt: 10 });
      emit({
        op: "add-reg",
        width: 64,
        rd: 11,
        rn: register,
        rm: 10,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: 11,
        rn: 11,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      emit({ op: "ldrb", rt: 11, rn: 11, offset: 0 });
      trapIf({ op: "cbnz", width: 32, rt: 11 });
    }
  }
  /** futex(2) through `syscall(number, cell, operation,
   * ...)`: a wait passes the expected word and a relative
   * timespec (null for an indefinite park, timeout 0); a
   * wake releases one waiter or, when `all` is 1, every
   * waiter. Leaves the raw status in x0, -errno on failure
   * (the statuses the Darwin ulock calls report). */
  function futexCall(
    wait: boolean,
    symbol: string,
    number: number,
    operation: number,
  ): void {
    integer(0, 1, true);
    if (wait) {
      integer(1, 3, true);
      integer(2, 9, true);
      imm(4, 0);
      const indefinite = instructions.length;
      emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
      imm(10, 1000000000);
      emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
      emit({
        op: "msub",
        width: 64,
        rd: 12,
        rn: 11,
        rm: 10,
        ra: 9,
      });
      emit({
        op: "str",
        width: 64,
        rt: 11,
        rn: "sp",
        offset: resultOffset,
      });
      emit({
        op: "str",
        width: 64,
        rt: 12,
        rn: "sp",
        offset: resultOffset + 8,
      });
      address(4, resultOffset);
      patchInstruction(indefinite, {
        op: "cbz",
        width: 64,
        rt: 9,
        displacement: (instructions.length - indefinite) * 4,
      });
    } else {
      // all is an already validated 0/1 scalar.
      integer(1, 9);
      imm(3, 1);
      const one = instructions.length;
      emit({ op: "cbz", width: 32, rt: 9, displacement: 0 });
      imm(3, 2147483647);
      patchInstruction(one, {
        op: "cbz",
        width: 32,
        rt: 9,
        displacement: (instructions.length - one) * 4,
      });
    }
    imm(0, number);
    imm(2, operation);
    importCall(symbol);
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 0,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    const success = instructions.length;
    emit({ op: "b.cond", condition: "ge", displacement: 0 });
    importCall(host().errnoSymbol);
    emit({ op: "ldr", width: 32, rt: 9, rn: 0, offset: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 0,
      rn: "zr",
      rm: 9,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    patchInstruction(success, {
      op: "b.cond",
      condition: "ge",
      displacement: (instructions.length - success) * 4,
    });
  }
  /** One SHA-256 block over typed arrays (state: 8 words,
   * schedule: 64 words, the first 16 holding the block's
   * big-endian words as numbers; constants: 64 words), with
   * the ARMv8 SHA-256 instructions: as the portable
   * compressSha256RoundsPortable, it writes schedule words 16-63 and
   * adds the compressed block into state. Short views trap.
   * Uses only v0-v7 (d8-d15 homes and d16-d31 temporaries
   * stay untouched) and x9-x14. */
  function sha256Rounds(
    state: number,
    schedule: number,
    constants: number,
  ): void {
    const views = [state, schedule, constants],
      minimums = [8, 64, 64];
    for (let view = 0; view < 3; view++) {
      rawValue(9, views[view] ?? 0);
      emit({
        op: "ldr",
        width: 32,
        rt: 10,
        rn: 9,
        offset: nativeArrayLengthOffset,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 10,
        immediate: minimums[view] ?? 0,
        shift: 0,
        setFlags: true,
      });
      trapIf({ op: "b.cond", condition: "cc" });
      emit({
        op: "ldr",
        width: 64,
        rt: 12 + view,
        rn: 9,
        offset: nativeArrayDataOffset,
      });
    }
    // v0 = ABCD, v1 = EFGH, v4-v7 = schedule words 4j..4j+3.
    emit({ op: "ldr-q", qt: 0, rn: 12, offset: 0 });
    emit({ op: "ldr-q", qt: 1, rn: 12, offset: 16 });
    for (let j = 0; j < 4; j++)
      emit({ op: "ldr-q", qt: 4 + j, rn: 13, offset: 16 * j });
    for (let group = 0; group < 16; group++) {
      const w = 4 + (group % 4);
      emit({ op: "ldr-q", qt: 3, rn: 14, offset: 16 * group });
      emit({ op: "add-4s", vd: 3, vn: 3, vm: w });
      if (group < 12)
        emit({
          op: "sha256su0",
          vd: w,
          vn: 4 + ((group + 1) % 4),
        });
      emit({ op: "mov-16b", vd: 2, vn: 0 });
      emit({ op: "sha256h", vd: 0, vn: 1, vm: 3 });
      emit({ op: "sha256h2", vd: 1, vn: 2, vm: 3 });
      if (group < 12) {
        emit({
          op: "sha256su1",
          vd: w,
          vn: 4 + ((group + 2) % 4),
          vm: 4 + ((group + 3) % 4),
        });
        // Schedule words 16 + 4 * group .. + 3.
        emit({
          op: "str-q",
          qt: w,
          rn: 13,
          offset: 64 + 16 * group,
        });
      }
    }
    emit({ op: "ldr-q", qt: 2, rn: 12, offset: 0 });
    emit({ op: "add-4s", vd: 0, vn: 0, vm: 2 });
    emit({ op: "ldr-q", qt: 2, rn: 12, offset: 16 });
    emit({ op: "add-4s", vd: 1, vn: 1, vm: 2 });
    emit({ op: "str-q", qt: 0, rn: 12, offset: 0 });
    emit({ op: "str-q", qt: 1, rn: 12, offset: 16 });
  }
  const foreign = importCall;
  const operation = executableHostOperation(op.operation);
  /** Inline control flow with named labels for host
   * sequences built outside this emitter; `finish` patches
   * the branches. A label forgets forwarded stack words,
   * since its branches arrive with other register contents. */
  function inlineSequence(): InlineSequenceBuilder {
    const labels = new Map<string, number>(),
      fixups: InlineFixup[] = [];
    function label(name: string): void {
      if (labels.has(name)) throw "duplicate inline label";
      labels.set(name, instructions.length);
      clearWordCaches();
    }
    function branch(
      name: string,
      condition: Condition | undefined = undefined,
    ): void {
      fixups.push({
        index: instructions.length,
        label: name,
        condition,
      });
      if (condition === undefined) emit({ op: "b", displacement: 0 });
      else emit({ op: "b.cond", condition, displacement: 0 });
    }
    function load(rt: number, word: number): void {
      emit({
        op: "ldr",
        width: 64,
        rt,
        rn: "sp",
        offset: resultOffset + word * 8,
      });
    }
    function store(rt: number | "zr", word: number): void {
      emit({
        op: "str",
        width: 64,
        rt,
        rn: "sp",
        offset: resultOffset + word * 8,
      });
    }
    function constant(rd: number, lo: number, hi: number = 0): void {
      imm64(rd, lo, hi);
    }
    function wordAddress(rd: number, word: number): void {
      address(rd, resultOffset + word * 8);
    }
    function finish(): void {
      for (const fixup of fixups) {
        if (fixup === undefined) throw "inline fixup invariant";
        const target = labels.get(fixup.label);
        if (target === undefined) throw "missing inline label";
        const displacement = (target - fixup.index) * 4,
          condition = fixup.condition;
        if (condition === undefined)
          patchInstruction(fixup.index, {
            op: "b",
            displacement,
          });
        else
          patchInstruction(fixup.index, {
            op: "b.cond",
            condition,
            displacement,
          });
      }
    }
    return {
      emit,
      label,
      branch,
      call: importCall,
      load,
      store,
      constant,
      address: wordAddress,
      finish,
    };
  }
  return {
    operation,
    foreign,
    argument,
    integer,
    bytes,
    futexCall,
    sha256Rounds,
    inlineSequence,
  };
}

function emitHostCallVoid(
  ctx: HostCallEmitContext,
  op: HostCallInstruction,
  helpers: HostCallHelpers,
): boolean {
  const {
    instructions,
    allocationOffset,
    contextOffset,
    ownRootHead,
    resultOffset,
    value,
    address,
    callHelper,
    emit,
    exceptionalBranch,
    imm,
    patchInstruction,
    pollWorkerStop,
    rawLoad,
    rawStore,
    rawValue,
    safepoint,
    startupCall,
    trapIf,
  } = ctx;
  const { operation, argument, sha256Rounds } = helpers;
  if (operation === "cpu-pause") {
    emit({ op: "yield" });
    return true;
  }
  if (operation === "sha256-rounds") {
    sha256Rounds(argument(0), argument(1), argument(2));
    return true;
  }
  if (operation === "collect-garbage") {
    pollWorkerStop();
    // Allocation slow-path ABI with request size 0, which the
    // runtime allocators reserve for a forced full collection
    // (no allocation producer passes 0). Exhaustion throws through
    // the exceptional edge; any other result is an invariant trap.
    rawLoad(0, contextOffset);
    address(3, resultOffset);
    imm(9, 0);
    callHelper("allocate-call");
    emit({ op: "blr", rn: 16 });
    safepoint();
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    exceptionalBranch({ op: "b.cond", condition: "ne" });
    // The acknowledgement is the number +0 (all-zero bits),
    // which also rules out `undefined` (one NaN-boxed word).
    rawLoad(9, resultOffset + 16);
    emit({ op: "cbz", width: 64, rt: 9, displacement: 8 });
    emit({ op: "brk", immediate: 3 });
    return true;
  }
  if (operation === "jit-debug-register") {
    // The hosted __jit_debug_register_code (jitDebugInterface
    // images), where an attached debugger loads new entries.
    startupCall("jit-register");
    return true;
  }
  if (operation === "native-array-detach") {
    // Only a reference (tag 5) to a typed-array view (marker
    // 2-5, flags 2) detaches: length 0, data one word before
    // its owner's.
    const input = op.arguments[0];
    if (input === undefined) throw "array detach invariant";
    const skips: { at: number; condition: "ne" | "hi" | "cs" }[] = [];
    function skip(condition: "ne" | "hi" | "cs"): void {
      skips.push({ at: instructions.length, condition });
      emit({ op: "b.cond", condition, displacement: 0 });
    }
    rawValue(9, input);
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 5,
      shift: 0,
      setFlags: true,
    });
    skip("ne");
    rawLoad(9, value(input).offset + 8);
    const absent = instructions.length;
    emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    emit({
      op: "ubfm",
      width: 64,
      rd: 11,
      rn: 10,
      immr: 0,
      imms: 47,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 11,
      immediate: nativeBuiltinMarkerLimit,
      shift: 0,
      setFlags: true,
    });
    skip("cs");
    emit({
      op: "ubfm",
      width: 64,
      rd: 11,
      rn: 11,
      immr: 0,
      imms: 2,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 11,
      rn: 11,
      immediate: 2,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 11,
      immediate: 3,
      shift: 0,
      setFlags: true,
    });
    skip("hi");
    emit({
      op: "ubfm",
      width: 64,
      rd: 11,
      rn: 10,
      immr: 48,
      imms: 50,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 11,
      immediate: 2,
      shift: 0,
      setFlags: true,
    });
    skip("ne");
    emit({
      op: "str",
      width: 32,
      rt: "zr",
      rn: 9,
      offset: nativeArrayLengthOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 10,
      rn: 9,
      offset: nativeArrayOwnerOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 10,
      rn: 10,
      offset: nativeArrayDataOffset,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 10,
      rn: 10,
      immediate: 8,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "str",
      width: 64,
      rt: 10,
      rn: 9,
      offset: nativeArrayDataOffset,
    });
    const end = instructions.length;
    patchInstruction(absent, {
      op: "cbz",
      width: 64,
      rt: 9,
      displacement: (end - absent) * 4,
    });
    for (const branch of skips) {
      if (branch === undefined) throw "array detach skip invariant";
      patchInstruction(branch.at, {
        op: "b.cond",
        condition: branch.condition,
        displacement: (end - branch.at) * 4,
      });
    }
    return true;
  }

  return false;
}

function emitHostCallRuntime(
  ctx: HostCallEmitContext,
  op: HostCallInstruction,
  helpers: HostCallHelpers,
  resultId: number,
): boolean {
  const {
    instructions,
    allocationOffset,
    contextOffset,
    resultOffset,
    value,
    address,
    allocate,
    callHelper,
    clearWordCaches,
    emit,
    exceptionalBranch,
    floatLoad,
    floatStore,
    host,
    imm,
    imm64,
    importAddress,
    importCall,
    patchInstruction,
    pollWorkerStop,
    prepareStringSize,
    rawLoad,
    rawStore,
    rawValue,
    safepoint,
    saveRaw,
    trapIf,
    zeroWords,
  } = ctx;
  function fail(code: Diagnostic["code"], message: string): never {
    return ctx.fail(code, message);
  }
  const {
    operation,
    foreign,
    argument,
    integer,
    bytes,
    futexCall,
    inlineSequence,
  } = helpers;
  if (operation === "word-park" || operation === "word-wake") {
    const parking = host().parking;
    if (parking === undefined)
      fail("UNSUPPORTED", "target has no word parking ABI");
    if (parking.kind === "linux-futex") {
      futexCall(
        operation === "word-park",
        parking.syscallSymbol,
        parking.futexSyscall,
        operation === "word-park"
          ? parking.waitOperation
          : parking.wakeOperation,
      );
      emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
      floatStore(0, resultId);
      return true;
    }
    const flags = parking.compareOperation + parking.noErrnoFlag;
    integer(0, 1, true);
    if (operation === "word-park") {
      integer(1, 2, true);
      integer(2, 3, true);
      imm(0, flags);
      imm(4, 0);
      // XNU's locked copyin cannot fault a new mapping in. Touch the
      // caller-owned cell first; this is not waiter linearization.
      emit({ op: "ldr", width: 32, rt: 9, rn: 1, offset: 0 });
      foreign(parking.waitSymbol);
    } else {
      integer(1, 9);
      imm(0, flags);
      // all is an already validated 0/1 scalar, not a Script value.
      const one = instructions.length;
      emit({ op: "cbz", width: 32, rt: 9, displacement: 0 });
      imm(0, flags + parking.wakeAllFlag);
      patchInstruction(one, {
        op: "cbz",
        width: 32,
        rt: 9,
        displacement: (instructions.length - one) * 4,
      });
      imm(2, 0);
      foreign(parking.wakeSymbol);
    }
    emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
    floatStore(0, resultId);
    return true;
  }
  if (
    operation === "hosted-thread-entry" ||
    operation === "collector-worker-entry"
  ) {
    importAddress(9, 17, "tint:" + operation);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "thread-start" || operation === "thread-join") {
    const threads = host().threads;
    if (threads === undefined)
      fail("UNSUPPORTED", "target has no thread lifecycle ABI");
    rawStore("zr", resultOffset);
    if (operation === "thread-start") {
      address(0, resultOffset);
      imm(1, 0);
      integer(0, 2, true);
      integer(1, 3, true);
      foreign(threads.createSymbol);
    } else {
      integer(0, 0, true);
      address(1, resultOffset);
      foreign(threads.joinSymbol);
    }
    // pthread routines return an error number directly, not errno.
    emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const failed = instructions.length;
    emit({ op: "cbnz", width: 32, rt: 0, displacement: 0 });
    rawLoad(9, resultOffset);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    patchInstruction(failed, {
      op: "cbnz",
      width: 32,
      rt: 0,
      displacement: (instructions.length - failed) * 4,
    });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "executable-call-managed") {
    pollWorkerStop();
    if (host().executableMemory === undefined)
      fail("UNSUPPORTED", "target has no executable-memory ABI");
    zeroWords([
      resultOffset,
      resultOffset + 8,
      resultOffset + 16,
      resultOffset + 24,
    ]);
    rawLoad(0, contextOffset);
    imm(1, 0);
    imm(2, 0);
    address(3, resultOffset);
    rawValue(4, argument(1));
    integer(0, 16, true);
    emit({ op: "blr", rn: 16 });
    safepoint();
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    exceptionalBranch({ op: "b.cond", condition: "ne" });
    // No safepoint may separate the returned payload and tag handoff.
    rawLoad(9, resultOffset + 16);
    rawLoad(10, resultOffset + 24);
    saveRaw(9, resultId);
    rawStore(10, value(resultId).offset + 8);
    return true;
  }
  if (
    operation === "executable-call-number" ||
    operation === "executable-call-value"
  ) {
    if (host().executableMemory === undefined)
      fail("UNSUPPORTED", "target has no executable-memory ABI");
    if (operation === "executable-call-value")
      address(4, value(argument(1)).offset);
    rawLoad(0, contextOffset);
    imm(1, 0);
    imm(2, 0);
    address(3, resultOffset);
    integer(0, 16, true);
    emit({ op: "blr", rn: 16 });
    safepoint();
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    trapIf({ op: "b.cond", condition: "ne" });
    if (operation === "executable-call-value") {
      rawLoad(9, resultOffset + 16);
      rawLoad(10, resultOffset + 24);
      saveRaw(9, resultId);
      rawStore(10, value(resultId).offset + 8);
    } else {
      emit({
        op: "ldr-d",
        rt: 0,
        rn: "sp",
        offset: resultOffset + 16,
      });
      floatStore(0, resultId);
    }
    return true;
  }
  if (operation === "executable-write" || operation === "memory-write-bytes") {
    // memory-write-bytes is the same bounded copy into an
    // ordinary writable window: no protection toggles, cache
    // maintenance or instruction alignment.
    const raw = operation === "memory-write-bytes";
    const executable = host().executableMemory;
    if (executable === undefined && !raw)
      fail("UNSUPPORTED", "target has no executable-memory ABI");
    const failures: {
      index: number;
      condition: "hi" | "eq" | "ne";
    }[] = [];
    function reject(condition: "hi" | "eq" | "ne"): void {
      failures.push({ index: instructions.length, condition });
      emit({ op: "b.cond", condition, displacement: 0 });
    }
    function compare(left: number, right: number): void {
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: left,
        rm: right,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
    }
    // This leaf cannot allocate or call generated code while writes
    // are enabled. Scratch words live in its reserved result area.
    for (let index = 0; index < 3; index++) {
      floatLoad(0, argument(index));
      emit({ op: "fcvtzs-x-d", rd: index, rn: 0 });
      emit({ op: "scvtf-d-x", rd: 1, rn: index });
      emit({ op: "fcmp", rn: 0, rm: 1 });
      reject("ne");
    }
    bytes(3, 3, false);
    imm(9, 0x1fffffffffffff);
    for (const register of [0, 1, 2]) {
      if (register === undefined) throw "executable argument invariant";
      compare(register, 9);
      reject("hi");
    }
    imm(9, 0);
    compare(0, 9);
    reject("eq");
    compare(1, 9);
    reject("eq");
    compare(10, 9);
    reject("eq");
    compare(2, 1);
    reject("hi");
    emit({
      op: "sub-reg",
      width: 64,
      rd: 11,
      rn: 1,
      rm: 2,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    compare(10, 11);
    reject("hi");
    emit({
      op: "add-reg",
      width: 64,
      rd: 11,
      rn: 0,
      rm: 1,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    imm(9, 0x1fffffffffffff);
    compare(11, 9);
    reject("hi");
    for (const register of raw ? [] : [0, 2, 10]) {
      if (register === undefined) throw "executable alignment invariant";
      imm(9, 3);
      emit({
        op: "and-reg",
        width: 64,
        rd: 11,
        rn: register,
        rm: 9,
      });
      imm(9, 0);
      compare(11, 9);
      reject("ne");
    }
    // Darwin toggles the thread's MAP_JIT protection around
    // the copy; Linux copies through the arena's writable view.
    const dualMapping = raw ? undefined : dualMappingOf(host());
    if (dualMapping !== undefined) {
      const sequence = inlineSequence();
      emitDualMappingWrite(sequence, dualMapping.symbols, reject);
      sequence.finish();
    } else {
      let writeProtect = "",
        cacheInvalidate = "";
      if (
        !raw &&
        executable !== undefined &&
        executable.kind === "darwin-jit"
      ) {
        writeProtect = executable.writeProtectSymbol;
        cacheInvalidate = executable.instructionCacheSymbol;
      }
      emit({
        op: "add-reg",
        width: 64,
        rd: 0,
        rn: 0,
        rm: 2,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      rawStore(0, resultOffset);
      rawStore(3, resultOffset + 8);
      rawStore(10, resultOffset + 16);
      if (writeProtect !== "") {
        imm(0, 0);
        foreign(writeProtect);
      }
      rawLoad(0, resultOffset);
      rawLoad(1, resultOffset + 8);
      rawLoad(2, resultOffset + 16);
      foreign(host().symbolPrefix + "memmove");
      if (writeProtect !== "") {
        rawLoad(0, resultOffset);
        rawLoad(1, resultOffset + 16);
        foreign(cacheInvalidate);
        imm(0, 1);
        foreign(writeProtect);
      }
    }
    emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const invalid = instructions.length;
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const done = instructions.length;
    for (const failure of failures) {
      if (failure === undefined) throw "executable guard invariant";
      patchInstruction(failure.index, {
        op: "b.cond",
        condition: failure.condition,
        displacement: (invalid - failure.index) * 4,
      });
    }
    patchInstruction(skip, {
      op: "b",
      displacement: (done - skip) * 4,
    });
    floatStore(0, resultId);
    return true;
  }
  if (
    operation === "memory-write-string" ||
    operation === "memory-read-string"
  ) {
    // Bulk UTF-16 copies through the C library's memmove. Both
    // first check every window input: exact integers within
    // MAX_SAFE_INTEGER, a nonzero address, and `units` code
    // units (two bytes each) inside the window at `offset`.
    // The string's data address stays valid across the copy:
    // nothing between the load and memmove can allocate.
    const read = operation === "memory-read-string";
    const failures: {
      index: number;
      condition: "hi" | "eq" | "ne";
    }[] = [];
    function reject(condition: "hi" | "eq" | "ne"): void {
      if (read) trapIf({ op: "b.cond", condition });
      else {
        failures.push({ index: instructions.length, condition });
        emit({ op: "b.cond", condition, displacement: 0 });
      }
    }
    function compare(left: number, right: number): void {
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: left,
        rm: right,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
    }
    function window(): void {
      // x0 address, x1 byteLength, x2 offset, x10 byte count.
      for (let index = 0; index < 3; index++) {
        floatLoad(0, argument(index));
        emit({ op: "fcvtzs-x-d", rd: index, rn: 0 });
        emit({ op: "scvtf-d-x", rd: 1, rn: index });
        emit({ op: "fcmp", rn: 0, rm: 1 });
        reject("ne");
      }
      if (read) {
        floatLoad(0, argument(3));
        emit({ op: "fcvtzs-x-d", rd: 10, rn: 0 });
        emit({ op: "scvtf-d-x", rd: 1, rn: 10 });
        emit({ op: "fcmp", rn: 0, rm: 1 });
        reject("ne");
        imm(9, maximumStringLength);
        compare(10, 9);
        reject("hi");
      } else {
        rawValue(9, argument(3));
        emit({
          op: "ldr",
          width: 32,
          rt: 10,
          rn: 9,
          offset: nativeStringLengthOffset,
        });
      }
      emit({
        op: "add-reg",
        width: 64,
        rd: 10,
        rn: "zr",
        rm: 10,
        shift: "lsl",
        amount: 1,
        setFlags: false,
      });
      imm(9, 0x1fffffffffffff);
      for (const register of [0, 1, 2]) {
        compare(register, 9);
        reject("hi");
      }
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 0,
        immediate: 0,
        shift: 0,
        setFlags: true,
      });
      reject("eq");
      compare(2, 1);
      reject("hi");
      emit({
        op: "sub-reg",
        width: 64,
        rd: 11,
        rn: 1,
        rm: 2,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      compare(10, 11);
      reject("hi");
      emit({
        op: "add-reg",
        width: 64,
        rd: 11,
        rn: 0,
        rm: 1,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      imm(9, 0x1fffffffffffff);
      compare(11, 9);
      reject("hi");
    }
    /** memmove(x0, x1, x10) unless x10 is zero. */
    function copy(): void {
      const empty = instructions.length;
      emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
      emit({
        op: "add-reg",
        width: 64,
        rd: 2,
        rn: "zr",
        rm: 10,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      foreign(host().symbolPrefix + "memmove");
      patchInstruction(empty, {
        op: "cbz",
        width: 64,
        rt: 10,
        displacement: (instructions.length - empty) * 4,
      });
    }
    if (read) {
      // Check the window, then allocate the string and copy
      // into it. The allocator may call out, so the source
      // address and byte count wait in the frame words that
      // string builders keep across allocation: the window is
      // caller-owned raw memory, which no collection moves.
      window();
      emit({
        op: "add-reg",
        width: 64,
        rd: 1,
        rn: 0,
        rm: 2,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      rawStore(1, allocationOffset + 8);
      rawStore(10, allocationOffset + 16);
      allocate(
        () => {
          rawLoad(13, allocationOffset + 8);
          rawLoad(11, allocationOffset + 16);
          imm(14, 1);
          emit({
            op: "add-reg",
            width: 64,
            rd: 15,
            rn: 13,
            rm: 11,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          const scanLoop = instructions.length;
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 13,
            rm: 15,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          const scanDoneBranch = instructions.length;
          emit({
            op: "b.cond",
            condition: "cs",
            displacement: 0,
          });
          emit({
            op: "ldrb",
            rt: 12,
            rn: 13,
            offset: 1,
          });
          const scanWideBranch = instructions.length;
          emit({
            op: "cbnz",
            width: 64,
            rt: 12,
            displacement: 0,
          });
          emit({
            op: "add-imm",
            width: 64,
            rd: 13,
            rn: 13,
            immediate: 2,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "b",
            displacement: (scanLoop - instructions.length) * 4,
          });
          const scanWide = instructions.length;
          imm(14, 0);
          const scanDone = instructions.length;
          patchInstruction(scanDoneBranch, {
            op: "b.cond",
            condition: "cs",
            displacement: (scanDone - scanDoneBranch) * 4,
          });
          patchInstruction(scanWideBranch, {
            op: "cbnz",
            width: 64,
            rt: 12,
            displacement: (scanWide - scanWideBranch) * 4,
          });
          emit({
            op: "ubfm",
            width: 64,
            rd: 11,
            rn: 11,
            immr: 1,
            imms: 63,
          });
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      saveRaw(9, resultId);
      rawLoad(12, allocationOffset + 24);
      emit({ op: "str", width: 64, rt: 12, rn: 9, offset: 0 });
      rawLoad(10, allocationOffset + 16);
      emit({
        op: "ubfm",
        width: 64,
        rd: 11,
        rn: 10,
        immr: 1,
        imms: 63,
      });
      emit({
        op: "str",
        width: 64,
        rt: 11,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      rawLoad(1, allocationOffset + 8);
      emit({
        op: "add-imm",
        width: 64,
        rd: 0,
        rn: 9,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 13,
        rn: 12,
        immr: nativeHeaderFlagsShift,
        imms: nativeHeaderFlagsShift,
      });
      const readTwoByteBranch = instructions.length;
      emit({
        op: "cbz",
        width: 64,
        rt: 13,
        displacement: 0,
      });
      const packLoop = instructions.length;
      const packDoneBranch = instructions.length;
      emit({
        op: "cbz",
        width: 64,
        rt: 11,
        displacement: 0,
      });
      emit({ op: "ldrb", rt: 12, rn: 1, offset: 0 });
      emit({ op: "strb", rt: 12, rn: 0, offset: 0 });
      emit({
        op: "add-imm",
        width: 64,
        rd: 1,
        rn: 1,
        immediate: 2,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 0,
        rn: 0,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: 11,
        rn: 11,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "b",
        displacement: (packLoop - instructions.length) * 4,
      });
      const readTwoByte = instructions.length;
      const readSkipBranch = readTwoByte;
      emit({ op: "b", displacement: 0 });
      const readWide = instructions.length;
      copy();
      const readDone = instructions.length;
      patchInstruction(readTwoByteBranch, {
        op: "cbz",
        width: 64,
        rt: 13,
        displacement: (readWide - readTwoByteBranch) * 4,
      });
      patchInstruction(packDoneBranch, {
        op: "cbz",
        width: 64,
        rt: 11,
        displacement: (readDone - packDoneBranch) * 4,
      });
      patchInstruction(readSkipBranch, {
        op: "b",
        displacement: (readDone - readSkipBranch) * 4,
      });
      return true;
    }
    window();
    // Destination x0 + x2, source the string's units (handling
    // flat one-byte, flat two-byte, and sliced strings).
    emit({
      op: "add-reg",
      width: 64,
      rd: 0,
      rn: 0,
      rm: 2,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    rawValue(9, argument(3));
    emit({ op: "ldr", width: 64, rt: 12, rn: 9, offset: 0 });
    emit({
      op: "ubfm",
      width: 64,
      rd: 13,
      rn: 12,
      immr: nativeHeaderFlagsShift,
      imms: nativeHeaderFlagsShift + 1,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 13,
      immediate: nativeStringSlicedFlag,
      shift: 0,
      setFlags: true,
    });
    const writeFlatBranch = instructions.length;
    emit({ op: "b.cond", condition: "cc", displacement: 0 });
    emit({
      op: "ldr",
      width: 64,
      rt: 14,
      rn: 9,
      offset: nativeStringSlicedStartOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset: nativeStringParentOffset,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 1,
      rn: 9,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-reg",
      width: 64,
      rd: 1,
      rn: 1,
      rm: 14,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    const writeFlatSkip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const writeFlat = instructions.length;
    emit({
      op: "add-imm",
      width: 64,
      rd: 1,
      rn: 9,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    const writeSourceReady = instructions.length;
    patchInstruction(writeFlatBranch, {
      op: "b.cond",
      condition: "cc",
      displacement: (writeFlat - writeFlatBranch) * 4,
    });
    patchInstruction(writeFlatSkip, {
      op: "b",
      displacement: (writeSourceReady - writeFlatSkip) * 4,
    });
    emit({
      op: "ubfm",
      width: 64,
      rd: 13,
      rn: 13,
      immr: 0,
      imms: 0,
    });
    const writeTwoByteBranch = instructions.length;
    emit({ op: "cbz", width: 64, rt: 13, displacement: 0 });
    emit({
      op: "ubfm",
      width: 64,
      rd: 11,
      rn: 10,
      immr: 1,
      imms: 63,
    });
    const widenLoop = instructions.length;
    const widenDoneBranch = instructions.length;
    emit({ op: "cbz", width: 64, rt: 11, displacement: 0 });
    emit({ op: "ldrb", rt: 12, rn: 1, offset: 0 });
    emit({ op: "strh", rt: 12, rn: 0, offset: 0 });
    emit({
      op: "add-imm",
      width: 64,
      rd: 1,
      rn: 1,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 0,
      rn: 0,
      immediate: 2,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 11,
      rn: 11,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "b",
      displacement: (widenLoop - instructions.length) * 4,
    });
    const writeCopyBranch = instructions.length;
    emit({ op: "b", displacement: 0 });
    const writeTwoByte = instructions.length;
    copy();
    const writeCopied = instructions.length;
    patchInstruction(writeTwoByteBranch, {
      op: "cbz",
      width: 64,
      rt: 13,
      displacement: (writeTwoByte - writeTwoByteBranch) * 4,
    });
    patchInstruction(widenDoneBranch, {
      op: "cbz",
      width: 64,
      rt: 11,
      displacement: (writeCopied - widenDoneBranch) * 4,
    });
    patchInstruction(writeCopyBranch, {
      op: "b",
      displacement: (writeCopied - writeCopyBranch) * 4,
    });
    emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const invalid = instructions.length;
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const done = instructions.length;
    for (const failure of failures)
      patchInstruction(failure.index, {
        op: "b.cond",
        condition: failure.condition,
        displacement: (invalid - failure.index) * 4,
      });
    patchInstruction(skip, {
      op: "b",
      displacement: (done - skip) * 4,
    });
    floatStore(0, resultId);
    return true;
  }

  return false;
}

function emitHostCallSystem(
  ctx: HostCallEmitContext,
  op: HostCallInstruction,
  helpers: HostCallHelpers,
  resultId: number,
): boolean {
  const {
    instructions,
    valueIds,
    wordKinds,
    wordConstants,
    allocationOffset,
    calleeSaveOffset,
    contextOffset,
    functionRecord,
    ownRootHead,
    preservedCount,
    resultOffset,
    value,
    address,
    allocate,
    callHelper,
    clearWordCaches,
    descriptorPointer,
    emit,
    exceptionalBranch,
    fail,
    floatLoad,
    floatOperand,
    floatStore,
    guardDescriptor,
    host,
    imm,
    imm64,
    importAddress,
    importCall,
    markInteger,
    numberConstant,
    patchInstruction,
    pollWorkerStop,
    prepareStringSize,
    rawLoad,
    rawStore,
    rawValue,
    safepoint,
    saveRaw,
    startupCall,
    storedAsInteger,
    trapIf,
    wantsInteger,
    zeroWords,
  } = ctx;
  const { operation, foreign, argument, integer, bytes } = helpers;
  if (operation === "string-address") {
    rawValue(9, argument(0));
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "string-at") {
    // The caller proves a string object lives at the address;
    // anything but an exact, nonzero, eight-byte-aligned
    // integer below 2^53 traps.
    floatLoad(0, argument(0));
    emit({ op: "fcvtzs-x-d", rd: 9, rn: 0 });
    emit({ op: "scvtf-d-x", rd: 1, rn: 9 });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    trapIf({ op: "b.cond", condition: "ne" });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    trapIf({ op: "b.cond", condition: "le" });
    emit({
      op: "ubfm",
      width: 64,
      rd: 10,
      rn: 9,
      immr: 0,
      imms: 2,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 10,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    trapIf({ op: "b.cond", condition: "ne" });
    imm(10, 0x1fffffffffffff);
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
    trapIf({ op: "b.cond", condition: "hi" });
    saveRaw(9, resultId);
    return true;
  }
  if (operation === "string-copy") {
    // A flat string object, copied verbatim (header, length
    // and units) by the extent its header gives, to
    // (address, byteLength, offset) of a caller-owned raw
    // window. Marker 1 is the only flat string today: its
    // extent is 16 + 2·length, rounded up to eight bytes.
    // Returns the extent, or -1 for invalid input, a string
    // that is not flat, or a window without room.
    const failures: { index: number; condition: Condition }[] = [];
    function reject(condition: Condition): void {
      failures.push({ index: instructions.length, condition });
      emit({ op: "b.cond", condition, displacement: 0 });
    }
    function compareRegisters(left: number, right: number): void {
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: left,
        rm: right,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
    }
    /** x10 = the flat extent of the string in x9, x12 = flat
     * header, x13 = units pointer, x14 = length, x15 = data
     * bytes (or a branch to -1). */
    function extent(): void {
      emit({ op: "ldr", width: 64, rt: 12, rn: 9, offset: 0 });
      emit({
        op: "ubfm",
        width: 64,
        rd: 13,
        rn: 12,
        immr: 0,
        imms: 47,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 13,
        immediate: 1,
        shift: 0,
        setFlags: true,
      });
      reject("ne");
      emit({
        op: "ubfm",
        width: 64,
        rd: 13,
        rn: 12,
        immr: nativeHeaderFlagsShift,
        imms: nativeHeaderFlagsShift + 2,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 13,
        immediate: nativeStringOneByteFlag | nativeStringSlicedFlag,
        shift: 0,
        setFlags: true,
      });
      reject("hi");
      emit({
        op: "ldr",
        width: 32,
        rt: 14,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: 9,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "tbz",
        rt: 12,
        bit: nativeHeaderFlagsShift + 1,
        displacement: 24,
      });
      emit({
        op: "ldp",
        width: 64,
        rt: 15,
        rt2: 13,
        rn: 9,
        offset: nativeStringSlicedStartOffset,
        mode: "offset",
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 13,
        rn: 13,
        rm: 15,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: 13,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "movz",
        width: 64,
        rd: 15,
        immediate: nativeStringSlicedFlag,
        shift: 48,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: 12,
        rn: 12,
        rm: 15,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 15,
        rn: 14,
        immediate: 0,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "tbnz",
        rt: 12,
        bit: nativeHeaderFlagsShift,
        displacement: 8,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 15,
        rn: 15,
        rm: 15,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      imm(10, nativeStringMinimumDataBytes);
      compareRegisters(15, 10);
      emit({
        op: "csel",
        width: 64,
        rd: 10,
        rn: 15,
        rm: 10,
        condition: "hi",
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 10,
        rn: 10,
        immediate: nativeStringDataOffset + 7,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 10,
        rn: 10,
        immr: 3,
        imms: 63,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 10,
        rn: "zr",
        rm: 10,
        shift: "lsl",
        amount: 3,
        setFlags: false,
      });
    }
    // x0 address, x1 byteLength, x2 offset: exact integers
    // below 2^53, a nonzero address, the offset inside the
    // window, and the window's end below 2^53.
    for (let index = 0; index < 3; index++) {
      floatLoad(0, argument(index));
      emit({ op: "fcvtzs-x-d", rd: index, rn: 0 });
      emit({ op: "scvtf-d-x", rd: 1, rn: index });
      emit({ op: "fcmp", rn: 0, rm: 1 });
      reject("ne");
    }
    imm(9, 0x1fffffffffffff);
    for (const register of [0, 1, 2]) {
      compareRegisters(register, 9);
      reject("hi");
    }
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 0,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    reject("eq");
    compareRegisters(2, 1);
    reject("hi");
    emit({
      op: "add-reg",
      width: 64,
      rd: 11,
      rn: 0,
      rm: 1,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    compareRegisters(11, 9);
    reject("hi");
    // Room after the offset, then the extent must fit it.
    emit({
      op: "sub-reg",
      width: 64,
      rd: 11,
      rn: 1,
      rm: 2,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    rawValue(9, argument(3));
    extent();
    compareRegisters(10, 11);
    reject("hi");
    // Write canonical flat header, length, zero tail padding,
    // and memmove(address + offset + 16, units, dataBytes).
    // Nothing between the load and the copy can allocate, so the
    // string stays put.
    emit({
      op: "add-reg",
      width: 64,
      rd: 0,
      rn: 0,
      rm: 2,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "add-reg",
      width: 64,
      rd: 16,
      rn: 0,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "stp",
      width: 64,
      rt: "zr",
      rt2: "zr",
      rn: 16,
      offset: -16,
      mode: "offset",
    });
    emit({
      op: "stp",
      width: 64,
      rt: 12,
      rt2: 14,
      rn: 0,
      offset: 0,
      mode: "offset",
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 0,
      rn: 0,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 1,
      rn: 13,
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 2,
      rn: 15,
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
    foreign(host().symbolPrefix + "memmove");
    // The call clobbers x9-x10: read the extent again.
    rawValue(9, argument(3));
    extent();
    emit({ op: "scvtf-d-x", rd: 0, rn: 10 });
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const invalid = instructions.length;
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const done = instructions.length;
    for (const failure of failures)
      patchInstruction(failure.index, {
        op: "b.cond",
        condition: failure.condition,
        displacement: (invalid - failure.index) * 4,
      });
    patchInstruction(skip, {
      op: "b",
      displacement: (done - skip) * 4,
    });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "jit-debug-descriptor") {
    // The hosted routine returns the descriptor's address in x0.
    startupCall("jit-descriptor");
    emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "environment-copy")
    fail("UNSUPPORTED", "host operation environment-copy");
  if (operation === "target-architecture") {
    imm(9, nativeTargetArchAArch64);
    emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "target-os") {
    imm(9, host().os === "darwin" ? nativeTargetOSDarwin : nativeTargetOSLinux);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "process-id") {
    foreign(host().symbolPrefix + "getpid");
    emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "memory-page-bytes") {
    const pageSize = host().pageSize;
    if (pageSize.kind === "fixed") imm(0, pageSize.bytes);
    else foreign(pageSize.symbol);
    emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "processor-count") {
    const processors = host().processors;
    if (processors.kind === "sysconf") {
      // sysconf returns -1 when the count is unknown: 0.
      imm(0, processors.name);
      foreign(processors.symbol);
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 0,
        immediate: 0,
        shift: 0,
        setFlags: true,
      });
      emit({
        op: "csel",
        width: 64,
        rd: 10,
        rn: 0,
        rm: "zr",
        condition: "gt",
      });
    } else {
      // sched_getaffinity(0, maskBytes, outgoing area): 0 on
      // success (a failure, such as a mask wider than the
      // buffer, counts 0: unknown). Then count the set bits
      // of each mask word (x9 &= x9 - 1 until zero).
      const maskBytes = processors.maskBytes;
      imm(0, 0);
      imm(1, maskBytes);
      address(2, 0);
      foreign(processors.symbol);
      imm(10, 0);
      const failed = instructions.length;
      emit({ op: "cbnz", width: 32, rt: 0, displacement: 0 });
      imm(11, 0);
      const word = instructions.length;
      emit({
        op: "ldr-indexed",
        size: 3,
        fp: false,
        rt: 9,
        rn: "sp",
        rm: 11,
        scaled: false,
      });
      const bit = instructions.length;
      emit({ op: "cbz", width: 64, rt: 9, displacement: 20 });
      emit({
        op: "sub-imm",
        width: 64,
        rd: 12,
        rn: 9,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      emit({ op: "and-reg", width: 64, rd: 9, rn: 9, rm: 12 });
      emit({
        op: "add-imm",
        width: 64,
        rd: 10,
        rn: 10,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "b",
        displacement: (bit - instructions.length) * 4,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 11,
        rn: 11,
        immediate: 8,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 11,
        immediate: maskBytes,
        shift: 0,
        setFlags: true,
      });
      emit({
        op: "b.cond",
        condition: "ne",
        displacement: (word - instructions.length) * 4,
      });
      patchInstruction(failed, {
        op: "cbnz",
        width: 32,
        rt: 0,
        displacement: (instructions.length - failed) * 4,
      });
    }
    emit({ op: "scvtf-d-x", rd: 0, rn: 10 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "cpu-sha256") {
    const sha256 = host().sha256Instructions;
    if (sha256.kind === "baseline") imm(9, 1);
    else {
      // symbol(type) & mask, as 1 or 0.
      imm(0, sha256.type);
      foreign(sha256.symbol);
      imm(10, sha256.mask);
      emit({ op: "and-reg", width: 64, rd: 9, rn: 0, rm: 10 });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 9,
        immediate: 0,
        shift: 0,
        setFlags: true,
      });
      emit({ op: "cset", rd: 9, condition: "ne" });
    }
    emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "random-word") {
    const random = host().random;
    if (random.kind === "fill") {
      // getrandom(&word, 4, 0): small requests from an
      // initialized pool never return short; anything else
      // (an unsupported kernel) traps.
      address(0, resultOffset);
      imm(1, 4);
      imm(2, 0);
      foreign(random.symbol);
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 0,
        immediate: 4,
        shift: 0,
        setFlags: true,
      });
      trapIf({ op: "b.cond", condition: "ne" });
      emit({
        op: "ldr",
        width: 32,
        rt: 0,
        rn: "sp",
        offset: resultOffset,
      });
    } else foreign(random.symbol);
    emit({ op: "ucvtf-d-w", rd: 0, rn: 0 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "monotonic-time" || operation === "wall-clock-time") {
    const clock = host().clock;
    imm(0, operation === "monotonic-time" ? clock.monotonicId : clock.wallId);
    if (clock.kind === "timespec") {
      // clock_gettime(id, &timespec) cannot fail for the
      // supported clocks; nanoseconds = seconds * 1e9 + nsec.
      address(1, resultOffset);
      foreign(clock.symbol);
      trapIf({ op: "cbnz", width: 32, rt: 0 });
      emit({
        op: "ldr",
        width: 64,
        rt: 9,
        rn: "sp",
        offset: resultOffset,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: "sp",
        offset: resultOffset + 8,
      });
      imm(11, 1000000000);
      emit({
        op: "madd",
        width: 64,
        rd: 0,
        rn: 9,
        rm: 11,
        ra: 10,
      });
    } else foreign(clock.symbol);
    emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
    imm(9, 1000000);
    emit({ op: "scvtf-d-x", rd: 1, rn: 9 });
    emit({ op: "fdiv", rd: 0, rn: 0, rm: 1 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "argument-count") {
    rawLoad(9, contextOffset);
    emit({ op: "ldr", width: 32, rt: 9, rn: 9, offset: 40 });
    emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "argument-length" || operation === "argument-copy") {
    integer(0, 9);
    rawLoad(10, contextOffset);
    emit({ op: "ldr", width: 32, rt: 11, rn: 10, offset: 40 });
    emit({
      op: "sub-reg",
      width: 32,
      rd: "zr",
      rn: 9,
      rm: 11,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    const invalidIndex = instructions.length;
    emit({ op: "b.cond", condition: "cs", displacement: 0 });
    emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 48 });
    emit({
      op: "add-reg",
      width: 64,
      rd: 10,
      rn: 10,
      rm: 9,
      shift: "lsl",
      amount: 3,
      setFlags: false,
    });
    emit({ op: "ldr", width: 64, rt: 0, rn: 10, offset: 0 });
    rawStore(0, resultOffset);
    if (operation === "argument-copy") {
      rawValue(9, argument(1));
      rawStore(9, resultOffset + 8);
    }
    foreign(host().symbolPrefix + "strlen");
    imm(9, 0xffffffff);
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 0,
      rm: 9,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    const tooLong = instructions.length;
    emit({ op: "b.cond", condition: "hi", displacement: 0 });
    let shortBuffer = -1;
    if (operation === "argument-copy") {
      rawLoad(9, resultOffset + 8);
      emit({
        op: "ldr",
        width: 32,
        rt: 10,
        rn: 9,
        offset: nativeArrayLengthOffset,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 0,
        rm: 10,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      shortBuffer = instructions.length;
      emit({ op: "b.cond", condition: "hi", displacement: 0 });
      rawStore(0, resultOffset + 16);
      emit({
        op: "add-imm",
        width: 64,
        rd: 2,
        rn: 0,
        immediate: 0,
        shift: 0,
        setFlags: false,
      });
      rawLoad(1, resultOffset);
      emit({
        op: "ldr",
        width: 64,
        rt: 0,
        rn: 9,
        offset: nativeArrayDataOffset,
      });
      foreign(host().symbolPrefix + "memcpy");
      rawLoad(0, resultOffset + 16);
    }
    emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const invalid = instructions.length;
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const done = instructions.length;
    patchInstruction(invalidIndex, {
      op: "b.cond",
      condition: "cs",
      displacement: (invalid - invalidIndex) * 4,
    });
    patchInstruction(tooLong, {
      op: "b.cond",
      condition: "hi",
      displacement: (invalid - tooLong) * 4,
    });
    if (shortBuffer >= 0)
      patchInstruction(shortBuffer, {
        op: "b.cond",
        condition: "hi",
        displacement: (invalid - shortBuffer) * 4,
      });
    patchInstruction(skip, {
      op: "b",
      displacement: (done - skip) * 4,
    });
    floatStore(0, resultId);
    return true;
  }
  if (
    operation === "external-memory-configure" ||
    operation === "external-memory-register"
  ) {
    rawLoad(0, contextOffset);
    const configure = operation === "external-memory-configure";
    if (configure) rawValue(1, argument(0));
    else {
      floatLoad(0, argument(0));
      floatLoad(1, argument(1));
    }
    for (const instruction of externalMemoryCapability(configure)) {
      if (instruction === undefined)
        throw "external memory instruction invariant";
      emit(instruction);
    }
    emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
    floatStore(0, resultId);
    return true;
  }
  if (
    operation === "permanent-function-address" ||
    operation === "permanent-array-address"
  ) {
    rawValue(9, argument(0));
    // Typed arrays keep their data address after the length.
    if (operation === "permanent-array-address")
      emit({
        op: "ldr",
        width: 64,
        rt: 9,
        rn: 9,
        offset: nativeArrayDataOffset,
      });
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "generational-state") {
    // State and bitmaps are permanent, caller-owned control storage.
    // Context +56 is zero until this checked publication succeeds.
    const failures: {
      index: number;
      condition: "cc" | "hi" | "ne";
    }[] = [];
    function requireState(condition: "cc" | "hi" | "ne"): void {
      failures.push({ index: instructions.length, condition });
      emit({ op: "b.cond", condition, displacement: 0 });
    }
    function compareState(left: number, right: number): void {
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: left,
        rm: right,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
    }
    rawValue(10, argument(0));
    rawValue(11, argument(1));
    emit({
      op: "ldr",
      width: 32,
      rt: 9,
      rn: 10,
      offset: nativeArrayLengthOffset,
    });
    imm(12, nativeGenerationalStateWords);
    compareState(9, 12);
    requireState("cc");
    emit({
      op: "ldr",
      width: 32,
      rt: 13,
      rn: 11,
      offset: nativeArrayLengthOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 12,
      rn: 10,
      offset: nativeArrayDataOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 14,
      rn: 11,
      offset: nativeArrayDataOffset,
    });
    imm(10, 0);
    emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 0 });
    compareState(9, 10);
    requireState("ne");
    emit({ op: "ldr", width: 32, rt: 17, rn: 12, offset: 28 });
    imm(10, 512);
    compareState(17, 10);
    requireState("cc");
    emit({
      op: "ubfm",
      width: 32,
      rd: 10,
      rn: 17,
      immr: 0,
      imms: 8,
    });
    imm(11, 0);
    compareState(10, 11);
    requireState("ne");
    emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 8 });
    compareState(9, 17);
    requireState("ne");
    emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 12 });
    compareState(9, 11);
    requireState("ne");
    emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 4 });
    imm(10, 16);
    compareState(9, 10);
    requireState("cc");
    imm(10, 0x7ffffff0);
    compareState(9, 10);
    requireState("hi");
    emit({
      op: "add-reg",
      width: 64,
      rd: 10,
      rn: 9,
      rm: 17,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    imm(11, 0x7ffffff0);
    compareState(10, 11);
    requireState("hi");
    emit({
      op: "ubfm",
      width: 32,
      rd: 10,
      rn: 9,
      immr: 0,
      imms: 3,
    });
    imm(11, 0);
    compareState(10, 11);
    requireState("ne");
    emit({
      op: "add-imm",
      width: 64,
      rd: 9,
      rn: 9,
      immediate: 255,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "ubfm",
      width: 64,
      rd: 9,
      rn: 9,
      immr: 8,
      imms: 63,
    });
    compareState(13, 9);
    requireState("cc");
    rawValue(15, argument(2));
    emit({
      op: "ldr",
      width: 32,
      rt: 13,
      rn: 15,
      offset: nativeArrayLengthOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 15,
      rn: 15,
      offset: nativeArrayDataOffset,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 9,
      rn: 17,
      immediate: 63,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "ubfm",
      width: 64,
      rd: 9,
      rn: 9,
      immr: 6,
      imms: 63,
    });
    compareState(13, 9);
    requireState("cc");
    rawValue(16, argument(3));
    emit({
      op: "ldr",
      width: 32,
      rt: 13,
      rn: 16,
      offset: nativeArrayLengthOffset,
    });
    imm(9, 1);
    compareState(13, 9);
    requireState("cc");
    emit({
      op: "ldr",
      width: 64,
      rt: 16,
      rn: 16,
      offset: nativeArrayDataOffset,
    });
    emit({ op: "str", width: 64, rt: 15, rn: 12, offset: 32 });
    emit({ op: "str", width: 64, rt: 16, rn: 12, offset: 40 });
    emit({
      op: "str",
      width: 32,
      rt: "zr",
      rn: 12,
      offset: 48,
    });
    emit({ op: "str", width: 32, rt: 13, rn: 12, offset: 52 });
    emit({
      op: "str",
      width: 64,
      rt: "zr",
      rn: 12,
      offset: 56,
    });
    emit({ op: "str", width: 32, rt: 9, rn: 12, offset: 24 });
    emit({ op: "str", width: 64, rt: 14, rn: 12, offset: 16 });
    rawLoad(10, contextOffset);
    emit({
      op: "str",
      width: 64,
      rt: 12,
      rn: 10,
      offset: nativeAllocationStateOffset,
    });
    emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const invalid = instructions.length;
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const done = instructions.length;
    for (const failure of failures) {
      if (failure === undefined) throw "allocation state guard invariant";
      patchInstruction(failure.index, {
        op: "b.cond",
        condition: failure.condition,
        displacement: (invalid - failure.index) * 4,
      });
    }
    patchInstruction(skip, {
      op: "b",
      displacement: (done - skip) * 4,
    });
    floatStore(0, resultId);
    return true;
  }
  if (
    operation === "native-function-descriptor" ||
    operation === "native-function-signature" ||
    operation === "native-value-function-descriptor" ||
    operation === "native-value-function-signature"
  ) {
    const callback = op.arguments[0];
    if (callback === undefined)
      throw "native function reflection argument invariant";
    rawValue(9, callback);
    const general =
      operation === "native-value-function-descriptor" ||
      operation === "native-value-function-signature";
    const rejected: number[] = [];
    let nullValue: number | undefined = undefined;
    if (general) {
      // A general value owns a tag/payload pair. Only tag 5 carries
      // a managed reference; primitives must never be dereferenced.
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 9,
        immediate: 5,
        shift: 0,
        setFlags: true,
      });
      rejected.push(instructions.length);
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
      rawLoad(9, value(callback).offset + 8);
      nullValue = instructions.length;
      emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
      emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
      descriptorPointer(functionRecord);
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 10,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      rejected.push(instructions.length);
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
    } else guardDescriptor(9, functionRecord);
    emit({
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset:
        operation === "native-function-descriptor" ||
        operation === "native-value-function-descriptor"
          ? nativeFunctionDescriptorOffset
          : nativeFunctionSignatureOffset,
    });
    const zero = instructions.length;
    emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
    imm(10, Number.MAX_SAFE_INTEGER);
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
    const tooLarge = instructions.length;
    emit({ op: "b.cond", condition: "hi", displacement: 0 });
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const invalid = instructions.length;
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const done = instructions.length;
    for (const at of rejected) {
      if (at === undefined) throw "function reflection rejection invariant";
      patchInstruction(at, {
        op: "b.cond",
        condition: "ne",
        displacement: (invalid - at) * 4,
      });
    }
    if (nullValue !== undefined)
      patchInstruction(nullValue, {
        op: "cbz",
        width: 64,
        rt: 9,
        displacement: (invalid - nullValue) * 4,
      });
    patchInstruction(zero, {
      op: "cbz",
      width: 64,
      rt: 9,
      displacement: (invalid - zero) * 4,
    });
    patchInstruction(tooLarge, {
      op: "b.cond",
      condition: "hi",
      displacement: (invalid - tooLarge) * 4,
    });
    patchInstruction(skip, {
      op: "b",
      displacement: (done - skip) * 4,
    });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "context-domain") {
    rawLoad(9, contextOffset);
    emit({
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset: nativeContextDomainOffset,
    });
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "engine-range-error") {
    // Tag 0 (undefined) with the reserved payload: the value a
    // JavaScript boundary converts to a RangeError. Emergency
    // mode is untouched, so catch landings leave the limit alone.
    imm(9, 0);
    saveRaw(9, resultId);
    imm(10, nativeStackOverflowPayload);
    rawStore(10, value(resultId).offset + 8);
    return true;
  }
  if (operation === "stack-overflow-is") {
    // The overflow's value is tag 0 with the reserved payload; any
    // other undefined has payload 0. The result is 1 or 0.
    const thrown = op.arguments[0];
    if (thrown === undefined)
      throw "stack overflow identity argument invariant";
    rawValue(9, thrown);
    rawLoad(10, value(thrown).offset + 8);
    imm(11, nativeStackOverflowPayload);
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 10,
      rm: 11,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 10, condition: "eq" });
    emit({ op: "cbz", width: 64, rt: 9, displacement: 8 });
    emit({
      op: "movz",
      width: 64,
      rd: 10,
      immediate: 0,
      shift: 0,
    });
    emit({ op: "scvtf-d-x", rd: 0, rn: 10 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "root-head") {
    // The stack-map registry, after recording the calling
    // function's frame as the start of the next walk (which
    // visits its callers) and its save block (all of x19..x28,
    // see savedWords). In the binding's own (not inlined) body
    // this frame is popped before the walk: record the
    // caller's, whose record x29 points to, and one plus the
    // return address into it, whose map describes its saves.
    rawLoad(9, contextOffset);
    emit({
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset: nativeStackMapRegistryOffset,
    });
    const absent = instructions.length;
    emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
    if (ownRootHead) {
      emit({
        op: "ldp",
        width: 64,
        rt: 10,
        rt2: 11,
        rn: 29,
        offset: 0,
        mode: "offset",
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 11,
        rn: 11,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
    } else address(11, calleeSaveOffset + preservedCount * 8);
    emit({
      op: "str",
      width: 64,
      rt: ownRootHead ? 10 : 29,
      rn: 9,
      offset: 16,
    });
    emit({
      op: "str",
      width: 64,
      rt: 11,
      rn: 9,
      offset: nativeStackMapSaveBlockOffset,
    });
    patchInstruction(absent, {
      op: "cbz",
      width: 64,
      rt: 9,
      displacement: (instructions.length - absent) * 4,
    });
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return true;
  }
  if (operation === "stack-maps-register") {
    // Appends (code start, code length, table) to the registry
    // in context word 0. Inputs are exact nonnegative integers
    // with a nonzero, 8-byte aligned table; else -1.
    const failures: {
      index: number;
      branch: "ne" | "le" | "cs" | "cbz" | "cbnz";
    }[] = [];
    for (let index = 0; index < 3; index++) {
      floatLoad(0, argument(index));
      emit({ op: "fcvtzs-x-d", rd: 12 + index, rn: 0 });
      emit({ op: "scvtf-d-x", rd: 1, rn: 12 + index });
      emit({ op: "fcmp", rn: 0, rm: 1 });
      failures.push({ index: instructions.length, branch: "ne" });
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 12 + index,
        rm: "zr",
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      failures.push({ index: instructions.length, branch: "le" });
      emit({ op: "b.cond", condition: "le", displacement: 0 });
    }
    emit({
      op: "ubfm",
      width: 64,
      rd: 9,
      rn: 14,
      immr: 0,
      imms: 2,
    });
    failures.push({ index: instructions.length, branch: "cbnz" });
    emit({ op: "cbnz", width: 64, rt: 9, displacement: 0 });
    rawLoad(9, contextOffset);
    emit({
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset: nativeStackMapRegistryOffset,
    });
    failures.push({ index: instructions.length, branch: "cbz" });
    emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    emit({ op: "ldr", width: 64, rt: 11, rn: 9, offset: 8 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 10,
      rm: 11,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    failures.push({ index: instructions.length, branch: "cs" });
    emit({ op: "b.cond", condition: "cs", displacement: 0 });
    imm(11, nativeStackMapRegistryEntryBytes);
    emit({
      op: "madd",
      width: 64,
      rd: 11,
      rn: 10,
      rm: 11,
      ra: 9,
    });
    emit({
      op: "str",
      width: 64,
      rt: 12,
      rn: 11,
      offset: nativeStackMapRegistryHeaderBytes,
    });
    emit({
      op: "str",
      width: 64,
      rt: 13,
      rn: 11,
      offset: nativeStackMapRegistryHeaderBytes + 8,
    });
    emit({
      op: "str",
      width: 64,
      rt: 14,
      rn: 11,
      offset: nativeStackMapRegistryHeaderBytes + 16,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 10,
      rn: 10,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
    const done = instructions.length;
    emit({ op: "b", displacement: 0 });
    const failed = instructions.length;
    for (const failure of failures) {
      if (failure === undefined) throw "stack map failure invariant";
      const displacement = (failed - failure.index) * 4,
        kind = failure.branch;
      if (kind === "cbz" || kind === "cbnz")
        patchInstruction(failure.index, {
          op: kind,
          width: 64,
          rt: 9,
          displacement,
        });
      else
        patchInstruction(failure.index, {
          op: "b.cond",
          condition: kind,
          displacement,
        });
    }
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const failedDone = instructions.length;
    emit({ op: "b", displacement: 0 });
    patchInstruction(done, {
      op: "b",
      displacement: (instructions.length - done) * 4,
    });
    imm(9, 0);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    patchInstruction(failedDone, {
      op: "b",
      displacement: (instructions.length - failedDone) * 4,
    });
    floatStore(0, resultId);
    return true;
  }
  if (
    operation === "shared-read-unsigned" ||
    operation === "shared-write-unsigned" ||
    operation === "shared-read-word64" ||
    operation === "shared-write-word64" ||
    operation === "shared-compare-exchange-word64" ||
    operation === "shared-compare-exchange-unsigned"
  ) {
    const failures: { index: number; condition: "ne" | "hi" }[] = [];
    const numeric =
      operation === "shared-compare-exchange-word64"
        ? 7
        : operation === "shared-read-word64"
          ? 4
          : operation === "shared-read-unsigned"
            ? 5
            : 6;
    for (let index = 0; index < numeric; index++) {
      floatLoad(0, argument(index));
      emit({ op: "fcvtzs-x-d", rd: index, rn: 0 });
      emit({ op: "scvtf-d-x", rd: 1, rn: index });
      emit({ op: "fcmp", rn: 0, rm: 1 });
      failures.push({
        index: instructions.length,
        condition: "ne",
      });
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
      imm(9, Number.MAX_SAFE_INTEGER);
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: index,
        rm: 9,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      failures.push({
        index: instructions.length,
        condition: "hi",
      });
      emit({ op: "b.cond", condition: "hi", displacement: 0 });
    }
    if (operation === "shared-read-word64") rawValue(4, argument(4));
    else if (operation === "shared-compare-exchange-word64")
      rawValue(7, argument(7));
    callHelper(operation);
    emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const invalid = instructions.length;
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    const done = instructions.length;
    for (const failure of failures) {
      if (failure === undefined) throw "shared guard invariant";
      patchInstruction(failure.index, {
        op: "b.cond",
        condition: failure.condition,
        displacement: (invalid - failure.index) * 4,
      });
    }
    patchInstruction(skip, {
      op: "b",
      displacement: (done - skip) * 4,
    });
    floatStore(0, resultId);
    return true;
  }

  return false;
}

function emitHostCallPosix(
  ctx: HostCallEmitContext,
  op: HostCallInstruction,
  helpers: HostCallHelpers,
  resultId: number,
): void {
  const {
    instructions,
    valueIds,
    wordKinds,
    wordConstants,
    contextOffset,
    resultOffset,
    address,
    callHelper,
    clearWordCaches,
    emit,
    floatLoad,
    floatOperand,
    floatStore,
    host,
    imm,
    imm64,
    importCall,
    markInteger,
    numberConstant,
    patchInstruction,
    rawLoad,
    rawStore,
    rawValue,
    saveRaw,
    storedAsInteger,
    trapIf,
    wantsInteger,
  } = ctx;
  function fail(code: Diagnostic["code"], message: string): never {
    return ctx.fail(code, message);
  }
  const { operation, foreign, argument, integer, bytes, inlineSequence } =
    helpers;
  if (rawWordOperation(operation)) {
    const failures: {
      index: number;
      condition: "eq" | "ne" | "hi" | "cc";
      register: number;
    }[] = [];
    function reject(condition: "eq" | "ne" | "hi" | "cc"): void {
      failures.push({
        index: instructions.length,
        condition,
        register: -1,
      });
      emit({ op: "b.cond", condition, displacement: 0 });
    }
    /** Rejects when `register` is zero ("eq") or not ("ne"). */
    function rejectRegister(register: number, condition: "eq" | "ne"): void {
      failures.push({
        index: instructions.length,
        condition,
        register,
      });
      emit(
        condition === "eq"
          ? {
              op: "cbz",
              width: 64,
              rt: register,
              displacement: 0,
            }
          : {
              op: "cbnz",
              width: 64,
              rt: register,
              displacement: 0,
            },
      );
    }
    function compare(left: number, right: number): void {
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: left,
        rm: right,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
    }
    /** Rejects `register` above Number.MAX_SAFE_INTEGER (any
     * of bits 53..63 set, as an unsigned word). */
    function rejectUnsafe(register: number): void {
      emit({
        op: "ubfm",
        width: 64,
        rd: 9,
        rn: register,
        immr: 53,
        imms: 63,
      });
      rejectRegister(9, "ne");
    }
    const arity =
      operation === "memory-move" ||
      operation === "memory-compare-exchange-word"
        ? 5
        : operation === "memory-write-word" ||
            operation === "memory-write-float64" ||
            operation === "memory-fetch-add-word" ||
            operation === "memory-store-release-word"
          ? 4
          : 3;
    // A binary64 operand or result is any number: it bypasses
    // the integer checks and travels in a float register.
    const float =
      operation === "memory-read-float64" ||
      operation === "memory-write-float64";
    // A fetch-add delta may be negative: it needs only an
    // exact integer, not the unsigned address-domain check.
    const signedArgument = operation === "memory-fetch-add-word" ? 3 : -1;
    // Exact constant bounds are checked by the compiler; the
    // offset then folds into the address and the window
    // arguments are never materialized.
    const lengthFact = valueIds.intern(argument(1)),
      offsetFact = valueIds.intern(argument(2)),
      windowLength = wordConstants[lengthFact] ?? 0,
      windowOffset = wordConstants[offsetFact] ?? 0,
      fixedBounds =
        operation !== "memory-move" &&
        wordKinds[lengthFact] === 3 &&
        wordKinds[offsetFact] === 3 &&
        windowLength >= 8 &&
        windowOffset <= windowLength - 8,
      directAddress = fixedBounds && windowOffset === 0,
      effective = directAddress ? 0 : 10;
    for (let index = 0; index < arity; index++) {
      if (fixedBounds && (index === 1 || index === 2)) continue;
      if (float && index === 3) continue;
      const fact = valueIds.intern(argument(index));
      if (wordKinds[fact] === 3) {
        imm(index, wordConstants[fact] ?? 0);
        continue;
      }
      const safeConst = numberConstant(argument(index));
      if (
        safeConst !== undefined &&
        Number.isSafeInteger(safeConst) &&
        safeConst >= 0 &&
        !(safeConst === 0 && 1 / safeConst < 0)
      ) {
        imm(index, safeConst);
        continue;
      }
      if (storedAsInteger(argument(index))) {
        // Already an exact integer: only the range remains.
        rawValue(index, argument(index));
      } else {
        const operand = floatOperand(argument(index), 0);
        emit({ op: "fcvtzs-x-d", rd: index, rn: operand });
        emit({ op: "scvtf-d-x", rd: 1, rn: index });
        emit({ op: "fcmp", rn: operand, rm: 1 });
        reject("ne");
      }
      // At a fixed zero offset the address is the effective
      // address, whose check below subsumes this one (with an
      // offset, a negative address could wrap past 2^64).
      if (!(directAddress && index === 0) && index !== signedArgument)
        rejectUnsafe(index);
    }
    rejectRegister(0, "eq");
    if (operation === "memory-move") {
      callHelper("memory-move");
    } else {
      // Dynamic windows retain the runtime range checks.
      if (!fixedBounds) {
        // An eight-byte access must fit the caller-authorized window.
        imm(9, 8);
        compare(1, 9);
        reject("cc");
        emit({
          op: "sub-imm",
          width: 64,
          rd: 10,
          rn: 1,
          immediate: 8,
          shift: 0,
          setFlags: false,
        });
        compare(2, 10);
        reject("hi");
      }
      // Effective address in x10 (address plus offset), or x0
      // itself at a fixed zero offset.
      if (fixedBounds && windowOffset > 0 && windowOffset <= 4095)
        emit({
          op: "add-imm",
          width: 64,
          rd: 10,
          rn: 0,
          immediate: windowOffset,
          shift: 0,
          setFlags: false,
        });
      else if (!directAddress) {
        // Dynamic offsets are already in x2.
        if (fixedBounds) imm(2, windowOffset);
        emit({
          op: "add-reg",
          width: 64,
          rd: 10,
          rn: 0,
          rm: 2,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
      }
      // An aligned word within MAX_SAFE_INTEGER - 7: rotated
      // right by 3, the low three bits join bits 53..63 as
      // bits 50..63, which must all be zero.
      emit({
        op: "extr",
        width: 64,
        rd: 9,
        rn: effective,
        rm: effective,
        lsb: 3,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 9,
        rn: 9,
        immr: 50,
        imms: 63,
      });
      rejectRegister(9, "ne");
      if (operation === "memory-read-word") {
        emit({
          op: "ldr",
          width: 64,
          rt: 0,
          rn: effective,
          offset: 0,
        });
        rejectUnsafe(0);
      } else if (operation === "memory-read-float64") {
        emit({ op: "ldr-d", rt: 0, rn: effective, offset: 0 });
      } else if (operation === "memory-write-float64") {
        const operand = floatOperand(argument(3), 1);
        emit({
          op: "str-d",
          rt: operand,
          rn: effective,
          offset: 0,
        });
        imm(0, 0);
      } else if (operation === "memory-load-acquire-word") {
        emit({ op: "ldar", width: 64, rt: 0, rn: effective });
        rejectUnsafe(0);
      } else if (operation === "memory-store-release-word") {
        emit({ op: "stlr", width: 64, rt: 3, rn: effective });
        imm(0, 0);
      } else if (
        operation === "memory-compare-exchange-word" ||
        operation === "memory-fetch-add-word"
      ) {
        // Exclusive-pair loop: x11 observes the word; x9 is the
        // new value (fetch-add) and x1 the store status (the
        // window length is dead once the address is checked).
        const exchange = operation === "memory-compare-exchange-word";
        const loop = instructions.length;
        emit({ op: "ldaxr", width: 64, rt: 11, rn: effective });
        let mismatch = -1;
        if (exchange) {
          compare(11, 3);
          mismatch = instructions.length;
          emit({
            op: "b.cond",
            condition: "ne",
            displacement: 0,
          });
        } else
          emit({
            op: "add-reg",
            width: 64,
            rd: 9,
            rn: 11,
            rm: 3,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
        emit({
          op: "stlxr",
          width: 64,
          rs: 1,
          rt: exchange ? 4 : 9,
          rn: effective,
        });
        emit({
          op: "cbnz",
          width: 32,
          rt: 1,
          displacement: (loop - instructions.length) * 4,
        });
        if (exchange) {
          const over = instructions.length;
          emit({ op: "b", displacement: 0 });
          patchInstruction(mismatch, {
            op: "b.cond",
            condition: "ne",
            displacement: (instructions.length - mismatch) * 4,
          });
          emit({ op: "clrex" });
          patchInstruction(over, {
            op: "b",
            displacement: (instructions.length - over) * 4,
          });
        }
        emit({
          op: "add-imm",
          width: 64,
          rd: 0,
          rn: 11,
          immediate: 0,
          shift: 0,
          setFlags: false,
        });
        rejectUnsafe(0);
      } else {
        emit({
          op: "str",
          width: 64,
          rt: 3,
          rn: effective,
          offset: 0,
        });
        imm(0, 0);
      }
    }
    // Integer consumers take the exact word (or -1) as int64.
    const integral =
      operation !== "memory-move" &&
      operation !== "memory-read-float64" &&
      wantsInteger(resultId);
    if (!integral && operation !== "memory-read-float64")
      emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const invalid = instructions.length;
    if (integral)
      emit({
        op: "orn-reg",
        width: 64,
        rd: 0,
        rn: "zr",
        rm: "zr",
      });
    else if (operation === "memory-read-float64") {
      // An invalid window reads as NaN.
      emit({
        op: "movz",
        width: 64,
        rd: 9,
        immediate: 0x7ff8,
        shift: 48,
      });
      emit({ op: "fmov-d-x", rd: 0, rn: 9 });
    } else {
      imm(9, 1);
      emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
      emit({ op: "fneg", rd: 0, rn: 0 });
    }
    const done = instructions.length;
    for (const failure of failures) {
      if (failure === undefined) throw "memory guard invariant";
      const index = failure.index,
        displacement = (invalid - index) * 4;
      patchInstruction(
        index,
        failure.register < 0
          ? {
              op: "b.cond",
              condition: failure.condition,
              displacement,
            }
          : failure.condition === "eq"
            ? {
                op: "cbz",
                width: 64,
                rt: failure.register,
                displacement,
              }
            : {
                op: "cbnz",
                width: 64,
                rt: failure.register,
                displacement,
              },
      );
    }
    patchInstruction(skip, {
      op: "b",
      displacement: (done - skip) * 4,
    });
    if (integral) {
      saveRaw(0, resultId);
      markInteger(resultId);
    } else floatStore(0, resultId);
    return;
  }
  const executableMemory = host().executableMemory,
    dualMapping = dualMappingOf(host());
  if (
    (operation === "executable-map" || operation === "executable-unmap") &&
    dualMapping !== undefined
  ) {
    // Integral results: the executable view's address (or
    // 0) or -errno, in x0.
    const sequence = inlineSequence();
    if (operation === "executable-map") {
      integer(0, 1, true);
      emitDualMappingMap(sequence, dualMapping);
    } else {
      integer(0, 0, true);
      integer(1, 1, true);
      emitDualMappingUnmap(sequence, dualMapping.symbols);
    }
    sequence.finish();
    emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
    floatStore(0, resultId);
    return;
  }
  let symbol = "";
  // memory-release's rejected ranges: they return -1 and map
  // nothing.
  const releaseRejects: {
    index: number;
    condition: Condition;
  }[] = [];
  if (operation === "memory-map" || operation === "executable-map") {
    let flags = host().anonymousPrivateFlags;
    if (operation === "executable-map") {
      if (executableMemory === undefined)
        fail("UNSUPPORTED", "target has no executable-memory ABI");
      else if (executableMemory.kind === "darwin-jit")
        flags = executableMemory.mappingFlags;
    }
    integer(0, 1, true);
    imm(0, 0);
    imm(2, operation === "executable-map" ? 7 : 3);
    imm(3, flags);
    imm(4, 0xffffffff);
    imm(5, 0);
    symbol = "mmap";
  } else if (operation === "memory-unmap" || operation === "executable-unmap") {
    // A Darwin arena is one MAP_JIT mapping.
    if (operation === "executable-unmap" && executableMemory === undefined)
      fail("UNSUPPORTED", "target has no executable-memory ABI");
    integer(0, 0, true);
    integer(1, 1, true);
    symbol = "munmap";
  } else if (operation === "memory-release") {
    // A fixed anonymous mapping over the range: fresh zero
    // pages replace (and release) the old ones.
    const fixed = host().fixedMappingFlag;
    if (fixed === undefined)
      fail("UNSUPPORTED", "target has no fixed-mapping ABI");
    integer(0, 0, true);
    integer(1, 1, true);
    // Defensively, only within the managed mapping or the
    // releasable window the identity page records (the shared
    // string arena): x11 = offset, x12 = room for the length.
    function reject(condition: Condition): void {
      releaseRejects.push({
        index: instructions.length,
        condition,
      });
      emit({ op: "b.cond", condition, displacement: 0 });
    }
    /** x11 = x0 minus the base word at `baseOffset` of x9,
     * setting the flags. */
    function offsetFrom(baseOffset: number): void {
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: 9,
        offset: baseOffset,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: 11,
        rn: 0,
        rm: 10,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
    }
    rawLoad(9, contextOffset);
    offsetFrom(nativeContextManagedBaseOffset);
    const belowManaged = instructions.length;
    emit({ op: "b.cond", condition: "cc", displacement: 0 });
    emit({
      op: "ldr",
      width: 64,
      rt: 12,
      rn: 9,
      offset: nativeContextManagedLengthOffset,
    });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 12,
      rn: 12,
      rm: 1,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    const longerThanManaged = instructions.length;
    emit({ op: "b.cond", condition: "cc", displacement: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 11,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    const insideManaged = instructions.length;
    emit({ op: "b.cond", condition: "ls", displacement: 0 });
    const window = instructions.length;
    for (const at of [belowManaged, longerThanManaged])
      patchInstruction(at, {
        op: "b.cond",
        condition: "cc",
        displacement: (window - at) * 4,
      });
    emit({
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset: nativeContextDomainOffset,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    reject("eq");
    offsetFrom(nativeIdentityReleasableBaseOffset);
    reject("cc");
    emit({
      op: "ldr",
      width: 64,
      rt: 12,
      rn: 9,
      offset: nativeIdentityReleasableLengthOffset,
    });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 12,
      rn: 12,
      rm: 1,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    reject("cc");
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 11,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    reject("hi");
    patchInstruction(insideManaged, {
      op: "b.cond",
      condition: "ls",
      displacement: (instructions.length - insideManaged) * 4,
    });
    imm(2, 3);
    imm(3, host().anonymousPrivateFlags | fixed);
    imm(4, 0xffffffff);
    imm(5, 0);
    symbol = "mmap";
  } else if (operation === "open-read" || operation === "open-exclusive") {
    bytes(0, 0, true);
    imm(
      1,
      operation === "open-read" ? host().readFlags : host().exclusiveFlags,
    );
    if (operation === "open-exclusive") {
      integer(1, host().creationModeOnStack ? 9 : 2);
      if (host().creationModeOnStack) rawStore(9, 0);
    }
    symbol = "open";
  } else if (
    operation === "read" ||
    operation === "write" ||
    operation === "read-link"
  ) {
    if (operation === "read-link") bytes(0, 0, true);
    else integer(0, 0);
    bytes(1, 1, false);
    emit({
      op: "add-reg",
      width: 64,
      rd: 2,
      rn: "zr",
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    symbol =
      operation === "read-link"
        ? "readlink"
        : operation === "read"
          ? "read"
          : "write";
  } else if (operation === "close") {
    integer(0, 0);
    symbol = "close";
  } else if (operation === "chmod") {
    integer(0, 0);
    integer(1, 1);
    symbol = "fchmod";
  } else if (operation === "rename") {
    bytes(0, 0, true);
    bytes(1, 1, true);
    symbol = "rename";
  } else if (operation === "unlink") {
    bytes(0, 0, true);
    symbol = "unlink";
  } else throw "verified host operation invariant";
  foreign(host().symbolPrefix + symbol);
  const wide =
    operation === "read" ||
    operation === "write" ||
    operation === "read-link" ||
    operation === "memory-map" ||
    operation === "memory-release" ||
    operation === "executable-map";
  emit({
    op: "sub-imm",
    width: wide ? 64 : 32,
    rd: "zr",
    rn: 0,
    immediate: 0,
    shift: 0,
    setFlags: true,
  });
  const success = instructions.length;
  emit({ op: "b.cond", condition: "ge", displacement: 0 });
  foreign(host().errnoSymbol);
  emit({ op: "ldr", width: 32, rt: 9, rn: 0, offset: 0 });
  emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
  emit({ op: "fneg", rd: 0, rn: 0 });
  const finish = instructions.length;
  emit({ op: "b", displacement: 0 });
  const good = instructions.length;
  // A fixed mapping returns its own address: report success.
  if (operation === "memory-release") imm(0, 0);
  if (wide) emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
  else emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
  const done = instructions.length;
  patchInstruction(success, {
    op: "b.cond",
    condition: "ge",
    displacement: (good - success) * 4,
  });
  patchInstruction(finish, {
    op: "b",
    displacement: (done - finish) * 4,
  });
  if (releaseRejects.length !== 0) {
    const skip = instructions.length;
    emit({ op: "b", displacement: 0 });
    const rejected = instructions.length;
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    for (const reject of releaseRejects)
      patchInstruction(reject.index, {
        op: "b.cond",
        condition: reject.condition,
        displacement: (rejected - reject.index) * 4,
      });
    patchInstruction(skip, {
      op: "b",
      displacement: (instructions.length - skip) * 4,
    });
  }
  floatStore(0, resultId);
  return;
}

export function emitHostCall(
  ctx: HostCallEmitContext,
  op: HostCallInstruction,
): void {
  const helpers = makeHostCallHelpers(ctx, op);
  if (emitHostCallVoid(ctx, op, helpers)) return;
  const resultId = op.id;
  if (resultId === undefined) throw "verified host result invariant";
  if (emitHostCallRuntime(ctx, op, helpers, resultId)) return;
  if (emitHostCallSystem(ctx, op, helpers, resultId)) return;
  emitHostCallPosix(ctx, op, helpers, resultId);
}
