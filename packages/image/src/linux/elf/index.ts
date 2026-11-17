import {
  buildDebugInfo,
  type DebugGlobal,
  type DebugType,
  type FunctionRange,
  type LineRange,
} from "../../dwarf.ts";
import {
  buildEhFrame,
  type CallFrameTarget,
  type FrameDescription,
} from "../../eh-frame.ts";
import { link, type Fragment, type Placement } from "../../layout.ts";
import type {
  ImageAddressPatcher,
  ImageAddressReference,
} from "@tint/abi/relocation";
import type { UnwindRange } from "@tint/abi/unwind";
import { writeUnsigned, writeWord64 } from "@tint/foundation/binary/bytes";
import { sha256 } from "@tint/foundation/binary/sha256";
import {
  buildEhFrameHeader,
  ehFrameHeaderSize,
  type FrameIndexEntry,
} from "./eh-frame-header.ts";
import { sysvHashTable } from "./sysv-hash.ts";

export interface ElfCodeSymbol {
  readonly name: string;
  /** Byte offset in the supplied code (or data), before image placement. */
  readonly offset: number;
}
/** A read-only section carved from the tail of the supplied code, after the
 * instructions. Sections are contiguous, in order, and end with the code. */
export interface ElfTextSection {
  /** `cstring`: NUL-terminated literals (`.rodata.str1.1`); `rodata`:
   * other constants (`.rodata`). */
  readonly kind: "cstring" | "rodata";
  readonly offset: number;
  readonly byteLength: number;
}
export interface ElfDebugRequest {
  readonly directory: string;
  readonly functions: readonly FunctionRange[];
  readonly lines: readonly LineRange[];
  readonly types?: readonly DebugType[] | undefined;
  readonly origins?: readonly string[] | undefined;
  readonly globals?: readonly DebugGlobal[] | undefined;
}
/** Linux/glibc-specific image options; everything else in the request is
 * format-neutral. */
export interface LinuxImageOptions {
  /** PT_INTERP path; defaults to glibc's `/lib/ld-linux-aarch64.so.1`. */
  readonly interpreter?: string | undefined;
  /** DT_NEEDED sonames loaded after `libc.so.6`, in order. Every import is
   * resolved through the global lookup scope (ELF has no two-level
   * namespace), so libraries need not list their symbols. */
  readonly needed?: readonly string[] | undefined;
  /** Imports bound as STB_WEAK: when no loaded object defines one, its slot
   * resolves to 0 instead of failing the launch. */
  readonly weakImports?: readonly string[] | undefined;
  /** Optional identity mixed into the `.note.gnu.build-id` hash. */
  readonly identifier?: string | undefined;
}
export interface ElfExecutableRequest {
  /** Encoded A64 instructions followed by any `textSections`. */
  readonly code: Uint8Array;
  /** Process entry (the ELF `e_entry`): receives the kernel's initial stack,
   * with the dynamic loader's finalizer in x0. */
  readonly entryOffset: number;
  readonly maxByteLength: number;
  readonly symbols?: readonly ElfCodeSymbol[] | undefined;
  /** Symbols naming offsets in `data`. */
  readonly dataSymbols?: readonly ElfCodeSymbol[] | undefined;
  readonly textSections?: readonly ElfTextSection[] | undefined;
  /** Call-frame rules of code ranges (code-relative, address order), emitted
   * as `.eh_frame` indexed by `.eh_frame_hdr`. */
  readonly unwind?: readonly UnwindRange[] | undefined;
  /** Writable data, placed after the import slots. */
  readonly data?: Uint8Array | undefined;
  /** Imported symbol names, verbatim (no platform mangling is applied). Each
   * gets one 8-byte GOT slot bound by R_AARCH64_GLOB_DAT at load. */
  readonly imports?: readonly string[] | undefined;
  readonly addressFixups?: readonly ImageAddressReference[] | undefined;
  /** Patches each fixup. `siteOffset` is the site's file offset and
   * `targetOffset` the target address minus the site address plus
   * `siteOffset`; executable code maps at its file offset, so this is the
   * target's virtual address in the image (based at 0). */
  readonly patchAddress?: ImageAddressPatcher | undefined;
  readonly debug?: ElfDebugRequest | undefined;
  readonly linux?: LinuxImageOptions | undefined;
}
export interface ElfImportSlot {
  readonly name: string;
  readonly fileOffset: number;
  readonly address: number;
}
export interface ElfExecutable {
  readonly bytes: Uint8Array;
  /** Code maps at its file offset (`codeFileOffset` is also its address). */
  readonly codeFileOffset: number;
  readonly entryFileOffset: number;
  readonly dataFileOffset: number | undefined;
  readonly dataAddress: number | undefined;
  readonly importSlots: readonly ElfImportSlot[];
}
export type ElfError =
  | "INVALID_CODE"
  | "INVALID_ENTRY"
  | "INVALID_LIMIT"
  | "INVALID_SYMBOL"
  | "INVALID_UNWIND"
  | "INVALID_IMPORT"
  | "INVALID_LIBRARY"
  | "INVALID_REFERENCE"
  | "ADDRESS_OUT_OF_RANGE"
  | "INVALID_DEBUG"
  | "SIZE_LIMIT"
  | "LAYOUT_FAILED";
export type ElfResult =
  | { readonly ok: true; readonly value: ElfExecutable }
  | { readonly ok: false; readonly error: ElfError };

const DEFAULT_INTERPRETER = "/lib/ld-linux-aarch64.so.1";
const LIBC = "libc.so.6";
/** Largest supported kernel page: PT_LOAD alignment that lets one image run
 * on 4 KiB, 16 KiB and 64 KiB page kernels. */
const SEGMENT_ALIGNMENT = 65536;
const ELF_HEADER_SIZE = 64,
  PROGRAM_HEADER_SIZE = 56,
  SECTION_HEADER_SIZE = 64,
  SYMBOL_SIZE = 24,
  RELA_SIZE = 24,
  DYNAMIC_SIZE = 16,
  BUILD_ID_SIZE = 20,
  NOTE_SIZE = 16 + BUILD_ID_SIZE;
const PT_LOAD = 1,
  PT_DYNAMIC = 2,
  PT_INTERP = 3,
  PT_NOTE = 4,
  PT_PHDR = 6,
  PT_GNU_EH_FRAME = 0x6474e550,
  PT_GNU_STACK = 0x6474e551,
  PT_GNU_RELRO = 0x6474e552;
const PF_X = 1,
  PF_W = 2,
  PF_R = 4;
const SHT_PROGBITS = 1,
  SHT_SYMTAB = 2,
  SHT_STRTAB = 3,
  SHT_RELA = 4,
  SHT_HASH = 5,
  SHT_DYNAMIC = 6,
  SHT_NOTE = 7,
  SHT_DYNSYM = 11;
const SHF_WRITE = 1,
  SHF_ALLOC = 2,
  SHF_EXECINSTR = 4,
  SHF_MERGE = 0x10,
  SHF_STRINGS = 0x20;
const DT_NULL = 0,
  DT_NEEDED = 1,
  DT_HASH = 4,
  DT_STRTAB = 5,
  DT_SYMTAB = 6,
  DT_RELA = 7,
  DT_RELASZ = 8,
  DT_RELAENT = 9,
  DT_STRSZ = 10,
  DT_SYMENT = 11,
  DT_DEBUG = 21,
  DT_FLAGS = 30,
  DT_FLAGS_1 = 0x6ffffffb;
const DF_BIND_NOW = 8,
  DF_1_NOW = 1,
  DF_1_PIE = 0x08000000;
const STB_LOCAL = 0,
  STB_GLOBAL = 1,
  STB_WEAK = 2,
  STT_NOTYPE = 0,
  STT_OBJECT = 1,
  STT_FUNC = 2;
const R_AARCH64_GLOB_DAT = 1025;
const NT_GNU_BUILD_ID = 3;
const ARM64_FRAME_TARGET: CallFrameTarget = {
  stackPointer: 31,
  framePointer: 29,
  returnAddress: 30,
  dataAlignment: 8,
};

interface SectionHeader {
  readonly name: string;
  readonly type: number;
  readonly flags: number;
  readonly address: number;
  readonly offset: number;
  readonly size: number;
  readonly link: number;
  readonly info: number;
  readonly alignment: number;
  readonly entrySize: number;
}
interface ProgramHeader {
  readonly type: number;
  readonly flags: number;
  readonly offset: number;
  readonly address: number;
  readonly fileSize: number;
  readonly memorySize: number;
  readonly alignment: number;
}
/** A string table under construction: offset 0 is the empty string. */
interface StringTable {
  readonly parts: Uint8Array[];
  readonly offsets: Map<string, number>;
  size: number;
}

function uint(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= max;
}
function alignTo(offset: number, alignment: number): number {
  return Math.ceil(offset / alignment) * alignment;
}
function put16(b: Uint8Array, o: number, n: number): void {
  if (!writeUnsigned(b, o, 2, n, "little").ok) throw "ELF u16 invariant";
}
function put32(b: Uint8Array, o: number, n: number): void {
  if (!writeUnsigned(b, o, 4, n, "little").ok) throw "ELF u32 invariant";
}
function put64(b: Uint8Array, o: number, n: number): void {
  const lo = n % 0x100000000,
    hi = Math.floor(n / 0x100000000);
  if (!writeWord64(b, o, { lo, hi }, "little").ok) throw "ELF u64 invariant";
}
function stringTable(): StringTable {
  const parts: Uint8Array[] = [new Uint8Array(1)];
  return { parts, offsets: new Map<string, number>(), size: 1 };
}
function intern(table: StringTable, value: string): number {
  const known = table.offsets.get(value);
  if (known !== undefined) return known;
  const encoded = new TextEncoder().encode(value);
  const offset = table.size;
  table.parts.push(encoded);
  table.parts.push(new Uint8Array(1));
  table.size += encoded.length + 1;
  table.offsets.set(value, offset);
  return offset;
}
function tableBytes(table: StringTable): Uint8Array {
  const out = new Uint8Array(table.size);
  let at = 0;
  for (const part of table.parts) {
    if (part === undefined) throw "ELF string table invariant";
    out.set(part, at);
    at += part.length;
  }
  return out;
}
/** A printable, NUL-free name for symbol and library tables. */
function validName(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++)
    if (value.charCodeAt(i) === 0) return false;
  return true;
}
function validPath(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}
/** Size of each symbol: the distance to the next higher symbol offset, or to
 * `end`, so profilers and debuggers can attribute addresses. */
function symbolSizes(symbols: readonly ElfCodeSymbol[], end: number): number[] {
  const offsets: number[] = [];
  for (const symbol of symbols) {
    if (symbol === undefined) throw "ELF symbol invariant";
    offsets.push(symbol.offset);
  }
  offsets.sort((a, b): number => a - b);
  const sizes: number[] = [];
  for (const symbol of symbols) {
    if (symbol === undefined) throw "ELF symbol invariant";
    let low = 0,
      high = offsets.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((offsets[middle] ?? 0) <= symbol.offset) low = middle + 1;
      else high = middle;
    }
    const next = offsets[low];
    sizes.push((next === undefined ? end : next) - symbol.offset);
  }
  return sizes;
}
function placementOf(
  placements: readonly Placement[],
  id: string,
): Placement | undefined {
  for (const placement of placements)
    if (placement !== undefined && placement.id === id) return placement;
  return undefined;
}
function writeProgramHeader(
  b: Uint8Array,
  o: number,
  header: ProgramHeader,
): void {
  put32(b, o, header.type);
  put32(b, o + 4, header.flags);
  put64(b, o + 8, header.offset);
  put64(b, o + 16, header.address);
  put64(b, o + 24, header.address);
  put64(b, o + 32, header.fileSize);
  put64(b, o + 40, header.memorySize);
  put64(b, o + 48, header.alignment);
}
function writeSymbol(
  b: Uint8Array,
  o: number,
  name: number,
  info: number,
  section: number,
  value: number,
  size: number,
): void {
  put32(b, o, name);
  b[o + 4] = info;
  b[o + 5] = 0; // STV_DEFAULT
  put16(b, o + 6, section);
  put64(b, o + 8, value);
  put64(b, o + 16, size);
}
function writeDynamic(
  b: Uint8Array,
  o: number,
  tag: number,
  value: number,
): void {
  put64(b, o, tag);
  put64(b, o + 8, value);
}

/**
 * A glibc-linked AArch64 Linux PIE (ET_DYN) holding supplied
 * position-independent code. One R+X segment carries the headers, dynamic
 * linking tables, code, read-only tail sections and unwind tables at
 * addresses equal to their file offsets; one R+W segment holds `.dynamic`,
 * the GOT (import slots, RELRO after BIND_NOW relocation) and `data`. Both
 * are aligned for 64 KiB pages. Symbols, DWARF and section headers follow as
 * non-allocated sections. Output is a pure function of the request.
 */
export function buildElfExecutable(request: ElfExecutableRequest): ElfResult {
  const code = request.code;
  if (code.length === 0 || code.length % 4 !== 0)
    return { ok: false, error: "INVALID_CODE" };
  if (
    !uint(request.entryOffset, code.length - 1) ||
    request.entryOffset % 4 !== 0
  )
    return { ok: false, error: "INVALID_ENTRY" };
  if (!uint(request.maxByteLength, Number.MAX_SAFE_INTEGER))
    return { ok: false, error: "INVALID_LIMIT" };
  const tail = request.textSections ?? [];
  let instructionEnd = code.length;
  for (let index = tail.length - 1; index >= 0; index--) {
    const section = tail[index];
    if (
      section === undefined ||
      (section.kind !== "cstring" && section.kind !== "rodata") ||
      !uint(section.offset, instructionEnd) ||
      section.offset + section.byteLength !== instructionEnd ||
      section.byteLength === 0
    )
      return { ok: false, error: "INVALID_CODE" };
    instructionEnd = section.offset;
  }
  if (instructionEnd <= request.entryOffset || instructionEnd % 4 !== 0)
    return { ok: false, error: "INVALID_CODE" };

  // Constants, not reassigned locals: the native compiler (which links
  // this writer) rejects reassigning an array-typed local from an optional.
  const options = request.linux,
    chosenInterpreter = options === undefined ? undefined : options.interpreter,
    chosenIdentifier = options === undefined ? undefined : options.identifier,
    chosenNeeded = options === undefined ? undefined : options.needed,
    chosenWeak = options === undefined ? undefined : options.weakImports;
  const interpreter =
      chosenInterpreter === undefined ? DEFAULT_INTERPRETER : chosenInterpreter,
    identifier = chosenIdentifier === undefined ? "" : chosenIdentifier;
  const none: readonly string[] = [];
  const neededInput = chosenNeeded === undefined ? none : chosenNeeded,
    weakInput = chosenWeak === undefined ? none : chosenWeak;
  if (!validPath(interpreter)) return { ok: false, error: "INVALID_LIBRARY" };
  const needed: string[] = [LIBC];
  for (const soname of neededInput) {
    if (soname === undefined || !validPath(soname) || needed.includes(soname))
      return { ok: false, error: "INVALID_LIBRARY" };
    needed.push(soname);
  }
  const imports = request.imports ?? [];
  const importIndex = new Map<string, number>();
  for (let index = 0; index < imports.length; index++) {
    const name = imports[index];
    if (name === undefined || !validName(name) || importIndex.has(name))
      return { ok: false, error: "INVALID_IMPORT" };
    importIndex.set(name, index);
  }
  const weak = new Set<string>();
  for (const name of weakInput) {
    if (name === undefined || !importIndex.has(name) || weak.has(name))
      return { ok: false, error: "INVALID_IMPORT" };
    weak.add(name);
  }

  const data = request.data ?? new Uint8Array(0);
  const codeSymbols = request.symbols ?? [],
    dataSymbols = request.dataSymbols ?? [];
  for (let i = 0; i < codeSymbols.length + dataSymbols.length; i++) {
    const isCode = i < codeSymbols.length;
    const symbol = isCode
      ? codeSymbols[i]
      : dataSymbols[i - codeSymbols.length];
    if (
      symbol === undefined ||
      !validName(symbol.name) ||
      (isCode
        ? !uint(symbol.offset, instructionEnd - 1) || symbol.offset % 4 !== 0
        : !uint(symbol.offset, data.length - 1))
    )
      return { ok: false, error: "INVALID_SYMBOL" };
  }

  const unwindRanges = request.unwind ?? [];
  let unwindEnd = 0;
  const unwound: UnwindRange[] = [];
  for (const range of unwindRanges) {
    if (
      range === undefined ||
      !uint(range.offset, code.length - 1) ||
      range.offset % 4 !== 0 ||
      !uint(range.byteLength, code.length - range.offset) ||
      range.offset < unwindEnd
    )
      return { ok: false, error: "INVALID_UNWIND" };
    unwindEnd = range.offset + range.byteLength;
    // An empty range describes no code and would duplicate a table key.
    if (range.byteLength > 0) unwound.push(range);
  }
  const hasUnwind = unwound.length > 0;
  const hasRelocations = imports.length > 0;

  // Dynamic string and symbol tables: libraries then imports.
  const dynamicStrings = stringTable();
  const neededOffsets: number[] = [];
  for (const soname of needed) {
    if (soname === undefined) throw "ELF needed invariant";
    neededOffsets.push(intern(dynamicStrings, soname));
  }
  const importNames: Uint8Array[] = [];
  const dynamicSymbols = new Uint8Array((imports.length + 1) * SYMBOL_SIZE);
  for (let index = 0; index < imports.length; index++) {
    const name = imports[index];
    if (name === undefined) throw "ELF import invariant";
    importNames.push(new TextEncoder().encode(name));
    const bind = weak.has(name) ? STB_WEAK : STB_GLOBAL;
    writeSymbol(
      dynamicSymbols,
      (index + 1) * SYMBOL_SIZE,
      intern(dynamicStrings, name),
      bind * 16 + STT_NOTYPE,
      0,
      0,
      0,
    );
  }
  const dynstr = tableBytes(dynamicStrings);
  const hashWords = sysvHashTable(importNames);
  const hash = new Uint8Array(hashWords.length * 4);
  for (let index = 0; index < hashWords.length; index++)
    put32(hash, index * 4, hashWords[index] ?? 0);
  const interp = new Uint8Array(interpreter.length + 1);
  for (let i = 0; i < interpreter.length; i++)
    interp[i] = interpreter.charCodeAt(i);
  const note = new Uint8Array(NOTE_SIZE);
  put32(note, 0, 4);
  put32(note, 4, BUILD_ID_SIZE);
  put32(note, 8, NT_GNU_BUILD_ID);
  note[12] = 0x47; // "GNU\0"
  note[13] = 0x4e;
  note[14] = 0x55;
  // NEEDED..., HASH, STRTAB, SYMTAB, STRSZ, SYMENT, [RELA, RELASZ, RELAENT],
  // DEBUG, FLAGS, FLAGS_1, NULL.
  const dynamicCount = needed.length + 5 + (hasRelocations ? 3 : 0) + 4;
  const programHeaderCount = 8 + (hasUnwind ? 1 : 0);
  const headerSize = ELF_HEADER_SIZE + programHeaderCount * PROGRAM_HEADER_SIZE;

  // The code address must be fixed before layout: DWARF and the FDEs encode
  // it. Mirror the fragment order and alignments given to link() below.
  let cursor = headerSize + interp.length;
  cursor = alignTo(cursor, 4) + note.length;
  cursor = alignTo(cursor, 4) + hash.length;
  cursor = alignTo(cursor, 8) + dynamicSymbols.length;
  cursor += dynstr.length;
  if (hasRelocations) cursor = alignTo(cursor, 8) + imports.length * RELA_SIZE;
  // Code starts on a 4 KiB boundary: generated code addresses its literals
  // page-relatively (ADRP), which needs offsets congruent to addresses.
  const codeAddress = alignTo(cursor, 4096);
  const codeEnd = codeAddress + code.length;
  const headerAddress = alignTo(codeEnd, 4);
  const ehFrameAddress = alignTo(
    headerAddress + ehFrameHeaderSize(unwound.length),
    8,
  );
  let ehFrameHeader: Uint8Array = new Uint8Array(0),
    ehFrame: Uint8Array = new Uint8Array(0);
  if (hasUnwind) {
    const descriptions: FrameDescription[] = [];
    for (const range of unwound) {
      if (range === undefined) throw "ELF unwind invariant";
      descriptions.push({
        address: codeAddress + range.offset,
        byteLength: range.byteLength,
        rule: range.rule,
      });
    }
    const built = buildEhFrame(
      descriptions,
      ehFrameAddress,
      ARM64_FRAME_TARGET,
    );
    // A zero-length entry terminates the section for unwinders that walk it.
    ehFrame = new Uint8Array(built.bytes.length + 4);
    ehFrame.set(built.bytes);
    const entries: FrameIndexEntry[] = [];
    for (let index = 0; index < descriptions.length; index++) {
      const description = descriptions[index],
        offset = built.offsets[index];
      if (description === undefined || offset === undefined)
        throw "ELF unwind index invariant";
      entries.push({
        location: description.address,
        description: ehFrameAddress + offset,
      });
    }
    ehFrameHeader = buildEhFrameHeader(headerAddress, ehFrameAddress, entries);
  }

  let debugAbbrev: Uint8Array = new Uint8Array(0),
    debugInfo: Uint8Array = new Uint8Array(0),
    debugLine: Uint8Array = new Uint8Array(0),
    debugLoc: Uint8Array = new Uint8Array(0),
    debugRanges: Uint8Array = new Uint8Array(0);
  const debugRequest = request.debug;
  if (debugRequest !== undefined) {
    const debug = buildDebugInfo({
      directory: debugRequest.directory,
      functions: debugRequest.functions,
      lines: debugRequest.lines,
      types: debugRequest.types,
      origins: debugRequest.origins,
      globals: debugRequest.globals,
      codeAddress,
      codeLength: code.length,
      maxByteLength: request.maxByteLength,
    });
    if (!debug.ok)
      return {
        ok: false,
        error: debug.error === "SIZE_LIMIT" ? "SIZE_LIMIT" : "INVALID_DEBUG",
      };
    debugAbbrev = debug.value.abbrev;
    debugInfo = debug.value.info;
    debugLine = debug.value.line;
    debugLoc = debug.value.loc;
    debugRanges = debug.value.ranges;
  }

  // Static symbols: all local, after the null symbol.
  const symbolCount = codeSymbols.length + dataSymbols.length;
  const strings = stringTable();
  const symbolNames: number[] = [];
  for (let i = 0; i < symbolCount; i++) {
    const symbol =
      i < codeSymbols.length
        ? codeSymbols[i]
        : dataSymbols[i - codeSymbols.length];
    if (symbol === undefined) throw "ELF symbol invariant";
    symbolNames.push(intern(strings, symbol.name));
  }
  const strtab = tableBytes(strings);
  const symtab = new Uint8Array(
    symbolCount > 0 ? (symbolCount + 1) * SYMBOL_SIZE : 0,
  );

  // Section names, in section header order (fixed before layout so the
  // header table's size is known).
  const sectionNames: string[] = [
    "",
    ".interp",
    ".note.gnu.build-id",
    ".hash",
    ".dynsym",
    ".dynstr",
  ];
  if (hasRelocations) sectionNames.push(".rela.dyn");
  sectionNames.push(".text");
  for (const section of tail) {
    if (section === undefined) throw "ELF text section invariant";
    sectionNames.push(
      section.kind === "cstring" ? ".rodata.str1.1" : ".rodata",
    );
  }
  if (hasUnwind) {
    sectionNames.push(".eh_frame_hdr");
    sectionNames.push(".eh_frame");
  }
  sectionNames.push(".dynamic");
  if (hasRelocations) sectionNames.push(".got");
  if (data.length > 0) sectionNames.push(".data");
  if (symbolCount > 0) {
    sectionNames.push(".symtab");
    sectionNames.push(".strtab");
  }
  if (debugRequest !== undefined) {
    sectionNames.push(".debug_abbrev");
    sectionNames.push(".debug_info");
    sectionNames.push(".debug_line");
    sectionNames.push(".debug_loc");
    sectionNames.push(".debug_ranges");
  }
  sectionNames.push(".shstrtab");
  const sectionStrings = stringTable();
  for (const sectionName of sectionNames) {
    if (sectionName === undefined) throw "ELF section name invariant";
    intern(sectionStrings, sectionName);
  }
  const shstrtab = tableBytes(sectionStrings);

  const fragments: Fragment[] = [
    {
      id: "headers",
      order: 0,
      alignment: 1,
      bytes: new Uint8Array(headerSize),
    },
    { id: "interp", order: 1, alignment: 1, bytes: interp },
    { id: "note", order: 2, alignment: 4, bytes: note },
    { id: "hash", order: 3, alignment: 4, bytes: hash },
    { id: "dynsym", order: 4, alignment: 8, bytes: dynamicSymbols },
    { id: "dynstr", order: 5, alignment: 1, bytes: dynstr },
    {
      id: "rela",
      order: 6,
      alignment: 8,
      bytes: new Uint8Array(imports.length * RELA_SIZE),
    },
    { id: "code", order: 7, alignment: 4096, bytes: code },
    { id: "eh-frame-hdr", order: 8, alignment: 4, bytes: ehFrameHeader },
    { id: "eh-frame", order: 9, alignment: 8, bytes: ehFrame },
    {
      id: "dynamic",
      order: 10,
      alignment: 8,
      bytes: new Uint8Array(dynamicCount * DYNAMIC_SIZE),
    },
    {
      id: "got",
      order: 11,
      alignment: 8,
      bytes: new Uint8Array(imports.length * 8),
    },
    { id: "data", order: 12, alignment: 16, bytes: data },
    { id: "symtab", order: 13, alignment: 8, bytes: symtab },
    { id: "strtab", order: 14, alignment: 1, bytes: strtab },
    { id: "debug-abbrev", order: 15, alignment: 1, bytes: debugAbbrev },
    { id: "debug-info", order: 16, alignment: 1, bytes: debugInfo },
    { id: "debug-line", order: 17, alignment: 1, bytes: debugLine },
    { id: "debug-loc", order: 18, alignment: 1, bytes: debugLoc },
    { id: "debug-ranges", order: 19, alignment: 1, bytes: debugRanges },
    { id: "shstrtab", order: 20, alignment: 1, bytes: shstrtab },
    {
      id: "section-headers",
      order: 21,
      alignment: 8,
      bytes: new Uint8Array(sectionNames.length * SECTION_HEADER_SIZE),
    },
  ];
  const linked = link({
    fragments,
    symbols: [],
    fixups: [],
    virtualBase: { lo: 0, hi: 0 },
    maxByteLength: request.maxByteLength,
  });
  if (!linked.ok)
    return {
      ok: false,
      error:
        linked.error.code === "SIZE_LIMIT" ? "SIZE_LIMIT" : "LAYOUT_FAILED",
    };
  const bytes = linked.value.bytes,
    placements = linked.value.placements;
  const at = (id: string): Placement => {
    const placement = placementOf(placements, id);
    if (placement === undefined) throw "ELF placement invariant";
    return placement;
  };
  const interpAt = at("interp"),
    noteAt = at("note"),
    hashAt = at("hash"),
    dynsymAt = at("dynsym"),
    dynstrAt = at("dynstr"),
    relaAt = at("rela"),
    codeAt = at("code"),
    ehFrameHeaderAt = at("eh-frame-hdr"),
    ehFrameAt = at("eh-frame"),
    dynamicAt = at("dynamic"),
    gotAt = at("got"),
    dataAt = at("data"),
    symtabAt = at("symtab"),
    strtabAt = at("strtab"),
    shstrtabAt = at("shstrtab"),
    sectionHeadersAt = at("section-headers");
  if (
    codeAt.fileOffset !== codeAddress ||
    (hasUnwind &&
      (ehFrameHeaderAt.fileOffset !== headerAddress ||
        ehFrameAt.fileOffset !== ehFrameAddress))
  )
    return { ok: false, error: "LAYOUT_FAILED" };

  // The R+X segment maps file offsets [0, textEnd) at the same addresses.
  // The R+W segment follows in the file without padding; its addresses start
  // on the next 64 KiB boundary, congruent to its file offsets.
  const textEnd = hasUnwind ? ehFrameAt.fileOffset + ehFrame.length : codeEnd;
  const writableOffset = dynamicAt.fileOffset;
  const writableBias =
    alignTo(textEnd, SEGMENT_ALIGNMENT) -
    Math.floor(writableOffset / SEGMENT_ALIGNMENT) * SEGMENT_ALIGNMENT;
  const writableEnd = dataAt.fileOffset + data.length;
  const dynamicAddress = dynamicAt.fileOffset + writableBias,
    gotAddress = gotAt.fileOffset + writableBias,
    dataAddress = dataAt.fileOffset + writableBias;

  const importSlots: ElfImportSlot[] = [];
  for (let index = 0; index < imports.length; index++) {
    const name = imports[index];
    if (name === undefined) throw "ELF import invariant";
    importSlots.push({
      name,
      fileOffset: gotAt.fileOffset + index * 8,
      address: gotAddress + index * 8,
    });
    const rela = relaAt.fileOffset + index * RELA_SIZE;
    put64(bytes, rela, gotAddress + index * 8);
    put32(bytes, rela + 8, R_AARCH64_GLOB_DAT);
    put32(bytes, rela + 12, index + 1);
    put64(bytes, rela + 16, 0);
  }

  const dynamicTags: number[] = [],
    dynamicValues: number[] = [];
  const dynamicEntry = (tag: number, value: number): void => {
    dynamicTags.push(tag);
    dynamicValues.push(value);
  };
  for (const offset of neededOffsets) {
    if (offset === undefined) throw "ELF needed invariant";
    dynamicEntry(DT_NEEDED, offset);
  }
  dynamicEntry(DT_HASH, hashAt.fileOffset);
  dynamicEntry(DT_STRTAB, dynstrAt.fileOffset);
  dynamicEntry(DT_SYMTAB, dynsymAt.fileOffset);
  dynamicEntry(DT_STRSZ, dynstr.length);
  dynamicEntry(DT_SYMENT, SYMBOL_SIZE);
  if (hasRelocations) {
    dynamicEntry(DT_RELA, relaAt.fileOffset);
    dynamicEntry(DT_RELASZ, relaAt.byteLength);
    dynamicEntry(DT_RELAENT, RELA_SIZE);
  }
  dynamicEntry(DT_DEBUG, 0);
  dynamicEntry(DT_FLAGS, DF_BIND_NOW);
  dynamicEntry(DT_FLAGS_1, DF_1_NOW + DF_1_PIE);
  dynamicEntry(DT_NULL, 0);
  if (dynamicTags.length !== dynamicCount) throw "ELF dynamic table invariant";
  for (let index = 0; index < dynamicTags.length; index++)
    writeDynamic(
      bytes,
      dynamicAt.fileOffset + index * DYNAMIC_SIZE,
      dynamicTags[index] ?? 0,
      dynamicValues[index] ?? 0,
    );

  // Section headers, in sectionNames order.
  const sections: SectionHeader[] = [];
  const addSection = (
    name: string,
    type: number,
    flags: number,
    placement: Placement,
    address: number,
    link: number,
    info: number,
    alignment: number,
    entrySize: number,
  ): number => {
    sections.push({
      name,
      type,
      flags,
      address,
      offset: placement.fileOffset,
      size: placement.byteLength,
      link,
      info,
      alignment,
      entrySize,
    });
    return sections.length - 1;
  };
  sections.push({
    name: "",
    type: 0,
    flags: 0,
    address: 0,
    offset: 0,
    size: 0,
    link: 0,
    info: 0,
    alignment: 0,
    entrySize: 0,
  });
  addSection(
    ".interp",
    SHT_PROGBITS,
    SHF_ALLOC,
    interpAt,
    interpAt.fileOffset,
    0,
    0,
    1,
    0,
  );
  addSection(
    ".note.gnu.build-id",
    SHT_NOTE,
    SHF_ALLOC,
    noteAt,
    noteAt.fileOffset,
    0,
    0,
    4,
    0,
  );
  // .dynsym follows .hash, and .dynstr follows .dynsym.
  const dynsymIndex = sections.length + 1,
    dynstrIndex = sections.length + 2;
  addSection(
    ".hash",
    SHT_HASH,
    SHF_ALLOC,
    hashAt,
    hashAt.fileOffset,
    dynsymIndex,
    0,
    4,
    4,
  );
  addSection(
    ".dynsym",
    SHT_DYNSYM,
    SHF_ALLOC,
    dynsymAt,
    dynsymAt.fileOffset,
    dynstrIndex,
    1,
    8,
    SYMBOL_SIZE,
  );
  addSection(
    ".dynstr",
    SHT_STRTAB,
    SHF_ALLOC,
    dynstrAt,
    dynstrAt.fileOffset,
    0,
    0,
    1,
    0,
  );
  if (hasRelocations)
    addSection(
      ".rela.dyn",
      SHT_RELA,
      SHF_ALLOC,
      relaAt,
      relaAt.fileOffset,
      dynsymIndex,
      0,
      8,
      RELA_SIZE,
    );
  const textIndex = addSection(
    ".text",
    SHT_PROGBITS,
    SHF_ALLOC + SHF_EXECINSTR,
    { id: "text", fileOffset: codeAddress, byteLength: instructionEnd },
    codeAddress,
    0,
    0,
    4096,
    0,
  );
  for (const item of tail) {
    if (item === undefined) throw "ELF text section invariant";
    const cstring = item.kind === "cstring";
    addSection(
      cstring ? ".rodata.str1.1" : ".rodata",
      SHT_PROGBITS,
      cstring ? SHF_ALLOC + SHF_MERGE + SHF_STRINGS : SHF_ALLOC,
      {
        id: "tail",
        fileOffset: codeAddress + item.offset,
        byteLength: item.byteLength,
      },
      codeAddress + item.offset,
      0,
      0,
      1,
      cstring ? 1 : 0,
    );
  }
  if (hasUnwind) {
    addSection(
      ".eh_frame_hdr",
      SHT_PROGBITS,
      SHF_ALLOC,
      ehFrameHeaderAt,
      headerAddress,
      0,
      0,
      4,
      0,
    );
    addSection(
      ".eh_frame",
      SHT_PROGBITS,
      SHF_ALLOC,
      ehFrameAt,
      ehFrameAddress,
      0,
      0,
      8,
      0,
    );
  }
  addSection(
    ".dynamic",
    SHT_DYNAMIC,
    SHF_ALLOC + SHF_WRITE,
    dynamicAt,
    dynamicAddress,
    dynstrIndex,
    0,
    8,
    DYNAMIC_SIZE,
  );
  if (hasRelocations)
    addSection(
      ".got",
      SHT_PROGBITS,
      SHF_ALLOC + SHF_WRITE,
      gotAt,
      gotAddress,
      0,
      0,
      8,
      8,
    );
  let dataIndex = 0;
  if (data.length > 0)
    dataIndex = addSection(
      ".data",
      SHT_PROGBITS,
      SHF_ALLOC + SHF_WRITE,
      dataAt,
      dataAddress,
      0,
      0,
      16,
      0,
    );
  if (symbolCount > 0) {
    const strtabIndex = sections.length + 1;
    addSection(
      ".symtab",
      SHT_SYMTAB,
      0,
      symtabAt,
      0,
      strtabIndex,
      symbolCount + 1,
      8,
      SYMBOL_SIZE,
    );
    addSection(".strtab", SHT_STRTAB, 0, strtabAt, 0, 0, 0, 1, 0);
  }
  if (debugRequest !== undefined) {
    addSection(
      ".debug_abbrev",
      SHT_PROGBITS,
      0,
      at("debug-abbrev"),
      0,
      0,
      0,
      1,
      0,
    );
    addSection(".debug_info", SHT_PROGBITS, 0, at("debug-info"), 0, 0, 0, 1, 0);
    addSection(".debug_line", SHT_PROGBITS, 0, at("debug-line"), 0, 0, 0, 1, 0);
    addSection(".debug_loc", SHT_PROGBITS, 0, at("debug-loc"), 0, 0, 0, 1, 0);
    addSection(
      ".debug_ranges",
      SHT_PROGBITS,
      0,
      at("debug-ranges"),
      0,
      0,
      0,
      1,
      0,
    );
  }
  const shstrtabIndex = addSection(
    ".shstrtab",
    SHT_STRTAB,
    0,
    shstrtabAt,
    0,
    0,
    0,
    1,
    0,
  );
  if (sections.length !== sectionNames.length)
    throw "ELF section count invariant";
  for (let index = 0; index < sections.length; index++) {
    const header = sections[index];
    if (header === undefined || header.name !== sectionNames[index])
      throw "ELF section order invariant";
    const o = sectionHeadersAt.fileOffset + index * SECTION_HEADER_SIZE;
    const name = sectionStrings.offsets.get(header.name);
    if (name === undefined) throw "ELF section name invariant";
    put32(bytes, o, name);
    put32(bytes, o + 4, header.type);
    put64(bytes, o + 8, header.flags);
    put64(bytes, o + 16, header.address);
    put64(bytes, o + 24, index === 0 ? 0 : header.offset);
    put64(bytes, o + 32, header.size);
    put32(bytes, o + 40, header.link);
    put32(bytes, o + 44, header.info);
    put64(bytes, o + 48, header.alignment);
    put64(bytes, o + 56, header.entrySize);
  }

  if (symbolCount > 0) {
    const codeSizes = symbolSizes(codeSymbols, instructionEnd),
      dataSizes = symbolSizes(dataSymbols, data.length);
    for (let i = 0; i < symbolCount; i++) {
      const isCode = i < codeSymbols.length;
      const symbol = isCode
        ? codeSymbols[i]
        : dataSymbols[i - codeSymbols.length];
      const size = isCode ? codeSizes[i] : dataSizes[i - codeSymbols.length];
      const name = symbolNames[i];
      if (symbol === undefined || size === undefined || name === undefined)
        throw "ELF symbol invariant";
      writeSymbol(
        bytes,
        symtabAt.fileOffset + (i + 1) * SYMBOL_SIZE,
        name,
        STB_LOCAL * 16 + (isCode ? STT_FUNC : STT_OBJECT),
        isCode ? textIndex : dataIndex,
        (isCode ? codeAddress : dataAddress) + symbol.offset,
        size,
      );
    }
  }

  const programHeaders: ProgramHeader[] = [
    {
      type: PT_PHDR,
      flags: PF_R,
      offset: ELF_HEADER_SIZE,
      address: ELF_HEADER_SIZE,
      fileSize: programHeaderCount * PROGRAM_HEADER_SIZE,
      memorySize: programHeaderCount * PROGRAM_HEADER_SIZE,
      alignment: 8,
    },
    {
      type: PT_INTERP,
      flags: PF_R,
      offset: interpAt.fileOffset,
      address: interpAt.fileOffset,
      fileSize: interp.length,
      memorySize: interp.length,
      alignment: 1,
    },
    {
      type: PT_LOAD,
      flags: PF_R + PF_X,
      offset: 0,
      address: 0,
      fileSize: textEnd,
      memorySize: textEnd,
      alignment: SEGMENT_ALIGNMENT,
    },
    {
      type: PT_LOAD,
      flags: PF_R + PF_W,
      offset: writableOffset,
      address: writableOffset + writableBias,
      fileSize: writableEnd - writableOffset,
      memorySize: writableEnd - writableOffset,
      alignment: SEGMENT_ALIGNMENT,
    },
    {
      type: PT_DYNAMIC,
      flags: PF_R + PF_W,
      offset: dynamicAt.fileOffset,
      address: dynamicAddress,
      fileSize: dynamicAt.byteLength,
      memorySize: dynamicAt.byteLength,
      alignment: 8,
    },
    // The loader write-protects whole pages of .dynamic and the GOT after
    // relocation; a page shared with data stays writable.
    {
      type: PT_GNU_RELRO,
      flags: PF_R,
      offset: writableOffset,
      address: writableOffset + writableBias,
      fileSize: gotAt.fileOffset + gotAt.byteLength - writableOffset,
      memorySize: gotAt.fileOffset + gotAt.byteLength - writableOffset,
      alignment: 1,
    },
    {
      type: PT_NOTE,
      flags: PF_R,
      offset: noteAt.fileOffset,
      address: noteAt.fileOffset,
      fileSize: note.length,
      memorySize: note.length,
      alignment: 4,
    },
  ];
  if (hasUnwind)
    programHeaders.push({
      type: PT_GNU_EH_FRAME,
      flags: PF_R,
      offset: headerAddress,
      address: headerAddress,
      fileSize: ehFrameHeader.length,
      memorySize: ehFrameHeader.length,
      alignment: 4,
    });
  programHeaders.push({
    type: PT_GNU_STACK,
    flags: PF_R + PF_W,
    offset: 0,
    address: 0,
    fileSize: 0,
    memorySize: 0,
    alignment: 16,
  });
  if (programHeaders.length !== programHeaderCount)
    throw "ELF program header invariant";
  for (let index = 0; index < programHeaders.length; index++) {
    const header = programHeaders[index];
    if (header === undefined) throw "ELF program header invariant";
    writeProgramHeader(
      bytes,
      ELF_HEADER_SIZE + index * PROGRAM_HEADER_SIZE,
      header,
    );
  }

  // ELFCLASS64, ELFDATA2LSB, EV_CURRENT, ELFOSABI_SYSV
  bytes[0] = 0x7f;
  bytes[1] = 0x45;
  bytes[2] = 0x4c;
  bytes[3] = 0x46;
  bytes[4] = 2;
  bytes[5] = 1;
  bytes[6] = 1;
  put16(bytes, 16, 3); // ET_DYN
  put16(bytes, 18, 183); // EM_AARCH64
  put32(bytes, 20, 1);
  put64(bytes, 24, codeAddress + request.entryOffset);
  put64(bytes, 32, ELF_HEADER_SIZE);
  put64(bytes, 40, sectionHeadersAt.fileOffset);
  put32(bytes, 48, 0);
  put16(bytes, 52, ELF_HEADER_SIZE);
  put16(bytes, 54, PROGRAM_HEADER_SIZE);
  put16(bytes, 56, programHeaderCount);
  put16(bytes, 58, SECTION_HEADER_SIZE);
  put16(bytes, 60, sections.length);
  put16(bytes, 62, shstrtabIndex);

  const patchSites = new Set<number>();
  const references = request.addressFixups ?? [];
  const patch = request.patchAddress;
  if (references.length > 0 && patch === undefined)
    return { ok: false, error: "INVALID_REFERENCE" };
  for (let index = 0; index < references.length; index++) {
    const reference = references[index];
    if (
      reference === undefined ||
      !uint(reference.byteLength, code.length) ||
      reference.byteLength === 0 ||
      !uint(reference.alignment, code.length) ||
      reference.alignment === 0 ||
      (reference.alignment & (reference.alignment - 1)) !== 0 ||
      !uint(reference.offset, code.length - reference.byteLength) ||
      reference.offset % reference.alignment !== 0 ||
      patchSites.has(reference.offset)
    )
      return { ok: false, error: "INVALID_REFERENCE" };
    patchSites.add(reference.offset);
    let targetAddress: number | undefined;
    const target = reference.target;
    if (target.kind === "data") {
      if (!uint(target.offset, data.length))
        return { ok: false, error: "INVALID_REFERENCE" };
      targetAddress = dataAddress + target.offset;
    } else if (target.kind === "import") {
      const slot = importIndex.get(target.name);
      if (slot !== undefined) targetAddress = gotAddress + slot * 8;
    }
    if (targetAddress === undefined || patch === undefined)
      return { ok: false, error: "INVALID_REFERENCE" };
    const status = patch(
      bytes,
      index,
      codeAddress + reference.offset,
      targetAddress,
    );
    if (status !== "complete")
      return {
        ok: false,
        error:
          status === "range" ? "ADDRESS_OUT_OF_RANGE" : "INVALID_REFERENCE",
      };
  }

  // The build ID hashes the finished image (with a zero ID) and identity.
  const encodedIdentity = new TextEncoder().encode(identifier);
  const identity = new Uint8Array(bytes.length + encodedIdentity.length);
  identity.set(bytes);
  identity.set(encodedIdentity, bytes.length);
  bytes.set(
    sha256(identity).subarray(0, BUILD_ID_SIZE),
    noteAt.fileOffset + 16,
  );

  return {
    ok: true,
    value: {
      bytes,
      codeFileOffset: codeAddress,
      entryFileOffset: codeAddress + request.entryOffset,
      dataFileOffset: data.length > 0 ? dataAt.fileOffset : undefined,
      dataAddress: data.length > 0 ? dataAddress : undefined,
      importSlots,
    },
  };
}
