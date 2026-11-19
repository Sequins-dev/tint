import {
  jitObjectParts,
  type JitObjectRequest,
  type JitObjectResult,
} from "../../jit-object.ts";
import {
  ELF_HEADER_SIZE,
  ET_REL,
  SECTION_HEADER_SIZE,
  SHF_ALLOC,
  SHF_EXECINSTR,
  SHT_PROGBITS,
  SHT_STRTAB,
  SHT_SYMTAB,
  STB_GLOBAL,
  STB_LOCAL,
  STT_FUNC,
  STT_SECTION,
  SYMBOL_SIZE,
  intern,
  stringTable,
  tableBytes,
  writeElfHeader,
  elfMachine,
  type ElfArchitecture,
  writeSectionHeader,
  writeSymbol,
  type SectionHeader,
} from "./format.ts";

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/** The ELF form of a JIT object (see ../../jit-object.ts), read by
 * GDB and by LLDB on Linux: a relocatable object (`ET_REL`) already
 * relocated in place, the shape LLVM's JITs register. `.text` carries the
 * code's live address in `sh_addr`; function symbols are section-relative
 * (`ET_REL` symbol values); DWARF addresses are absolute, so the object
 * needs no relocations. */
export function buildElfJitObject(
  request: JitObjectRequest,
  arch: ElfArchitecture = "aarch64",
): JitObjectResult {
  const machine = elfMachine(arch);
  const parts = jitObjectParts(request);
  if (!parts.ok) return { ok: false, error: parts.error };
  const code = request.code,
    abbrev = parts.value.abbrev,
    info = parts.value.info,
    line = parts.value.line,
    hasDebug = request.lines.length > 0;
  const symbolNames = stringTable(),
    sectionNames = stringTable();
  for (const fn of request.functions) {
    if (fn === undefined) throw "ELF JIT function invariant";
    intern(symbolNames, fn.name);
  }
  const names: string[] = [".text"];
  if (hasDebug) {
    names.push(".debug_abbrev");
    names.push(".debug_info");
    names.push(".debug_line");
  }
  names.push(".symtab");
  names.push(".strtab");
  names.push(".shstrtab");
  for (const name of names) {
    if (name === undefined) throw "ELF JIT section invariant";
    intern(sectionNames, name);
  }
  const strtab = tableBytes(symbolNames),
    shstrtab = tableBytes(sectionNames),
    // null, the .text section symbol, then one per function.
    symbolCount = 2 + request.functions.length,
    textOffset = align(ELF_HEADER_SIZE, 16),
    abbrevOffset = textOffset + code.length,
    infoOffset = abbrevOffset + abbrev.length,
    lineOffset = infoOffset + info.length,
    symtabOffset = align(lineOffset + line.length, 8),
    strtabOffset = symtabOffset + symbolCount * SYMBOL_SIZE,
    shstrtabOffset = strtabOffset + strtab.length,
    headersOffset = align(shstrtabOffset + shstrtab.length, 8),
    sectionCount = names.length + 1,
    total = headersOffset + sectionCount * SECTION_HEADER_SIZE;
  if (total > request.maxByteLength) return { ok: false, error: "SIZE_LIMIT" };
  const bytes = new Uint8Array(total);
  bytes.set(code, textOffset);
  bytes.set(abbrev, abbrevOffset);
  bytes.set(info, infoOffset);
  bytes.set(line, lineOffset);
  bytes.set(strtab, strtabOffset);
  bytes.set(shstrtab, shstrtabOffset);
  const textIndex = 1,
    symtabIndex = hasDebug ? 5 : 2;
  writeSymbol(
    bytes,
    symtabOffset + SYMBOL_SIZE,
    0,
    STB_LOCAL * 16 + STT_SECTION,
    textIndex,
    0,
    0,
  );
  for (let index = 0; index < request.functions.length; index++) {
    const fn = request.functions[index];
    if (fn === undefined) throw "ELF JIT function invariant";
    const name = symbolNames.offsets.get(fn.name);
    if (name === undefined) throw "ELF JIT symbol name invariant";
    writeSymbol(
      bytes,
      symtabOffset + (2 + index) * SYMBOL_SIZE,
      name,
      STB_GLOBAL * 16 + STT_FUNC,
      textIndex,
      fn.offset,
      fn.byteLength,
    );
  }
  const headers: SectionHeader[] = [
    {
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
    },
    {
      name: ".text",
      type: SHT_PROGBITS,
      flags: SHF_ALLOC + SHF_EXECINSTR,
      address: request.address,
      offset: textOffset,
      size: code.length,
      link: 0,
      info: 0,
      alignment: machine.instructionAlignment,
      entrySize: 0,
    },
  ];
  if (hasDebug) {
    const debugNames = [".debug_abbrev", ".debug_info", ".debug_line"],
      offsets = [abbrevOffset, infoOffset, lineOffset],
      sizes = [abbrev.length, info.length, line.length];
    for (let index = 0; index < 3; index++)
      headers.push({
        name: debugNames[index] ?? "",
        type: SHT_PROGBITS,
        flags: 0,
        address: 0,
        offset: offsets[index] ?? 0,
        size: sizes[index] ?? 0,
        link: 0,
        info: 0,
        alignment: 1,
        entrySize: 0,
      });
  }
  headers.push({
    name: ".symtab",
    type: SHT_SYMTAB,
    flags: 0,
    address: 0,
    offset: symtabOffset,
    size: symbolCount * SYMBOL_SIZE,
    // The string table follows; locals (null and section) come first.
    link: symtabIndex + 1,
    info: 2,
    alignment: 8,
    entrySize: SYMBOL_SIZE,
  });
  headers.push({
    name: ".strtab",
    type: SHT_STRTAB,
    flags: 0,
    address: 0,
    offset: strtabOffset,
    size: strtab.length,
    link: 0,
    info: 0,
    alignment: 1,
    entrySize: 0,
  });
  headers.push({
    name: ".shstrtab",
    type: SHT_STRTAB,
    flags: 0,
    address: 0,
    offset: shstrtabOffset,
    size: shstrtab.length,
    link: 0,
    info: 0,
    alignment: 1,
    entrySize: 0,
  });
  if (headers.length !== sectionCount) throw "ELF JIT section count invariant";
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index];
    if (header === undefined) throw "ELF JIT header invariant";
    const name = sectionNames.offsets.get(header.name) ?? 0;
    writeSectionHeader(
      bytes,
      headersOffset + index * SECTION_HEADER_SIZE,
      name,
      header,
    );
  }
  writeElfHeader(bytes, {
    machine: machine.id,
    type: ET_REL,
    entry: 0,
    programHeaderCount: 0,
    sectionHeaderOffset: headersOffset,
    sectionCount,
    sectionNameIndex: sectionCount - 1,
  });
  return { ok: true, value: bytes };
}
