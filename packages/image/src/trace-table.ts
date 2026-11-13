import { readUnsigned, writeUnsigned } from "@tint/foundation/binary/bytes";

/** Compact symbol and line table that a native image embeds for its own
 * symbolicated stack traces (see docs/runtime-diagnostics.md). All fields are
 * little-endian u32. Offsets are code offsets (relative to the image's first
 * instruction); ranges are half-open and sorted without overlap:
 *
 *   header  magic "TTRC", version, functionCount, lineCount, fileCount,
 *           functionsOffset, linesOffset, filesOffset, stringsOffset
 *   function start, end, nameOffset, nameLength          (16 bytes)
 *   line     start, end, file, line, column               (20 bytes)
 *   file     nameOffset, nameLength                        (8 bytes)
 *   strings  UTF-8 bytes; name offsets are relative to stringsOffset
 *
 * Offsets in the header are relative to the table's first byte. */
export const traceTableMagic = 0x43525454;
export const traceTableVersion = 1;
export const traceTableHeaderBytes = 36;
export const traceTableFunctionBytes = 16;
export const traceTableLineBytes = 20;
export const traceTableFileBytes = 8;

export interface TraceFunction {
  readonly name: string;
  readonly offset: number;
  readonly byteLength: number;
}
export interface TraceLine {
  readonly offset: number;
  readonly byteLength: number;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
export type TraceTableResult =
  | { readonly ok: true; readonly value: Uint8Array }
  | { readonly ok: false; readonly error: "INVALID_RANGE" | "SIZE_LIMIT" };

function word(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function put(bytes: Uint8Array, offset: number, value: number): void {
  if (!writeUnsigned(bytes, offset, 4, value, "little").ok)
    throw "trace table write invariant";
}

/** Sorts both inputs by start and keeps the first of overlapping ranges, so
 * every lookup has at most one answer. Empty ranges are dropped. */
export function buildTraceTable(
  functions: readonly TraceFunction[],
  lines: readonly TraceLine[],
  maxByteLength: number,
): TraceTableResult {
  const sortedFunctions: TraceFunction[] = [];
  for (const fn of functions) {
    if (fn === undefined) throw "trace function invariant";
    if (
      !word(fn.offset) ||
      !word(fn.byteLength) ||
      !word(fn.offset + fn.byteLength)
    )
      return { ok: false, error: "INVALID_RANGE" };
    if (fn.byteLength > 0) sortedFunctions.push(fn);
  }
  sortedFunctions.sort((a, b) => a.offset - b.offset);
  const sortedLines: TraceLine[] = [];
  for (const line of lines) {
    if (line === undefined) throw "trace line invariant";
    if (
      !word(line.offset) ||
      !word(line.byteLength) ||
      !word(line.offset + line.byteLength) ||
      !word(line.line) ||
      !word(line.column)
    )
      return { ok: false, error: "INVALID_RANGE" };
    if (line.byteLength > 0) sortedLines.push(line);
  }
  sortedLines.sort((a, b) => a.offset - b.offset);
  const encoder = new TextEncoder(),
    strings: Uint8Array[] = [],
    stringOffsets = new Map<string, number>();
  let stringBytes = 0;
  function intern(text: string): number {
    const known = stringOffsets.get(text);
    if (known !== undefined) return known;
    const encoded = encoder.encode(text);
    const offset = stringBytes;
    strings.push(encoded);
    stringOffsets.set(text, offset);
    stringBytes += encoded.length;
    return offset;
  }
  const functionWords: number[] = [];
  let functionEnd = 0;
  for (const fn of sortedFunctions) {
    if (fn === undefined) throw "trace function invariant";
    if (fn.offset < functionEnd) continue;
    functionEnd = fn.offset + fn.byteLength;
    const nameOffset = intern(fn.name);
    functionWords.push(
      fn.offset,
      functionEnd,
      nameOffset,
      encoder.encode(fn.name).length,
    );
  }
  const files = new Map<string, number>(),
    fileWords: number[] = [],
    lineWords: number[] = [];
  let lineEnd = 0;
  for (const line of sortedLines) {
    if (line === undefined) throw "trace line invariant";
    if (line.offset < lineEnd) continue;
    lineEnd = line.offset + line.byteLength;
    let file = files.get(line.file);
    if (file === undefined) {
      file = files.size;
      files.set(line.file, file);
      fileWords.push(intern(line.file), encoder.encode(line.file).length);
    }
    lineWords.push(line.offset, lineEnd, file, line.line, line.column);
  }
  const functionsOffset = traceTableHeaderBytes,
    linesOffset = functionsOffset + functionWords.length * 4,
    filesOffset = linesOffset + lineWords.length * 4,
    stringsOffset = filesOffset + fileWords.length * 4,
    total = Math.ceil((stringsOffset + stringBytes) / 4) * 4;
  if (!word(total) || total > maxByteLength)
    return { ok: false, error: "SIZE_LIMIT" };
  const bytes = new Uint8Array(total);
  const header = [
    traceTableMagic,
    traceTableVersion,
    functionWords.length / 4,
    lineWords.length / 5,
    fileWords.length / 2,
    functionsOffset,
    linesOffset,
    filesOffset,
    stringsOffset,
  ];
  for (let index = 0; index < header.length; index++)
    put(bytes, index * 4, header[index] ?? 0);
  for (let index = 0; index < functionWords.length; index++)
    put(bytes, functionsOffset + index * 4, functionWords[index] ?? 0);
  for (let index = 0; index < lineWords.length; index++)
    put(bytes, linesOffset + index * 4, lineWords[index] ?? 0);
  for (let index = 0; index < fileWords.length; index++)
    put(bytes, filesOffset + index * 4, fileWords[index] ?? 0);
  let cursor = stringsOffset;
  for (const encoded of strings) {
    if (encoded === undefined) throw "trace string invariant";
    bytes.set(encoded, cursor);
    cursor += encoded.length;
  }
  return { ok: true, value: bytes };
}

export interface TraceLocation {
  readonly name: string | undefined;
  readonly file: string | undefined;
  readonly line: number;
  readonly column: number;
}
function get(bytes: Uint8Array, offset: number): number {
  const value = readUnsigned(bytes, offset, 4, "little");
  if (!value.ok) throw "trace table read invariant";
  return value.value;
}
/** The binary search the native reporter performs: the last range starting at
 * or below `offset`, if it contains it. Returns its index or -1. */
function find(
  bytes: Uint8Array,
  base: number,
  count: number,
  stride: number,
  offset: number,
): number {
  let low = 0,
    high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (get(bytes, base + middle * stride) <= offset) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return -1;
  const index = low - 1;
  return offset < get(bytes, base + index * stride + 4) ? index : -1;
}
/** Reference lookup of a code offset, for tests and offline tools. */
export function lookupTraceTable(
  bytes: Uint8Array,
  offset: number,
): TraceLocation | undefined {
  if (
    bytes.length < traceTableHeaderBytes ||
    get(bytes, 0) !== traceTableMagic ||
    get(bytes, 4) !== traceTableVersion
  )
    return undefined;
  const functionCount = get(bytes, 8),
    lineCount = get(bytes, 12),
    functionsOffset = get(bytes, 20),
    linesOffset = get(bytes, 24),
    filesOffset = get(bytes, 28),
    stringsOffset = get(bytes, 32);
  const decoder = new TextDecoder();
  function text(offset: number, length: number): string {
    return decoder.decode(
      bytes.subarray(stringsOffset + offset, stringsOffset + offset + length),
    );
  }
  const fn = find(
    bytes,
    functionsOffset,
    functionCount,
    traceTableFunctionBytes,
    offset,
  );
  const line = find(bytes, linesOffset, lineCount, traceTableLineBytes, offset);
  let name: string | undefined, file: string | undefined;
  if (fn >= 0) {
    const at = functionsOffset + fn * traceTableFunctionBytes;
    name = text(get(bytes, at + 8), get(bytes, at + 12));
  }
  if (line < 0) return { name, file: undefined, line: 0, column: 0 };
  const at = linesOffset + line * traceTableLineBytes,
    fileAt = filesOffset + get(bytes, at + 8) * traceTableFileBytes;
  file = text(get(bytes, fileAt), get(bytes, fileAt + 4));
  return {
    name,
    file,
    line: get(bytes, at + 12),
    column: get(bytes, at + 16),
  };
}
