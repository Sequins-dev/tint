import { runtimeEntitlements } from "./runtime-entitlements.ts";
import {
  buildDebugInfo,
  type LineRange,
  type DebugGlobal,
  type DebugType,
  type FunctionRange,
} from "../../dwarf.ts";
import type {
  ImageAddressReference,
  ImageAddressPatcher,
} from "@tint/abi/relocation";
import { buildImportFixups, type Import } from "../dyld-fixups.ts";
import {
  alignUp,
  writeUnsigned,
  writeWord64,
} from "@tint/foundation/binary/bytes";
import { sha256 } from "@tint/foundation/binary/sha256";
import { link, type Fragment, type SymbolDefinition } from "../../layout.ts";
import { signatureSize, signCode } from "../signature.ts";
import type { UnwindRange } from "@tint/abi/unwind";
import { buildUnwindSections } from "./compact-unwind.ts";
export interface PlatformVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}
export interface CodeSymbol {
  readonly name: string;
  /** Byte offset in the supplied code, before image placement. */
  readonly offset: number;
}
/** A named `__TEXT` section carved from the tail of the supplied code, after
 * the instructions. Sections are contiguous, in order, and end with the code. */
export interface TextSection {
  readonly name: "__cstring" | "__const";
  /** Byte offset in the supplied code. */
  readonly offset: number;
  readonly byteLength: number;
}
export interface ExecutableRequest {
  /** Development-only get-task-allow entitlement; independent of DWARF emission. */
  readonly allowDebugger?: boolean;
  /** Explicit permission for a runtime that publishes native code through MAP_JIT. */
  readonly allowJit?: boolean;
  readonly debug?:
    | {
        readonly directory: string;
        readonly functions: readonly FunctionRange[];
        readonly lines: readonly LineRange[];
        readonly types?: readonly DebugType[] | undefined;
        readonly origins?: readonly string[] | undefined;
        readonly globals?: readonly DebugGlobal[] | undefined;
      }
    | undefined;
  readonly symbols?: readonly CodeSymbol[];
  /** Symbols naming offsets in `data` (the writable `__DATA,__data`). */
  readonly dataSymbols?: readonly CodeSymbol[] | undefined;
  /** Read-only tail sections of `code` (see TextSection). */
  readonly textSections?: readonly TextSection[] | undefined;
  /** Call-frame rules of code ranges (code-relative, address order), emitted
   * as `__TEXT,__unwind_info` and `__TEXT,__eh_frame` for unwinders. */
  readonly unwind?: readonly UnwindRange[];
  readonly data?: Uint8Array | undefined;
  readonly imports?: readonly string[];
  readonly addressFixups?: readonly ImageAddressReference[];
  readonly patchAddress?: ImageAddressPatcher;
  readonly code: Uint8Array;
  readonly entryOffset: number;
  readonly identifier: string;
  readonly minimumOS: PlatformVersion;
  readonly sdk: PlatformVersion;
  readonly maxByteLength: number;
}
export interface ExecutableImage {
  readonly dataFileOffset: number | undefined;
  readonly importSlots: readonly {
    readonly name: string;
    readonly fileOffset: number;
  }[];
  readonly bytes: Uint8Array;
  readonly codeFileOffset: number;
  readonly entryFileOffset: number;
  readonly signatureFileOffset: number;
}
export type MachOError =
  | "INVALID_DEBUG"
  | "INVALID_CAPABILITY"
  | "INVALID_SYMBOL"
  | "INVALID_UNWIND"
  | "INVALID_IMPORT"
  | "INVALID_REFERENCE"
  | "ADDRESS_OUT_OF_RANGE"
  | "INVALID_CODE"
  | "INVALID_ENTRY"
  | "INVALID_VERSION"
  | "INVALID_IDENTIFIER"
  | "INVALID_LIMIT"
  | "SIZE_LIMIT"
  | "LAYOUT_FAILED"
  | "SIGNING_FAILED";
export type MachOResult =
  | { readonly ok: true; readonly value: ExecutableImage }
  | { readonly ok: false; readonly error: MachOError };
const PAGE = 16384;
// 32-byte header and ten load commands, including one __text section.
const HEADER_SIZE = 520;
function uint(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= max;
}
function version(v: PlatformVersion): number | undefined {
  if (!uint(v.major, 65535) || !uint(v.minor, 255) || !uint(v.patch, 255))
    return undefined;
  return v.major * 65536 + v.minor * 256 + v.patch;
}
function put32(b: Uint8Array, o: number, n: number): void {
  if (!writeUnsigned(b, o, 4, n, "little").ok) throw "Mach-O u32 invariant";
}
function put64(b: Uint8Array, o: number, lo: number, hi: number = 0): void {
  if (!writeWord64(b, o, { lo, hi }, "little").ok) throw "Mach-O u64 invariant";
}
function name(b: Uint8Array, o: number, value: string): void {
  for (let i = 0; i < value.length; i++) b[o + i] = value.charCodeAt(i);
}
function command(b: Uint8Array, o: number, cmd: number, size: number): void {
  put32(b, o, cmd);
  put32(b, o + 4, size);
}
function segment(
  b: Uint8Array,
  o: number,
  label: string,
  vmLo: number,
  vmHi: number,
  sizeLo: number,
  sizeHi: number,
  fileOffset: number,
  fileSize: number,
  prot: number,
  sections: number,
): void {
  command(b, o, 0x19, 72 + sections * 80);
  name(b, o + 8, label);
  put64(b, o + 24, vmLo, vmHi);
  put64(b, o + 32, sizeLo, sizeHi);
  put64(b, o + 40, fileOffset);
  put64(b, o + 48, fileSize);
  put32(b, o + 56, prot);
  put32(b, o + 60, prot);
  put32(b, o + 64, sections);
}
/** Minimal signed arm64 PIE containing a supplied position-independent Darwin main. */
export function buildExecutable(request: ExecutableRequest): MachOResult {
  if (request.code.length === 0 || request.code.length % 4 !== 0)
    return { ok: false, error: "INVALID_CODE" };
  if (
    !uint(request.entryOffset, request.code.length - 1) ||
    request.entryOffset % 4 !== 0
  )
    return { ok: false, error: "INVALID_ENTRY" };
  if (!uint(request.maxByteLength, 0xffffffff))
    return { ok: false, error: "INVALID_LIMIT" };
  const minimumOS = version(request.minimumOS),
    sdk = version(request.sdk);
  if (minimumOS === undefined || sdk === undefined)
    return { ok: false, error: "INVALID_VERSION" };
  if (!signatureSize(0, request.identifier).ok)
    return { ok: false, error: "INVALID_IDENTIFIER" };
  if (
    request.allowDebugger !== undefined &&
    typeof request.allowDebugger !== "boolean"
  )
    return { ok: false, error: "INVALID_DEBUG" };
  if (request.allowJit !== undefined && typeof request.allowJit !== "boolean")
    return { ok: false, error: "INVALID_CAPABILITY" };
  const specialBlobs =
    request.allowDebugger === true || request.allowJit === true
      ? runtimeEntitlements(
          request.allowDebugger === true,
          request.allowJit === true,
        )
      : undefined;
  const imports = request.imports ?? [],
    data = request.data ?? new Uint8Array(0);
  const hasData = imports.length > 0 || data.length > 0;
  const codeSymbols = request.symbols ?? [],
    dataSymbols = request.dataSymbols ?? [];
  const hasSymbols = codeSymbols.length + dataSymbols.length > 0;
  const tail = request.textSections ?? [];
  let instructionEnd = request.code.length;
  for (let index = tail.length - 1; index >= 0; index--) {
    const section = tail[index];
    if (
      section === undefined ||
      (section.name !== "__cstring" && section.name !== "__const") ||
      !uint(section.offset, instructionEnd) ||
      section.offset + section.byteLength !== instructionEnd ||
      section.byteLength === 0
    )
      return { ok: false, error: "INVALID_CODE" };
    instructionEnd = section.offset;
  }
  if (instructionEnd <= request.entryOffset || instructionEnd % 4 !== 0)
    return { ok: false, error: "INVALID_CODE" };
  const debugRequest = request.debug;
  const hasDebug = debugRequest !== undefined;
  const unwindRanges = request.unwind ?? [];
  const hasUnwind = unwindRanges.length > 0;
  let unwindEnd = 0;
  for (const range of unwindRanges) {
    if (
      range === undefined ||
      !uint(range.offset, request.code.length - 1) ||
      range.offset % 4 !== 0 ||
      !uint(range.byteLength, request.code.length - range.offset) ||
      range.offset < unwindEnd
    )
      return { ok: false, error: "INVALID_UNWIND" };
    unwindEnd = range.offset + range.byteLength;
  }
  const headerSize =
    HEADER_SIZE +
    tail.length * 80 +
    (hasData ? 152 : 0) +
    (hasSymbols ? 24 : 0) +
    (hasDebug ? 472 : 0) +
    (hasUnwind ? 160 : 0);
  // Code starts on a 4 KiB boundary: generated modules address their data
  // page-relatively (ADRP+ADD), which needs offsets congruent to addresses.
  const expectedCodeOffset = Math.ceil(headerSize / 4096) * 4096;
  let debugAbbrev: Uint8Array = new Uint8Array(0),
    debugInfo: Uint8Array = new Uint8Array(0),
    debugLine: Uint8Array = new Uint8Array(0),
    debugLoc: Uint8Array = new Uint8Array(0),
    debugRanges: Uint8Array = new Uint8Array(0);
  if (debugRequest !== undefined) {
    const debug = buildDebugInfo({
      ...debugRequest,
      codeAddress: 0x100000000 + expectedCodeOffset,
      codeLength: request.code.length,
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
  const symbolNames: Uint8Array[] = [];
  let stringBytes = 1;
  for (let i = 0; i < codeSymbols.length + dataSymbols.length; i++) {
    const code = i < codeSymbols.length,
      symbol = code ? codeSymbols[i] : dataSymbols[i - codeSymbols.length];
    if (
      symbol === undefined ||
      (code
        ? !uint(symbol.offset, instructionEnd - 1) || symbol.offset % 4 !== 0
        : !uint(symbol.offset, data.length - 1)) ||
      symbol.name.length === 0 ||
      symbol.name.includes("\0")
    )
      return { ok: false, error: "INVALID_SYMBOL" };
    const encoded = new TextEncoder().encode(symbol.name);
    symbolNames.push(encoded);
    stringBytes += encoded.length + 1;
  }
  const recordBytes = (codeSymbols.length + dataSymbols.length) * 16;
  if (hasSymbols && recordBytes + stringBytes > request.maxByteLength)
    return { ok: false, error: "SIZE_LIMIT" };
  const symbolBytes = new Uint8Array(
    hasSymbols ? recordBytes + stringBytes : 0,
  );
  let stringOffset = 1;
  // Data symbol values need the data placement; they are patched after layout.
  for (let i = 0; i < codeSymbols.length + dataSymbols.length; i++) {
    const code = i < codeSymbols.length,
      symbol = code ? codeSymbols[i] : dataSymbols[i - codeSymbols.length],
      encoded = symbolNames[i];
    if (symbol === undefined || encoded === undefined) throw "symbol invariant";
    put32(symbolBytes, i * 16, stringOffset);
    symbolBytes[i * 16 + 4] = 0x0e;
    // __data follows __text, the tail sections and any two unwind sections.
    symbolBytes[i * 16 + 5] = code ? 1 : 2 + tail.length + (hasUnwind ? 2 : 0);
    if (code)
      put64(symbolBytes, i * 16 + 8, expectedCodeOffset + symbol.offset, 1);
    symbolBytes.set(encoded, recordBytes + stringOffset);
    stringOffset += encoded.length + 1;
  }
  // Unwind sections follow the code in __TEXT: __eh_frame (its FDEs address
  // code pc-relatively, so its placement is fixed here) then __unwind_info.
  const ehFrameAddress =
    Math.ceil((expectedCodeOffset + request.code.length) / 8) * 8;
  const unwind = hasUnwind
    ? buildUnwindSections(unwindRanges, expectedCodeOffset, ehFrameAddress)
    : { ehFrame: new Uint8Array(0), unwindInfo: new Uint8Array(0) };
  const unwindInfoAddress =
    Math.ceil((ehFrameAddress + unwind.ehFrame.length) / 4) * 4;
  const textEnd = hasUnwind
    ? unwindInfoAddress + unwind.unwindInfo.length
    : expectedCodeOffset + request.code.length;
  const dataStart = Math.ceil(textEnd / PAGE) * PAGE;
  const bindings: Import[] = [];
  for (const name of imports) {
    if (name === undefined) return { ok: false, error: "INVALID_IMPORT" };
    bindings.push({ name, libraryOrdinal: 1 });
  }
  const built = buildImportFixups({
    imports: bindings,
    segmentOffset: hasData ? dataStart : 0,
    segmentIndex: hasData ? 2 : 0,
    segmentCount: (hasData ? 4 : 3) + (hasDebug ? 1 : 0),
    maxByteLength: request.maxByteLength,
  });
  if (!built.ok)
    return {
      ok: false,
      error: built.error === "SIZE_LIMIT" ? "SIZE_LIMIT" : "INVALID_IMPORT",
    };
  const slots = built.value.slots,
    chains = built.value.metadata;
  const fragments: Fragment[] = [
    {
      id: "headers",
      order: 0,
      alignment: 1,
      bytes: new Uint8Array(headerSize),
    },
    // Page-aligned so code offsets agree with loaded addresses modulo 4 KiB
    // (modules use page-relative ADRP+ADD addressing).
    { id: "code", order: 1, alignment: 4096, bytes: request.code },
    { id: "chains", order: 11, alignment: PAGE, bytes: chains },
    { id: "symbol-table", order: 12, alignment: 8, bytes: symbolBytes },
    { id: "signature", order: 13, alignment: 16, bytes: new Uint8Array(0) },
  ];
  const symbols: SymbolDefinition[] = [
    { id: "code", fragment: "code", offset: 0 },
    { id: "entry", fragment: "code", offset: request.entryOffset },
    { id: "chains", fragment: "chains", offset: 0 },
    { id: "symbol-table", fragment: "symbol-table", offset: 0 },
  ];
  if (hasUnwind) {
    fragments.push({
      id: "eh-frame",
      order: 2,
      alignment: 8,
      bytes: unwind.ehFrame,
    });
    fragments.push({
      id: "unwind-info",
      order: 3,
      alignment: 4,
      bytes: unwind.unwindInfo,
    });
    symbols.push({ id: "eh-frame", fragment: "eh-frame", offset: 0 });
    symbols.push({ id: "unwind-info", fragment: "unwind-info", offset: 0 });
  }
  if (hasData) {
    fragments.push({ id: "slots", order: 4, alignment: PAGE, bytes: slots });
    fragments.push({ id: "data", order: 5, alignment: 16, bytes: data });
    symbols.push({ id: "data", fragment: "data", offset: 0 });
  }
  if (hasDebug) {
    fragments.push({
      id: "debug-abbrev",
      order: 6,
      alignment: PAGE,
      bytes: debugAbbrev,
    });
    fragments.push({
      id: "debug-info",
      order: 7,
      alignment: 1,
      bytes: debugInfo,
    });
    fragments.push({
      id: "debug-line",
      order: 8,
      alignment: 1,
      bytes: debugLine,
    });
    fragments.push({
      id: "debug-loc",
      order: 9,
      alignment: 1,
      bytes: debugLoc,
    });
    fragments.push({
      id: "debug-ranges",
      order: 10,
      alignment: 1,
      bytes: debugRanges,
    });
    symbols.push({ id: "debug-abbrev", fragment: "debug-abbrev", offset: 0 });
    symbols.push({ id: "debug-info", fragment: "debug-info", offset: 0 });
    symbols.push({ id: "debug-line", fragment: "debug-line", offset: 0 });
    symbols.push({ id: "debug-loc", fragment: "debug-loc", offset: 0 });
    symbols.push({ id: "debug-ranges", fragment: "debug-ranges", offset: 0 });
  }
  const linked = link({
    fragments,
    symbols,
    fixups: [],
    virtualBase: { lo: 0, hi: 1 },
    maxByteLength: request.maxByteLength,
  });
  if (!linked.ok)
    return {
      ok: false,
      error:
        linked.error.code === "SIZE_LIMIT" ? "SIZE_LIMIT" : "LAYOUT_FAILED",
    };
  let codeOffset = 0,
    entryOffset = 0,
    linkeditOffset = 0,
    symbolOffset = 0,
    debugOffset = 0,
    debugInfoOffset = 0,
    debugLineOffset = 0,
    debugLocOffset = 0,
    debugRangesOffset = 0,
    ehFrameOffset = 0,
    unwindInfoOffset = 0,
    dataFileOffset: number | undefined;
  for (const symbol of linked.value.symbols) {
    if (symbol === undefined) return { ok: false, error: "LAYOUT_FAILED" };
    if (symbol.id === "code") codeOffset = symbol.fileOffset;
    if (symbol.id === "entry") entryOffset = symbol.fileOffset;
    if (symbol.id === "chains") linkeditOffset = symbol.fileOffset;
    if (symbol.id === "symbol-table") symbolOffset = symbol.fileOffset;
    if (symbol.id === "data") dataFileOffset = symbol.fileOffset;
    if (symbol.id === "debug-abbrev") debugOffset = symbol.fileOffset;
    if (symbol.id === "debug-info") debugInfoOffset = symbol.fileOffset;
    if (symbol.id === "debug-line") debugLineOffset = symbol.fileOffset;
    if (symbol.id === "debug-loc") debugLocOffset = symbol.fileOffset;
    if (symbol.id === "debug-ranges") debugRangesOffset = symbol.fileOffset;
    if (symbol.id === "eh-frame") ehFrameOffset = symbol.fileOffset;
    if (symbol.id === "unwind-info") unwindInfoOffset = symbol.fileOffset;
  }
  if (
    hasUnwind &&
    (ehFrameOffset !== ehFrameAddress || unwindInfoOffset !== unwindInfoAddress)
  )
    return { ok: false, error: "LAYOUT_FAILED" };
  const textSize = hasData
    ? dataStart
    : hasDebug
      ? debugOffset
      : linkeditOffset;
  const importSlots: { readonly name: string; readonly fileOffset: number }[] =
    [];
  for (let index = 0; index < imports.length; index++) {
    const name = imports[index];
    if (name === undefined) throw "Mach-O import invariant";
    importSlots.push({ name, fileOffset: dataStart + index * 8 });
  }
  const prefix = linked.value.bytes,
    signatureOffset = prefix.length;
  for (let i = 0; i < dataSymbols.length; i++) {
    const symbol = dataSymbols[i];
    if (symbol === undefined || dataFileOffset === undefined)
      throw "data symbol invariant";
    put64(
      prefix,
      symbolOffset + (codeSymbols.length + i) * 16 + 8,
      dataFileOffset + symbol.offset,
      1,
    );
  }
  const sigSize = signatureSize(
    signatureOffset,
    request.identifier,
    specialBlobs,
  );
  if (!sigSize.ok) return { ok: false, error: "SIGNING_FAILED" };
  if (sigSize.value > request.maxByteLength - signatureOffset)
    return { ok: false, error: "SIZE_LIMIT" };
  const fileSize = signatureOffset + sigSize.value,
    linkeditSize = fileSize - linkeditOffset;
  const linkeditVM = alignUp(linkeditSize, PAGE);
  if (!linkeditVM.ok || linkeditVM.value > 0xffffffff)
    return { ok: false, error: "SIZE_LIMIT" };
  put32(prefix, 0, 0xfeedfacf);
  put32(prefix, 4, 0x100000c);
  put32(prefix, 8, 0);
  put32(prefix, 12, 2);
  put32(
    prefix,
    16,
    (hasData ? 11 : 10) + (hasSymbols ? 1 : 0) + (hasDebug ? 1 : 0),
  );
  put32(prefix, 20, headerSize - 32);
  put32(prefix, 24, 0x200085);
  let o = 32;
  segment(prefix, o, "__PAGEZERO", 0, 0, 0, 1, 0, 0, 0, 0);
  o += 72;
  const textSections = (hasUnwind ? 3 : 1) + tail.length;
  segment(prefix, o, "__TEXT", 0, 1, textSize, 0, 0, textSize, 5, textSections);
  const section = o + 72;
  name(prefix, section, "__text");
  name(prefix, section + 16, "__TEXT");
  put64(prefix, section + 32, codeOffset, 1);
  put64(prefix, section + 40, instructionEnd);
  put32(prefix, section + 48, codeOffset);
  put32(prefix, section + 52, 2);
  put32(prefix, section + 64, 0x80000400);
  for (let index = 0; index < tail.length; index++) {
    const item = tail[index],
      at = section + 80 + index * 80;
    if (item === undefined) throw "Mach-O text section invariant";
    name(prefix, at, item.name);
    name(prefix, at + 16, "__TEXT");
    put64(prefix, at + 32, codeOffset + item.offset, 1);
    put64(prefix, at + 40, item.byteLength);
    put32(prefix, at + 48, codeOffset + item.offset);
    // S_CSTRING_LITERALS for C strings; regular read-only data otherwise.
    put32(prefix, at + 64, item.name === "__cstring" ? 2 : 0);
  }
  if (hasUnwind) {
    const frames = section + 80 + tail.length * 80;
    name(prefix, frames, "__eh_frame");
    name(prefix, frames + 16, "__TEXT");
    put64(prefix, frames + 32, ehFrameOffset, 1);
    put64(prefix, frames + 40, unwind.ehFrame.length);
    put32(prefix, frames + 48, ehFrameOffset);
    put32(prefix, frames + 52, 3);
    // S_COALESCED | S_ATTR_NO_TOC | S_ATTR_STRIP_STATIC_SYMS | S_ATTR_LIVE_SUPPORT
    put32(prefix, frames + 64, 0x6800000b);
    const info = frames + 80;
    name(prefix, info, "__unwind_info");
    name(prefix, info + 16, "__TEXT");
    put64(prefix, info + 32, unwindInfoOffset, 1);
    put64(prefix, info + 40, unwind.unwindInfo.length);
    put32(prefix, info + 48, unwindInfoOffset);
    put32(prefix, info + 52, 2);
  }
  o += 72 + textSections * 80;
  if (hasData) {
    const size = (hasDebug ? debugOffset : linkeditOffset) - dataStart;
    segment(prefix, o, "__DATA", dataStart, 1, size, 0, dataStart, size, 3, 1);
    const section = o + 72;
    name(prefix, section, "__data");
    name(prefix, section + 16, "__DATA");
    put64(prefix, section + 32, dataStart, 1);
    if (dataFileOffset === undefined) throw "Mach-O data placement invariant";
    put64(prefix, section + 40, dataFileOffset + data.length - dataStart);
    put32(prefix, section + 48, dataStart);
    put32(prefix, section + 52, 4);
    o += 152;
  }
  if (hasDebug) {
    const size = linkeditOffset - debugOffset;
    segment(
      prefix,
      o,
      "__DWARF",
      debugOffset,
      1,
      size,
      0,
      debugOffset,
      size,
      1,
      5,
    );
    const sections = [
      {
        name: "__debug_abbrev",
        offset: debugOffset,
        length: debugAbbrev.length,
      },
      {
        name: "__debug_info",
        offset: debugInfoOffset,
        length: debugInfo.length,
      },
      {
        name: "__debug_line",
        offset: debugLineOffset,
        length: debugLine.length,
      },
      { name: "__debug_loc", offset: debugLocOffset, length: debugLoc.length },
      {
        name: "__debug_ranges",
        offset: debugRangesOffset,
        length: debugRanges.length,
      },
    ];
    for (let i = 0; i < sections.length; i++) {
      const item = sections[i];
      if (item === undefined) throw "debug section invariant";
      const at = o + 72 + i * 80;
      name(prefix, at, item.name);
      name(prefix, at + 16, "__DWARF");
      put64(prefix, at + 32, item.offset, 1);
      put64(prefix, at + 40, item.length);
      put32(prefix, at + 48, item.offset);
      put32(prefix, at + 64, 0x02000000);
    }
    o += 472;
  }
  segment(
    prefix,
    o,
    "__LINKEDIT",
    linkeditOffset,
    1,
    linkeditVM.value,
    0,
    linkeditOffset,
    linkeditSize,
    1,
    0,
  );
  o += 72;
  command(prefix, o, 0xe, 32);
  put32(prefix, o + 8, 12);
  name(prefix, o + 12, "/usr/lib/dyld");
  o += 32;
  command(prefix, o, 0xc, 56);
  put32(prefix, o + 8, 24);
  put32(prefix, o + 16, 0x10000);
  put32(prefix, o + 20, 0x10000);
  name(prefix, o + 24, "/usr/lib/libSystem.B.dylib");
  o += 56;
  command(prefix, o, 0x80000028, 24);
  put64(prefix, o + 8, entryOffset);
  o += 24;
  command(prefix, o, 0x32, 24);
  put32(prefix, o + 8, 1);
  put32(prefix, o + 12, minimumOS);
  put32(prefix, o + 16, sdk);
  o += 24;
  command(prefix, o, 0x80000034, 16);
  put32(prefix, o + 8, linkeditOffset);
  put32(prefix, o + 12, chains.length);
  o += 16;
  command(prefix, o, 0x1d, 16);
  put32(prefix, o + 8, signatureOffset);
  put32(prefix, o + 12, sigSize.value);
  o += 16;
  command(prefix, o, 0x1b, 24);
  const uuidOffset = o + 8;
  o += 24;
  if (hasSymbols) {
    command(prefix, o, 2, 24);
    put32(prefix, o + 8, symbolOffset);
    put32(prefix, o + 12, codeSymbols.length + dataSymbols.length);
    put32(prefix, o + 16, symbolOffset + recordBytes);
    put32(prefix, o + 20, stringBytes);
    o += 24;
  }
  if (o !== headerSize || codeOffset !== expectedCodeOffset)
    throw "Mach-O header layout invariant";
  const patchSites = new Set<number>();
  const references = request.addressFixups ?? [];
  const patch = request.patchAddress;
  if (references.length > 0 && patch === undefined)
    return { ok: false, error: "INVALID_REFERENCE" };
  for (
    let referenceIndex = 0;
    referenceIndex < references.length;
    referenceIndex++
  ) {
    const reference = references[referenceIndex];
    if (reference === undefined)
      return { ok: false, error: "INVALID_REFERENCE" };
    if (
      !uint(reference.byteLength, request.code.length) ||
      reference.byteLength === 0 ||
      !uint(reference.alignment, request.code.length) ||
      reference.alignment === 0 ||
      (reference.alignment & (reference.alignment - 1)) !== 0 ||
      !uint(reference.offset, request.code.length - reference.byteLength) ||
      reference.offset % reference.alignment !== 0 ||
      patchSites.has(reference.offset)
    )
      return { ok: false, error: "INVALID_REFERENCE" };
    patchSites.add(reference.offset);
    let targetOffset: number | undefined;
    const target = reference.target;
    if (target.kind === "data") {
      const dataOffset = dataFileOffset;
      if (dataOffset === undefined || !uint(target.offset, data.length))
        return { ok: false, error: "INVALID_REFERENCE" };
      targetOffset = dataOffset + target.offset;
    } else if (target.kind === "import") {
      for (const slot of importSlots)
        if (slot !== undefined && slot.name === target.name)
          targetOffset = slot.fileOffset;
    }
    if (targetOffset === undefined)
      return { ok: false, error: "INVALID_REFERENCE" };
    if (patch === undefined) throw "image relocation patcher invariant";
    const status = patch(
      prefix,
      referenceIndex,
      codeOffset + reference.offset,
      targetOffset,
    );
    if (status !== "complete")
      return {
        ok: false,
        error:
          status === "range" ? "ADDRESS_OUT_OF_RANGE" : "INVALID_REFERENCE",
      };
  }
  // Hash the finalized unsigned image with its UUID field zero, plus its identity.
  const identity = new Uint8Array(prefix.length + request.identifier.length);
  identity.set(prefix);
  name(identity, prefix.length, request.identifier);
  const uuid = sha256(identity).subarray(0, 16);
  uuid[6] = ((uuid[6] ?? 0) & 0x0f) | 0x80;
  uuid[8] = ((uuid[8] ?? 0) & 0x3f) | 0x80;
  prefix.set(uuid, uuidOffset);
  const signed = signCode(prefix, {
    identifier: request.identifier,
    executableOffset: 0,
    executableLength: textSize,
    mainExecutable: true,
    specialBlobs,
  });
  if (!signed.ok || signed.value.length !== sigSize.value)
    return { ok: false, error: "SIGNING_FAILED" };
  const bytes = new Uint8Array(fileSize);
  bytes.set(prefix);
  bytes.set(signed.value, signatureOffset);
  return {
    ok: true,
    value: {
      bytes,
      dataFileOffset,
      importSlots,
      codeFileOffset: codeOffset,
      entryFileOffset: entryOffset,
      signatureFileOffset: signatureOffset,
    },
  };
}
