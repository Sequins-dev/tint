import { runtimeEntitlements } from "./runtime-entitlements.ts";
import { buildDebugInfo } from "../../dwarf.ts";
import type {
  ExecutableImageRequest,
  ImageSymbol,
  ReadOnlySectionKind,
} from "../../executable.ts";
import { buildImportFixups, type Import } from "../dyld-fixups.ts";
import {
  alignUp,
  writeUnsigned,
  writeWord64,
} from "@tint/foundation/binary/bytes";
import { sha256 } from "@tint/foundation/binary/sha256";
import {
  createSha256Stream,
  updateSha256Stream,
  finishSha256Stream,
} from "@tint/foundation/binary/sha256-stream";
import {
  contiguousCodeOutput,
  type CodeOutput,
  type ImageAddressPatcher,
} from "@tint/abi/relocation";
import {
  planLayout,
  type Fragment,
  type SymbolDefinition,
} from "../../layout.ts";
import { signatureSize, signCode } from "../signature.ts";
import { buildUnwindSections } from "./compact-unwind.ts";
import {
  loaderEntryDelta,
  loaderTableDelta,
  signatureLoader,
} from "./signature-loader.ts";
/** A Mach-O `major.minor.patch` version (LC_BUILD_VERSION). */
export interface PlatformVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}
export type CodeSymbol = ImageSymbol;
/** The Mach-O version words of one library's load command. */
export interface MachODylibVersion {
  /** The install name of an ExecutableImageRequest `libraries` entry. */
  readonly name: string;
  /** `xxxx.yy.zz` version words (compatibility is checked by dyld). */
  readonly currentVersion: number;
  readonly compatibilityVersion: number;
}
/** Mach-O's own facts about an executable: the code-signing identifier,
 * the deployment target and SDK, and library version words. */
export interface MachOLayoutOptions {
  /** Lower the compact VM ceiling for tests. */
  readonly compactVMLimit?: number | undefined;
  /** Page-aligned signing unit for the large layout. */
  readonly signedChunkBytes?: number | undefined;
}

export interface MachOImageOptions extends MachOLayoutOptions {
  readonly identifier: string;
  readonly minimumOS: PlatformVersion;
  readonly sdk: PlatformVersion;
  /** One entry per `libraries` entry. */
  readonly dylibVersions?: readonly MachODylibVersion[];
}
/** The format-neutral request with Mach-O's options. Libraries beyond
 * libSystem (ordinal 1) become load commands from ordinal 2; a weak library
 * is an LC_LOAD_WEAK_DYLIB whose imports are weak. Read-only sections map
 * to `__TEXT,__cstring` and `__TEXT,__const`; `data` is `__DATA,__data`. */
export interface ExecutableRequest
  extends ExecutableImageRequest, MachOImageOptions {}
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
  | "LARGE_METADATA_LIMIT"
  | "LARGE_SECTION_LIMIT"
  | "LAYOUT_FAILED"
  | "SIGNING_FAILED";
export type MachOResult =
  | { readonly ok: true; readonly value: ExecutableImage }
  | { readonly ok: false; readonly error: MachOError };
const PAGE = 16384;
const UINT32_MAX = 0xffffffff;
// XNU can slide a 16 KiB-page arm64 image by two 32 MiB sections plus
// almost 16 MiB. Leave 128 MiB for the slide and the main stack.
const COMPACT_VM_LIMIT = 0x78000000;
const LARGE_BASE_HIGH = 3;
const CHUNK_BYTES = 0x40000000;

interface CodeChunk {
  readonly offset: number;
  readonly length: number;
  readonly vmLength: number;
  readonly sections: number;
  readonly firstSection: number;
  fileOffset: number;
  signatureLength: number;
}

/** Translate logical code offsets to final file offsets. Only windows
 * crossing a signing boundary need scratch storage. */
function chunkedCodeOutput(
  bytes: Uint8Array,
  chunks: readonly CodeChunk[],
  chunkBytes: number,
): CodeOutput {
  function write(source: Uint8Array, offset: number): void {
    let pos = offset;
    const end = offset + source.length;
    while (pos < end) {
      const chunk = chunks[Math.floor(pos / chunkBytes)];
      if (chunk === undefined) throw "Mach-O code placement invariant";
      const next = Math.min(end, chunk.offset + chunk.length);
      if (next <= pos) throw "Mach-O code extent invariant";
      bytes.set(
        pos === offset && next === end
          ? source
          : source.subarray(pos - offset, next - offset),
        chunk.fileOffset + pos - chunk.offset,
      );
      pos = next;
    }
  }
  return {
    write,
    patch: (offset, byteLength, update) => {
      const first = chunks[Math.floor(offset / chunkBytes)];
      if (first === undefined) throw "Mach-O patch placement invariant";
      const end = offset + byteLength;
      if (end <= first.offset + first.length)
        return update(bytes, first.fileOffset + offset - first.offset);
      const window = new Uint8Array(byteLength);
      let pos = offset;
      while (pos < end) {
        const chunk = chunks[Math.floor(pos / chunkBytes)];
        if (chunk === undefined) throw "Mach-O patch chunk invariant";
        const next = Math.min(end, chunk.offset + chunk.length);
        if (next <= pos) throw "Mach-O patch extent invariant";
        const at = chunk.fileOffset + pos - chunk.offset;
        window.set(bytes.subarray(at, at + next - pos), pos - offset);
        pos = next;
      }
      const error = update(window, 0);
      if (error === undefined) write(window, offset);
      return error;
    },
  };
}

function putAddress(bytes: Uint8Array, at: number, address: number): void {
  const high = Math.floor(address / 0x100000000);
  put64(bytes, at, address - high * 0x100000000, high);
}
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
/** A dylib_command: 24 bytes, then the NUL-terminated name, padded to 8. */
function dylibCommandSize(installName: string): number {
  return 24 + Math.ceil((installName.length + 1) / 8) * 8;
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
  putAddress(b, o + 40, fileOffset);
  putAddress(b, o + 48, fileSize);
  put32(b, o + 56, prot);
  put32(b, o + 60, prot);
  put32(b, o + 64, sections);
}
/** The `__TEXT` section a read-only section kind becomes. */
function textSectionName(kind: ReadOnlySectionKind): string {
  return kind === "cstring" ? "__cstring" : "__const";
}
/** Minimal signed arm64 PIE containing a supplied position-independent Darwin main. */
export function buildExecutable(request: ExecutableRequest): MachOResult {
  return buildLayout(request, undefined);
}

function buildLayout(
  request: ExecutableRequest,
  largeCodeAddress: number | undefined,
): MachOResult {
  const large = largeCodeAddress !== undefined;
  const sharedEntry = request.sharedEntry;
  if (large && sharedEntry !== undefined)
    return { ok: false, error: "SIZE_LIMIT" };
  const baseHigh = sharedEntry !== undefined ? 0 : large ? LARGE_BASE_HIGH : 1;
  const base = baseHigh * 0x100000000;
  const compactLimit = request.compactVMLimit ?? COMPACT_VM_LIMIT;
  const chunkBytes = request.signedChunkBytes ?? CHUNK_BYTES;
  if (
    !uint(compactLimit, COMPACT_VM_LIMIT) ||
    compactLimit === 0 ||
    !uint(chunkBytes, UINT32_MAX) ||
    chunkBytes === 0 ||
    chunkBytes % PAGE !== 0
  )
    return { ok: false, error: "INVALID_LIMIT" };
  const codePlan = request.codePlan;
  if (request.code.length !== 0 && codePlan !== undefined)
    return { ok: false, error: "INVALID_CODE" };
  const code = request.code;
  const codeLength = codePlan?.byteLength ?? code.length;
  if (
    !uint(codeLength, Number.MAX_SAFE_INTEGER) ||
    codeLength === 0 ||
    codeLength % 4 !== 0
  )
    return { ok: false, error: "INVALID_CODE" };
  if (
    !uint(request.entryOffset, codeLength - 1) ||
    request.entryOffset % 4 !== 0
  )
    return { ok: false, error: "INVALID_ENTRY" };
  if (!uint(request.maxByteLength, Number.MAX_SAFE_INTEGER))
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
  const hasData = large || imports.length > 0 || data.length > 0;
  const codeSymbols = request.symbols ?? [],
    dataSymbols = request.dataSymbols ?? [];
  const hasSymbols = codeSymbols.length + dataSymbols.length > 0;
  const tail = request.readOnlySections ?? [];
  let instructionEnd = codeLength;
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
  const debugRequest = request.debug;
  const hasDebug = debugRequest !== undefined;
  const unwindRanges = request.unwind ?? [];
  const hasUnwind = unwindRanges.length > 0;
  const unwindSections = hasUnwind ? (large ? 1 : 2) : 0;
  const chunks: CodeChunk[] = [];
  let sectionCount =
    1 + unwindSections + (hasData ? 1 : 0) + (hasDebug ? 5 : 0);
  let chunkCommands = 0;
  if (large) {
    for (let offset = 0; offset < codeLength; offset += chunkBytes) {
      const length = Math.min(chunkBytes, codeLength - offset);
      const end = offset + length;
      let sections = offset < instructionEnd ? 1 : 0;
      for (const part of tail) {
        if (
          part !== undefined &&
          part.offset < end &&
          part.offset + part.byteLength > offset
        )
          sections++;
      }
      chunks.push({
        offset,
        length,
        vmLength: Math.ceil(length / PAGE) * PAGE,
        sections,
        firstSection: sectionCount + 1,
        fileOffset: 0,
        signatureLength: 0,
      });
      sectionCount += sections;
      chunkCommands += 72 + sections * 80;
      if (sectionCount > 255 || chunks.length > 250)
        return { ok: false, error: "LARGE_SECTION_LIMIT" };
    }
  }
  let unwindEnd = 0;
  for (const range of unwindRanges) {
    if (
      range === undefined ||
      !uint(range.offset, codeLength - 1) ||
      range.offset % 4 !== 0 ||
      !uint(range.byteLength, codeLength - range.offset) ||
      range.offset < unwindEnd
    )
      return { ok: false, error: "INVALID_UNWIND" };
    unwindEnd = range.offset + range.byteLength;
  }
  const dylibs = request.libraries ?? [],
    dylibVersions = request.dylibVersions ?? [],
    versions: MachODylibVersion[] = [];
  const ordinals = new Map<string, number>(),
    weakImports = new Set<string>(),
    installNames = new Set<string>();
  let dylibBytes = 0;
  for (let index = 0; index < dylibs.length; index++) {
    const dylib = dylibs[index];
    if (dylib === undefined) return { ok: false, error: "INVALID_IMPORT" };
    const installName = dylib.name,
      version = dylibVersions.find(
        (item) => item !== undefined && item.name === installName,
      );
    if (
      version === undefined ||
      installName.length === 0 ||
      installNames.has(installName) ||
      !uint(version.currentVersion, 0xffffffff) ||
      !uint(version.compatibilityVersion, 0xffffffff) ||
      index + 2 > 240
    )
      return { ok: false, error: "INVALID_IMPORT" };
    for (let i = 0; i < installName.length; i++) {
      const c = installName.charCodeAt(i);
      if (c < 32 || c > 126) return { ok: false, error: "INVALID_IMPORT" };
    }
    installNames.add(installName);
    versions.push(version);
    for (const symbol of dylib.symbols) {
      if (
        symbol === undefined ||
        ordinals.has(symbol) ||
        !imports.includes(symbol)
      )
        return { ok: false, error: "INVALID_IMPORT" };
      ordinals.set(symbol, index + 2);
      if (dylib.weak || (dylib.weakSymbols ?? []).includes(symbol))
        weakImports.add(symbol);
    }
    dylibBytes += dylibCommandSize(installName);
  }
  const installName =
    sharedEntry === undefined ? "" : request.identifier + ".dylib";
  const libraryCommand =
    sharedEntry === undefined ? 0 : dylibCommandSize(installName);
  const headerSize =
    HEADER_SIZE +
    (libraryCommand === 0 ? 0 : libraryCommand - 112) +
    dylibBytes +
    (large ? chunkCommands : tail.length * 80) +
    (hasData ? 152 : 0) +
    (hasSymbols ? 24 : 0) +
    (hasDebug ? 472 : 0) +
    unwindSections * 80;
  // Code starts on a 4 KiB boundary: generated modules address their data
  // page-relatively (ADRP+ADD), which needs offsets congruent to addresses.
  const expectedCodeOffset = Math.ceil(headerSize / 4096) * 4096;
  if (!large && expectedCodeOffset + codeLength >= compactLimit)
    return buildLayout(request, 0);
  const codeAddress = largeCodeAddress ?? expectedCodeOffset;
  let exports: Uint8Array = new Uint8Array(0);
  if (sharedEntry !== undefined) {
    if (
      !uint(sharedEntry.offset, instructionEnd - 1) ||
      sharedEntry.offset % 4 !== 0
    )
      return { ok: false, error: "INVALID_SYMBOL" };
    const encoded = exportEntry(
      sharedEntry.name,
      codeAddress + sharedEntry.offset,
    );
    if (encoded === undefined) return { ok: false, error: "INVALID_SYMBOL" };
    exports = encoded;
  }
  const textCode = large ? signatureLoader() : code;
  const textCodeLength = large ? textCode.length : codeLength;
  const metadataLimit = Math.min(
    request.maxByteLength,
    large ? UINT32_MAX : compactLimit,
  );
  let debugAbbrev: Uint8Array = new Uint8Array(0),
    debugInfo: Uint8Array = new Uint8Array(0),
    debugLine: Uint8Array = new Uint8Array(0),
    debugLoc: Uint8Array = new Uint8Array(0),
    debugRanges: Uint8Array = new Uint8Array(0);
  if (debugRequest !== undefined) {
    const debug = buildDebugInfo({
      ...debugRequest,
      codeAddress: base + codeAddress,
      codeLength,
      maxByteLength: Math.min(request.maxByteLength, UINT32_MAX),
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
  if (
    hasSymbols &&
    recordBytes + stringBytes > Math.min(request.maxByteLength, UINT32_MAX)
  )
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
    const chunk =
      large && code
        ? chunks[Math.floor(symbol.offset / chunkBytes)]
        : undefined;
    symbolBytes[i * 16 + 5] = code
      ? (chunk?.firstSection ?? 1)
      : 2 + (large ? 0 : tail.length) + unwindSections;
    if (code)
      putAddress(symbolBytes, i * 16 + 8, base + codeAddress + symbol.offset);
    symbolBytes.set(encoded, recordBytes + stringOffset);
    stringOffset += encoded.length + 1;
  }
  // Unwind sections follow the code in __TEXT: __eh_frame (its FDEs address
  // code pc-relatively, so its placement is fixed here) then __unwind_info.
  const ehFrameAddress =
    Math.ceil((expectedCodeOffset + textCodeLength) / 8) * 8;
  const unwind = hasUnwind
    ? buildUnwindSections(unwindRanges, codeAddress, ehFrameAddress, large)
    : { ehFrame: new Uint8Array(0), unwindInfo: new Uint8Array(0) };
  const unwindInfoAddress =
    Math.ceil((ehFrameAddress + unwind.ehFrame.length) / 4) * 4;
  const textEnd = hasUnwind
    ? unwindInfoAddress + unwind.unwindInfo.length
    : expectedCodeOffset + textCodeLength;
  const dataStart = Math.ceil(textEnd / PAGE) * PAGE;
  if (large && dataStart > UINT32_MAX)
    return { ok: false, error: "LARGE_METADATA_LIMIT" };
  if (!large && dataStart >= compactLimit) return buildLayout(request, 0);
  const bindings: Import[] = [];
  for (const name of imports) {
    if (name === undefined) return { ok: false, error: "INVALID_IMPORT" };
    bindings.push({
      name,
      libraryOrdinal: ordinals.get(name) ?? 1,
      weak: weakImports.has(name),
    });
  }
  const built = buildImportFixups({
    imports: bindings,
    segmentOffset: hasData ? dataStart : 0,
    segmentIndex: hasData ? (sharedEntry === undefined ? 2 : 1) : 0,
    segmentCount:
      (hasData ? 4 : 3) -
      (sharedEntry === undefined ? 0 : 1) +
      (hasDebug ? 1 : 0) +
      chunks.length,
    maxByteLength: Math.min(request.maxByteLength, UINT32_MAX),
  });
  if (!built.ok)
    return {
      ok: false,
      error: built.error === "SIZE_LIMIT" ? "SIZE_LIMIT" : "INVALID_IMPORT",
    };
  const slots = built.value.slots,
    chains = built.value.metadata;
  let linkedit = chains;
  if (sharedEntry !== undefined) {
    linkedit = new Uint8Array(chains.length + exports.length);
    linkedit.set(chains);
    linkedit.set(exports, chains.length);
  }
  const fragments: Fragment[] = [
    {
      id: "headers",
      order: 0,
      alignment: 1,
      bytes: new Uint8Array(headerSize),
    },
    // Page-aligned so code offsets agree with loaded addresses modulo 4 KiB
    // (modules use page-relative ADRP+ADD addressing).
    {
      id: "code",
      order: 1,
      alignment: 4096,
      bytes: textCode,
      byteLength: textCodeLength,
    },
    { id: "chains", order: 12, alignment: PAGE, bytes: linkedit },
    { id: "symbol-table", order: 13, alignment: 8, bytes: symbolBytes },
    { id: "signature", order: 14, alignment: 16, bytes: new Uint8Array(0) },
  ];
  const symbols: SymbolDefinition[] = [
    { id: "code", fragment: "code", offset: 0 },
    { id: "entry", fragment: "code", offset: large ? 0 : request.entryOffset },
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
  if (large) {
    fragments.push({
      id: "chunk-table",
      order: 6,
      alignment: 8,
      bytes: new Uint8Array(8 + chunks.length * 24),
    });
    symbols.push({ id: "chunk-table", fragment: "chunk-table", offset: 0 });
  }
  if (hasDebug) {
    fragments.push({
      id: "debug-abbrev",
      order: 7,
      alignment: PAGE,
      bytes: debugAbbrev,
    });
    fragments.push({
      id: "debug-info",
      order: 8,
      alignment: 1,
      bytes: debugInfo,
    });
    fragments.push({
      id: "debug-line",
      order: 9,
      alignment: 1,
      bytes: debugLine,
    });
    fragments.push({
      id: "debug-loc",
      order: 10,
      alignment: 1,
      bytes: debugLoc,
    });
    fragments.push({
      id: "debug-ranges",
      order: 11,
      alignment: 1,
      bytes: debugRanges,
    });
    symbols.push({ id: "debug-abbrev", fragment: "debug-abbrev", offset: 0 });
    symbols.push({ id: "debug-info", fragment: "debug-info", offset: 0 });
    symbols.push({ id: "debug-line", fragment: "debug-line", offset: 0 });
    symbols.push({ id: "debug-loc", fragment: "debug-loc", offset: 0 });
    symbols.push({ id: "debug-ranges", fragment: "debug-ranges", offset: 0 });
  }
  const linked = planLayout({
    fragments,
    symbols,
    fixups: [],
    virtualBase: { lo: 0, hi: baseHigh },
    maxByteLength: metadataLimit,
  });
  if (!linked.ok) {
    if (
      !large &&
      linked.error.code === "SIZE_LIMIT" &&
      metadataLimit === compactLimit
    )
      return buildLayout(request, 0);
    if (
      large &&
      linked.error.code === "SIZE_LIMIT" &&
      metadataLimit === UINT32_MAX
    )
      return { ok: false, error: "LARGE_METADATA_LIMIT" };
    return {
      ok: false,
      error:
        linked.error.code === "SIZE_LIMIT" ? "SIZE_LIMIT" : "LAYOUT_FAILED",
    };
  }
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
    tableOffset = 0,
    dataFileOffset: number | undefined;
  for (const symbol of linked.value.symbols) {
    if (symbol === undefined) return { ok: false, error: "LAYOUT_FAILED" };
    if (symbol.id === "code") codeOffset = symbol.fileOffset;
    if (symbol.id === "entry") entryOffset = symbol.fileOffset;
    if (symbol.id === "chains") linkeditOffset = symbol.fileOffset;
    if (symbol.id === "symbol-table") symbolOffset = symbol.fileOffset;
    if (symbol.id === "data") dataFileOffset = symbol.fileOffset;
    if (symbol.id === "chunk-table") tableOffset = symbol.fileOffset;
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
  const signatureOffset = linked.value.byteLength;
  const sigSize = signatureSize(
    signatureOffset,
    request.identifier,
    specialBlobs,
  );
  if (!sigSize.ok) return { ok: false, error: "SIGNING_FAILED" };
  if (sigSize.value > request.maxByteLength - signatureOffset)
    return { ok: false, error: "SIZE_LIMIT" };
  const prefixEnd = signatureOffset + sigSize.value,
    linkeditSize = prefixEnd - linkeditOffset;
  const prefixVMEnd = Math.ceil(prefixEnd / PAGE) * PAGE;
  if (!large && prefixVMEnd >= compactLimit) return buildLayout(request, 0);
  if (large && prefixVMEnd > UINT32_MAX)
    return { ok: false, error: "LARGE_METADATA_LIMIT" };
  if (large && codeAddress !== prefixVMEnd) {
    if (codeAddress !== 0) throw "Mach-O large metadata size invariant";
    return buildLayout(request, prefixVMEnd);
  }
  let fileSize = prefixEnd;
  for (const chunk of chunks) {
    if (chunk === undefined) throw "Mach-O chunk invariant";
    const size = signatureSize(chunk.vmLength, request.identifier);
    if (!size.ok) return { ok: false, error: "SIGNING_FAILED" };
    chunk.fileOffset = Math.ceil(fileSize / PAGE) * PAGE;
    chunk.signatureLength = size.value;
    fileSize = chunk.fileOffset + chunk.vmLength + size.value;
    if (fileSize > request.maxByteLength)
      return { ok: false, error: "SIZE_LIMIT" };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(fileSize);
  } catch {
    return { ok: false, error: "LAYOUT_FAILED" };
  }
  linked.value.write(bytes);
  const prefix = bytes.subarray(0, signatureOffset);
  for (let i = 0; i < dataSymbols.length; i++) {
    const symbol = dataSymbols[i];
    if (symbol === undefined || dataFileOffset === undefined)
      throw "data symbol invariant";
    put64(
      prefix,
      symbolOffset + (codeSymbols.length + i) * 16 + 8,
      dataFileOffset + symbol.offset,
      baseHigh,
    );
  }
  if (large) {
    put64(prefix, tableOffset, chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk === undefined) throw "Mach-O chunk invariant";
      const at = tableOffset + 8 + i * 24;
      putAddress(prefix, at, chunk.fileOffset);
      putAddress(prefix, at + 8, chunk.vmLength);
      putAddress(prefix, at + 16, chunk.signatureLength);
    }
    const table = codeOffset + loaderTableDelta;
    const entry = codeOffset + loaderEntryDelta;
    putAddress(prefix, table, tableOffset - table);
    putAddress(prefix, entry, codeAddress + request.entryOffset - entry);
  }
  const linkeditVM = alignUp(linkeditSize, PAGE);
  if (!linkeditVM.ok || linkeditVM.value > 0xffffffff)
    return { ok: false, error: "SIZE_LIMIT" };
  put32(prefix, 0, 0xfeedfacf);
  put32(prefix, 4, 0x100000c);
  put32(prefix, 8, 0);
  put32(prefix, 12, sharedEntry === undefined ? 2 : 6);
  put32(
    prefix,
    16,
    (hasData ? 11 : 10) -
      (sharedEntry === undefined ? 0 : 1) +
      (hasSymbols ? 1 : 0) +
      (hasDebug ? 1 : 0) +
      dylibs.length +
      chunks.length,
  );
  put32(prefix, 20, headerSize - 32);
  put32(prefix, 24, sharedEntry === undefined ? 0x200085 : 0x85);
  let o = 32;
  if (sharedEntry === undefined) {
    segment(prefix, o, "__PAGEZERO", 0, 0, 0, 1, 0, 0, 0, 0);
    o += 72;
  }
  const textSections = 1 + unwindSections + (large ? 0 : tail.length);
  segment(
    prefix,
    o,
    "__TEXT",
    0,
    baseHigh,
    textSize,
    0,
    0,
    textSize,
    5,
    textSections,
  );
  const section = o + 72;
  name(prefix, section, "__text");
  name(prefix, section + 16, "__TEXT");
  put64(prefix, section + 32, codeOffset, baseHigh);
  put64(prefix, section + 40, large ? loaderTableDelta : instructionEnd);
  put32(prefix, section + 48, codeOffset);
  put32(prefix, section + 52, 2);
  put32(prefix, section + 64, 0x80000400);
  for (let index = 0; !large && index < tail.length; index++) {
    const item = tail[index],
      at = section + 80 + index * 80;
    if (item === undefined) throw "Mach-O text section invariant";
    name(prefix, at, textSectionName(item.kind));
    name(prefix, at + 16, "__TEXT");
    put64(prefix, at + 32, codeOffset + item.offset, baseHigh);
    put64(prefix, at + 40, item.byteLength);
    put32(prefix, at + 48, codeOffset + item.offset);
    // S_CSTRING_LITERALS for C strings; regular read-only data otherwise.
    put32(prefix, at + 64, item.kind === "cstring" ? 2 : 0);
  }
  if (hasUnwind) {
    const frames = section + 80 + (large ? 0 : tail.length * 80);
    name(prefix, frames, "__eh_frame");
    name(prefix, frames + 16, "__TEXT");
    put64(prefix, frames + 32, ehFrameOffset, baseHigh);
    put64(prefix, frames + 40, unwind.ehFrame.length);
    put32(prefix, frames + 48, ehFrameOffset);
    put32(prefix, frames + 52, 3);
    // dyld's unwind-section lookup requires __TEXT,__eh_frame, even when
    // the described PC ranges live in other executable segments.
    // S_COALESCED | S_ATTR_NO_TOC | S_ATTR_STRIP_STATIC_SYMS | S_ATTR_LIVE_SUPPORT
    put32(prefix, frames + 64, 0x6800000b);
    if (!large) {
      const info = frames + 80;
      name(prefix, info, "__unwind_info");
      name(prefix, info + 16, "__TEXT");
      put64(prefix, info + 32, unwindInfoOffset, baseHigh);
      put64(prefix, info + 40, unwind.unwindInfo.length);
      put32(prefix, info + 48, unwindInfoOffset);
      put32(prefix, info + 52, 2);
    }
  }
  o += 72 + textSections * 80;
  if (hasData) {
    const size = (hasDebug ? debugOffset : linkeditOffset) - dataStart;
    segment(
      prefix,
      o,
      "__DATA",
      dataStart,
      baseHigh,
      size,
      0,
      dataStart,
      size,
      3,
      1,
    );
    const section = o + 72;
    name(prefix, section, "__data");
    name(prefix, section + 16, "__DATA");
    put64(prefix, section + 32, dataStart, baseHigh);
    if (dataFileOffset === undefined) throw "Mach-O data placement invariant";
    put64(
      prefix,
      section + 40,
      (large
        ? tableOffset + 8 + chunks.length * 24
        : dataFileOffset + data.length) - dataStart,
    );
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
      baseHigh,
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
      put64(prefix, at + 32, item.offset, baseHigh);
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
    baseHigh,
    linkeditVM.value,
    0,
    linkeditOffset,
    linkeditSize,
    1,
    0,
  );
  o += 72;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (chunk === undefined) throw "Mach-O chunk invariant";
    const label = "__TEXT_" + String(index + 1);
    const address = base + codeAddress + chunk.offset;
    segment(
      prefix,
      o,
      label,
      address % 0x100000000,
      Math.floor(address / 0x100000000),
      chunk.vmLength,
      0,
      chunk.fileOffset,
      chunk.vmLength,
      5,
      chunk.sections,
    );
    o += 72;
    if (chunk.offset < instructionEnd) {
      name(prefix, o, "__text");
      name(prefix, o + 16, label);
      putAddress(prefix, o + 32, address);
      put64(
        prefix,
        o + 40,
        Math.min(chunk.length, instructionEnd - chunk.offset),
      );
      put32(prefix, o + 52, 2);
      put32(prefix, o + 64, 0x80000400);
      o += 80;
    }
    for (const item of tail) {
      if (item === undefined) throw "Mach-O tail invariant";
      const start = Math.max(item.offset, chunk.offset);
      const end = Math.min(
        item.offset + item.byteLength,
        chunk.offset + chunk.length,
      );
      if (start >= end) continue;
      name(prefix, o, textSectionName(item.kind));
      name(prefix, o + 16, label);
      putAddress(prefix, o + 32, base + codeAddress + start);
      put64(prefix, o + 40, end - start);
      put32(prefix, o + 64, item.kind === "cstring" ? 2 : 0);
      o += 80;
    }
  }
  if (sharedEntry === undefined) {
    command(prefix, o, 0xe, 32);
    put32(prefix, o + 8, 12);
    name(prefix, o + 12, "/usr/lib/dyld");
    o += 32;
  } else {
    command(prefix, o, 0xd, libraryCommand);
    put32(prefix, o + 8, 24);
    name(prefix, o + 24, installName);
    o += libraryCommand;
  }
  command(prefix, o, 0xc, 56);
  put32(prefix, o + 8, 24);
  put32(prefix, o + 16, 0x10000);
  put32(prefix, o + 20, 0x10000);
  name(prefix, o + 24, "/usr/lib/libSystem.B.dylib");
  o += 56;
  for (let index = 0; index < dylibs.length; index++) {
    const dylib = dylibs[index],
      version = versions[index];
    if (dylib === undefined || version === undefined)
      throw "Mach-O dylib invariant";
    const size = dylibCommandSize(dylib.name);
    // LC_LOAD_WEAK_DYLIB (0x18 | LC_REQ_DYLD) or LC_LOAD_DYLIB.
    command(prefix, o, dylib.weak ? 0x80000018 : 0xc, size);
    put32(prefix, o + 8, 24);
    put32(prefix, o + 16, version.currentVersion);
    put32(prefix, o + 20, version.compatibilityVersion);
    name(prefix, o + 24, dylib.name);
    o += size;
  }
  if (sharedEntry === undefined) {
    command(prefix, o, 0x80000028, 24);
    put64(prefix, o + 8, entryOffset);
    o += 24;
  } else {
    command(prefix, o, 0x80000033, 16);
    put32(prefix, o + 8, linkeditOffset + chains.length);
    put32(prefix, o + 12, exports.length);
    o += 16;
  }
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
  const output = large
    ? chunkedCodeOutput(bytes, chunks, chunkBytes)
    : contiguousCodeOutput(bytes, codeOffset);
  if (codePlan !== undefined) {
    if (codePlan.write(output, 0) !== undefined)
      return { ok: false, error: "INVALID_CODE" };
  } else if (large) output.write(code, 0);
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
      !uint(reference.byteLength, codeLength) ||
      reference.byteLength === 0 ||
      !uint(reference.alignment, codeLength) ||
      reference.alignment === 0 ||
      (reference.alignment & (reference.alignment - 1)) !== 0 ||
      !uint(reference.offset, codeLength - reference.byteLength) ||
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
    const applyPatch: ImageAddressPatcher = patch;
    const destination: number = targetOffset;
    const status = large
      ? (output.patch(reference.offset, reference.byteLength, (window, at) => {
          const result = applyPatch(
            window,
            referenceIndex,
            at,
            destination,
            codeAddress + reference.offset,
          );
          return result === "complete" ? undefined : result;
        }) ?? "complete")
      : patch(
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
  // In the large layout the chunk signatures commit to the relocated code.
  const identity = createSha256Stream();
  updateSha256Stream(identity, prefix);
  const identifier = new Uint8Array(request.identifier.length);
  name(identifier, 0, request.identifier);
  updateSha256Stream(identity, identifier);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) throw "Mach-O chunk invariant";
    const end = chunk.fileOffset + chunk.vmLength;
    const signed = signCode(bytes.subarray(chunk.fileOffset, end), {
      identifier: request.identifier,
      executableOffset: 0,
      executableLength: chunk.vmLength,
      mainExecutable: false,
    });
    if (!signed.ok || signed.value.length !== chunk.signatureLength)
      return { ok: false, error: "SIGNING_FAILED" };
    bytes.set(signed.value, end);
    updateSha256Stream(identity, sha256(signed.value));
  }
  const uuid = finishSha256Stream(identity).subarray(0, 16);
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
  bytes.set(signed.value, signatureOffset);
  return {
    ok: true,
    value: {
      bytes,
      dataFileOffset,
      importSlots,
      codeFileOffset: chunks[0]?.fileOffset ?? codeOffset,
      entryFileOffset: entryOffset,
      signatureFileOffset: signatureOffset,
    },
  };
}

/** The dyld export trie for one ordinary function. The root has one edge to
 * a terminal with flags zero and its image-relative code address. */
function exportEntry(symbol: string, address: number): Uint8Array | undefined {
  const encoded = new TextEncoder().encode("_" + symbol);
  if (encoded.length >= 124 || symbol.length === 0 || symbol.includes("\0"))
    return undefined;
  // Flags plus up to eight ULEB128 bytes for an exact Number address.
  const terminal = new Uint8Array(9);
  let length = 1;
  let cursor = address;
  do {
    const low = cursor % 128;
    cursor = Math.floor(cursor / 128);
    terminal[length++] = low + (cursor === 0 ? 0 : 128);
  } while (cursor > 0);
  const child = encoded.length + 4;
  const bytes = new Uint8Array(child + 2 + length);
  bytes[1] = 1;
  bytes.set(encoded, 2);
  bytes[child - 1] = child;
  bytes[child] = length;
  bytes.set(terminal.subarray(0, length), child + 1);
  return bytes;
}
