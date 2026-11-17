/** A minimal ELF64 little-endian reader for writer tests. */
export interface ElfSection {
  readonly index: number;
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
export interface ElfSegment {
  readonly type: number;
  readonly flags: number;
  readonly offset: number;
  readonly address: number;
  readonly fileSize: number;
  readonly memorySize: number;
  readonly alignment: number;
}
export interface ElfSymbol {
  readonly name: string;
  readonly info: number;
  readonly section: number;
  readonly value: number;
  readonly size: number;
}
export interface ElfFile {
  readonly view: DataView;
  readonly type: number;
  readonly machine: number;
  readonly entry: number;
  readonly sectionNameIndex: number;
  readonly segments: readonly ElfSegment[];
  readonly sections: readonly ElfSection[];
  section(name: string): ElfSection;
  contents(section: ElfSection): Uint8Array;
  symbols(table: string): readonly ElfSymbol[];
  /** Dynamic entries as [tag, value] pairs. */
  dynamic(): readonly (readonly [number, number])[];
}
function u64(view: DataView, offset: number): number {
  return Number(view.getBigUint64(offset, true));
}
export function cString(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}
export function readElf(bytes: Uint8Array): ElfFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const phoff = u64(view, 32),
    shoff = u64(view, 40),
    phnum = view.getUint16(56, true),
    shnum = view.getUint16(60, true),
    shstrndx = view.getUint16(62, true);
  const segments: ElfSegment[] = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * view.getUint16(54, true);
    segments.push({
      type: view.getUint32(o, true),
      flags: view.getUint32(o + 4, true),
      offset: u64(view, o + 8),
      address: u64(view, o + 16),
      fileSize: u64(view, o + 32),
      memorySize: u64(view, o + 40),
      alignment: u64(view, o + 48),
    });
  }
  const raw = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * view.getUint16(58, true);
    raw.push({
      index: i,
      nameOffset: view.getUint32(o, true),
      type: view.getUint32(o + 4, true),
      flags: u64(view, o + 8),
      address: u64(view, o + 16),
      offset: u64(view, o + 24),
      size: u64(view, o + 32),
      link: view.getUint32(o + 40, true),
      info: view.getUint32(o + 44, true),
      alignment: u64(view, o + 48),
      entrySize: u64(view, o + 56),
    });
  }
  const names = raw[shstrndx]!;
  const sections: ElfSection[] = raw.map(({ nameOffset, ...rest }) => ({
    ...rest,
    name: cString(bytes, names.offset + nameOffset),
  }));
  const section = (name: string): ElfSection => {
    const found = sections.find((s) => s.name === name);
    if (found === undefined) throw new Error(`missing section ${name}`);
    return found;
  };
  const contents = (s: ElfSection) =>
    bytes.subarray(s.offset, s.offset + s.size);
  return {
    view,
    type: view.getUint16(16, true),
    machine: view.getUint16(18, true),
    entry: u64(view, 24),
    sectionNameIndex: shstrndx,
    segments,
    sections,
    section,
    contents,
    symbols(table) {
      const symtab = section(table),
        strings = sections[symtab.link]!;
      const out: ElfSymbol[] = [];
      for (let o = symtab.offset; o < symtab.offset + symtab.size; o += 24)
        out.push({
          name: cString(bytes, strings.offset + view.getUint32(o, true)),
          info: bytes[o + 4]!,
          section: view.getUint16(o + 6, true),
          value: u64(view, o + 8),
          size: u64(view, o + 16),
        });
      return out;
    },
    dynamic() {
      const dynamic = section(".dynamic");
      const out: (readonly [number, number])[] = [];
      for (let o = dynamic.offset; o < dynamic.offset + dynamic.size; o += 16)
        out.push([u64(view, o), u64(view, o + 8)]);
      return out;
    },
  };
}
