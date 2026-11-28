import type {
  EmissionOptions,
  EmissionRange,
  FragmentForms,
} from "@tint/codegen/aarch64/scalar";
import type { ModuleIR } from "@tint/ir/scalar";
import {
  createByteReader,
  createByteWriter,
  readByte,
  readString,
  readUnsigned,
  writeByte,
  writeString,
  writeUnsigned,
  writtenBytes,
  type ByteReader,
  type ByteWriter,
} from "@tint/ir/storage";
import { darwinAArch64Target, linuxAArch64Target } from "@tint/platform/target";

const MiB = 1048576;

export const defaultWorkerHeapMiB: number = 704;
export const minWorkerHeapMiB: number = 64;
export const maxWorkerHeapMiB: number = 2048;
export const defaultWorkerStackBytes: number = 16 * MiB;
export const defaultResultCreditBytes: number = 64 * MiB;
/** Per-worker non-heap overhead reserve (GC metadata, stack guard, ports). */
export const workerOverheadReserveBytes: number = 32 * MiB;

export interface WorkerAdmissionInput {
  readonly requestedWorkers: number;
  readonly rangeCount: number;
  readonly coordinatorRssBytes: number;
  readonly wireBytes: number;
  readonly workerHeapBytes: number;
  readonly workerStackBytes: number;
  readonly resultCreditBytes: number;
  readonly memoryBudgetBytes: number | undefined;
}

export interface WorkerAdmissionDecision {
  readonly workers: number;
  readonly resultCreditBytes: number;
  readonly perWorkerReserveBytes: number;
  readonly estimatedPeakBytes: number;
  readonly reason: string;
}

/** Minimum total RSS budget that could possibly admit one worker lane (with
 * zero coordinator residency and zero wire bytes). Budgets below this bound
 * always fall back to serial without needing wire packing or residency checks. */
export function minimumWorkerAdmissionBudgetBytes(
  workerHeapBytes: number,
  workerStackBytes: number = defaultWorkerStackBytes,
  resultCreditBytes: number = defaultResultCreditBytes,
): number {
  return (
    workerHeapBytes +
    workerStackBytes +
    workerOverheadReserveBytes +
    resultCreditBytes
  );
}

/** Decide how many worker lanes to launch given coordinator residency, wire
 * size, per-worker scratch/heap reserve, result credit pool, and an optional
 * total RSS budget. Returns 0 workers when the budget cannot admit one lane. */
export function admitEmissionWorkers(
  input: WorkerAdmissionInput,
): WorkerAdmissionDecision {
  const perWorkerReserveBytes =
    input.workerHeapBytes + input.workerStackBytes + workerOverheadReserveBytes;
  if (input.requestedWorkers <= 0 || input.rangeCount <= 1)
    return {
      workers: 0,
      resultCreditBytes: 0,
      perWorkerReserveBytes,
      estimatedPeakBytes: input.coordinatorRssBytes,
      reason: "serial",
    };
  const maxByRanges = Math.min(input.requestedWorkers, input.rangeCount);
  const budget = input.memoryBudgetBytes;
  if (budget === undefined)
    return {
      workers: maxByRanges,
      resultCreditBytes: input.resultCreditBytes,
      perWorkerReserveBytes,
      estimatedPeakBytes:
        input.coordinatorRssBytes +
        input.wireBytes +
        input.resultCreditBytes +
        maxByRanges * perWorkerReserveBytes,
      reason: "explicit",
    };
  const available =
    budget -
    input.coordinatorRssBytes -
    input.wireBytes -
    input.resultCreditBytes;
  if (available < perWorkerReserveBytes)
    return {
      workers: 0,
      resultCreditBytes: 0,
      perWorkerReserveBytes,
      estimatedPeakBytes: input.coordinatorRssBytes,
      reason: "budget-exceeded",
    };
  const fit = Math.floor(available / perWorkerReserveBytes);
  const workers = Math.min(maxByRanges, fit);
  return {
    workers,
    resultCreditBytes: input.resultCreditBytes,
    perWorkerReserveBytes,
    estimatedPeakBytes:
      input.coordinatorRssBytes +
      input.wireBytes +
      input.resultCreditBytes +
      workers * perWorkerReserveBytes,
    reason: workers < maxByRanges ? "budget-capped" : "admitted",
  };
}

/** Partition `module`'s functions into contiguous, IR-weight-balanced ranges
 * covering `[0, functions.length)`. Never splits a function or leaves a gap. */
export function planEmissionRanges(
  module: ModuleIR,
  targetJobs: number,
): EmissionRange[] {
  const count = module.functions.length;
  if (count === 0) return [];
  const jobs = Math.min(count, Math.max(1, targetJobs));
  if (jobs === 1) return [{ first: 0, end: count }];
  const weights: number[] = [];
  let total = 0;
  for (let id = 0; id < count; id++) {
    const fn = module.functions[id];
    let weight = 1;
    if (fn !== undefined)
      for (const block of fn.blocks)
        if (block !== undefined) weight += 1 + block.instructions.length;
    weights.push(weight);
    total += weight;
  }
  const ranges: EmissionRange[] = [];
  let first = 0,
    remainingWeight = total;
  for (let slot = 0; slot < jobs && first < count; slot++) {
    const remainingJobs = jobs - slot;
    if (remainingJobs === 1) {
      ranges.push({ first, end: count });
      break;
    }
    const maxEnd = count - (remainingJobs - 1);
    const target = remainingWeight / remainingJobs;
    let acc = 0,
      end = first;
    while (end < maxEnd) {
      const w = weights[end] ?? 1;
      if (end > first && acc + w > target && acc >= target * 0.5) break;
      acc += w;
      end++;
      if (acc >= target) break;
    }
    if (end === first) {
      acc = weights[end] ?? 1;
      end++;
    }
    ranges.push({ first, end });
    first = end;
    remainingWeight = Math.max(1, remainingWeight - acc);
  }
  return ranges;
}

/** Estimate the pending packet byte credit reserved while a range is in flight. */
export function estimateRangeCreditBytes(
  irWeight: number,
  totalCreditBytes: number,
): number {
  const cap = Math.max(65536, Math.floor(totalCreditBytes / 2));
  const raw = Math.max(65536, irWeight * 48);
  return raw > cap ? cap : raw;
}

/** Binary message tags exchanged over NativeMessagePort between coordinator and
 * fragment worker isolates. */
export const messageInitTag: number = 1;
export const messageJobTag: number = 2;
export const messageShutdownTag: number = 3;
export const messageReadyTag: number = 1;
export const messageReplyTag: number = 2;
export const messageErrorTag: number = 3;

export interface WorkerInitPayload {
  readonly wireBase: number;
  readonly preparationBytes: number;
  readonly bodyBytes: number;
  readonly targetOs: "darwin" | "linux";
  readonly options: EmissionOptions;
  readonly ranges: readonly EmissionRange[];
}

export interface WorkerJobPayload {
  readonly rangeIndex: number;
  readonly forms: FragmentForms;
}

export interface WorkerReplyHeader {
  readonly rangeIndex: number;
  readonly forms: FragmentForms;
  readonly packetOffset: number;
  readonly packetByteLength: number;
}

function writeNumberList(writer: ByteWriter, values: readonly number[]): void {
  writeUnsigned(writer, values.length);
  for (const value of values) {
    if (value === undefined) throw "worker wire list invariant";
    writeUnsigned(writer, value);
  }
}

function readNumberList(reader: ByteReader): number[] {
  const length = readUnsigned(reader);
  const result: number[] = [];
  for (let index = 0; index < length; index++)
    result.push(readUnsigned(reader));
  return result;
}

function writeForms(writer: ByteWriter, forms: FragmentForms): void {
  writeByte(
    writer,
    (forms.calls ? 1 : 0) | (forms.addresses ? 2 : 0) | (forms.far ? 4 : 0),
  );
  writeNumberList(writer, forms.longBranches);
  writeNumberList(writer, forms.longAddresses);
  writeNumberList(writer, forms.islands);
  writeNumberList(writer, forms.farBranches);
}

function readForms(reader: ByteReader): FragmentForms {
  const flags = readByte(reader);
  return {
    calls: (flags & 1) !== 0,
    addresses: (flags & 2) !== 0,
    far: (flags & 4) !== 0,
    longBranches: readNumberList(reader),
    longAddresses: readNumberList(reader),
    islands: readNumberList(reader),
    farBranches: readNumberList(reader),
  };
}

function writeUint64Number(writer: ByteWriter, value: number): void {
  const low = value % 4294967296;
  const high = Math.floor(value / 4294967296);
  writeUnsigned(writer, low);
  writeUnsigned(writer, high);
}

function readUint64Number(reader: ByteReader): number {
  const low = readUnsigned(reader);
  const high = readUnsigned(reader);
  return low + high * 4294967296;
}

export function encodeInitMessage(payload: WorkerInitPayload): Uint8Array {
  const writer = createByteWriter(256);
  writeByte(writer, messageInitTag);
  writeUint64Number(writer, payload.wireBase);
  writeUnsigned(writer, payload.preparationBytes);
  writeUnsigned(writer, payload.bodyBytes);
  writeByte(writer, payload.targetOs === "linux" ? 1 : 0);
  const options = payload.options;
  const optionFlags =
    (options.unboundedAnalysis === true ? 1 : 0) |
    (options.jsConvert === true ? 2 : 0) |
    (options.debugSpans === true ? 4 : 0) |
    (options.throwTraces === true ? 8 : 0) |
    (options.operationRanges === true ? 16 : 0) |
    (options.linearAllocation === true ? 32 : 0) |
    (options.generationalBarriers === true ? 64 : 0) |
    (options.trustedExecutableCode === true ? 128 : 0);
  const optionFlags2 =
    (options.pageAlignedCode === true ? 1 : 0) |
    (options.forceFarReach === true ? 2 : 0) |
    (options.farAddresses === false ? 4 : 0) |
    (options.closedRoots !== undefined ? 8 : 0) |
    (options.workerFunctions !== undefined ? 16 : 0);
  writeByte(writer, optionFlags);
  writeByte(writer, optionFlags2);
  if (options.closedRoots !== undefined)
    writeNumberList(writer, options.closedRoots);
  if (options.workerFunctions !== undefined) {
    const names: string[] = [];
    for (const name of options.workerFunctions) names.push(name);
    writeUnsigned(writer, names.length);
    for (const name of names) {
      if (name === undefined) throw "worker function name invariant";
      writeString(writer, name);
    }
  }
  writeUnsigned(writer, payload.ranges.length);
  for (const range of payload.ranges) {
    if (range === undefined) throw "worker range invariant";
    writeUnsigned(writer, range.first);
    writeUnsigned(writer, range.end);
  }
  return writtenBytes(writer);
}

export function decodeInitMessage(bytes: Uint8Array): WorkerInitPayload {
  const reader = createByteReader(bytes);
  const tag = readByte(reader);
  if (tag !== messageInitTag) throw "unexpected worker init message";
  const wireBase = readUint64Number(reader);
  const preparationBytes = readUnsigned(reader);
  const bodyBytes = readUnsigned(reader);
  const targetOs: "darwin" | "linux" =
    readByte(reader) === 1 ? "linux" : "darwin";
  const optionFlags = readByte(reader);
  const optionFlags2 = readByte(reader);
  const closedRoots =
    (optionFlags2 & 8) !== 0 ? readNumberList(reader) : undefined;
  let workerFunctions: ReadonlySet<string> | undefined;
  if ((optionFlags2 & 16) !== 0) {
    const set = new Set<string>();
    const count = readUnsigned(reader);
    for (let index = 0; index < count; index++) set.add(readString(reader));
    workerFunctions = set;
  }
  const rangeCount = readUnsigned(reader);
  const ranges: EmissionRange[] = [];
  for (let index = 0; index < rangeCount; index++)
    ranges.push({ first: readUnsigned(reader), end: readUnsigned(reader) });
  const options: EmissionOptions = {
    maxByteLength: Number.MAX_SAFE_INTEGER,
    hostABI:
      targetOs === "linux"
        ? linuxAArch64Target.hostABI
        : darwinAArch64Target.hostABI,
    unboundedAnalysis: (optionFlags & 1) !== 0,
    jsConvert: (optionFlags & 2) !== 0,
    debugSpans: (optionFlags & 4) !== 0,
    throwTraces: (optionFlags & 8) !== 0,
    operationRanges: (optionFlags & 16) !== 0,
    linearAllocation: (optionFlags & 32) !== 0,
    generationalBarriers: (optionFlags & 64) !== 0,
    trustedExecutableCode: (optionFlags & 128) !== 0,
    pageAlignedCode: (optionFlags2 & 1) !== 0,
    forceFarReach: (optionFlags2 & 2) !== 0 ? true : undefined,
    farAddresses: (optionFlags2 & 4) !== 0 ? false : undefined,
    ...(closedRoots === undefined ? {} : { closedRoots }),
    ...(workerFunctions === undefined ? {} : { workerFunctions }),
  };
  return {
    wireBase,
    preparationBytes,
    bodyBytes,
    targetOs,
    options,
    ranges,
  };
}

export function encodeJobMessage(payload: WorkerJobPayload): Uint8Array {
  const writer = createByteWriter(64);
  writeByte(writer, messageJobTag);
  writeUnsigned(writer, payload.rangeIndex);
  writeForms(writer, payload.forms);
  return writtenBytes(writer);
}

export function decodeJobMessage(bytes: Uint8Array): WorkerJobPayload {
  const reader = createByteReader(bytes);
  const tag = readByte(reader);
  if (tag !== messageJobTag) throw "unexpected worker job message";
  const rangeIndex = readUnsigned(reader);
  const forms = readForms(reader);
  return { rangeIndex, forms };
}

export function encodeReplyHeader(
  rangeIndex: number,
  forms: FragmentForms,
  packetByteLength: number,
): Uint8Array {
  const writer = createByteWriter(64);
  writeByte(writer, messageReplyTag);
  writeUnsigned(writer, rangeIndex);
  writeForms(writer, forms);
  writeUnsigned(writer, packetByteLength);
  return writtenBytes(writer);
}

export function decodeReplyHeader(bytes: Uint8Array): WorkerReplyHeader {
  const reader = createByteReader(bytes);
  const tag = readByte(reader);
  if (tag !== messageReplyTag) throw "unexpected worker reply message";
  const rangeIndex = readUnsigned(reader);
  const forms = readForms(reader);
  const packetByteLength = readUnsigned(reader);
  return {
    rangeIndex,
    forms,
    packetOffset: reader.offset,
    packetByteLength,
  };
}

export function encodeErrorMessage(
  rangeIndex: number,
  message: string,
): Uint8Array {
  const text = new TextEncoder().encode(message);
  const writer = createByteWriter(16 + text.length);
  writeByte(writer, messageErrorTag);
  writeUnsigned(writer, rangeIndex < 0 ? 0 : rangeIndex + 1);
  writeUnsigned(writer, text.length);
  const header = writtenBytes(writer);
  const full = new Uint8Array(header.length + text.length);
  full.set(header, 0);
  full.set(text, header.length);
  return full;
}

export function decodeErrorMessage(bytes: Uint8Array): {
  readonly rangeIndex: number;
  readonly message: string;
} {
  const reader = createByteReader(bytes);
  const tag = readByte(reader);
  if (tag !== messageErrorTag) throw "unexpected worker error message";
  const encodedIndex = readUnsigned(reader);
  const length = readUnsigned(reader);
  const slice = bytes.subarray(reader.offset, reader.offset + length);
  return {
    rangeIndex: encodedIndex === 0 ? -1 : encodedIndex - 1,
    message: new TextDecoder("utf-8").decode(slice),
  };
}
