import {
  nativeStringLengthOffset,
  nativeStringOneByteHeader,
  nativeStringTwoByteHeader,
  nativeStringSlicedStartOffset,
  nativeStringParentOffset,
  nativeStringDataOffset,
  type HostSignpostFacility,
} from "@tint/abi/host";
import {
  writeInstruction,
  relativeAddress,
  farRelativeAddress,
  type Condition,
  type Instruction,
} from "./isa.ts";
import type { UnwindRange, UnwindRow } from "@tint/abi/unwind";
import { dwarfStackPointer } from "./unwind.ts";
import { nativeStackOverflowPayload } from "@tint/abi/host";
import {
  heapDebugDescriptorBytes,
  heapDebugSampleCountOffset,
  heapDebugSampleIntervalOffset,
  heapDebugSampleLimitOffset,
} from "@tint/abi/heap-debug";
import { nativeAllocationStateOffset } from "./scalar/abi.ts";

/** Opt-in runtime diagnostics routines appended to a hosted image after its
 * modules (see docs/runtime-diagnostics.md). Default images contain none of
 * this code. All routines use only the stack they are entered on, preserve
 * the frame-pointer chain, and are position independent: code and data
 * addresses are relative windows that the composition patches. */

/** Writable diagnostic state in the image's `__DATA` (zero-initialized,
 * except the JIT descriptor's version word). */
export const diagnosticTraceOffset = 0;
/** Recorded throw: payload, tag, frame count, then (fp, pc) pairs. */
export const diagnosticTraceFrames = 64;
export const diagnosticJitDescriptorOffset = 32 + diagnosticTraceFrames * 16;
export const diagnosticSignpostLogOffset = diagnosticJitDescriptorOffset + 24;
export const diagnosticSignpostImageOffset = diagnosticSignpostLogOffset + 8;
export const diagnosticAllocationEntryOffset =
  diagnosticSignpostImageOffset + 8;
/** The allocation entry the heap sampling thunk forwards to (the runtime's
 * slow path, or the allocation signpost routine). */
export const diagnosticSampleEntryOffset = diagnosticAllocationEntryOffset + 8;
export const diagnosticDataBytes = diagnosticSampleEntryOffset + 8;
/** The heap debugger descriptor (`__tint_heap_descriptor`, see
 * @tint/abi/heap-debug), present with heap introspection. */
export const diagnosticHeapDescriptorOffset =
  Math.ceil(diagnosticDataBytes / 16) * 16;
/** Diagnostic data bytes of an image, with or without heap introspection. */
export function diagnosticDataLength(heapIntrospection: boolean): number {
  return heapIntrospection
    ? diagnosticHeapDescriptorOffset + heapDebugDescriptorBytes().length
    : diagnosticDataBytes;
}

/** os_signpost subsystem and category; Points of Interest shows the category. */
export const signpostSubsystem = "dev.tint.runtime";
export const signpostCategory = "PointsOfInterest";
/** Interval names, indexed by SignpostSite.name. */
export const signpostNames: readonly string[] = [
  "gc.collect",
  "gc.minor",
  "gc.major",
  "gc.parallel-minor",
  "gc.parallel-mark",
  "gc.parallel-forward",
  "gc.worker",
  "gc.roots",
  "gc.remembered",
  "alloc.slow",
];
export const signpostNameSlot = 32;
/** Signpost type bit: the end message carries collection metrics. */
export const signpostFormatted = 8;
/** End message of a signposted collection with metrics (see
 * SignpostSite.metrics): 1 for a major collection, the nursery bytes it
 * evacuated, the bytes it copied (promoted by a minor, surviving a major)
 * and the old-space bytes after it. */
export const collectionFormat = "major=%llu nursery=%llu copied=%llu old=%llu";
const collectionBufferBytes = 2 + 4 * 10;
const signpostBufferOffset = 64;
const signpostMetricsFrameBytes = 128;
export const signpostAllocationName = signpostNames.indexOf("alloc.slow");
/** USDT probe names (elf-usdt targets): each interval has a `__begin` and an
 * `__end` probe whose argument is the interval identifier (`8@x9`); its name
 * is the interval's with `.` and `-` replaced by `_` (gc.parallel-minor:
 * `gc_parallel_minor__begin`). Collections with metrics also fire
 * `gc__end` (major, nursery, copied, old bytes, then the identifier) before
 * `gc_collect__end`; the allocation sampling hook is `alloc__sample`
 * (address, size, context). */
export function intervalProbeName(interval: string, end: boolean): string {
  let name = "";
  for (let index = 0; index < interval.length; index++) {
    const character = interval.charAt(index);
    name += character === "." || character === "-" ? "_" : character;
  }
  return name + (end ? "__end" : "__begin");
}
export const intervalProbeArguments = "8@x9";
export const collectionProbeName = "gc__end";
export const collectionProbeArguments = "8@x10 8@x11 8@x12 8@x13 8@x9";
export const allocationSampleProbeName = "alloc__sample";
export const allocationSampleProbeArguments = "8@x0 8@x1 8@x2";
/** A statically defined tracing probe site: a `nop` at the block-relative
 * `offset`, described by the image's `.note.stapsdt`. */
export interface DiagnosticProbe {
  readonly provider: string;
  readonly name: string;
  readonly offset: number;
  /** SystemTap argument specification (`size@register`, space-separated). */
  readonly arguments: string;
}

export interface SignpostSite {
  /** Code offset of an instrumented function's first instruction, which
   * must be the standard frame-record push (it is displaced into a stub). */
  readonly offset: number;
  /** Index into signpostNames. */
  readonly name: number;
  /** Bytes of stack-passed arguments (a multiple of 16, below 4096). */
  readonly stackBytes: number;
  /** Select `alternate` instead of `name` when this integer argument
   * register is zero at entry (e.g. a minor/major flag or optional input). */
  readonly classify?: SignpostClassification | undefined;
  /** A generational collect entry (context in x0): the interval's end
   * message reports collectionFormat metrics from the allocation state. */
  readonly metrics?: boolean | undefined;
  /** With metrics: the integer argument register that forces a major
   * collection when nonzero. Otherwise a collection is major when the
   * nursery is empty or does not fit the old space's free room (the
   * generational collector's own choice). */
  readonly majorRegister?: number | undefined;
}
/** Select `alternate` instead of the site's name when this integer argument
 * register is zero at entry (e.g. a minor/major flag or optional input). */
export interface SignpostClassification {
  readonly register: number;
  readonly alternate: number;
}
export interface DiagnosticsRequest {
  /** Code offset where the routine block starts (16-byte aligned). */
  readonly base: number;
  readonly farAddresses?: boolean | undefined;
  readonly wideTrace?: boolean | undefined;
  readonly stackTraces: boolean;
  readonly signposts: readonly SignpostSite[];
  readonly allocationSignposts: boolean;
  readonly jitDebug: boolean;
  /** The heap debugger descriptor, the allocation sampling thunk and the
   * exported `__tint_allocation_sample` hook. */
  readonly heapIntrospection?: boolean | undefined;
  /** Prefix of C symbol names in the target's import table. */
  readonly symbolPrefix: string;
  /** The target's interval facility: os_signpost calls (whose name and
   * format strings must lie in `__TEXT,__cstring`) or USDT probe sites. */
  readonly signpostABI?: HostSignpostFacility | undefined;
}
export interface DiagnosticsBlock {
  /** Routine code followed by the read-only tail (C strings), padded to 16. */
  readonly code: Uint8Array;
  /** Block-relative start of the `__cstring` tail and its length. */
  readonly cstringOffset: number;
  readonly cstringLength: number;
  /** Block-relative routine entries, by name: trace-capture, trace-report,
   * signpost, signpost-init, allocation-signpost, jit-register,
   * jit-descriptor, allocation-sample-hook, allocation-sample. Absent
   * routines were not requested. */
  readonly entries: ReadonlyMap<string, number>;
  /** The same entries in emission (address) order. */
  readonly routines: readonly {
    readonly name: string;
    readonly offset: number;
  }[];
  /** Block-relative stub entry for each SignpostSite, in request order. */
  readonly thunks: readonly number[];
  /** USDT probe sites (elf-usdt targets), in address order. */
  readonly probes: readonly DiagnosticProbe[];
  /** 16-byte relative windows to absolute code offsets (register x17 is the
   * scratch register); the trace table's code offset is `tableReference`. */
  readonly codeReferences: readonly {
    readonly offset: number;
    readonly rd: number;
    readonly target: number;
  }[];
  /** Windows to the trace table, resolved after it is placed. */
  readonly tableReferences: readonly {
    readonly offset: number;
    readonly rd: number;
  }[];
  readonly dataReferences: readonly {
    readonly offset: number;
    readonly rd: number;
    readonly target: number;
  }[];
  readonly imports: readonly {
    readonly offset: number;
    readonly rd: number;
    readonly name: string;
  }[];
  readonly unwind: readonly UnwindRange[];
}
export type DiagnosticsResult =
  | { readonly ok: true; readonly value: DiagnosticsBlock }
  | { readonly ok: false; readonly error: string };

/** Bytes of one report line before truncation. */
const reportCapacity = 448;
const uncaughtText = "Uncaught ",
  frameText = "    at ",
  noTraceText = "    (no throw-site trace was recorded for this value)\n",
  unknownText = "<unknown>",
  codeText = "code+0x";

export function emitDiagnostics(
  request: DiagnosticsRequest,
): DiagnosticsResult {
  const instructions: Instruction[] = [],
    labels = new Map<string, number>(),
    branches: {
      index: number;
      label: string;
      op: string;
      condition: Condition | undefined;
    }[] = [],
    tailAddresses: { index: number; rd: number; offset: number }[] = [],
    labelAddresses: { index: number; rd: number; label: string }[] = [],
    codeReferences: { offset: number; rd: number; target: number }[] = [],
    tableReferences: { offset: number; rd: number }[] = [],
    dataReferences: { offset: number; rd: number; target: number }[] = [],
    imports: { offset: number; rd: number; name: string }[] = [],
    unwind: UnwindRange[] = [],
    probes: DiagnosticProbe[] = [],
    entries = new Map<string, number>();
  // The C-string tail: fixed messages, then signpost names in fixed slots.
  const strings: number[] = [],
    stringOffsets = new Map<string, number>();
  function cstring(text: string): number {
    const known = stringOffsets.get(text);
    if (known !== undefined) return known;
    const offset = strings.length;
    for (let i = 0; i < text.length; i++)
      strings.push(text.charCodeAt(i) & 0x7f);
    strings.push(0);
    stringOffsets.set(text, offset);
    return offset;
  }
  const routines: { name: string; offset: number }[] = [];
  function addEntry(name: string, offset: number): void {
    entries.set(name, offset);
    routines.push({ name, offset });
  }
  function emit(instruction: Instruction): void {
    instructions.push(instruction);
  }
  function here(): number {
    return instructions.length * 4;
  }
  function label(name: string): void {
    labels.set(name, instructions.length);
  }
  function jump(name: string, condition?: Condition): void {
    branches.push({
      index: instructions.length,
      label: name,
      op: condition === undefined ? "b" : "b.cond",
      condition,
    });
    emit({ op: "nop" });
  }
  /** ADR of a label within the block. */
  function labelAddress(rd: number, name: string): void {
    labelAddresses.push({ index: instructions.length, rd, label: name });
    emit({ op: "nop" });
  }
  /** A USDT probe site at the next instruction. */
  function probe(provider: string, name: string, specification: string): void {
    probes.push({ provider, name, offset: here(), arguments: specification });
    emit({ op: "nop" });
  }
  function call(name: string): void {
    branches.push({
      index: instructions.length,
      label: name,
      op: "bl",
      condition: undefined,
    });
    emit({ op: "nop" });
  }
  function move(rd: number | "sp", rn: number | "sp"): void {
    emit({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
  }
  function imm(rd: number, value: number): void {
    emit({ op: "movz", width: 64, rd, immediate: value % 65536, shift: 0 });
    let rest = Math.floor(value / 65536);
    for (const shift of [16, 32, 48]) {
      if (rest === 0) break;
      if (shift !== 16 && shift !== 32 && shift !== 48)
        throw "diagnostic immediate invariant";
      emit({ op: "movk", width: 64, rd, immediate: rest % 65536, shift });
      rest = Math.floor(rest / 65536);
    }
  }
  function add(rd: number | "sp", rn: number | "sp", immediate: number): void {
    emit({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate,
      shift: 0,
      setFlags: false,
    });
  }
  function addRegister(
    rd: number,
    rn: number,
    rm: number,
    amount: number,
  ): void {
    emit({
      op: "add-reg",
      width: 64,
      rd,
      rn,
      rm,
      shift: "lsl",
      amount,
      setFlags: false,
    });
  }
  function compare(rn: number, rm: number | "zr"): void {
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  }
  function compareImmediate(rn: number, immediate: number): void {
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn,
      immediate,
      shift: 0,
      setFlags: true,
    });
  }
  function load(rt: number, rn: number | "sp", offset: number): void {
    emit({ op: "ldr", width: 64, rt, rn, offset });
  }
  function load32(rt: number, rn: number | "sp", offset: number): void {
    emit({ op: "ldr", width: 32, rt, rn, offset });
  }
  function store(rt: number | "zr", rn: number | "sp", offset: number): void {
    emit({ op: "str", width: 64, rt, rn, offset });
  }
  function window(rd: number): void {
    const sequence =
      request.farAddresses === true
        ? farRelativeAddress(rd, 17, 0)
        : relativeAddress(rd, 17, 0);
    if (!sequence.ok) throw "diagnostic window invariant";
    for (const instruction of sequence.value) {
      if (instruction === undefined)
        throw "diagnostic window instruction invariant";
      emit(instruction);
    }
  }
  function codeAddress(rd: number, target: number): void {
    codeReferences.push({ offset: here(), rd, target });
    window(rd);
  }
  function tableAddress(rd: number): void {
    tableReferences.push({ offset: here(), rd });
    window(rd);
  }
  function dataAddress(rd: number, target: number): void {
    dataReferences.push({ offset: here(), rd, target });
    window(rd);
  }
  /** Address of a C string in the tail (ADR: the tail follows the routines). */
  function stringAddress(rd: number, text: string): void {
    tailAddresses.push({
      index: instructions.length,
      rd,
      offset: cstring(text),
    });
    emit({ op: "nop" });
  }
  /** A C call through the image's import table: clobbers x0-x17 and d0-d7,
   * d16-d31 like any foreign call. */
  function foreign(name: string): void {
    imports.push({ offset: here(), rd: 16, name });
    window(16);
    load(16, 16, 0);
    emit({ op: "blr", rn: 16 });
  }
  function framePush(bytes: number): void {
    emit({
      op: "stp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: -bytes,
      mode: "pre",
    });
    move(29, "sp");
  }
  function framePop(bytes: number): void {
    emit({
      op: "ldp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: bytes,
      mode: "post",
    });
  }
  /** Unwind rows for code starting with framePush(bytes). */
  function frameRows(start: number, end: number, bytes: number): void {
    const saves = [
      { register: 29, offset: -bytes },
      { register: 30, offset: 8 - bytes },
    ];
    const rows: UnwindRow[] = [
      { offset: 0, cfaRegister: dwarfStackPointer, cfaOffset: 0, saves: [] },
      { offset: 4, cfaRegister: dwarfStackPointer, cfaOffset: bytes, saves },
      { offset: 8, cfaRegister: 29, cfaOffset: bytes, saves },
    ];
    unwind.push({
      offset: start,
      byteLength: end - start,
      rule: { kind: "rows", rows },
    });
  }

  if (request.stackTraces) {
    // trace-capture: x16 = tag, x17 = payload of a value being thrown; x29 is
    // the throwing frame and x30 returns into it. Preserves x0-x15 and x18+.
    // A throw of the value already recorded from a frame of the recorded
    // chain (with the same callers) is a rethrow and keeps the original.
    const start = here();
    addEntry("trace-capture", start);
    emit({
      op: "sub-imm",
      width: 64,
      rd: "sp",
      rn: "sp",
      immediate: 80,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "stp",
      width: 64,
      rt: 0,
      rt2: 1,
      rn: "sp",
      offset: 0,
      mode: "offset",
    });
    emit({
      op: "stp",
      width: 64,
      rt: 2,
      rt2: 3,
      rn: "sp",
      offset: 16,
      mode: "offset",
    });
    emit({
      op: "stp",
      width: 64,
      rt: 4,
      rt2: 5,
      rn: "sp",
      offset: 32,
      mode: "offset",
    });
    emit({
      op: "stp",
      width: 64,
      rt: 6,
      rt2: 7,
      rn: "sp",
      offset: 48,
      mode: "offset",
    });
    store(30, "sp", 64);
    const saved = here();
    move(1, 17);
    move(2, 16);
    dataAddress(0, diagnosticTraceOffset);
    load(3, 0, 0);
    compare(3, 1);
    jump("capture-record", "ne");
    load(3, 0, 8);
    compare(3, 2);
    jump("capture-record", "ne");
    load(3, 0, 16);
    imm(4, 0);
    label("capture-find");
    compare(4, 3);
    jump("capture-record", "cs");
    add(5, 0, 32);
    addRegister(5, 5, 4, 4);
    load(6, 5, 0);
    compare(6, 29);
    jump("capture-match", "eq");
    add(4, 4, 1);
    jump("capture-find");
    label("capture-match");
    move(6, 29);
    label("capture-compare");
    add(4, 4, 1);
    compare(4, 3);
    jump("capture-done", "cs");
    add(5, 0, 32);
    addRegister(5, 5, 4, 4);
    load(7, 5, 0);
    load(16, 6, 0);
    compare(7, 16);
    jump("capture-record", "ne");
    load(7, 5, 8);
    load(17, 6, 8);
    compare(7, 17);
    jump("capture-record", "ne");
    move(6, 16);
    jump("capture-compare");
    label("capture-record");
    store(1, 0, 0);
    store(2, 0, 8);
    load(7, "sp", 64);
    store(29, 0, 32);
    store(7, 0, 40);
    imm(3, 1);
    move(6, 29);
    codeAddress(4, 0);
    // Frames whose return address leaves this image end the walk; the bound
    // is this block's end, so instrumentation stubs count as image code.
    tailAddresses.push({ index: instructions.length, rd: 5, offset: -1 });
    emit({ op: "nop" });
    label("capture-walk");
    compareImmediate(3, diagnosticTraceFrames);
    jump("capture-walked", "cs");
    load(16, 6, 0);
    compare(16, "zr");
    jump("capture-walked", "eq");
    imm(17, 15);
    emit({ op: "and-reg", width: 64, rd: 17, rn: 16, rm: 17 });
    compare(17, "zr");
    jump("capture-walked", "ne");
    load(7, 6, 8);
    compare(7, 4);
    jump("capture-walked", "cc");
    compare(7, 5);
    jump("capture-walked", "cs");
    add(17, 0, 32);
    addRegister(17, 17, 3, 4);
    emit({
      op: "stp",
      width: 64,
      rt: 16,
      rt2: 7,
      rn: 17,
      offset: 0,
      mode: "offset",
    });
    add(3, 3, 1);
    move(6, 16);
    jump("capture-walk");
    label("capture-walked");
    store(3, 0, 16);
    label("capture-done");
    const restore = here();
    emit({
      op: "ldp",
      width: 64,
      rt: 0,
      rt2: 1,
      rn: "sp",
      offset: 0,
      mode: "offset",
    });
    emit({
      op: "ldp",
      width: 64,
      rt: 2,
      rt2: 3,
      rn: "sp",
      offset: 16,
      mode: "offset",
    });
    emit({
      op: "ldp",
      width: 64,
      rt: 4,
      rt2: 5,
      rn: "sp",
      offset: 32,
      mode: "offset",
    });
    emit({
      op: "ldp",
      width: 64,
      rt: 6,
      rt2: 7,
      rn: "sp",
      offset: 48,
      mode: "offset",
    });
    load(30, "sp", 64);
    add("sp", "sp", 80);
    const restored = here();
    emit({ op: "ret", rn: 30 });
    unwind.push({
      offset: start,
      byteLength: here() - start,
      rule: {
        kind: "rows",
        rows: [
          {
            offset: 0,
            cfaRegister: dwarfStackPointer,
            cfaOffset: 0,
            saves: [],
          },
          {
            offset: 8,
            cfaRegister: dwarfStackPointer,
            cfaOffset: 80,
            saves: [],
          },
          {
            offset: saved - start,
            cfaRegister: dwarfStackPointer,
            cfaOffset: 80,
            saves: [{ register: 30, offset: -16 }],
          },
          {
            offset: restore - start + 20,
            cfaRegister: dwarfStackPointer,
            cfaOffset: 80,
            saves: [],
          },
          {
            offset: restored - start,
            cfaRegister: dwarfStackPointer,
            cfaOffset: 0,
            saves: [],
          },
        ],
      },
    });
    emitReporter();
  }

  /** trace-report: x0 = tag, x1 = payload of an uncaught value, x2 = 1 to
   * print the "Uncaught <value>" line first. Writes to file descriptor 2 and
   * follows the platform call ABI. It allocates nothing, so heap exhaustion
   * and stack overflow reports still print. */
  function emitReporter(): void {
    const start = here(),
      frame = 96,
      buffer = 16,
      capacity = reportCapacity;
    addEntry("trace-report", start);
    framePush(frame);
    for (let index = 0; index < 5; index++)
      emit({
        op: "stp",
        width: 64,
        rt: 19 + index * 2,
        rt2: 20 + index * 2,
        rn: "sp",
        offset: 16 + index * 16,
        mode: "offset",
      });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "sp",
      rn: "sp",
      immediate: buffer + capacity + 64,
      shift: 0,
      setFlags: false,
    });
    store(0, "sp", 0);
    store(1, "sp", 8);
    add(22, "sp", buffer);
    imm(23, 0);
    dataAddress(19, diagnosticTraceOffset);
    tableAddress(20);
    codeAddress(21, 0);
    compare(2, "zr");
    jump("report-trace", "eq");
    appendText(uncaughtText);
    load(24, "sp", 0);
    load(25, "sp", 8);
    compareImmediate(24, 3);
    jump("report-string", "eq");
    compareImmediate(24, 1);
    jump("report-number", "eq");
    compareImmediate(24, 2);
    jump("report-boolean", "eq");
    compareImmediate(24, 4);
    jump("report-null", "eq");
    compareImmediate(24, 0);
    jump("report-undefined", "eq");
    appendText("<object>");
    jump("report-value-done");
    label("report-null");
    appendText("null");
    jump("report-value-done");
    label("report-undefined");
    // The engine's reserved undefined: a stack overflow, or an allocation
    // that can never fit (see nativeStackOverflowPayload).
    imm(9, nativeStackOverflowPayload);
    compare(25, 9);
    jump("report-plain-undefined", "ne");
    appendText("RangeError: stack overflow or impossible allocation");
    jump("report-value-done");
    label("report-plain-undefined");
    appendText("undefined");
    jump("report-value-done");
    label("report-boolean");
    compare(25, "zr");
    jump("report-false", "eq");
    appendText("true");
    jump("report-value-done");
    label("report-false");
    appendText("false");
    jump("report-value-done");
    label("report-number");
    // Integral values within 2^32 in magnitude print exactly; others do not.
    emit({ op: "fmov-d-x", rd: 0, rn: 25 });
    emit({ op: "fcvtzs-x-d", rd: 26, rn: 0 });
    emit({ op: "scvtf-d-x", rd: 1, rn: 26 });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    jump("report-inexact", "ne");
    compare(26, "zr");
    jump("report-positive", "ge");
    appendText("-");
    emit({
      op: "sub-reg",
      width: 64,
      rd: 26,
      rn: "zr",
      rm: 26,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    label("report-positive");
    imm(9, 0xffffffff);
    compare(26, 9);
    jump("report-inexact", "hi");
    move(0, 26);
    call("append-decimal");
    jump("report-value-done");
    label("report-inexact");
    appendText("<number>");
    jump("report-value-done");
    label("report-string");
    compare(25, "zr");
    jump("report-object", "eq");
    load(9, 25, 0);
    load32(26, 25, nativeStringLengthOffset);
    // A sliced string (kind flag 2) is read through its parent: x25
    // becomes the parent plus the start offset, and the header the flat
    // header of its kind.
    emit({ op: "ubfm", width: 64, rd: 10, rn: 9, immr: 49, imms: 49 });
    compareImmediate(10, 0);
    jump("report-flat", "eq");
    emit({
      op: "sub-reg",
      width: 64,
      rd: 9,
      rn: 9,
      rm: 10,
      shift: "lsl",
      amount: 49,
      setFlags: false,
    });
    load(10, 25, nativeStringSlicedStartOffset);
    load(25, 25, nativeStringParentOffset);
    emit({
      op: "add-reg",
      width: 64,
      rd: 25,
      rn: 25,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    label("report-flat");
    compareImmediate(9, nativeStringTwoByteHeader);
    jump("report-two-byte", "eq");
    imm(10, nativeStringOneByteHeader);
    compare(9, 10);
    jump("report-object", "ne");
    // One-byte (Latin-1) units, at most 160, encoded as UTF-8.
    imm(27, 0);
    label("report-byte");
    compare(27, 26);
    jump("report-units-done", "cs");
    compareImmediate(27, 160);
    jump("report-units-done", "cs");
    addRegister(9, 25, 27, 0);
    emit({ op: "ldrb", rt: 10, rn: 9, offset: nativeStringDataOffset });
    add(27, 27, 1);
    move(0, 10);
    call("append-utf8");
    jump("report-byte");
    label("report-two-byte");
    // UTF-16 units, at most 160, encoded as UTF-8 (unpaired surrogates as
    // three-byte sequences).
    imm(27, 0);
    label("report-unit");
    compare(27, 26);
    jump("report-units-done", "cs");
    compareImmediate(27, 160);
    jump("report-units-done", "cs");
    addRegister(9, 25, 27, 1);
    emit({ op: "ldrh", rt: 10, rn: 9, offset: nativeStringDataOffset });
    add(27, 27, 1);
    // Combine a surrogate pair.
    imm(11, 0xd800);
    compare(10, 11);
    jump("report-encode", "cc");
    imm(11, 0xdc00);
    compare(10, 11);
    jump("report-encode", "cs");
    compare(27, 26);
    jump("report-encode", "cs");
    addRegister(9, 25, 27, 1);
    emit({ op: "ldrh", rt: 12, rn: 9, offset: nativeStringDataOffset });
    imm(11, 0xdc00);
    compare(12, 11);
    jump("report-encode", "cc");
    imm(11, 0xe000);
    compare(12, 11);
    jump("report-encode", "cs");
    add(27, 27, 1);
    imm(11, 0xd800);
    emit({
      op: "sub-reg",
      width: 64,
      rd: 10,
      rn: 10,
      rm: 11,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "ubfm", width: 64, rd: 10, rn: 10, immr: 54, imms: 53 });
    imm(11, 0xdc00);
    emit({
      op: "sub-reg",
      width: 64,
      rd: 12,
      rn: 12,
      rm: 11,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    addRegister(10, 10, 12, 0);
    imm(11, 0x10000);
    addRegister(10, 10, 11, 0);
    label("report-encode");
    move(0, 10);
    call("append-utf8");
    jump("report-unit");
    label("report-units-done");
    compare(27, 26);
    jump("report-value-done", "cs");
    appendText("...");
    jump("report-value-done");
    label("report-object");
    appendText("<object>");
    label("report-value-done");
    appendText("\n");
    call("flush");
    label("report-trace");
    load(24, "sp", 0);
    load(25, "sp", 8);
    load(9, 19, 0);
    compare(9, 25);
    jump("report-untraced", "ne");
    load(9, 19, 8);
    compare(9, 24);
    jump("report-untraced", "ne");
    load(25, 19, 16);
    compare(25, "zr");
    jump("report-untraced", "eq");
    imm(24, 0);
    label("report-frame");
    compare(24, 25);
    jump("report-done", "cs");
    add(9, 19, 40);
    addRegister(9, 9, 24, 4);
    load(26, 9, 0);
    emit({
      op: "sub-reg",
      width: 64,
      rd: 26,
      rn: 26,
      rm: 21,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 26,
      rn: 26,
      immediate: 4,
      shift: 0,
      setFlags: false,
    });
    appendText(frameText);
    // Function: header word 2 is the count, word 5 the array offset.
    move(3, 26);
    load32(1, 20, 8);
    load32(0, 20, 20);
    addRegister(0, 0, 20, 0);
    const rangeBytes = request.wideTrace === true ? 16 : 8;
    imm(2, rangeBytes + 8);
    call("find");
    compare(0, "zr");
    jump("report-anonymous", "eq");
    load32(9, 0, rangeBytes);
    load32(1, 0, rangeBytes + 4);
    load32(10, 20, 32);
    addRegister(9, 9, 10, 0);
    addRegister(0, 9, 20, 0);
    call("append-bytes");
    jump("report-named");
    label("report-anonymous");
    appendText(unknownText);
    label("report-named");
    move(3, 26);
    load32(1, 20, 12);
    load32(0, 20, 24);
    addRegister(0, 0, 20, 0);
    imm(2, rangeBytes + 12);
    call("find");
    move(27, 0);
    appendText(" (");
    compare(27, "zr");
    jump("report-offset", "eq");
    load32(9, 27, rangeBytes);
    load32(10, 20, 28);
    addRegister(9, 10, 9, 3);
    addRegister(9, 9, 20, 0);
    load32(10, 9, 0);
    load32(1, 9, 4);
    load32(11, 20, 32);
    addRegister(10, 10, 11, 0);
    addRegister(0, 10, 20, 0);
    call("append-bytes");
    appendText(":");
    load32(0, 27, rangeBytes + 4);
    call("append-decimal");
    appendText(":");
    load32(0, 27, rangeBytes + 8);
    call("append-decimal");
    jump("report-located");
    label("report-offset");
    appendText(codeText);
    move(0, 26);
    call("append-hex");
    label("report-located");
    appendText(")\n");
    call("flush");
    add(24, 24, 1);
    jump("report-frame");
    label("report-untraced");
    appendText(noTraceText);
    call("flush");
    label("report-done");
    add("sp", "sp", buffer + capacity + 64);
    for (let index = 4; index >= 0; index--)
      emit({
        op: "ldp",
        width: 64,
        rt: 19 + index * 2,
        rt2: 20 + index * 2,
        rn: "sp",
        offset: 16 + index * 16,
        mode: "offset",
      });
    framePop(frame);
    emit({ op: "ret", rn: 30 });
    const reporterEnd = here();
    // Leaf subroutines: x22 = buffer, x23 = its length; they use x0-x12.
    label("append-bytes"); // x0 = bytes, x1 = length; truncates at capacity
    label("append-bytes-loop");
    compare(1, "zr");
    jump("append-bytes-done", "eq");
    imm(9, capacity);
    compare(23, 9);
    jump("append-bytes-done", "cs");
    emit({ op: "ldrb", rt: 9, rn: 0, offset: 0 });
    addRegister(10, 22, 23, 0);
    emit({ op: "strb", rt: 9, rn: 10, offset: 0 });
    add(23, 23, 1);
    add(0, 0, 1);
    emit({
      op: "sub-imm",
      width: 64,
      rd: 1,
      rn: 1,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    jump("append-bytes-loop");
    label("append-bytes-done");
    emit({ op: "ret", rn: 30 });
    label("append-byte"); // x0 = byte
    imm(9, capacity);
    compare(23, 9);
    jump("append-byte-done", "cs");
    addRegister(10, 22, 23, 0);
    emit({ op: "strb", rt: 0, rn: 10, offset: 0 });
    add(23, 23, 1);
    label("append-byte-done");
    emit({ op: "ret", rn: 30 });
    label("append-decimal"); // x0 = value below 2^32
    imm(11, 0);
    let power = 1000000000;
    while (power >= 10) {
      imm(10, power);
      imm(12, 48);
      const digit = "decimal-" + String(power);
      label(digit);
      compare(0, 10);
      jump(digit + "-done", "cc");
      emit({
        op: "sub-reg",
        width: 64,
        rd: 0,
        rn: 0,
        rm: 10,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      add(12, 12, 1);
      imm(11, 1);
      jump(digit);
      label(digit + "-done");
      compare(11, "zr");
      jump(digit + "-skip", "eq");
      decimalByte();
      label(digit + "-skip");
      power = power / 10;
    }
    add(12, 0, 48);
    decimalByte();
    emit({ op: "ret", rn: 30 });
    label("append-hex"); // x0 = value; no leading zeros
    imm(11, 0);
    imm(10, 60);
    label("hex-digit");
    emit({ op: "lsrv", width: 64, rd: 12, rn: 0, rm: 10 });
    imm(9, 15);
    emit({ op: "and-reg", width: 64, rd: 12, rn: 12, rm: 9 });
    compare(12, "zr");
    jump("hex-emit", "ne");
    compare(11, "zr");
    jump("hex-emit", "ne");
    compare(10, "zr");
    jump("hex-next", "ne");
    label("hex-emit");
    imm(11, 1);
    compareImmediate(12, 10);
    jump("hex-letter", "cs");
    add(12, 12, 48);
    jump("hex-store");
    label("hex-letter");
    add(12, 12, 87);
    label("hex-store");
    decimalByte();
    label("hex-next");
    compare(10, "zr");
    jump("hex-done", "eq");
    emit({
      op: "sub-imm",
      width: 64,
      rd: 10,
      rn: 10,
      immediate: 4,
      shift: 0,
      setFlags: false,
    });
    jump("hex-digit");
    label("hex-done");
    emit({ op: "ret", rn: 30 });
    label("append-utf8"); // x0 = code point; preserves x30 in x8
    move(8, 30);
    move(12, 0);
    compareImmediate(12, 0x80);
    jump("utf8-two", "cs");
    move(0, 12);
    call("append-byte");
    jump("utf8-done");
    label("utf8-two");
    compareImmediate(12, 0x800);
    jump("utf8-three", "cs");
    utf8Lead(6, 0xc0);
    utf8Continuation(0);
    jump("utf8-done");
    label("utf8-three");
    imm(9, 0x10000);
    compare(12, 9);
    jump("utf8-four", "cs");
    utf8Lead(12, 0xe0);
    utf8Continuation(6);
    utf8Continuation(0);
    jump("utf8-done");
    label("utf8-four");
    utf8Lead(18, 0xf0);
    utf8Continuation(12);
    utf8Continuation(6);
    utf8Continuation(0);
    label("utf8-done");
    move(30, 8);
    emit({ op: "ret", rn: 30 });
    label("flush"); // write(2, buffer, length) until written; x28 keeps x30
    move(28, 30);
    label("flush-loop");
    compare(23, "zr");
    jump("flush-done", "eq");
    imm(0, 2);
    move(1, 22);
    move(2, 23);
    foreign(request.symbolPrefix + "write");
    compare(0, "zr");
    jump("flush-done", "le");
    // Shift any unwritten tail down (short writes are rare).
    emit({
      op: "sub-reg",
      width: 64,
      rd: 23,
      rn: 23,
      rm: 0,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    imm(9, 0);
    label("flush-shift");
    compare(9, 23);
    jump("flush-loop", "cs");
    addRegister(10, 22, 0, 0);
    addRegister(10, 10, 9, 0);
    emit({ op: "ldrb", rt: 11, rn: 10, offset: 0 });
    addRegister(10, 22, 9, 0);
    emit({ op: "strb", rt: 11, rn: 10, offset: 0 });
    add(9, 9, 1);
    jump("flush-shift");
    label("flush-done");
    imm(23, 0);
    move(30, 28);
    emit({ op: "ret", rn: 30 });
    label("find"); // x0 = array, x1 = count, x2 = stride, x3 = key -> entry or 0
    imm(4, 0);
    move(5, 1);
    label("find-loop");
    compare(4, 5);
    jump("find-end", "cs");
    addRegister(6, 4, 5, 0);
    emit({ op: "ubfm", width: 64, rd: 6, rn: 6, immr: 1, imms: 63 });
    emit({ op: "madd", width: 64, rd: 7, rn: 6, rm: 2, ra: 0 });
    if (request.wideTrace === true) load(9, 7, 0);
    else load32(9, 7, 0);
    compare(9, 3);
    jump("find-upper", "hi");
    add(4, 6, 1);
    jump("find-loop");
    label("find-upper");
    move(5, 6);
    jump("find-loop");
    label("find-end");
    compare(4, "zr");
    jump("find-none", "eq");
    emit({
      op: "sub-imm",
      width: 64,
      rd: 4,
      rn: 4,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "madd", width: 64, rd: 7, rn: 4, rm: 2, ra: 0 });
    if (request.wideTrace === true) load(9, 7, 8);
    else load32(9, 7, 4);
    compare(3, 9);
    jump("find-none", "cs");
    move(0, 7);
    emit({ op: "ret", rn: 30 });
    label("find-none");
    imm(0, 0);
    emit({ op: "ret", rn: 30 });
    frameRows(start, reporterEnd, frame);
    // The leaf subroutines keep the return address in x30 (or x8 around
    // nested calls) and never move the stack pointer.
    unwind.push({
      offset: reporterEnd,
      byteLength: here() - reporterEnd,
      rule: { kind: "leaf" },
    });
  }
  /** Appends x12 as one byte (a digit or letter) from inside a leaf. */
  function decimalByte(): void {
    imm(9, reportCapacity);
    compare(23, 9);
    const skip = "byte-" + String(instructions.length);
    jump(skip, "cs");
    addRegister(9, 22, 23, 0);
    emit({ op: "strb", rt: 12, rn: 9, offset: 0 });
    add(23, 23, 1);
    label(skip);
  }
  function utf8Lead(shift: number, marker: number): void {
    emit({ op: "ubfm", width: 64, rd: 0, rn: 12, immr: shift, imms: 63 });
    add(0, 0, marker);
    call("append-byte");
  }
  function utf8Continuation(shift: number): void {
    if (shift === 0) move(0, 12);
    else emit({ op: "ubfm", width: 64, rd: 0, rn: 12, immr: shift, imms: 63 });
    imm(9, 63);
    emit({ op: "and-reg", width: 64, rd: 0, rn: 0, rm: 9 });
    add(0, 0, 0x80);
    call("append-byte");
  }
  function appendText(text: string): void {
    stringAddress(0, text);
    imm(1, text.length);
    call("append-bytes");
  }

  /** Collection metrics, at a signposted collect entry: the allocation
   * state words before the collection and whether it will be major (x0 is
   * the context; only x16/x17 may change). Frame: context +24, young top
   * +32, old top +40, major +48. Majors compact in place, so the state
   * after the collection cannot tell them from minors. */
  function collectionBefore(
    site: number,
    majorRegister: number | undefined,
  ): void {
    store(0, "sp", 24);
    load(16, 0, nativeAllocationStateOffset);
    load32(17, 16, 0);
    store(17, "sp", 32);
    load32(17, 16, 12);
    store(17, "sp", 40);
    // major = force || young top == 0 || young top > old capacity - old top
    load32(17, 16, 8);
    load(16, "sp", 40);
    emit({
      op: "sub-reg",
      width: 64,
      rd: 17,
      rn: 17,
      rm: 16,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    load(16, "sp", 32);
    compare(16, 17);
    emit({ op: "cset", rd: 17, condition: "hi" });
    const nonempty = "metrics-nonempty-" + String(site),
      unforced = "metrics-unforced-" + String(site);
    compare(16, "zr");
    jump(nonempty, "ne");
    imm(17, 1);
    label(nonempty);
    if (majorRegister !== undefined) {
      compare(majorRegister, "zr");
      jump(unforced, "eq");
      imm(17, 1);
      label(unforced);
    }
    store(17, "sp", 48);
  }
  /** After the collection: the metrics (major, nursery bytes, bytes copied,
   * old bytes) at signpostBufferOffset, as the os_log buffer of
   * collectionFormat or (`words`, for USDT probes) four 64-bit words,
   * preserving every register but x16/x17 (x9/x10 are saved around it). */
  function collectionAfter(words: boolean): void {
    store(9, "sp", 112);
    store(10, "sp", 120);
    load(16, "sp", 24);
    load(16, 16, nativeAllocationStateOffset);
    load32(17, 16, 12);
    load(9, "sp", 48);
    load(10, "sp", 40);
    emit({
      op: "sub-reg",
      width: 64,
      rd: 10,
      rn: 17,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    compare(9, "zr");
    emit({ op: "csel", width: 64, rd: 10, rn: 17, rm: 10, condition: "ne" });
    if (words) {
      store(9, "sp", signpostBufferOffset);
      load(16, "sp", 32);
      store(16, "sp", signpostBufferOffset + 8);
      store(10, "sp", signpostBufferOffset + 16);
      store(17, "sp", signpostBufferOffset + 24);
      load(9, "sp", 112);
      load(10, "sp", 120);
      return;
    }
    // Header: no private items, four arguments.
    imm(16, 0x0400);
    emit({ op: "strh", rt: 16, rn: "sp", offset: signpostBufferOffset });
    const values: { register: number; offset: number }[] = [
      { register: 9, offset: -1 },
      { register: -1, offset: 32 },
      { register: 10, offset: -1 },
      { register: 17, offset: -1 },
    ];
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (value === undefined) throw "collection metric invariant";
      const at = signpostBufferOffset + 2 + index * 10;
      // Item: scalar, public by default, eight bytes.
      imm(16, 0x0800);
      emit({ op: "strh", rt: 16, rn: "sp", offset: at });
      if (value.register < 0) load(16, "sp", value.offset);
      else move(16, value.register);
      // Little-endian bytes: the argument is not 8-byte aligned.
      for (let byte = 0; byte < 8; byte++) {
        emit({ op: "strb", rt: 16, rn: "sp", offset: at + 2 + byte });
        emit({ op: "ubfm", width: 64, rd: 16, rn: 16, immr: 8, imms: 63 });
      }
    }
    load(9, "sp", 112);
    load(10, "sp", 120);
  }
  const signposts = request.signpostABI;
  if (request.signposts.length > 0 || request.allocationSignposts) {
    if (signposts === undefined)
      return { ok: false, error: "target has no signpost facility" };
    let start = 0;
    if (signposts.kind === "darwin-os-signpost") {
      // signpost-init: create the os_log handle once per process (startup
      // calls it before any thread or collection exists).
      start = here();
      addEntry("signpost-init", start);
      framePush(16);
      dataAddress(9, diagnosticSignpostLogOffset);
      load(10, 9, 0);
      compare(10, "zr");
      jump("signpost-init-done", "ne");
      imm(0, 0);
      foreign(signposts.imageHeaderSymbol);
      dataAddress(9, diagnosticSignpostImageOffset);
      store(0, 9, 0);
      stringAddress(0, signpostSubsystem);
      stringAddress(1, signpostCategory);
      foreign(signposts.logCreateSymbol);
      dataAddress(9, diagnosticSignpostLogOffset);
      store(0, 9, 0);
      label("signpost-init-done");
      framePop(16);
      emit({ op: "ret", rn: 30 });
      frameRows(start, here(), 16);
      // signpost: x16 = name index, x17 = type (1 begin, 2 end); the caller's
      // frame pointer is the interval identifier. Preserves every register
      // except x16/x17, including all argument and result registers.
      start = here();
      addEntry("signpost", start);
      const saveBytes = 352;
      framePush(16);
      emit({
        op: "sub-imm",
        width: 64,
        rd: "sp",
        rn: "sp",
        immediate: saveBytes,
        shift: 0,
        setFlags: false,
      });
      for (let index = 0; index < 18; index += 2)
        emit({
          op: "stp",
          width: 64,
          rt: index,
          rt2: index + 1,
          rn: "sp",
          offset: index * 8,
          mode: "offset",
        });
      for (let index = 0; index < 8; index += 2)
        emit({
          op: "stp-d",
          rt: index,
          rt2: index + 1,
          rn: "sp",
          offset: 144 + index * 8,
        });
      for (let index = 16; index < 32; index += 2)
        emit({
          op: "stp-d",
          rt: index,
          rt2: index + 1,
          rn: "sp",
          offset: 208 + (index - 16) * 8,
        });
      store("zr", "sp", 336);
      dataAddress(9, diagnosticSignpostLogOffset);
      load(0, 9, 0);
      compare(0, "zr");
      jump("signpost-skip", "eq");
      foreign(signposts.enabledSymbol);
      imm(9, 255);
      emit({ op: "and-reg", width: 64, rd: 0, rn: 0, rm: 9 });
      compare(0, "zr");
      jump("signpost-skip", "eq");
      dataAddress(9, diagnosticSignpostImageOffset);
      load(0, 9, 0);
      dataAddress(9, diagnosticSignpostLogOffset);
      load(1, 9, 0);
      load(2, "sp", 136);
      load(3, 29, 0);
      tailAddresses.push({ index: instructions.length, rd: 4, offset: -2 });
      emit({ op: "nop" });
      load(9, "sp", 128);
      imm(10, signpostNameSlot);
      emit({ op: "madd", width: 64, rd: 4, rn: 9, rm: 10, ra: 4 });
      stringAddress(5, "");
      add(6, "sp", 336);
      imm(7, 2);
      // Type + signpostFormatted: the caller's frame holds an os_log
      // argument buffer of the collection format at signpostBufferOffset.
      emit({ op: "ubfm", width: 64, rd: 9, rn: 2, immr: 3, imms: 3 });
      compare(9, "zr");
      jump("signpost-plain", "eq");
      emit({ op: "ubfm", width: 64, rd: 2, rn: 2, immr: 0, imms: 2 });
      stringAddress(5, collectionFormat);
      add(6, 3, signpostBufferOffset);
      imm(7, collectionBufferBytes);
      label("signpost-plain");
      foreign(signposts.emitSymbol);
      label("signpost-skip");
      for (let index = 0; index < 16; index += 2)
        emit({
          op: "ldp",
          width: 64,
          rt: index,
          rt2: index + 1,
          rn: "sp",
          offset: index * 8,
          mode: "offset",
        });
      for (let index = 0; index < 8; index += 2)
        emit({
          op: "ldp-d",
          rt: index,
          rt2: index + 1,
          rn: "sp",
          offset: 144 + index * 8,
        });
      for (let index = 16; index < 32; index += 2)
        emit({
          op: "ldp-d",
          rt: index,
          rt2: index + 1,
          rn: "sp",
          offset: 208 + (index - 16) * 8,
        });
      add("sp", "sp", saveBytes);
      framePop(16);
      emit({ op: "ret", rn: 30 });
      frameRows(start, here(), 16);
    } else {
      // signpost (USDT): x16 = name index, x17 = type (1 begin, 2 end, plus
      // signpostFormatted when the caller's frame holds collection metrics
      // as words at signpostBufferOffset). Dispatches in constant time to
      // the probe pair of the name; each probe is a nop with the caller's
      // frame pointer (the interval identifier) in x9. Preserves every
      // register except x16/x17.
      const provider = signposts.provider;
      start = here();
      addEntry("signpost", start);
      framePush(64);
      emit({
        op: "stp",
        width: 64,
        rt: 9,
        rt2: 10,
        rn: "sp",
        offset: 16,
        mode: "offset",
      });
      emit({
        op: "stp",
        width: 64,
        rt: 11,
        rt2: 12,
        rn: "sp",
        offset: 32,
        mode: "offset",
      });
      store(13, "sp", 48);
      load(9, 29, 0);
      emit({ op: "ubfm", width: 64, rd: 10, rn: 17, immr: 3, imms: 3 });
      compare(10, "zr");
      jump("signpost-probe", "eq");
      load(10, 9, signpostBufferOffset);
      load(11, 9, signpostBufferOffset + 8);
      load(12, 9, signpostBufferOffset + 16);
      load(13, 9, signpostBufferOffset + 24);
      probe(provider, collectionProbeName, collectionProbeArguments);
      label("signpost-probe");
      // Entry (name * 2 + type - 1) of the table: 8 bytes each.
      emit({ op: "ubfm", width: 64, rd: 17, rn: 17, immr: 0, imms: 2 });
      addRegister(16, 17, 16, 1);
      emit({
        op: "sub-imm",
        width: 64,
        rd: 16,
        rn: 16,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      labelAddress(17, "signpost-probes");
      addRegister(17, 17, 16, 3);
      emit({ op: "br", rn: 17 });
      label("signpost-probes");
      for (const name of signpostNames) {
        if (name === undefined) throw "signpost name invariant";
        probe(provider, intervalProbeName(name, false), intervalProbeArguments);
        jump("signpost-done");
        probe(provider, intervalProbeName(name, true), intervalProbeArguments);
        jump("signpost-done");
      }
      label("signpost-done");
      emit({
        op: "ldp",
        width: 64,
        rt: 9,
        rt2: 10,
        rn: "sp",
        offset: 16,
        mode: "offset",
      });
      emit({
        op: "ldp",
        width: 64,
        rt: 11,
        rt2: 12,
        rn: "sp",
        offset: 32,
        mode: "offset",
      });
      load(13, "sp", 48);
      framePop(64);
      emit({ op: "ret", rn: 30 });
      frameRows(start, here(), 64);
    }
    if (request.allocationSignposts) {
      // allocation-signpost: stands in for the runtime's allocation slow
      // path (context +16) and forwards to the saved entry.
      start = here();
      addEntry("allocation-signpost", start);
      framePush(16);
      imm(16, signpostAllocationName);
      imm(17, 1);
      call("signpost-entry");
      dataAddress(16, diagnosticAllocationEntryOffset);
      load(16, 16, 0);
      emit({ op: "blr", rn: 16 });
      imm(16, signpostAllocationName);
      imm(17, 2);
      call("signpost-entry");
      framePop(16);
      emit({ op: "ret", rn: 30 });
      frameRows(start, here(), 16);
    }
    for (let index = 0; index < request.signposts.length; index++) {
      const site = request.signposts[index];
      if (site === undefined) throw "signpost site invariant";
      // Thunk: frame (32 bytes: record plus the chosen name), begin, the
      // displaced body, end. The body returns here with its results intact.
      start = here();
      addEntry("signpost-thunk-" + String(index), start);
      const metrics = site.metrics === true,
        frameBytes = metrics ? signpostMetricsFrameBytes : 32;
      framePush(frameBytes);
      if (metrics) collectionBefore(index, site.majorRegister);
      imm(16, site.name);
      const classify = site.classify;
      if (classify !== undefined) {
        compare(classify.register, "zr");
        const keep = "signpost-keep-" + String(index);
        jump(keep, "ne");
        imm(16, classify.alternate);
        label(keep);
      }
      store(16, "sp", 16);
      imm(17, 1);
      call("signpost-entry");
      // Stack arguments are copied below the frame, where the body expects
      // them (signposted functions must not retain or update them).
      const stackBytes = site.stackBytes;
      if (stackBytes > 0) {
        emit({
          op: "sub-imm",
          width: 64,
          rd: "sp",
          rn: "sp",
          immediate: stackBytes,
          shift: 0,
          setFlags: false,
        });
        for (let offset = 0; offset < stackBytes; offset += 8) {
          load(16, 29, frameBytes + offset);
          store(16, "sp", offset);
        }
      }
      call("signpost-body-" + String(index));
      if (stackBytes > 0) move("sp", 29);
      if (metrics) collectionAfter(signposts.kind === "elf-usdt");
      load(16, "sp", 16);
      imm(17, metrics ? 2 + signpostFormatted : 2);
      call("signpost-entry");
      framePop(frameBytes);
      emit({ op: "ret", rn: 30 });
      frameRows(start, here(), frameBytes);
      // Body stub: the displaced frame push, then the function's second
      // instruction onward.
      const body = here();
      label("signpost-body-" + String(index));
      emit({
        op: "stp",
        width: 64,
        rt: 29,
        rt2: 30,
        rn: "sp",
        offset: -16,
        mode: "pre",
      });
      const target = site.offset + 4 - (request.base + here());
      emit({ op: "b", displacement: target });
      unwind.push({
        offset: body,
        byteLength: 8,
        rule: {
          kind: "rows",
          rows: [
            {
              offset: 0,
              cfaRegister: dwarfStackPointer,
              cfaOffset: 0,
              saves: [],
            },
            {
              offset: 4,
              cfaRegister: dwarfStackPointer,
              cfaOffset: 16,
              saves: [
                { register: 29, offset: -16 },
                { register: 30, offset: -8 },
              ],
            },
          ],
        },
      });
    }
  }
  if (entries.has("signpost")) {
    // Calls within the block reach the signpost routine through this label.
    const entry = entries.get("signpost");
    if (entry === undefined) throw "signpost entry invariant";
    labels.set("signpost-entry", entry / 4);
  }

  if (request.jitDebug) {
    // GDB/LLDB JIT interface: debuggers break on __jit_debug_register_code
    // and read __jit_debug_descriptor. The routine must stay a real call.
    let start = here();
    addEntry("jit-register", start);
    emit({ op: "nop" });
    emit({ op: "ret", rn: 30 });
    unwind.push({
      offset: start,
      byteLength: here() - start,
      rule: { kind: "leaf" },
    });
    // jit-descriptor: x0 = the descriptor's address; clobbers x17.
    start = here();
    addEntry("jit-descriptor", start);
    dataAddress(0, diagnosticJitDescriptorOffset);
    emit({ op: "ret", rn: 30 });
    unwind.push({
      offset: start,
      byteLength: here() - start,
      rule: { kind: "leaf" },
    });
  }

  if (request.heapIntrospection === true) {
    // __tint_allocation_sample(address, size, context): the hook tools
    // breakpoint (or probe) to record allocation stacks. It must stay a real
    // call that does nothing.
    let start = here();
    addEntry("allocation-sample-hook", start);
    label("allocation-sample-hook");
    // On USDT targets the hook's nop is also the alloc__sample probe.
    const facility = request.signpostABI;
    if (facility !== undefined && facility.kind === "elf-usdt")
      probe(
        facility.provider,
        allocationSampleProbeName,
        allocationSampleProbeArguments,
      );
    else emit({ op: "nop" });
    emit({ op: "ret", rn: 30 });
    unwind.push({
      offset: start,
      byteLength: here() - start,
      rule: { kind: "leaf" },
    });
    // allocation-sample: stands in for the allocation slow path (context
    // +16) and forwards to the saved entry with the arguments untouched.
    // When a tool armed sampling (a nonzero interval in the descriptor), a
    // successful allocation calls the hook with its address, then the young
    // limit is rearmed to min(saved limit, young top + interval), or
    // restored when the tool disarmed meanwhile. Unarmed, it only forwards.
    // The rearm derives the limit from the current top and never reads the
    // old one, so a limit a tool lowered below the top (the inline sequence
    // then fell into the slow path) is simply replaced.
    // Frame: record, context, result area, request (d0), status.
    const descriptor = diagnosticHeapDescriptorOffset;
    start = here();
    addEntry("allocation-sample", start);
    framePush(48);
    store(0, "sp", 16);
    store(3, "sp", 24);
    emit({ op: "str-d", rt: 0, rn: "sp", offset: 32 });
    dataAddress(16, diagnosticSampleEntryOffset);
    load(16, 16, 0);
    emit({ op: "blr", rn: 16 });
    compareImmediate(0, 1);
    jump("sample-done", "ne");
    dataAddress(9, descriptor);
    load(10, 9, heapDebugSampleIntervalOffset);
    compare(10, "zr");
    jump("sample-done", "eq");
    store(0, "sp", 40);
    // address = managed base (context +8) + the returned offset.
    load(2, "sp", 16);
    load(9, "sp", 24);
    emit({ op: "ldr-d", rt: 1, rn: 9, offset: 16 });
    emit({ op: "fcvtzs-x-d", rd: 1, rn: 1 });
    load(10, 2, 8);
    addRegister(0, 10, 1, 0);
    emit({ op: "ldr-d", rt: 0, rn: "sp", offset: 32 });
    emit({ op: "fcvtzs-x-d", rd: 1, rn: 0 });
    call("allocation-sample-hook");
    load(2, "sp", 16);
    load(12, 2, nativeAllocationStateOffset);
    dataAddress(9, descriptor);
    load(10, 9, heapDebugSampleIntervalOffset);
    load(11, 9, heapDebugSampleLimitOffset);
    compare(11, "zr");
    jump("sample-rearmed", "eq");
    compare(10, "zr");
    jump("sample-disarm", "eq");
    load32(13, 12, 0);
    addRegister(13, 13, 10, 0);
    compare(13, 11);
    emit({
      op: "csel",
      width: 64,
      rd: 13,
      rn: 13,
      rm: 11,
      condition: "cc",
    });
    emit({ op: "str", width: 32, rt: 13, rn: 12, offset: 4 });
    load(14, 9, heapDebugSampleCountOffset);
    add(14, 14, 1);
    store(14, 9, heapDebugSampleCountOffset);
    jump("sample-rearmed");
    label("sample-disarm");
    emit({ op: "str", width: 32, rt: 11, rn: 12, offset: 4 });
    label("sample-rearmed");
    load(0, "sp", 40);
    label("sample-done");
    framePop(48);
    emit({ op: "ret", rn: 30 });
    frameRows(start, here(), 48);
  }

  // Resolve branches, then the tail: C strings, padded so the table that
  // may follow starts 16-byte aligned.
  const routinesLength = here();
  let nameBase = 0;
  if (
    (request.signposts.length > 0 || request.allocationSignposts) &&
    signposts !== undefined &&
    signposts.kind === "darwin-os-signpost"
  ) {
    while (strings.length % signpostNameSlot !== 0) strings.push(0);
    nameBase = strings.length;
    for (const name of signpostNames) {
      if (name === undefined) throw "signpost name invariant";
      const at = strings.length;
      for (let i = 0; i < name.length; i++) strings.push(name.charCodeAt(i));
      while (strings.length < at + signpostNameSlot) strings.push(0);
    }
  }
  const cstringOffset = Math.ceil(routinesLength / 16) * 16,
    cstringLength = Math.ceil(strings.length / 16) * 16;
  for (const branch of branches) {
    if (branch === undefined) throw "diagnostic branch invariant";
    const target = labels.get(branch.label);
    if (target === undefined)
      return { ok: false, error: "missing diagnostic label " + branch.label };
    const displacement = (target - branch.index) * 4;
    const condition = branch.condition;
    instructions[branch.index] =
      branch.op === "bl"
        ? { op: "bl", displacement }
        : condition === undefined
          ? { op: "b", displacement }
          : { op: "b.cond", condition, displacement };
  }
  for (const item of labelAddresses) {
    if (item === undefined) throw "diagnostic label address invariant";
    const target = labels.get(item.label);
    if (target === undefined)
      return { ok: false, error: "missing diagnostic label " + item.label };
    instructions[item.index] = {
      op: "adr",
      rd: item.rd,
      displacement: (target - item.index) * 4,
    };
  }
  for (const item of tailAddresses) {
    if (item === undefined) throw "diagnostic tail invariant";
    // -1 addresses the end of the block (after the tail), -2 the first
    // signpost name slot.
    let target = cstringOffset + item.offset;
    if (item.offset === -1) target = cstringOffset + cstringLength;
    if (item.offset === -2) target = cstringOffset + nameBase;
    instructions[item.index] = {
      op: "adr",
      rd: item.rd,
      displacement: target - item.index * 4,
    };
  }
  const code = new Uint8Array(cstringOffset + cstringLength);
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index];
    if (instruction === undefined) throw "diagnostic instruction invariant";
    const written = writeInstruction(code, index * 4, instruction);
    if (!written.ok)
      return { ok: false, error: "diagnostic encoding: " + written.error };
  }
  for (let index = 0; index < strings.length; index++)
    code[cstringOffset + index] = strings[index] ?? 0;
  const thunks: number[] = [];
  for (let index = 0; index < request.signposts.length; index++) {
    const thunk = entries.get("signpost-thunk-" + String(index));
    if (thunk === undefined) throw "signpost thunk invariant";
    thunks.push(thunk);
  }
  return {
    ok: true,
    value: {
      code,
      cstringOffset,
      cstringLength,
      entries,
      routines,
      thunks,
      probes,
      codeReferences,
      tableReferences,
      dataReferences,
      imports,
      unwind,
    },
  };
}
