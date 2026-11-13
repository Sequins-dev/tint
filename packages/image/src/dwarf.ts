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
/** A machine word: a DWARF register, or memory at a register plus offset.
 * AArch64 numbers x0-x30 as 0-30, SP as 31 and v0-v31 as 64-95. */
export type DebugWord =
  | { readonly kind: "register"; readonly register: number }
  | {
      readonly kind: "memory";
      readonly register: number;
      readonly offset: number;
    };
/** Part of a value's storage. `pointer` addresses memory at a pointer word
 * plus `add`; with `value`, it is the loaded word itself (a computed value). */
export type DebugLocationPart =
  | DebugWord
  | {
      readonly kind: "pointer";
      readonly base: DebugWord;
      readonly add: number;
      readonly value: boolean;
    };
export interface DebugPiece {
  readonly part: DebugLocationPart;
  /** Bytes of the value this part supplies; omitted for a single whole part. */
  readonly byteSize?: number | undefined;
}
/** Where a variable's value is valid; ranges are disjoint and ordered. */
export interface DebugLocationRange {
  readonly offset: number;
  readonly byteLength: number;
  readonly pieces: readonly DebugPiece[];
}
export interface DebugMember {
  readonly name: string;
  readonly type: number;
  readonly offset: number;
}
/** Types reference each other by index in DebugRequest.types. */
export type DebugType =
  | {
      readonly kind: "base";
      readonly name: string;
      readonly byteSize: number;
      readonly encoding: "float" | "signed" | "unsigned" | "boolean" | "utf";
    }
  | { readonly kind: "pointer"; readonly target: number | undefined }
  | {
      readonly kind: "structure" | "union";
      readonly name: string;
      readonly byteSize: number;
      readonly members: readonly DebugMember[];
    }
  | {
      readonly kind: "enumeration";
      readonly name: string;
      readonly byteSize: number;
      readonly base: number;
      readonly values: readonly {
        readonly name: string;
        readonly value: number;
      }[];
    }
  | {
      readonly kind: "array";
      readonly element: number;
      /** Omitted for a flexible trailing array. */
      readonly count?: number | undefined;
    };
export interface DebugVariable {
  readonly name: string;
  readonly type: number;
  readonly parameter?: boolean | undefined;
  readonly artificial?: boolean | undefined;
  /** Declaration position; the file must be named for a line to be used. */
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  /** Empty when the value is never available (optimized out). */
  readonly locations: readonly DebugLocationRange[];
  /** Present for a variable-length view: the variable is an array of `type`
   * whose element count is the (computed) value described here. */
  readonly count?: readonly DebugLocationRange[] | undefined;
}
/** Code copied from `origins[origin]` into its caller at the call position. */
export interface DebugInlineScope {
  readonly origin: number;
  readonly callFile: string;
  readonly callLine: number;
  readonly callColumn: number;
  /** Disjoint, ordered, and within the enclosing scope's ranges. */
  readonly ranges: readonly FrameRange[];
  readonly variables: readonly DebugVariable[];
  readonly inlined: readonly DebugInlineScope[];
}
export interface FunctionRange {
  readonly offset: number;
  readonly byteLength: number;
  readonly name: string;
  readonly frame?: DebugFrame | undefined;
  readonly variables?: readonly DebugVariable[] | undefined;
  readonly inlined?: readonly DebugInlineScope[] | undefined;
}
export interface DebugRequest {
  readonly codeAddress: number;
  readonly codeLength: number;
  readonly directory: string;
  readonly functions: readonly FunctionRange[];
  readonly lines: readonly LineRange[];
  readonly types?: readonly DebugType[] | undefined;
  /** Abstract (inlined) function names referenced by DebugInlineScope.origin. */
  readonly origins?: readonly string[] | undefined;
  readonly maxByteLength: number;
}
export interface DebugSections {
  readonly abbrev: Uint8Array;
  readonly info: Uint8Array;
  readonly line: Uint8Array;
  readonly loc: Uint8Array;
  readonly ranges: Uint8Array;
}
export type DebugResult =
  | { readonly ok: true; readonly value: DebugSections }
  | { readonly ok: false; readonly error: "INVALID_INPUT" | "SIZE_LIMIT" };

// DWARF v4 constants used by this encoder.
const TAG_ARRAY = 0x01,
  TAG_ENUMERATION = 0x04,
  TAG_FORMAL_PARAMETER = 0x05,
  TAG_MEMBER = 0x0d,
  TAG_POINTER = 0x0f,
  TAG_COMPILE_UNIT = 0x11,
  TAG_STRUCTURE = 0x13,
  TAG_UNION = 0x17,
  TAG_INLINED = 0x1d,
  TAG_SUBRANGE = 0x21,
  TAG_BASE = 0x24,
  TAG_ENUMERATOR = 0x28,
  TAG_SUBPROGRAM = 0x2e,
  TAG_VARIABLE = 0x34;
const AT_LOCATION = 0x02,
  AT_NAME = 0x03,
  AT_BYTE_SIZE = 0x0b,
  AT_STMT_LIST = 0x10,
  AT_LOW_PC = 0x11,
  AT_HIGH_PC = 0x12,
  AT_LANGUAGE = 0x13,
  AT_COMP_DIR = 0x1b,
  AT_CONST_VALUE = 0x1c,
  AT_INLINE = 0x20,
  AT_ABSTRACT_ORIGIN = 0x31,
  AT_ARTIFICIAL = 0x34,
  AT_COUNT = 0x37,
  AT_DATA_MEMBER_LOCATION = 0x38,
  AT_DECL_FILE = 0x3a,
  AT_DECL_LINE = 0x3b,
  AT_ENCODING = 0x3e,
  AT_FRAME_BASE = 0x40,
  AT_TYPE = 0x49,
  AT_RANGES = 0x55,
  AT_CALL_COLUMN = 0x57,
  AT_CALL_FILE = 0x58,
  AT_CALL_LINE = 0x59;
const FORM_ADDR = 0x01,
  FORM_DATA1 = 0x0b,
  FORM_DATA4 = 0x06,
  FORM_STRING = 0x08,
  FORM_SDATA = 0x0d,
  FORM_UDATA = 0x0f,
  FORM_REF4 = 0x13,
  FORM_SEC_OFFSET = 0x17,
  FORM_EXPRLOC = 0x18,
  FORM_FLAG_PRESENT = 0x19;
const OP_DEREF = 0x06,
  OP_PLUS_UCONST = 0x23,
  OP_REG0 = 0x50,
  OP_BREG0 = 0x70,
  OP_REGX = 0x90,
  OP_FBREG = 0x91,
  OP_BREGX = 0x92,
  OP_PIECE = 0x93,
  OP_STACK_VALUE = 0x9f;
const LANGUAGE_C99 = 0x0c,
  INLINE_INLINED = 1;

/** Growable little-endian byte sink. */
interface Sink {
  bytes: Uint8Array;
  length: number;
}
function sink(): Sink {
  return { bytes: new Uint8Array(256), length: 0 };
}
function reserve(out: Sink, extra: number): void {
  const needed = out.length + extra;
  if (needed <= out.bytes.length) return;
  let capacity = out.bytes.length * 2;
  while (capacity < needed) capacity *= 2;
  const grown = new Uint8Array(capacity);
  grown.set(out.bytes.subarray(0, out.length), 0);
  out.bytes = grown;
}
function finish(out: Sink): Uint8Array {
  return out.bytes.slice(0, out.length);
}
function byte(out: Sink, value: number): void {
  reserve(out, 1);
  out.bytes[out.length++] = value;
}
function put(bytes: Uint8Array, at: number, width: 2 | 4, value: number): void {
  if (!writeUnsigned(bytes, at, width, value, "little").ok)
    throw "DWARF integer invariant";
}
function u16(out: Sink, value: number): void {
  reserve(out, 2);
  put(out.bytes, out.length, 2, value);
  out.length += 2;
}
function u32(out: Sink, value: number): void {
  reserve(out, 4);
  put(out.bytes, out.length, 4, value);
  out.length += 4;
}
function u64(out: Sink, value: number): void {
  reserve(out, 8);
  if (
    !writeWord64(
      out.bytes,
      out.length,
      { lo: value % 0x100000000, hi: Math.floor(value / 0x100000000) },
      "little",
    ).ok
  )
    throw "DWARF address invariant";
  out.length += 8;
}
function uleb(out: Sink, value: number): void {
  do {
    let next = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) next += 128;
    byte(out, next);
  } while (value > 0);
}
function sleb(out: Sink, value: number): void {
  while (true) {
    const rest = Math.floor(value / 128);
    let next = value - rest * 128;
    value = rest;
    const done = (value === 0 && next < 64) || (value === -1 && next >= 64);
    if (!done) next += 128;
    byte(out, next);
    if (done) return;
  }
}
function append(out: Sink, bytes: Uint8Array): void {
  reserve(out, bytes.length);
  out.bytes.set(bytes, out.length);
  out.length += bytes.length;
}
function text(out: Sink, value: Uint8Array): void {
  append(out, value);
  byte(out, 0);
}

function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function signed32(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= 0xffffffff;
}
function path(value: string): boolean {
  return value.length > 0 && !value.includes("\0");
}
function register(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff;
}
/** Ranges are nonempty, ordered, disjoint and inside [start, end). */
function rangesWithin(
  ranges: readonly FrameRange[],
  start: number,
  end: number,
): boolean {
  let previous = start;
  for (const range of ranges) {
    if (
      range === undefined ||
      !uint(range.offset) ||
      !uint(range.byteLength) ||
      range.byteLength === 0 ||
      range.offset < previous ||
      range.offset + range.byteLength > end
    )
      return false;
    previous = range.offset + range.byteLength;
  }
  return true;
}
function validWord(word: DebugWord): boolean {
  return (
    register(word.register) &&
    (word.kind === "register" || signed32(word.offset))
  );
}
function validLocations(
  ranges: readonly DebugLocationRange[],
  start: number,
  end: number,
): boolean {
  if (!rangesWithin(ranges, start, end)) return false;
  for (const range of ranges) {
    if (range === undefined || range.pieces.length === 0) return false;
    for (const piece of range.pieces) {
      if (piece === undefined) return false;
      const size = piece.byteSize;
      if (size === undefined) {
        if (range.pieces.length !== 1) return false;
      } else if (!uint(size) || size === 0) return false;
      const part = piece.part;
      if (part.kind === "pointer") {
        if (!validWord(part.base) || !uint(part.add)) return false;
      } else if (!validWord(part)) return false;
    }
  }
  return true;
}

function wordExpression(out: Sink, word: DebugWord, address: boolean): void {
  if (word.kind === "register") {
    if (address) {
      // The register's value is the address (a pointer held in a register).
      if (word.register < 32) byte(out, OP_BREG0 + word.register);
      else {
        byte(out, OP_BREGX);
        uleb(out, word.register);
      }
      sleb(out, 0);
      return;
    }
    if (word.register < 32) byte(out, OP_REG0 + word.register);
    else {
      byte(out, OP_REGX);
      uleb(out, word.register);
    }
    return;
  }
  if (word.register < 32) byte(out, OP_BREG0 + word.register);
  else {
    byte(out, OP_BREGX);
    uleb(out, word.register);
  }
  sleb(out, word.offset);
  // A memory word used as an address source is first loaded.
  if (address) byte(out, OP_DEREF);
}
function locationExpression(range: DebugLocationRange): Uint8Array {
  const out = sink();
  for (const piece of range.pieces) {
    if (piece === undefined) throw "DWARF piece invariant";
    const part = piece.part;
    if (part.kind === "pointer") {
      wordExpression(out, part.base, true);
      if (part.add !== 0) {
        byte(out, OP_PLUS_UCONST);
        uleb(out, part.add);
      }
      if (part.value) {
        byte(out, OP_DEREF);
        byte(out, OP_STACK_VALUE);
      }
    } else wordExpression(out, part, false);
    const size = piece.byteSize;
    if (size !== undefined) {
      byte(out, OP_PIECE);
      uleb(out, size);
    }
  }
  return finish(out);
}

interface Abbreviation {
  readonly code: number;
}
interface AbbreviationTable {
  readonly codes: Map<string, number>;
  readonly out: Sink;
  next: number;
}
/** Abbreviation codes are assigned on first use; attributes are name/form pairs. */
function abbreviation(
  table: AbbreviationTable,
  tag: number,
  children: boolean,
  attributes: readonly number[],
): Abbreviation {
  const key = String(tag) + (children ? "+" : "-") + ":" + attributes.join(",");
  const existing = table.codes.get(key);
  if (existing !== undefined) return { code: existing };
  const code = table.next++;
  table.codes.set(key, code);
  uleb(table.out, code);
  uleb(table.out, tag);
  byte(table.out, children ? 1 : 0);
  for (const value of attributes) {
    if (value === undefined) throw "DWARF abbreviation invariant";
    uleb(table.out, value);
  }
  byte(table.out, 0);
  byte(table.out, 0);
  return { code };
}

interface Encoder {
  readonly request: DebugRequest;
  readonly table: AbbreviationTable;
  readonly info: Sink;
  readonly loc: Sink;
  readonly ranges: Sink;
  readonly encode: (value: string) => Uint8Array;
  readonly fileIds: Map<string, number>;
  readonly files: Uint8Array[];
  /** CU-relative DIE offsets of request.types, then the opaque pointer. */
  readonly typeOffsets: number[];
  readonly originOffsets: number[];
  voidPointer: number;
  countType: number;
}
function fileId(encoder: Encoder, file: string): number {
  const existing = encoder.fileIds.get(file);
  if (existing !== undefined) return existing;
  encoder.files.push(encoder.encode(file));
  const id = encoder.files.length;
  encoder.fileIds.set(file, id);
  return id;
}
function typeOffset(encoder: Encoder, type: number): number {
  const offset = encoder.typeOffsets[type];
  if (offset === undefined) throw "DWARF type reference invariant";
  return offset;
}
/** A location list in .debug_loc; offsets are relative to the unit base. */
function locationList(
  encoder: Encoder,
  ranges: readonly DebugLocationRange[],
): number {
  const out = encoder.loc,
    start = out.length;
  for (const range of ranges) {
    if (range === undefined) throw "DWARF location invariant";
    const expression = locationExpression(range);
    if (expression.length > 0xffff) throw "DWARF location size invariant";
    u64(out, range.offset);
    u64(out, range.offset + range.byteLength);
    u16(out, expression.length);
    append(out, expression);
  }
  u64(out, 0);
  u64(out, 0);
  return start;
}
function writeVariable(encoder: Encoder, variable: DebugVariable): void {
  const info = encoder.info,
    table = encoder.table;
  let type = typeOffset(encoder, variable.type);
  const count = variable.count;
  if (count !== undefined) {
    // A variable-length view: an artificial count, then an array type whose
    // subrange counts with it (the form compilers use for C VLAs).
    const countOffset = info.length;
    const countAbbrev = abbreviation(table, TAG_VARIABLE, false, [
      AT_NAME,
      FORM_STRING,
      AT_TYPE,
      FORM_REF4,
      AT_ARTIFICIAL,
      FORM_FLAG_PRESENT,
      AT_LOCATION,
      FORM_SEC_OFFSET,
    ]);
    uleb(info, countAbbrev.code);
    text(info, encoder.encode("__count_" + variable.name));
    u32(info, encoder.countType);
    u32(info, locationList(encoder, count));
    const arrayOffset = info.length;
    const arrayAbbrev = abbreviation(table, TAG_ARRAY, true, [
      AT_TYPE,
      FORM_REF4,
    ]);
    uleb(info, arrayAbbrev.code);
    u32(info, type);
    const subrange = abbreviation(table, TAG_SUBRANGE, false, [
      AT_COUNT,
      FORM_REF4,
    ]);
    uleb(info, subrange.code);
    u32(info, countOffset);
    byte(info, 0);
    type = arrayOffset;
  }
  const attributes = [AT_NAME, FORM_STRING, AT_TYPE, FORM_REF4];
  const file = variable.file,
    line = variable.line;
  const declared = file !== undefined && line !== undefined;
  if (declared)
    attributes.push(AT_DECL_FILE, FORM_UDATA, AT_DECL_LINE, FORM_UDATA);
  if (variable.artificial === true)
    attributes.push(AT_ARTIFICIAL, FORM_FLAG_PRESENT);
  if (variable.locations.length > 0)
    attributes.push(AT_LOCATION, FORM_SEC_OFFSET);
  const code = abbreviation(
    table,
    variable.parameter === true ? TAG_FORMAL_PARAMETER : TAG_VARIABLE,
    false,
    attributes,
  );
  uleb(info, code.code);
  text(info, encoder.encode(variable.name));
  u32(info, type);
  if (declared) {
    uleb(info, fileId(encoder, file ?? ""));
    uleb(info, line ?? 0);
  }
  if (variable.locations.length > 0)
    u32(info, locationList(encoder, variable.locations));
}
/** One range: low/high PC; several: a .debug_ranges list. */
function writeScopeRanges(
  encoder: Encoder,
  ranges: readonly FrameRange[],
): void {
  const first = ranges[0];
  if (first === undefined) throw "DWARF scope range invariant";
  if (ranges.length === 1) {
    u64(encoder.info, encoder.request.codeAddress + first.offset);
    u32(encoder.info, first.byteLength);
    return;
  }
  u32(encoder.info, encoder.ranges.length);
  for (const range of ranges) {
    if (range === undefined) throw "DWARF scope range invariant";
    u64(encoder.ranges, range.offset);
    u64(encoder.ranges, range.offset + range.byteLength);
  }
  u64(encoder.ranges, 0);
  u64(encoder.ranges, 0);
}
function writeInline(encoder: Encoder, scope: DebugInlineScope): void {
  const children = scope.variables.length > 0 || scope.inlined.length > 0;
  const attributes = [AT_ABSTRACT_ORIGIN, FORM_REF4];
  if (scope.ranges.length === 1)
    attributes.push(AT_LOW_PC, FORM_ADDR, AT_HIGH_PC, FORM_DATA4);
  else attributes.push(AT_RANGES, FORM_SEC_OFFSET);
  attributes.push(
    AT_CALL_FILE,
    FORM_UDATA,
    AT_CALL_LINE,
    FORM_UDATA,
    AT_CALL_COLUMN,
    FORM_UDATA,
  );
  const code = abbreviation(encoder.table, TAG_INLINED, children, attributes);
  uleb(encoder.info, code.code);
  const origin = encoder.originOffsets[scope.origin];
  if (origin === undefined) throw "DWARF inline origin invariant";
  u32(encoder.info, origin);
  writeScopeRanges(encoder, scope.ranges);
  uleb(encoder.info, fileId(encoder, scope.callFile));
  uleb(encoder.info, scope.callLine);
  uleb(encoder.info, scope.callColumn);
  if (!children) return;
  for (const variable of scope.variables) {
    if (variable === undefined) throw "DWARF inline variable invariant";
    writeVariable(encoder, variable);
  }
  for (const inner of scope.inlined) {
    if (inner === undefined) throw "DWARF inline scope invariant";
    writeInline(encoder, inner);
  }
  byte(encoder.info, 0);
}
function frameBase(out: Sink, frameRegister: number): void {
  if (frameRegister < 32) {
    uleb(out, 1);
    byte(out, OP_REG0 + frameRegister);
    return;
  }
  const expression = sink();
  byte(expression, OP_REGX);
  uleb(expression, frameRegister);
  uleb(out, expression.length);
  append(out, finish(expression));
}
/** Artificial frame pointers: frame-base-relative over the frame ranges. */
function frameVariables(encoder: Encoder, frame: DebugFrame): void {
  for (const variable of frame.variables) {
    if (variable === undefined) throw "DWARF frame variable invariant";
    const out = encoder.loc,
      start = out.length,
      expression = sink();
    byte(expression, OP_FBREG);
    sleb(expression, variable.offset);
    for (const range of frame.ranges) {
      if (range === undefined) throw "DWARF frame range invariant";
      u64(out, range.offset);
      u64(out, range.offset + range.byteLength);
      u16(out, expression.length);
      append(out, finish(expression));
    }
    u64(out, 0);
    u64(out, 0);
    const code = abbreviation(encoder.table, TAG_VARIABLE, false, [
      AT_NAME,
      FORM_STRING,
      AT_TYPE,
      FORM_REF4,
      AT_ARTIFICIAL,
      FORM_FLAG_PRESENT,
      AT_LOCATION,
      FORM_SEC_OFFSET,
    ]);
    uleb(encoder.info, code.code);
    text(encoder.info, encoder.encode(variable.name));
    u32(encoder.info, encoder.voidPointer);
    u32(encoder.info, start);
  }
}
function writeType(
  encoder: Encoder,
  type: DebugType,
  references: { at: number; type: number }[],
): void {
  const info = encoder.info,
    table = encoder.table;
  if (type.kind === "base") {
    const code = abbreviation(table, TAG_BASE, false, [
      AT_NAME,
      FORM_STRING,
      AT_BYTE_SIZE,
      FORM_UDATA,
      AT_ENCODING,
      FORM_DATA1,
    ]);
    uleb(info, code.code);
    text(info, encoder.encode(type.name));
    uleb(info, type.byteSize);
    byte(
      info,
      type.encoding === "float"
        ? 0x04
        : type.encoding === "signed"
          ? 0x05
          : type.encoding === "unsigned"
            ? 0x07
            : type.encoding === "boolean"
              ? 0x02
              : 0x10,
    );
    return;
  }
  if (type.kind === "pointer") {
    const target = type.target;
    const code = abbreviation(
      table,
      TAG_POINTER,
      false,
      target === undefined
        ? [AT_BYTE_SIZE, FORM_DATA1]
        : [AT_BYTE_SIZE, FORM_DATA1, AT_TYPE, FORM_REF4],
    );
    uleb(info, code.code);
    byte(info, 8);
    if (target !== undefined) {
      references.push({ at: info.length, type: target });
      u32(info, 0);
    }
    return;
  }
  if (type.kind === "array") {
    const code = abbreviation(table, TAG_ARRAY, true, [AT_TYPE, FORM_REF4]);
    uleb(info, code.code);
    references.push({ at: info.length, type: type.element });
    u32(info, 0);
    const count = type.count;
    const subrange = abbreviation(
      table,
      TAG_SUBRANGE,
      false,
      count === undefined ? [] : [AT_COUNT, FORM_UDATA],
    );
    uleb(info, subrange.code);
    if (count !== undefined) uleb(info, count);
    byte(info, 0);
    return;
  }
  if (type.kind === "enumeration") {
    const code = abbreviation(table, TAG_ENUMERATION, true, [
      AT_NAME,
      FORM_STRING,
      AT_TYPE,
      FORM_REF4,
      AT_BYTE_SIZE,
      FORM_UDATA,
    ]);
    uleb(info, code.code);
    text(info, encoder.encode(type.name));
    references.push({ at: info.length, type: type.base });
    u32(info, 0);
    uleb(info, type.byteSize);
    const enumerator = abbreviation(table, TAG_ENUMERATOR, false, [
      AT_NAME,
      FORM_STRING,
      AT_CONST_VALUE,
      FORM_SDATA,
    ]);
    for (const value of type.values) {
      if (value === undefined) throw "DWARF enumerator invariant";
      uleb(info, enumerator.code);
      text(info, encoder.encode(value.name));
      sleb(info, value.value);
    }
    byte(info, 0);
    return;
  }
  const composite = abbreviation(
    table,
    type.kind === "structure" ? TAG_STRUCTURE : TAG_UNION,
    type.members.length > 0,
    [AT_NAME, FORM_STRING, AT_BYTE_SIZE, FORM_UDATA],
  );
  uleb(info, composite.code);
  text(info, encoder.encode(type.name));
  uleb(info, type.byteSize);
  if (type.members.length === 0) return;
  const member = abbreviation(table, TAG_MEMBER, false, [
    AT_NAME,
    FORM_STRING,
    AT_TYPE,
    FORM_REF4,
    AT_DATA_MEMBER_LOCATION,
    FORM_UDATA,
  ]);
  for (const field of type.members) {
    if (field === undefined) throw "DWARF member invariant";
    uleb(info, member.code);
    text(info, encoder.encode(field.name));
    references.push({ at: info.length, type: field.type });
    u32(info, 0);
    uleb(info, field.offset);
  }
  byte(info, 0);
}
function validType(type: DebugType, count: number): boolean {
  const index = (value: number): boolean =>
    Number.isInteger(value) && value >= 0 && value < count;
  if (type.kind === "base")
    return path(type.name) && uint(type.byteSize) && type.byteSize > 0;
  if (type.kind === "pointer")
    return type.target === undefined || index(type.target);
  if (type.kind === "array") {
    const length = type.count;
    return index(type.element) && (length === undefined || uint(length));
  }
  if (type.kind === "enumeration") {
    if (!path(type.name) || !uint(type.byteSize) || !index(type.base))
      return false;
    for (const value of type.values)
      if (
        value === undefined ||
        !path(value.name) ||
        !Number.isSafeInteger(value.value)
      )
        return false;
    return true;
  }
  if (!path(type.name) || !uint(type.byteSize)) return false;
  for (const member of type.members)
    if (
      member === undefined ||
      !path(member.name) ||
      !index(member.type) ||
      !uint(member.offset)
    )
      return false;
  return true;
}
function validVariable(
  variable: DebugVariable,
  typeCount: number,
  start: number,
  end: number,
): boolean {
  const line = variable.line,
    file = variable.file,
    count = variable.count;
  return (
    path(variable.name) &&
    Number.isInteger(variable.type) &&
    variable.type >= 0 &&
    variable.type < typeCount &&
    (file === undefined || path(file)) &&
    (line === undefined || uint(line)) &&
    validLocations(variable.locations, start, end) &&
    (count === undefined || validLocations(count, start, end))
  );
}
function validScope(
  scope: DebugInlineScope,
  origins: number,
  typeCount: number,
  parent: readonly FrameRange[],
): boolean {
  if (
    !Number.isInteger(scope.origin) ||
    scope.origin < 0 ||
    scope.origin >= origins ||
    !path(scope.callFile) ||
    !uint(scope.callLine) ||
    !uint(scope.callColumn) ||
    scope.ranges.length === 0 ||
    !rangesWithin(scope.ranges, 0, 0xffffffff)
  )
    return false;
  // Each range lies inside one range of the enclosing scope.
  for (const range of scope.ranges) {
    if (range === undefined) return false;
    let contained = false;
    for (const outer of parent)
      if (
        outer !== undefined &&
        range.offset >= outer.offset &&
        range.offset + range.byteLength <= outer.offset + outer.byteLength
      )
        contained = true;
    if (!contained) return false;
  }
  const first = scope.ranges[0],
    last = scope.ranges[scope.ranges.length - 1];
  if (first === undefined || last === undefined) return false;
  for (const variable of scope.variables)
    if (
      variable === undefined ||
      !validVariable(
        variable,
        typeCount,
        first.offset,
        last.offset + last.byteLength,
      )
    )
      return false;
  for (const inner of scope.inlined)
    if (
      inner === undefined ||
      !validScope(inner, origins, typeCount, scope.ranges)
    )
      return false;
  return true;
}
function validFrame(fn: FunctionRange, frame: DebugFrame): boolean {
  if (!register(frame.register)) return false;
  const unique: string[] = [];
  for (const variable of frame.variables) {
    if (
      variable === undefined ||
      !path(variable.name) ||
      unique.includes(variable.name) ||
      !signed32(variable.offset)
    )
      return false;
    unique.push(variable.name);
  }
  return rangesWithin(frame.ranges, fn.offset, fn.offset + fn.byteLength);
}
function writeLines(encoder: Encoder, rowFiles: readonly number[]): Uint8Array {
  const request = encoder.request,
    line = sink();
  u32(line, 0);
  u16(line, 4);
  u32(line, 0);
  const headerStart = line.length;
  for (const value of [
    1, 1, 1, 251, 14, 13, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0,
  ]) {
    if (value === undefined) throw "DWARF line header invariant";
    byte(line, value);
  }
  for (const file of encoder.files) {
    if (file === undefined) throw "DWARF file invariant";
    text(line, file);
    byte(line, 0);
    byte(line, 0);
    byte(line, 0);
  }
  byte(line, 0);
  put(line.bytes, 6, 4, line.length - headerStart);
  for (let i = 0; i < request.lines.length; i++) {
    const row = request.lines[i],
      file = rowFiles[i];
    if (row === undefined || file === undefined) throw "DWARF line invariant";
    byte(line, 0);
    byte(line, 9);
    byte(line, 2);
    u64(line, request.codeAddress + row.offset);
    byte(line, 4);
    uleb(line, file);
    byte(line, 3);
    sleb(line, row.line - 1);
    byte(line, 5);
    uleb(line, row.column);
    byte(line, 1);
    byte(line, 2);
    uleb(line, row.byteLength);
    byte(line, 0);
    byte(line, 1);
    byte(line, 1);
  }
  put(line.bytes, 0, 4, line.length - 4);
  return finish(line);
}
/** DWARF32 v4 units for a little-endian target with eight-byte addresses.
 * Source ranges are disjoint and ordered; holes never inherit a previous line.
 * Variables use .debug_loc lists, so a value is described only where valid;
 * inlined code is described with abstract origins and call positions. */
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
  const types = request.types ?? [],
    origins = request.origins ?? [];
  for (const type of types)
    if (type === undefined || !validType(type, types.length))
      return { ok: false, error: "INVALID_INPUT" };
  for (const origin of origins)
    if (origin === undefined || !path(origin))
      return { ok: false, error: "INVALID_INPUT" };
  if (!rangesWithin(request.lines, 0, request.codeLength))
    return { ok: false, error: "INVALID_INPUT" };
  for (const row of request.lines)
    if (
      row === undefined ||
      !path(row.file) ||
      !uint(row.line) ||
      row.line === 0 ||
      !uint(row.column) ||
      row.column === 0
    )
      return { ok: false, error: "INVALID_INPUT" };
  // Frames, variables and inline scopes share the internal opaque pointer and
  // element-count types.
  let internal = false;
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
    const frame = fn.frame,
      end = fn.offset + fn.byteLength;
    if (frame !== undefined) {
      if (!validFrame(fn, frame)) return { ok: false, error: "INVALID_INPUT" };
      internal = true;
    }
    for (const variable of fn.variables ?? [])
      if (
        variable === undefined ||
        !validVariable(variable, types.length, fn.offset, end)
      )
        return { ok: false, error: "INVALID_INPUT" };
    const whole: FrameRange[] = [
      { offset: fn.offset, byteLength: fn.byteLength },
    ];
    for (const scope of fn.inlined ?? [])
      if (
        scope === undefined ||
        !validScope(scope, origins.length, types.length, whole)
      )
        return { ok: false, error: "INVALID_INPUT" };
    if ((fn.variables ?? []).length > 0 || (fn.inlined ?? []).length > 0)
      internal = true;
  }
  const utf8 = new TextEncoder();
  const encoder: Encoder = {
    request,
    table: { codes: new Map<string, number>(), out: sink(), next: 1 },
    info: sink(),
    loc: sink(),
    ranges: sink(),
    encode: (value) => utf8.encode(value),
    fileIds: new Map<string, number>(),
    files: [],
    typeOffsets: [],
    originOffsets: [],
    voidPointer: 0,
    countType: 0,
  };
  // Line-row files come first so their indices match the line program.
  const rowFiles: number[] = [];
  for (const row of request.lines) {
    if (row === undefined) throw "DWARF line invariant";
    rowFiles.push(fileId(encoder, row.file));
  }
  const info = encoder.info,
    unitName = encoder.files[0] ?? encoder.encode("tint");
  u32(info, 0);
  u16(info, 4);
  u32(info, 0);
  byte(info, 8);
  const unit = abbreviation(encoder.table, TAG_COMPILE_UNIT, true, [
    AT_NAME,
    FORM_STRING,
    AT_LANGUAGE,
    FORM_DATA1,
    AT_COMP_DIR,
    FORM_STRING,
    AT_STMT_LIST,
    FORM_SEC_OFFSET,
    AT_LOW_PC,
    FORM_ADDR,
    AT_HIGH_PC,
    FORM_DATA4,
  ]);
  uleb(info, unit.code);
  text(info, unitName);
  byte(info, LANGUAGE_C99);
  text(info, encoder.encode(request.directory));
  u32(info, 0);
  u64(info, request.codeAddress);
  u32(info, request.codeLength);
  const references: { at: number; type: number }[] = [];
  for (const type of types) {
    if (type === undefined) throw "DWARF type invariant";
    encoder.typeOffsets.push(info.length);
    writeType(encoder, type, references);
  }
  for (const reference of references) {
    if (reference === undefined) throw "DWARF type reference invariant";
    put(info.bytes, reference.at, 4, typeOffset(encoder, reference.type));
  }
  if (internal) {
    encoder.voidPointer = info.length;
    const pointer = abbreviation(encoder.table, TAG_POINTER, false, [
      AT_BYTE_SIZE,
      FORM_DATA1,
    ]);
    uleb(info, pointer.code);
    byte(info, 8);
    encoder.countType = info.length;
    const count = abbreviation(encoder.table, TAG_BASE, false, [
      AT_NAME,
      FORM_STRING,
      AT_BYTE_SIZE,
      FORM_UDATA,
      AT_ENCODING,
      FORM_DATA1,
    ]);
    uleb(info, count.code);
    text(info, encoder.encode("__tint_count"));
    uleb(info, 8);
    byte(info, 0x07);
  }
  for (const origin of origins) {
    if (origin === undefined) throw "DWARF origin invariant";
    encoder.originOffsets.push(info.length);
    const code = abbreviation(encoder.table, TAG_SUBPROGRAM, false, [
      AT_NAME,
      FORM_STRING,
      AT_INLINE,
      FORM_DATA1,
    ]);
    uleb(info, code.code);
    text(info, encoder.encode(origin));
    byte(info, INLINE_INLINED);
  }
  for (const fn of request.functions) {
    if (fn === undefined) throw "DWARF function invariant";
    const frame = fn.frame,
      variables = fn.variables ?? [],
      inlined = fn.inlined ?? [];
    const children =
      (frame !== undefined && frame.variables.length > 0) ||
      variables.length > 0 ||
      inlined.length > 0;
    const attributes = [
      AT_NAME,
      FORM_STRING,
      AT_LOW_PC,
      FORM_ADDR,
      AT_HIGH_PC,
      FORM_DATA4,
    ];
    if (frame !== undefined) attributes.push(AT_FRAME_BASE, FORM_EXPRLOC);
    const code = abbreviation(
      encoder.table,
      TAG_SUBPROGRAM,
      children,
      attributes,
    );
    uleb(info, code.code);
    text(info, encoder.encode(fn.name));
    u64(info, request.codeAddress + fn.offset);
    u32(info, fn.byteLength);
    if (frame !== undefined) frameBase(info, frame.register);
    if (!children) continue;
    if (frame !== undefined) frameVariables(encoder, frame);
    for (const variable of variables) {
      if (variable === undefined) throw "DWARF variable invariant";
      writeVariable(encoder, variable);
    }
    for (const scope of inlined) {
      if (scope === undefined) throw "DWARF inline scope invariant";
      writeInline(encoder, scope);
    }
    byte(info, 0);
  }
  byte(info, 0);
  put(info.bytes, 0, 4, info.length - 4);
  byte(encoder.table.out, 0);
  const line = writeLines(encoder, rowFiles);
  const total =
    encoder.table.out.length +
    info.length +
    line.length +
    encoder.loc.length +
    encoder.ranges.length;
  if (!uint(info.length) || !uint(line.length) || total > request.maxByteLength)
    return { ok: false, error: "SIZE_LIMIT" };
  return {
    ok: true,
    value: {
      abbrev: finish(encoder.table.out),
      info: finish(info),
      line,
      loc: finish(encoder.loc),
      ranges: finish(encoder.ranges),
    },
  };
}
