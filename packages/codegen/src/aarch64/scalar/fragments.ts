import type { UnwindRule, UnwindSave, UnwindRow } from "@tint/abi/unwind";
import type { FunctionIR } from "@tint/ir/scalar";
import {
  createByteReader,
  createByteWriter,
  readByte,
  readSigned,
  readString,
  readUnsigned,
  writeByte,
  writeSigned,
  writeString,
  writeUnsigned,
  writtenBytes,
  type ByteReader,
  type ByteWriter,
} from "@tint/ir/storage";
import {
  appendWord,
  createWordBuffer,
  type WordBuffer,
} from "@tint/foundation/binary/word-buffer";
import type {
  EmissionRange,
  LeafHelperKind,
  NativeFrameRoots,
  NativeFunction,
  NativeImportReference,
  NativeOperationRange,
  NativeSourceRange,
  NativeStartupCall,
  SafepointEntry,
} from "./index.ts";
import type { SignatureLayout } from "./abi.ts";
import type { Branch, Condition, DataRegister } from "../isa.ts";
import type { CellAccess } from "../cell.ts";

export interface FamilySite {
  readonly key: string;
  readonly word: number;
}

/** A range owns its words and relocations until canonical placement. All
 * code offsets are relative to the start of the fragment. */
export interface Fragment {
  readonly range: EmissionRange;
  readonly instructions: WordBuffer;
  readonly functions: readonly NativeFunction[];
  readonly blockOffsets: readonly {
    readonly offsets: readonly (number | undefined)[];
  }[];
  readonly fixups: readonly Fixup[];
  readonly resolvedFixups: ReadonlySet<number>;
  readonly helperFixups: readonly {
    readonly offset: number;
    readonly kind: LeafHelperKind;
  }[];
  readonly recordFixups: readonly {
    readonly offset: number;
    readonly record: number;
  }[];
  readonly functionAddresses: readonly {
    readonly offset: number;
    readonly target: number;
    readonly rd: number;
  }[];
  readonly signatureFixups: readonly {
    readonly offset: number;
    readonly target: number;
    readonly rd: number;
  }[];
  readonly cellFixups: readonly {
    readonly offset: number;
    readonly key: string;
  }[];
  readonly stringFixups: readonly {
    readonly offset: number;
    readonly value: string;
  }[];
  readonly dispatchFixups: readonly {
    readonly offset: number;
    readonly key: string;
  }[];
  readonly sourceRanges: readonly NativeSourceRange[];
  readonly operationRanges: readonly NativeOperationRange[];
  readonly startupCalls: readonly NativeStartupCall[];
  readonly imports: readonly NativeImportReference[];
  readonly safepoints: readonly SafepointEntry[];
  readonly cellRequests: ReadonlyMap<string, CellAccess>;
  readonly dispatchSets: ReadonlyMap<
    string,
    { readonly first: number; readonly records: readonly number[] }
  >;
  readonly dispatchFamilies: ReadonlyMap<string, number>;
  readonly familySites: readonly FamilySite[];
  readonly compactSites: ReadonlyMap<number, number>;
  readonly pageSites: ReadonlySet<number>;
  readonly compactOverflow: boolean;
  readonly usesUnitStrings: boolean;
}
export interface Fixup {
  readonly offset: number;
  readonly branch: Branch;
  readonly function: number;
  readonly block: number | undefined;
  /** A register-indirect far branch: an x16 address sequence then BR. */
  readonly far?: true | undefined;
}

const packetVersion: number = 2;
const conditions: readonly Condition[] = [
  "eq",
  "ne",
  "cs",
  "cc",
  "mi",
  "pl",
  "vs",
  "vc",
  "hi",
  "ls",
  "ge",
  "lt",
  "gt",
  "le",
  "al",
  "nv",
];
const helpers: readonly LeafHelperKind[] = [
  "allocate-call",
  "allocate-finish",
  "array-initialize",
  "array-copy",
  "array-fill",
  "memory-move",
  "remember-object",
  "stack-overflow",
  "remainder",
  "to-uint32",
  "string-starts-with",
  "string-equal",
  "string-code-unit",
  "string-concat-copy",
  "string-write-copy",
  "string-slice-bounds",
  "string-slice-kind",
  "string-slice-copy",
  "string-slice-narrow",
  "string-index-of",
  "string-last-index-of",
  "string-ascii-prefix",
  "bytes-ascii-prefix",
  "string-copy-latin1",
  "bytes-copy",
  "string-ascii-upper",
  "string-ascii-lower",
  "string-utf8-length",
  "string-write-utf8",
  "bytes-utf8-measure",
  "bytes-utf8-decode",
  "shared-read-unsigned",
  "shared-write-unsigned",
  "shared-read-word64",
  "shared-write-word64",
  "shared-compare-exchange-unsigned",
  "shared-compare-exchange-word64",
];

function length(reader: ByteReader): number {
  const count = readUnsigned(reader);
  if (count > reader.end - reader.offset) throw "truncated fragment rows";
  return count;
}

function writeRows<T>(
  sink: ByteWriter,
  values: readonly T[],
  write: (sink: ByteWriter, value: T) => void,
): void {
  writeUnsigned(sink, values.length);
  for (const value of values) {
    if (value === undefined) throw "fragment row invariant";
    write(sink, value);
  }
}

function readRows<T>(reader: ByteReader, read: (reader: ByteReader) => T): T[] {
  const rows: T[] = [];
  const count = length(reader);
  for (let i = 0; i < count; i++) rows.push(read(reader));
  return rows;
}

function writeCondition(sink: ByteWriter, condition: Condition): void {
  const index = conditions.indexOf(condition);
  if (index < 0) throw "unknown fragment branch condition";
  writeUnsigned(sink, index);
}

function readCondition(reader: ByteReader): Condition {
  const condition = conditions[readUnsigned(reader)];
  if (condition === undefined) throw "invalid fragment branch condition";
  return condition;
}

function writeFlag(sink: ByteWriter, value: boolean): void {
  writeByte(sink, value ? 1 : 0);
}

function readFlag(reader: ByteReader): boolean {
  const tag = readByte(reader);
  if (tag > 1) throw "invalid fragment flag";
  return tag === 1;
}

function writeOptionalOffset(
  sink: ByteWriter,
  offset: number | undefined,
): void {
  writeUnsigned(sink, offset === undefined ? 0 : offset + 1);
}

function readOptionalOffset(reader: ByteReader): number | undefined {
  const offset = readUnsigned(reader);
  return offset === 0 ? undefined : offset - 1;
}

function writeFixup(sink: ByteWriter, site: Fixup): void {
  const branch = site.branch;
  switch (branch.op) {
    case "b":
      writeByte(sink, 0);
      break;
    case "bl":
      writeByte(sink, 1);
      break;
    case "b.cond":
      writeByte(sink, 2);
      writeCondition(sink, branch.condition);
      break;
    case "cbz":
    case "cbnz":
      writeByte(sink, branch.op === "cbz" ? 3 : 4);
      writeFlag(sink, branch.width === 64);
      const register = branch.rt;
      writeUnsigned(sink, typeof register === "number" ? register : 32);
      break;
  }
  writeUnsigned(sink, site.offset);
  writeUnsigned(sink, site.function);
  writeFlag(sink, site.block !== undefined);
  const block = site.block;
  if (block !== undefined) writeSigned(sink, block);
  writeFlag(sink, site.far === true);
}

function readBranch(reader: ByteReader): Branch {
  const kind = readByte(reader);
  if (kind === 0) return { op: "b" };
  if (kind === 1) return { op: "bl" };
  if (kind === 2) return { op: "b.cond", condition: readCondition(reader) };
  if (kind !== 3 && kind !== 4) throw "invalid fragment branch kind";
  const width: 32 | 64 = readFlag(reader) ? 64 : 32;
  const register = readUnsigned(reader);
  if (register > 32) throw "invalid fragment branch register";
  const rt: DataRegister = register === 32 ? "zr" : register;
  if (kind === 3) return { op: "cbz", width, rt };
  return { op: "cbnz", width, rt };
}

function readFixup(reader: ByteReader): Fixup {
  const branch = readBranch(reader);
  const offset = readUnsigned(reader);
  const owner = readUnsigned(reader);
  const block = readFlag(reader) ? readSigned(reader) : undefined;
  const far: true | undefined = readFlag(reader) ? true : undefined;
  return { branch, offset, function: owner, block, far };
}

function writeSave(sink: ByteWriter, save: UnwindSave): void {
  writeUnsigned(sink, save.register);
  writeSigned(sink, save.offset);
}
function readSave(reader: ByteReader): UnwindSave {
  return { register: readUnsigned(reader), offset: readSigned(reader) };
}
function writeRow(sink: ByteWriter, row: UnwindRow): void {
  writeUnsigned(sink, row.offset);
  writeUnsigned(sink, row.cfaRegister);
  writeSigned(sink, row.cfaOffset);
  writeRows<UnwindSave>(sink, row.saves, writeSave);
}
function readRow(reader: ByteReader): UnwindRow {
  return {
    offset: readUnsigned(reader),
    cfaRegister: readUnsigned(reader),
    cfaOffset: readSigned(reader),
    saves: readRows<UnwindSave>(reader, readSave),
  };
}
function writeUnwind(sink: ByteWriter, rule: UnwindRule | undefined): void {
  if (rule === undefined) {
    writeByte(sink, 0);
    return;
  }
  switch (rule.kind) {
    case "leaf":
      writeByte(sink, 1);
      break;
    case "outermost":
      writeByte(sink, 2);
      break;
    case "frame":
      writeByte(sink, 3);
      writeRows<UnwindSave>(sink, rule.saves, writeSave);
      break;
    case "rows":
      writeByte(sink, 4);
      writeRows<UnwindRow>(sink, rule.rows, writeRow);
      break;
  }
}
function readUnwind(reader: ByteReader): UnwindRule | undefined {
  switch (readByte(reader)) {
    case 0:
      return undefined;
    case 1:
      return { kind: "leaf" };
    case 2:
      return { kind: "outermost" };
    case 3:
      return { kind: "frame", saves: readRows<UnwindSave>(reader, readSave) };
    case 4:
      return { kind: "rows", rows: readRows<UnwindRow>(reader, readRow) };
    default:
      throw "invalid fragment unwind rule";
  }
}
function writeFrameRoots(
  sink: ByteWriter,
  roots: NativeFrameRoots | undefined,
): void {
  writeFlag(sink, roots !== undefined);
  if (roots === undefined) return;
  writeRows<number>(sink, roots.references, writeUnsigned);
  writeRows<number>(sink, roots.generals, writeUnsigned);
}
function readFrameRoots(reader: ByteReader): NativeFrameRoots | undefined {
  if (!readFlag(reader)) return undefined;
  return {
    references: readRows<number>(reader, readUnsigned),
    generals: readRows<number>(reader, readUnsigned),
  };
}
function readFunction(
  reader: ByteReader,
  fn: FunctionIR,
  signature: SignatureLayout,
): NativeFunction {
  if (fn.import === true)
    return {
      id: fn.id,
      name: fn.name,
      exported: false,
      import: true,
      offset: 0,
      byteLength: 0,
      frameBytes: 0,
      signature,
    };
  return {
    id: fn.id,
    name: fn.name,
    exported: fn.exported,
    offset: readUnsigned(reader),
    byteLength: readUnsigned(reader),
    frameBytes: readUnsigned(reader),
    signature,
    unwind: readUnwind(reader),
    frameRoots: readFrameRoots(reader),
    debugFrame: undefined,
  };
}

function writeWords(sink: ByteWriter, words: WordBuffer): void {
  writeUnsigned(sink, words.length);
  let remaining = words.length;
  for (const page of words.pages) {
    if (page === undefined) throw "fragment instruction page invariant";
    const inPage = Math.min(page.length, remaining);
    for (let i = 0; i < inPage; i++) {
      const word = page[i];
      if (word === undefined) throw "fragment instruction invariant";
      writeByte(sink, word & 255);
      writeByte(sink, (word >>> 8) & 255);
      writeByte(sink, (word >>> 16) & 255);
      writeByte(sink, word >>> 24);
    }
    remaining -= inPage;
  }
  if (remaining !== 0) throw "invalid fragment instruction extent";
}
function readWords(reader: ByteReader): WordBuffer {
  const count = length(reader);
  if (count * 4 > reader.end - reader.offset) throw "truncated fragment code";
  const words = createWordBuffer();
  for (let i = 0; i < count; i++) {
    const word =
      readByte(reader) |
      (readByte(reader) << 8) |
      (readByte(reader) << 16) |
      (readByte(reader) << 24);
    appendWord(words, word >>> 0);
  }
  return words;
}

function writeImport(sink: ByteWriter, site: NativeImportReference): void {
  writeUnsigned(sink, site.offset);
  writeUnsigned(sink, site.rd);
  writeUnsigned(sink, site.scratch);
  writeString(sink, site.target.name);
  writeFlag(sink, site.far === true);
}
function readImport(reader: ByteReader): NativeImportReference {
  const offset = readUnsigned(reader);
  const rd = readUnsigned(reader);
  const scratch = readUnsigned(reader);
  const name = readString(reader);
  const far: true | undefined = readFlag(reader) ? true : undefined;
  return {
    offset,
    rd,
    scratch,
    target: { kind: "import", name },
    far,
  };
}
function writeStartup(sink: ByteWriter, site: NativeStartupCall): void {
  writeUnsigned(sink, site.offset);
  writeByte(
    sink,
    site.target === "trace-capture"
      ? 0
      : site.target === "jit-descriptor"
        ? 1
        : 2,
  );
  writeFlag(sink, site.far === true);
}
function readStartup(reader: ByteReader): NativeStartupCall {
  const offset = readUnsigned(reader);
  const kind = readByte(reader);
  if (kind > 2) throw "invalid fragment startup target";
  const target: "trace-capture" | "jit-descriptor" | "jit-register" =
    kind === 0
      ? "trace-capture"
      : kind === 1
        ? "jit-descriptor"
        : "jit-register";
  const site: NativeStartupCall = { offset, target };
  return readFlag(reader) ? { ...site, far: true } : site;
}
function writeHelper(sink: ByteWriter, site: HelperSite): void {
  writeUnsigned(sink, site.offset);
  const index = helpers.indexOf(site.kind);
  if (index < 0) throw "unknown fragment helper";
  writeUnsigned(sink, index);
}
function readHelper(reader: ByteReader): HelperSite {
  const offset = readUnsigned(reader);
  const kind = helpers[readUnsigned(reader)];
  if (kind === undefined) throw "invalid fragment helper";
  return { offset, kind };
}

function writeCell(sink: ByteWriter, cell: CellAccess): void {
  writeByte(
    sink,
    cell.operation === "initialize" ? 0 : cell.operation === "read" ? 1 : 2,
  );
  writeUnsigned(sink, cell.stateOffset);
  writeUnsigned(sink, cell.valueOffset);
  writeUnsigned(sink, cell.byteLength);
  writeFlag(sink, cell.mutable);
}
function readCell(reader: ByteReader): CellAccess {
  const kind = readByte(reader);
  if (kind > 2) throw "invalid fragment cell operation";
  const operation: "initialize" | "read" | "write" =
    kind === 0 ? "initialize" : kind === 1 ? "read" : "write";
  return {
    operation,
    stateOffset: readUnsigned(reader),
    valueOffset: readUnsigned(reader),
    byteLength: readUnsigned(reader),
    mutable: readFlag(reader),
  };
}

interface HelperSite {
  readonly offset: number;
  readonly kind: LeafHelperKind;
}
interface LabelRow {
  readonly offsets: readonly (number | undefined)[];
}
function writeLabels(sink: ByteWriter, row: LabelRow): void {
  writeUnsigned(sink, row.offsets.length);
  for (let i = 0; i < row.offsets.length; i++)
    writeOptionalOffset(sink, row.offsets[i]);
}
function readLabels(reader: ByteReader): LabelRow {
  const count = length(reader);
  const offsets: (number | undefined)[] = [];
  for (let i = 0; i < count; i++) offsets.push(readOptionalOffset(reader));
  return { offsets };
}
interface RecordSite {
  readonly offset: number;
  readonly record: number;
}
function writeRecordSite(sink: ByteWriter, value: RecordSite): void {
  writeUnsigned(sink, value.offset);
  writeUnsigned(sink, value.record);
}
function readRecordSite(reader: ByteReader): RecordSite {
  return {
    offset: readUnsigned(reader),
    record: readUnsigned(reader),
  };
}
interface TargetSite {
  readonly offset: number;
  readonly target: number;
  readonly rd: number;
}
function writeTargetSite(sink: ByteWriter, value: TargetSite): void {
  writeUnsigned(sink, value.offset);
  writeUnsigned(sink, value.target);
  writeUnsigned(sink, value.rd);
}
function readTargetSite(reader: ByteReader): TargetSite {
  return {
    offset: readUnsigned(reader),
    target: readUnsigned(reader),
    rd: readUnsigned(reader),
  };
}
interface KeySite {
  readonly offset: number;
  readonly key: string;
}
function writeKeySite(sink: ByteWriter, value: KeySite): void {
  writeUnsigned(sink, value.offset);
  writeString(sink, value.key);
}
function readKeySite(reader: ByteReader): KeySite {
  return {
    offset: readUnsigned(reader),
    key: readString(reader),
  };
}
interface StringSite {
  readonly offset: number;
  readonly value: string;
}
function writeStringSite(sink: ByteWriter, value: StringSite): void {
  writeUnsigned(sink, value.offset);
  writeString(sink, value.value);
}
function readStringSite(reader: ByteReader): StringSite {
  return {
    offset: readUnsigned(reader),
    value: readString(reader),
  };
}
function writeNativeSourceRange(
  sink: ByteWriter,
  value: NativeSourceRange,
): void {
  writeUnsigned(sink, value.offset);
  writeUnsigned(sink, value.byteLength);
  writeUnsigned(sink, value.function);
  writeUnsigned(sink, value.start);
  writeUnsigned(sink, value.end);
}
function readNativeSourceRange(reader: ByteReader): NativeSourceRange {
  return {
    offset: readUnsigned(reader),
    byteLength: readUnsigned(reader),
    function: readUnsigned(reader),
    start: readUnsigned(reader),
    end: readUnsigned(reader),
  };
}
function writeNativeOperationRange(
  sink: ByteWriter,
  value: NativeOperationRange,
): void {
  writeUnsigned(sink, value.offset);
  writeUnsigned(sink, value.byteLength);
  writeUnsigned(sink, value.function);
  writeUnsigned(sink, value.block);
  writeSigned(sink, value.index);
  writeString(sink, value.operation);
  writeString(sink, value.operands);
}
function readNativeOperationRange(reader: ByteReader): NativeOperationRange {
  return {
    offset: readUnsigned(reader),
    byteLength: readUnsigned(reader),
    function: readUnsigned(reader),
    block: readUnsigned(reader),
    index: readSigned(reader),
    operation: readString(reader),
    operands: readString(reader),
  };
}
function writeSafepointEntry(sink: ByteWriter, value: SafepointEntry): void {
  writeUnsigned(sink, value.offset);
  writeUnsigned(sink, value.start);
  writeRows<number>(sink, value.map, writeUnsigned);
}
function readSafepointEntry(reader: ByteReader): SafepointEntry {
  return {
    offset: readUnsigned(reader),
    start: readUnsigned(reader),
    map: readRows<number>(reader, readUnsigned),
  };
}
function writeFamilySite(sink: ByteWriter, value: FamilySite): void {
  writeUnsigned(sink, value.word);
  writeString(sink, value.key);
}
function readFamilySite(reader: ByteReader): FamilySite {
  return {
    word: readUnsigned(reader),
    key: readString(reader),
  };
}

/** The fragment's function names and physical signatures come from the
 * prepared module. Everything else belongs to the range that emitted it. */
export function encodeFragment(fragment: Fragment): Uint8Array {
  const sink = createByteWriter(fragment.instructions.length * 4 + 4096);
  writeByte(sink, packetVersion);
  writeUnsigned(sink, fragment.range.first);
  writeUnsigned(sink, fragment.range.end);
  writeFlag(sink, fragment.compactOverflow);
  writeFlag(sink, fragment.usesUnitStrings);
  writeWords(sink, fragment.instructions);
  for (const fn of fragment.functions) {
    if (fn === undefined) throw "fragment function invariant";
    if (fn.import === true) continue;
    writeUnsigned(sink, fn.offset);
    writeUnsigned(sink, fn.byteLength);
    writeUnsigned(sink, fn.frameBytes);
    writeUnwind(sink, fn.unwind);
    writeFrameRoots(sink, fn.frameRoots);
  }
  writeRows<LabelRow>(sink, fragment.blockOffsets, writeLabels);
  writeRows<Fixup>(sink, fragment.fixups, writeFixup);
  writeUnsigned(sink, fragment.resolvedFixups.size);
  for (const index of fragment.resolvedFixups) writeUnsigned(sink, index);
  writeRows<HelperSite>(sink, fragment.helperFixups, writeHelper);
  writeRows<RecordSite>(sink, fragment.recordFixups, writeRecordSite);
  writeRows<TargetSite>(sink, fragment.functionAddresses, writeTargetSite);
  writeRows<TargetSite>(sink, fragment.signatureFixups, writeTargetSite);
  writeRows<KeySite>(sink, fragment.cellFixups, writeKeySite);
  writeRows<StringSite>(sink, fragment.stringFixups, writeStringSite);
  writeRows<KeySite>(sink, fragment.dispatchFixups, writeKeySite);
  writeRows<NativeSourceRange>(
    sink,
    fragment.sourceRanges,
    writeNativeSourceRange,
  );
  writeRows<NativeOperationRange>(
    sink,
    fragment.operationRanges,
    writeNativeOperationRange,
  );
  writeRows<NativeStartupCall>(sink, fragment.startupCalls, writeStartup);
  writeRows<NativeImportReference>(sink, fragment.imports, writeImport);
  writeRows<SafepointEntry>(sink, fragment.safepoints, writeSafepointEntry);
  writeUnsigned(sink, fragment.cellRequests.size);
  for (const [key, cell] of fragment.cellRequests) {
    writeString(sink, key);
    writeCell(sink, cell);
  }
  writeUnsigned(sink, fragment.dispatchSets.size);
  for (const [key, set] of fragment.dispatchSets) {
    writeString(sink, key);
    writeUnsigned(sink, set.first);
    writeRows<number>(sink, set.records, writeUnsigned);
  }
  writeUnsigned(sink, fragment.dispatchFamilies.size);
  for (const [key, ordinal] of fragment.dispatchFamilies) {
    writeString(sink, key);
    writeUnsigned(sink, ordinal);
  }
  writeRows<FamilySite>(sink, fragment.familySites, writeFamilySite);
  writeUnsigned(sink, fragment.compactSites.size);
  for (const [offset, owner] of fragment.compactSites) {
    writeUnsigned(sink, offset);
    writeUnsigned(sink, owner);
  }
  writeUnsigned(sink, fragment.pageSites.size);
  for (const offset of fragment.pageSites) writeUnsigned(sink, offset);
  return writtenBytes(sink);
}

export function decodeFragment(
  bytes: Uint8Array,
  headers: readonly FunctionIR[],
  signatures: readonly SignatureLayout[],
): Fragment {
  const reader = createByteReader(bytes);
  if (readByte(reader) !== packetVersion) throw "invalid fragment version";
  const first = readUnsigned(reader);
  const end = readUnsigned(reader);
  if (first >= end || end > headers.length) throw "invalid fragment range";
  const range: EmissionRange = { first, end };
  const compactOverflow = readFlag(reader);
  const usesUnitStrings = readFlag(reader);
  const instructions = readWords(reader);
  const functions: NativeFunction[] = [];
  for (let id = first; id < end; id++) {
    const fn = headers[id];
    const signature = signatures[id];
    if (fn === undefined || signature === undefined)
      throw "invalid fragment header";
    functions.push(readFunction(reader, fn, signature));
  }
  const blockOffsets = readRows<LabelRow>(reader, readLabels);
  if (blockOffsets.length !== functions.length)
    throw "invalid fragment label count";
  const fixups = readRows<Fixup>(reader, readFixup);
  const resolvedFixups = new Set<number>();
  const resolvedCount = length(reader);
  for (let i = 0; i < resolvedCount; i++) {
    const index = readUnsigned(reader);
    if (index >= fixups.length) throw "invalid resolved fragment fixup";
    resolvedFixups.add(index);
  }
  const helperFixups = readRows<HelperSite>(reader, readHelper);
  const recordFixups = readRows<RecordSite>(reader, readRecordSite);
  const functionAddresses = readRows<TargetSite>(reader, readTargetSite);
  const signatureFixups = readRows<TargetSite>(reader, readTargetSite);
  const cellFixups = readRows<KeySite>(reader, readKeySite);
  const stringFixups = readRows<StringSite>(reader, readStringSite);
  const dispatchFixups = readRows<KeySite>(reader, readKeySite);
  const sourceRanges = readRows<NativeSourceRange>(
    reader,
    readNativeSourceRange,
  );
  const operationRanges = readRows<NativeOperationRange>(
    reader,
    readNativeOperationRange,
  );
  const startupCalls = readRows<NativeStartupCall>(reader, readStartup);
  const imports = readRows<NativeImportReference>(reader, readImport);
  const safepoints = readRows<SafepointEntry>(reader, readSafepointEntry);
  const cellRequests = new Map<string, CellAccess>();
  const cellCount = length(reader);
  for (let i = 0; i < cellCount; i++) {
    const key = readString(reader);
    cellRequests.set(key, readCell(reader));
  }
  const dispatchSets = new Map<
    string,
    { readonly first: number; readonly records: readonly number[] }
  >();
  const dispatchSetCount = length(reader);
  for (let i = 0; i < dispatchSetCount; i++) {
    const key = readString(reader);
    dispatchSets.set(key, {
      first: readUnsigned(reader),
      records: readRows<number>(reader, readUnsigned),
    });
  }
  const dispatchFamilies = new Map<string, number>();
  const familyCount = length(reader);
  for (let i = 0; i < familyCount; i++) {
    const key = readString(reader);
    dispatchFamilies.set(key, readUnsigned(reader));
  }
  const familySites = readRows<FamilySite>(reader, readFamilySite);
  const compactSites = new Map<number, number>();
  const compactCount = length(reader);
  for (let i = 0; i < compactCount; i++) {
    const offset = readUnsigned(reader);
    compactSites.set(offset, readUnsigned(reader));
  }
  const pageSites = new Set<number>();
  const pageCount = length(reader);
  for (let i = 0; i < pageCount; i++) pageSites.add(readUnsigned(reader));
  if (reader.offset !== reader.end) throw "trailing fragment data";
  return {
    range,
    instructions,
    functions,
    blockOffsets,
    fixups,
    resolvedFixups,
    helperFixups,
    recordFixups,
    functionAddresses,
    signatureFixups,
    cellFixups,
    stringFixups,
    dispatchFixups,
    sourceRanges,
    operationRanges,
    startupCalls,
    imports,
    safepoints,
    cellRequests,
    dispatchSets,
    dispatchFamilies,
    familySites,
    compactSites,
    pageSites,
    compactOverflow,
    usesUnitStrings,
  };
}
