import { writeUnsigned, writeWord64 } from "@tint/foundation/binary/bytes";
import {
  jitObjectParts,
  type JitObjectRequest,
  type JitObjectResult,
} from "../../jit-object.ts";

function put32(bytes: Uint8Array, offset: number, value: number): void {
  if (!writeUnsigned(bytes, offset, 4, value, "little").ok)
    throw "JIT object u32 invariant";
}
function put64(bytes: Uint8Array, offset: number, value: number): void {
  const lo = value % 4294967296,
    hi = Math.floor(value / 4294967296);
  if (!writeWord64(bytes, offset, { lo, hi }, "little").ok)
    throw "JIT object u64 invariant";
}
function name(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}
function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/** The arm64 Mach-O form of a JIT object (see ../../jit-object.ts): an
 * MH_OBJECT whose `__TEXT` segment's address is the code's live address,
 * with absolute symbols. */
export function buildJitObject(request: JitObjectRequest): JitObjectResult {
  const parts = jitObjectParts(request);
  if (!parts.ok) return { ok: false, error: parts.error };
  const code = request.code,
    names = parts.value.names,
    abbrev = parts.value.abbrev,
    info = parts.value.info,
    line = parts.value.line,
    hasDebug = request.lines.length > 0;
  let stringBytes = 1;
  for (const encoded of names) {
    if (encoded === undefined) throw "JIT object name invariant";
    stringBytes += encoded.length + 1;
  }
  // Header, one unnamed segment (__text, then any three DWARF sections),
  // LC_SYMTAB: the relocatable-object layout LLVM's JITs also register.
  const sectionCount = hasDebug ? 4 : 1,
    commands = 72 + sectionCount * 80 + 24,
    textOffset = align(32 + commands, 16),
    abbrevOffset = textOffset + code.length,
    infoOffset = abbrevOffset + abbrev.length,
    lineOffset = infoOffset + info.length,
    symbolOffset = align(lineOffset + line.length, 8),
    stringOffset = symbolOffset + request.functions.length * 16,
    total = stringOffset + stringBytes;
  if (total > request.maxByteLength) return { ok: false, error: "SIZE_LIMIT" };
  const bytes = new Uint8Array(total);
  put32(bytes, 0, 0xfeedfacf);
  put32(bytes, 4, 0x100000c);
  put32(bytes, 8, 0);
  // MH_OBJECT
  put32(bytes, 12, 1);
  put32(bytes, 16, 2);
  put32(bytes, 20, commands);
  let o = 32;
  put32(bytes, o, 0x19);
  put32(bytes, o + 4, 72 + sectionCount * 80);
  // The segment spans address 0 to the code's end: debug sections have no
  // address (debuggers then read them where the object itself lies).
  put64(bytes, o + 24, 0);
  put64(bytes, o + 32, request.address + code.length);
  put64(bytes, o + 40, textOffset);
  put64(bytes, o + 48, lineOffset + line.length - textOffset);
  put32(bytes, o + 56, 7);
  put32(bytes, o + 60, 7);
  put32(bytes, o + 64, sectionCount);
  o += 72;
  name(bytes, o, "__text");
  name(bytes, o + 16, "__TEXT");
  put64(bytes, o + 32, request.address);
  put64(bytes, o + 40, code.length);
  put32(bytes, o + 48, textOffset);
  put32(bytes, o + 52, 2);
  put32(bytes, o + 64, 0x80000400);
  o += 80;
  if (hasDebug) {
    const sections = ["__debug_abbrev", "__debug_info", "__debug_line"],
      offsets = [abbrevOffset, infoOffset, lineOffset],
      lengths = [abbrev.length, info.length, line.length];
    for (let index = 0; index < 3; index++) {
      name(bytes, o, sections[index] ?? "");
      name(bytes, o + 16, "__DWARF");
      put64(bytes, o + 40, lengths[index] ?? 0);
      put32(bytes, o + 48, offsets[index] ?? 0);
      put32(bytes, o + 64, 0x02000000);
      o += 80;
    }
  }
  put32(bytes, o, 2);
  put32(bytes, o + 4, 24);
  put32(bytes, o + 8, symbolOffset);
  put32(bytes, o + 12, request.functions.length);
  put32(bytes, o + 16, stringOffset);
  put32(bytes, o + 20, stringBytes);
  bytes.set(code, textOffset);
  bytes.set(abbrev, abbrevOffset);
  bytes.set(info, infoOffset);
  bytes.set(line, lineOffset);
  let strings = 1;
  for (let index = 0; index < request.functions.length; index++) {
    const fn = request.functions[index],
      encoded = names[index];
    if (fn === undefined || encoded === undefined)
      throw "JIT object symbol invariant";
    const at = symbolOffset + index * 16;
    put32(bytes, at, strings);
    bytes[at + 4] = 0x0f;
    bytes[at + 5] = 1;
    put64(bytes, at + 8, request.address + fn.offset);
    bytes.set(encoded, stringOffset + strings);
    strings += encoded.length + 1;
  }
  return { ok: true, value: bytes };
}
