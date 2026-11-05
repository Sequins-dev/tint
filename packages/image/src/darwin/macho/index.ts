import { runtimeEntitlements } from "./runtime-entitlements.ts";
import {
  buildDebugInfo,
  type LineRange,
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
      }
    | undefined;
  readonly symbols?: readonly CodeSymbol[];
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
  const codeSymbols = request.symbols ?? [];
  const hasSymbols = codeSymbols.length > 0;
  const debugRequest = request.debug;
  const hasDebug = debugRequest !== undefined;
  const headerSize =
    HEADER_SIZE +
    (hasData ? 152 : 0) +
    (hasSymbols ? 24 : 0) +
    (hasDebug ? 312 : 0);
  const expectedCodeOffset = Math.ceil(headerSize / 16) * 16;
  let debugAbbrev: Uint8Array = new Uint8Array(0),
    debugInfo: Uint8Array = new Uint8Array(0),
    debugLine: Uint8Array = new Uint8Array(0);
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
  }
  const symbolNames: Uint8Array[] = [];
  let stringBytes = 1;
  for (const symbol of codeSymbols) {
    if (
      symbol === undefined ||
      !uint(symbol.offset, request.code.length - 1) ||
      symbol.offset % 4 !== 0 ||
      symbol.name.length === 0 ||
      symbol.name.includes("\0")
    )
      return { ok: false, error: "INVALID_SYMBOL" };
    const encoded = new TextEncoder().encode(symbol.name);
    symbolNames.push(encoded);
    stringBytes += encoded.length + 1;
  }
  const recordBytes = codeSymbols.length * 16;
  if (hasSymbols && recordBytes + stringBytes > request.maxByteLength)
    return { ok: false, error: "SIZE_LIMIT" };
  const symbolBytes = new Uint8Array(
    hasSymbols ? recordBytes + stringBytes : 0,
  );
  let stringOffset = 1;
  for (let i = 0; i < codeSymbols.length; i++) {
    const symbol = codeSymbols[i],
      encoded = symbolNames[i];
    if (symbol === undefined || encoded === undefined) throw "symbol invariant";
    put32(symbolBytes, i * 16, stringOffset);
    symbolBytes[i * 16 + 4] = 0x0e;
    symbolBytes[i * 16 + 5] = 1;
    put64(symbolBytes, i * 16 + 8, expectedCodeOffset + symbol.offset, 1);
    symbolBytes.set(encoded, recordBytes + stringOffset);
    stringOffset += encoded.length + 1;
  }
  const dataStart =
    Math.ceil((expectedCodeOffset + request.code.length) / PAGE) * PAGE;
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
    { id: "code", order: 1, alignment: 16, bytes: request.code },
    { id: "chains", order: 7, alignment: PAGE, bytes: chains },
    { id: "symbol-table", order: 8, alignment: 8, bytes: symbolBytes },
    { id: "signature", order: 9, alignment: 16, bytes: new Uint8Array(0) },
  ];
  const symbols: SymbolDefinition[] = [
    { id: "code", fragment: "code", offset: 0 },
    { id: "entry", fragment: "code", offset: request.entryOffset },
    { id: "chains", fragment: "chains", offset: 0 },
    { id: "symbol-table", fragment: "symbol-table", offset: 0 },
  ];
  if (hasData) {
    fragments.push({ id: "slots", order: 2, alignment: PAGE, bytes: slots });
    fragments.push({ id: "data", order: 3, alignment: 16, bytes: data });
    symbols.push({ id: "data", fragment: "data", offset: 0 });
  }
  if (hasDebug) {
    fragments.push({
      id: "debug-abbrev",
      order: 4,
      alignment: PAGE,
      bytes: debugAbbrev,
    });
    fragments.push({
      id: "debug-info",
      order: 5,
      alignment: 1,
      bytes: debugInfo,
    });
    fragments.push({
      id: "debug-line",
      order: 6,
      alignment: 1,
      bytes: debugLine,
    });
    symbols.push({ id: "debug-abbrev", fragment: "debug-abbrev", offset: 0 });
    symbols.push({ id: "debug-info", fragment: "debug-info", offset: 0 });
    symbols.push({ id: "debug-line", fragment: "debug-line", offset: 0 });
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
  }
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
  segment(prefix, o, "__TEXT", 0, 1, textSize, 0, 0, textSize, 5, 1);
  const section = o + 72;
  name(prefix, section, "__text");
  name(prefix, section + 16, "__TEXT");
  put64(prefix, section + 32, codeOffset, 1);
  put64(prefix, section + 40, request.code.length);
  put32(prefix, section + 48, codeOffset);
  put32(prefix, section + 52, 2);
  put32(prefix, section + 64, 0x80000400);
  o += 152;
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
      3,
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
    o += 312;
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
    put32(prefix, o + 12, codeSymbols.length);
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
