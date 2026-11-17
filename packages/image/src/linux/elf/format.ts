import { writeUnsigned, writeWord64 } from "@tint/foundation/binary/bytes";

/** ELF64 little-endian AArch64 building blocks shared by the executable
 * writer and the in-memory JIT object (System V gABI; AArch64 ELF ABI). */
export const ELF_HEADER_SIZE = 64,
  PROGRAM_HEADER_SIZE = 56,
  SECTION_HEADER_SIZE = 64,
  SYMBOL_SIZE = 24;
export const ET_REL = 1,
  ET_DYN = 3;
const EM_AARCH64 = 183;
export const SHT_PROGBITS = 1,
  SHT_SYMTAB = 2,
  SHT_STRTAB = 3;
export const SHF_ALLOC = 2,
  SHF_EXECINSTR = 4;
export const STB_LOCAL = 0,
  STB_GLOBAL = 1,
  STT_FUNC = 2,
  STT_SECTION = 3;

export interface SectionHeader {
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
/** A string table under construction: offset 0 is the empty string. */
export interface StringTable {
  readonly parts: Uint8Array[];
  readonly offsets: Map<string, number>;
  size: number;
}

export function put16(b: Uint8Array, o: number, n: number): void {
  if (!writeUnsigned(b, o, 2, n, "little").ok) throw "ELF u16 invariant";
}
export function put32(b: Uint8Array, o: number, n: number): void {
  if (!writeUnsigned(b, o, 4, n, "little").ok) throw "ELF u32 invariant";
}
export function put64(b: Uint8Array, o: number, n: number): void {
  const lo = n % 0x100000000,
    hi = Math.floor(n / 0x100000000);
  if (!writeWord64(b, o, { lo, hi }, "little").ok) throw "ELF u64 invariant";
}
export function stringTable(): StringTable {
  const parts: Uint8Array[] = [new Uint8Array(1)];
  return { parts, offsets: new Map<string, number>(), size: 1 };
}
export function intern(table: StringTable, value: string): number {
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
export function tableBytes(table: StringTable): Uint8Array {
  const out = new Uint8Array(table.size);
  let at = 0;
  for (const part of table.parts) {
    if (part === undefined) throw "ELF string table invariant";
    out.set(part, at);
    at += part.length;
  }
  return out;
}
/** A NUL-free, nonempty name for symbol, section and library tables. */
export function validName(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++)
    if (value.charCodeAt(i) === 0) return false;
  return true;
}
export function writeSymbol(
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
export function writeSectionHeader(
  b: Uint8Array,
  o: number,
  name: number,
  header: SectionHeader,
): void {
  put32(b, o, name);
  put32(b, o + 4, header.type);
  put64(b, o + 8, header.flags);
  put64(b, o + 16, header.address);
  put64(b, o + 24, header.offset);
  put64(b, o + 32, header.size);
  put32(b, o + 40, header.link);
  put32(b, o + 44, header.info);
  put64(b, o + 48, header.alignment);
  put64(b, o + 56, header.entrySize);
}
export interface ElfHeader {
  readonly type: number;
  readonly entry: number;
  /** Program headers follow the ELF header when there are any. */
  readonly programHeaderCount: number;
  readonly sectionHeaderOffset: number;
  readonly sectionCount: number;
  readonly sectionNameIndex: number;
}
/** ELFCLASS64, ELFDATA2LSB, EV_CURRENT, ELFOSABI_SYSV, EM_AARCH64. */
export function writeElfHeader(b: Uint8Array, header: ElfHeader): void {
  const programs = header.programHeaderCount > 0;
  b[0] = 0x7f;
  b[1] = 0x45;
  b[2] = 0x4c;
  b[3] = 0x46;
  b[4] = 2;
  b[5] = 1;
  b[6] = 1;
  put16(b, 16, header.type);
  put16(b, 18, EM_AARCH64);
  put32(b, 20, 1);
  put64(b, 24, header.entry);
  put64(b, 32, programs ? ELF_HEADER_SIZE : 0);
  put64(b, 40, header.sectionHeaderOffset);
  put32(b, 48, 0);
  put16(b, 52, ELF_HEADER_SIZE);
  put16(b, 54, programs ? PROGRAM_HEADER_SIZE : 0);
  put16(b, 56, header.programHeaderCount);
  put16(b, 58, SECTION_HEADER_SIZE);
  put16(b, 60, header.sectionCount);
  put16(b, 62, header.sectionNameIndex);
}
