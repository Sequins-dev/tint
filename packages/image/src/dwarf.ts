import { writeUnsigned, writeWord64 } from "@tint/foundation/binary/bytes";
export interface LineRange {
  readonly offset: number;
  readonly byteLength: number;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
export interface FrameRange {
  /** Offsets use the same code coordinate system as FunctionRange. */
  readonly offset: number;
  readonly byteLength: number;
}
export interface FrameVariable {
  readonly name: string;
  readonly offset: number;
}
/** Artificial saved pointers, visible only while the described frame exists. */
export interface DebugFrame {
  readonly register: number;
  readonly ranges: readonly FrameRange[];
  readonly variables: readonly FrameVariable[];
}
export interface FunctionRange {
  readonly offset: number;
  readonly byteLength: number;
  readonly name: string;
  readonly frame?: DebugFrame | undefined;
}
export interface DebugRequest {
  readonly codeAddress: number;
  readonly codeLength: number;
  readonly directory: string;
  readonly functions: readonly FunctionRange[];
  readonly lines: readonly LineRange[];
  readonly maxByteLength: number;
}
export type DebugResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly abbrev: Uint8Array;
        readonly info: Uint8Array;
        readonly line: Uint8Array;
      };
    }
  | { readonly ok: false; readonly error: "INVALID_INPUT" | "SIZE_LIMIT" };

function bytesFromValues(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === undefined) throw "DWARF byte invariant";
    bytes[i] = value;
  }
  return bytes;
}
function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function path(value: string): boolean {
  return value.length > 0 && !value.includes("\0");
}
function ulebSize(value: number): number {
  let size = 1;
  while (value >= 128) {
    value = Math.floor(value / 128);
    size++;
  }
  return size;
}
function slebSize(value: number): number {
  let size = 0;
  while (true) {
    const rest = Math.floor(value / 128),
      byte = value - rest * 128;
    size++;
    if ((rest === 0 && byte < 64) || (rest === -1 && byte >= 64)) return size;
    value = rest;
  }
  throw "DWARF SLEB size invariant";
}

function uleb(bytes: Uint8Array, at: number, value: number): number {
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte += 128;
    bytes[at++] = byte;
  } while (value > 0);
  return at;
}
function sleb(bytes: Uint8Array, at: number, value: number): number {
  while (true) {
    const rest = Math.floor(value / 128);
    let byte = value - rest * 128;
    value = rest;
    const done = (value === 0 && byte < 64) || (value === -1 && byte >= 64);
    if (!done) byte += 128;
    bytes[at++] = byte;
    if (done) return at;
  }
  throw "DWARF SLEB invariant";
}
function put(bytes: Uint8Array, at: number, width: 2 | 4, value: number): void {
  if (!writeUnsigned(bytes, at, width, value, "little").ok)
    throw "DWARF integer invariant";
}
function address(bytes: Uint8Array, at: number, value: number): void {
  if (
    !writeWord64(
      bytes,
      at,
      { lo: value % 0x100000000, hi: Math.floor(value / 0x100000000) },
      "little",
    ).ok
  )
    throw "DWARF address invariant";
}
interface FramePlan {
  readonly registerExpression: Uint8Array;
  readonly names: readonly Uint8Array[];
  readonly byteLength: number;
}
function prepareFrame(fn: FunctionRange): FramePlan | undefined {
  const frame = fn.frame;
  if (frame === undefined || !uint(frame.register)) return undefined;
  const encoder = new TextEncoder(),
    names: Uint8Array[] = [],
    unique: string[] = [];
  let variablesBytes = 0,
    previousEnd = fn.offset;
  for (const variable of frame.variables) {
    if (variable === undefined) return undefined;
    if (
      !path(variable.name) ||
      unique.includes(variable.name) ||
      !Number.isInteger(variable.offset) ||
      Math.abs(variable.offset) > 0xffffffff
    )
      return undefined;
    unique.push(variable.name);
    const name = encoder.encode(variable.name),
      expressionBytes = 1 + slebSize(variable.offset);
    names.push(name);
    variablesBytes +=
      6 + name.length + ulebSize(expressionBytes) + expressionBytes;
  }
  const expression = new Uint8Array(
    frame.register < 32 ? 1 : 1 + ulebSize(frame.register),
  );
  if (frame.register < 32) expression[0] = 0x50 + frame.register;
  else {
    expression[0] = 0x90;
    uleb(expression, 1, frame.register);
  }
  let byteLength = ulebSize(expression.length) + expression.length + 1;
  for (const range of frame.ranges) {
    if (range === undefined) return undefined;
    if (
      !uint(range.offset) ||
      !uint(range.byteLength) ||
      range.byteLength === 0 ||
      range.offset < previousEnd ||
      range.offset > fn.offset + fn.byteLength - range.byteLength
    )
      return undefined;
    previousEnd = range.offset + range.byteLength;
    byteLength += 14 + variablesBytes;
  }
  return { registerExpression: expression, names, byteLength };
}
function writeFrame(
  bytes: Uint8Array,
  at: number,
  frame: DebugFrame,
  plan: FramePlan,
  codeAddress: number,
  pointerType: number,
): number {
  at = uleb(bytes, at, plan.registerExpression.length);
  bytes.set(plan.registerExpression, at);
  at += plan.registerExpression.length;
  for (const range of frame.ranges) {
    if (range === undefined) throw "DWARF frame range invariant";
    bytes[at++] = 4;
    address(bytes, at, codeAddress + range.offset);
    at += 8;
    put(bytes, at, 4, range.byteLength);
    at += 4;
    for (let index = 0; index < frame.variables.length; index++) {
      const variable = frame.variables[index],
        name = plan.names[index];
      if (variable === undefined || name === undefined)
        throw "DWARF frame variable invariant";
      bytes[at++] = 5;
      bytes.set(name, at);
      at += name.length + 1;
      put(bytes, at, 4, pointerType);
      at += 4;
      at = uleb(bytes, at, 1 + slebSize(variable.offset));
      bytes[at++] = 0x91;
      at = sleb(bytes, at, variable.offset);
    }
    bytes[at++] = 0;
  }
  bytes[at++] = 0;
  return at;
}
/** DWARF32 v4 units for a little-endian target with eight-byte addresses.
 * Source ranges are disjoint and ordered; holes never inherit a previous line. */
export function buildDebugInfo(request: DebugRequest): DebugResult {
  if (
    !uint(request.codeLength) ||
    !uint(request.maxByteLength) ||
    !Number.isSafeInteger(request.codeAddress) ||
    request.codeAddress < 0 ||
    !Number.isSafeInteger(request.codeAddress + request.codeLength) ||
    !path(request.directory)
  )
    return { ok: false, error: "INVALID_INPUT" };
  const encoder = new TextEncoder(),
    files: Uint8Array[] = [],
    fileIds = new Map<string, number>(),
    rowFiles: number[] = [],
    names: Uint8Array[] = [],
    frames: (FramePlan | undefined)[] = [];
  let hasFrames = false;
  const directory = encoder.encode(request.directory);
  let previousEnd = 0,
    programBytes = 0,
    fileBytes = 0,
    functionBytes = 0;
  for (const row of request.lines) {
    if (
      row === undefined ||
      !uint(row.offset) ||
      !uint(row.byteLength) ||
      row.byteLength === 0 ||
      row.offset < previousEnd ||
      row.offset > request.codeLength - row.byteLength ||
      !path(row.file) ||
      !uint(row.line) ||
      row.line === 0 ||
      !uint(row.column) ||
      row.column === 0
    )
      return { ok: false, error: "INVALID_INPUT" };
    previousEnd = row.offset + row.byteLength;
    let file = fileIds.get(row.file);
    if (file === undefined) {
      const name = encoder.encode(row.file);
      files.push(name);
      file = files.length;
      fileIds.set(row.file, file);
      fileBytes += name.length + 4;
    }
    rowFiles.push(file);
    programBytes +=
      19 +
      ulebSize(file) +
      slebSize(row.line - 1) +
      ulebSize(row.column) +
      ulebSize(row.byteLength);
  }
  for (const fn of request.functions) {
    if (
      fn === undefined ||
      !path(fn.name) ||
      !uint(fn.offset) ||
      !uint(fn.byteLength) ||
      fn.byteLength === 0 ||
      fn.offset > request.codeLength - fn.byteLength
    )
      return { ok: false, error: "INVALID_INPUT" };
    const name = encoder.encode(fn.name);
    names.push(name);
    functionBytes += 14 + name.length;
    const frame = fn.frame === undefined ? undefined : prepareFrame(fn);
    if (fn.frame !== undefined && frame === undefined)
      return { ok: false, error: "INVALID_INPUT" };
    frames.push(frame);
    if (frame !== undefined) {
      hasFrames = true;
      functionBytes += frame.byteLength;
    }
  }
  const unitName = files[0] ?? encoder.encode("tint");
  const abbreviations = [
    1, 0x11, 1, 3, 8, 0x1b, 8, 0x10, 0x17, 0x11, 1, 0x12, 6, 0, 0, 2, 0x2e, 0,
    3, 8, 0x11, 1, 0x12, 6, 0, 0,
  ];
  if (hasFrames)
    for (const value of [
      3, 0x2e, 1, 3, 8, 0x11, 1, 0x12, 6, 0x40, 0x18, 0, 0, 4, 0x0b, 1, 0x11, 1,
      0x12, 6, 0, 0, 5, 0x34, 0, 3, 8, 0x49, 0x13, 2, 0x18, 0x34, 0x19, 0, 0, 6,
      0x0f, 0, 0x0b, 0x0b, 0, 0,
    ]) {
      if (value === undefined) throw "DWARF abbreviation invariant";
      abbreviations.push(value);
    }
  abbreviations.push(0);
  const abbrev = bytesFromValues(abbreviations);
  const headerLength = 20 + fileBytes,
    lineLength = 10 + headerLength + programBytes,
    infoLength =
      31 +
      unitName.length +
      directory.length +
      functionBytes +
      (hasFrames ? 2 : 0);
  if (
    !uint(lineLength) ||
    !uint(infoLength) ||
    lineLength + infoLength + abbrev.length > request.maxByteLength
  )
    return { ok: false, error: "SIZE_LIMIT" };
  const info = new Uint8Array(infoLength),
    line = new Uint8Array(lineLength);
  put(info, 0, 4, info.length - 4);
  put(info, 4, 2, 4);
  put(info, 6, 4, 0);
  info[10] = 8;
  let at = 11;
  info[at++] = 1;
  info.set(unitName, at);
  at += unitName.length + 1;
  info.set(directory, at);
  at += directory.length + 1;
  put(info, at, 4, 0);
  at += 4;
  address(info, at, request.codeAddress);
  at += 8;
  put(info, at, 4, request.codeLength);
  at += 4;
  const pointerType = at;
  if (hasFrames) {
    info[at++] = 6;
    info[at++] = 8;
  }
  for (let i = 0; i < request.functions.length; i++) {
    const fn = request.functions[i],
      name = names[i];
    if (fn === undefined || name === undefined)
      throw "DWARF function invariant";
    const frame = frames[i];
    info[at++] = frame === undefined ? 2 : 3;
    info.set(name, at);
    at += name.length + 1;
    address(info, at, request.codeAddress + fn.offset);
    at += 8;
    put(info, at, 4, fn.byteLength);
    at += 4;
    if (frame !== undefined) {
      if (fn.frame === undefined) throw "DWARF frame invariant";
      at = writeFrame(
        info,
        at,
        fn.frame,
        frame,
        request.codeAddress,
        pointerType,
      );
    }
  }
  info[at++] = 0;
  if (at !== info.length) throw "DWARF info size invariant";
  put(line, 0, 4, line.length - 4);
  put(line, 4, 2, 4);
  put(line, 6, 4, headerLength);
  line.set(
    bytesFromValues([
      1, 1, 1, 251, 14, 13, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0,
    ]),
    10,
  );
  at = 29;
  for (const file of files) {
    if (file === undefined) throw "DWARF file invariant";
    line.set(file, at);
    at += file.length + 4;
  }
  line[at++] = 0;
  if (at !== 10 + headerLength) throw "DWARF header size invariant";
  for (let i = 0; i < request.lines.length; i++) {
    const row = request.lines[i],
      file = rowFiles[i];
    if (row === undefined || file === undefined) throw "DWARF line invariant";
    line[at++] = 0;
    line[at++] = 9;
    line[at++] = 2;
    address(line, at, request.codeAddress + row.offset);
    at += 8;
    line[at++] = 4;
    at = uleb(line, at, file);
    line[at++] = 3;
    at = sleb(line, at, row.line - 1);
    line[at++] = 5;
    at = uleb(line, at, row.column);
    line[at++] = 1;
    line[at++] = 2;
    at = uleb(line, at, row.byteLength);
    line[at++] = 0;
    line[at++] = 1;
    line[at++] = 1;
  }
  if (at !== line.length) throw "DWARF line size invariant";
  return { ok: true, value: { abbrev, info, line } };
}
