import { readUnsigned, writeUnsigned } from "@tint/foundation/binary/bytes";

/** Compact symbol and line table that a native image embeds for its own
 * symbolicated stack traces (see docs/runtime-diagnostics.md). All fields are
 * little-endian u32, except that version 2 stores each range's start and
 * end as u64. Offsets are code offsets (relative to the image's first
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
export const wideTraceTableVersion = 2;
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

function coordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function rangeWords(
  out: number[],
  start: number,
  end: number,
  wide: boolean,
): void {
  out.push(start % 0x100000000);
  if (wide) out.push(Math.floor(start / 0x100000000));
  out.push(end % 0x100000000);
  if (wide) out.push(Math.floor(end / 0x100000000));
}

/** Sorts both inputs by start and keeps the first of overlapping ranges, so
 * every lookup has at most one answer. Empty ranges are dropped. */
export function buildTraceTable(
  functions: readonly TraceFunction[],
  lines: readonly TraceLine[],
  maxByteLength: number,
  forceWide: boolean = false,
): TraceTableResult {
  let wide = forceWide;
  const sortedFunctions: TraceFunction[] = [];
  for (const fn of functions) {
    if (fn === undefined) throw "trace function invariant";
    if (
      !coordinate(fn.offset) ||
      !coordinate(fn.byteLength) ||
      !coordinate(fn.offset + fn.byteLength)
    )
      return { ok: false, error: "INVALID_RANGE" };
    if (fn.offset + fn.byteLength > 0xffffffff) wide = true;
    if (fn.byteLength > 0) sortedFunctions.push(fn);
  }
  sortedFunctions.sort((a, b) => a.offset - b.offset);
  const sortedLines: TraceLine[] = [];
  for (const line of lines) {
    if (line === undefined) throw "trace line invariant";
    if (
      !coordinate(line.offset) ||
      !coordinate(line.byteLength) ||
      !coordinate(line.offset + line.byteLength) ||
      !word(line.line) ||
      !word(line.column)
    )
      return { ok: false, error: "INVALID_RANGE" };
    if (line.offset + line.byteLength > 0xffffffff) wide = true;
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
    rangeWords(functionWords, fn.offset, functionEnd, wide);
    functionWords.push(nameOffset, encoder.encode(fn.name).length);
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
    rangeWords(lineWords, line.offset, lineEnd, wide);
    lineWords.push(file, line.line, line.column);
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
    wide ? wideTraceTableVersion : traceTableVersion,
    functionWords.length / (wide ? 6 : 4),
    lineWords.length / (wide ? 7 : 5),
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
function getCoordinate(
  bytes: Uint8Array,
  offset: number,
  width: number,
): number {
  const lo = get(bytes, offset);
  return width === 8 ? lo + get(bytes, offset + 4) * 0x100000000 : lo;
}

/** The binary search the native reporter performs: the last range starting at
 * or below `offset`, if it contains it. Returns its index or -1. */
function find(
  bytes: Uint8Array,
  base: number,
  count: number,
  stride: number,
  width: number,
  offset: number,
): number {
  let low = 0,
    high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (getCoordinate(bytes, base + middle * stride, width) <= offset)
      low = middle + 1;
    else high = middle;
  }
  if (low === 0) return -1;
  const index = low - 1;
  return offset < getCoordinate(bytes, base + index * stride + width, width)
    ? index
    : -1;
}
/** Reference lookup of a code offset, for tests and offline tools. */
export function lookupTraceTable(
  bytes: Uint8Array,
  offset: number,
): TraceLocation | undefined {
  if (bytes.length < traceTableHeaderBytes || get(bytes, 0) !== traceTableMagic)
    return undefined;
  const version = get(bytes, 4);
  if (version !== traceTableVersion && version !== wideTraceTableVersion)
    return undefined;
  const width = version === wideTraceTableVersion ? 8 : 4;
  const rangeBytes = width * 2;
  const functionStride = rangeBytes + 8;
  const lineStride = rangeBytes + 12;
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
    functionStride,
    width,
    offset,
  );
  const line = find(bytes, linesOffset, lineCount, lineStride, width, offset);
  let name: string | undefined, file: string | undefined;
  if (fn >= 0) {
    const at = functionsOffset + fn * functionStride + rangeBytes;
    name = text(get(bytes, at), get(bytes, at + 4));
  }
  if (line < 0) return { name, file: undefined, line: 0, column: 0 };
  const at = linesOffset + line * lineStride + rangeBytes,
    fileAt = filesOffset + get(bytes, at) * traceTableFileBytes;
  file = text(get(bytes, fileAt), get(bytes, fileAt + 4));
  return {
    name,
    file,
    line: get(bytes, at + 4),
    column: get(bytes, at + 8),
  };
}
