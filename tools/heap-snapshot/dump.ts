// A raw heap dump written by `tint-heap dump` (tools/lldb/tint.py): the
// active old and young spaces, the object-start bits, the stack, the
// stack-map registry, and meta.json (the heap descriptor, thread state and
// the DWARF type table). Image memory (record descriptors, safepoint
// tables, literal strings) is read from the executable on disk, relocated
// by the slide LLDB reported, so live processes and core files read alike.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface KindInfo {
  readonly marker: number;
  readonly flags: number;
  readonly fixedBytes: number;
  readonly countOffset: number | null;
  readonly elementBytes: number;
  readonly edges: number;
  readonly referenceOffset: number;
  readonly name: string;
  /** Extents count at least this many elements (strings: four units). */
  readonly minimumCount: number;
}
export interface FieldInfo {
  readonly name: string;
  readonly offset: number;
  readonly type: string;
  readonly class: string;
  readonly size: number;
  readonly target?: string;
}
export interface RecordInfo {
  readonly name: string;
  readonly size: number;
  readonly module: string;
  readonly index: number | null;
  readonly fields: readonly FieldInfo[];
}
export interface FrameInfo {
  readonly pc: number;
  readonly fp: number;
  readonly sp: number;
  readonly function: string;
  readonly file: string | null;
  readonly line: number;
  readonly inlined: boolean;
}
export interface DumpMeta {
  readonly format: string;
  readonly formatVersion: number;
  readonly time: number;
  readonly image: {
    readonly path: string;
    readonly loadAddress: number;
    readonly fileAddress: number;
    readonly slide: number;
    readonly uuid: string;
  };
  readonly descriptor: {
    readonly descriptor: number;
    readonly version: number;
    readonly context: number;
    readonly headerBytes: number;
    readonly granule: number;
    /** Header bit where the three kind-flag bits start; the marker (or
     * record descriptor address) occupies the bits below. */
    readonly flagsShift: number;
    readonly collector: number;
    readonly kinds: readonly KindInfo[];
    readonly registry: number;
    readonly managedBase: number;
    readonly managedBytes: number;
    readonly state: {
      readonly youngTop: number;
      readonly youngBase: number;
      readonly oldTop: number;
      readonly oldBase: number;
      readonly oldCapacity: number;
      readonly youngCapacity: number;
      readonly startBits: number;
    };
  };
  readonly thread: {
    readonly registers: Readonly<Record<string, number>>;
    readonly frames: readonly FrameInfo[];
  };
  readonly walk: {
    readonly kind: "sample" | "registry";
    readonly start: number;
    readonly returnAddress?: number;
    readonly block?: number;
    readonly saves: readonly number[] | null;
  };
  readonly stack: { readonly base: number; readonly top: number };
  /** The allocation reported at the sample hook, not yet initialized. */
  readonly pending?: { readonly address: number; readonly size: number } | null;
  readonly records: Readonly<Record<string, RecordInfo>>;
  /** Bytes a core file did not hold (never-modified pages), dumped as
   * zeros. */
  readonly absentBytes?: number;
  readonly kindTypes: Readonly<Record<string, RecordInfo>>;
  readonly label?: string;
}

interface Region {
  readonly base: number;
  readonly bytes: Buffer;
}
interface Segment {
  readonly address: number;
  readonly size: number;
  readonly fileOffset: number;
  readonly fileSize: number;
}

/** Loaded address ranges of the executable: LC_SEGMENT_64 commands of a
 * 64-bit Mach-O image, or PT_LOAD headers of a 64-bit ELF image. */
export function imageSegments(image: Buffer): Segment[] {
  if (image.readUInt32BE(0) === 0x7f454c46) return elfSegments(image);
  return machSegments(image);
}
function elfSegments(image: Buffer): Segment[] {
  if (image[4] !== 2 || image[5] !== 1)
    throw Error("not a 64-bit little-endian ELF image");
  const offset = Number(image.readBigUInt64LE(32)),
    entrySize = image.readUInt16LE(54),
    count = image.readUInt16LE(56),
    segments: Segment[] = [];
  for (let index = 0; index < count; index++) {
    const at = offset + index * entrySize;
    if (image.readUInt32LE(at) !== 1) continue; // PT_LOAD
    segments.push({
      fileOffset: Number(image.readBigUInt64LE(at + 8)),
      address: Number(image.readBigUInt64LE(at + 16)),
      fileSize: Number(image.readBigUInt64LE(at + 32)),
      size: Number(image.readBigUInt64LE(at + 40)),
    });
  }
  return segments;
}
function machSegments(image: Buffer): Segment[] {
  if (image.readUInt32LE(0) !== 0xfeedfacf)
    throw Error("not a 64-bit Mach-O or ELF image");
  const count = image.readUInt32LE(16),
    segments: Segment[] = [];
  let at = 32;
  for (let index = 0; index < count; index++) {
    const command = image.readUInt32LE(at),
      size = image.readUInt32LE(at + 4);
    if (command === 0x19)
      segments.push({
        address: Number(image.readBigUInt64LE(at + 24)),
        size: Number(image.readBigUInt64LE(at + 32)),
        fileOffset: Number(image.readBigUInt64LE(at + 40)),
        fileSize: Number(image.readBigUInt64LE(at + 48)),
      });
    at += size;
  }
  return segments;
}

export class HeapDump {
  readonly meta: DumpMeta;
  readonly old: Region;
  readonly young: Region;
  readonly starts: Buffer;
  readonly stack: Region;
  readonly registry: Region;
  readonly image: Buffer;
  readonly segments: readonly Segment[];
  /** Words the walk adds (a synthetic registry and save block). */
  readonly synthetic = new Map<number, number>();

  constructor(directory: string, imagePath?: string) {
    this.meta = JSON.parse(
      readFileSync(join(directory, "meta.json"), "utf8"),
    ) as DumpMeta;
    if (this.meta.format !== "tint-heap-dump" || this.meta.formatVersion !== 2)
      throw Error("unsupported heap dump format");
    if (this.meta.descriptor.version !== 2)
      throw Error(
        "heap descriptor version " +
          this.meta.descriptor.version +
          " is not supported",
      );
    const state = this.meta.descriptor.state;
    this.old = {
      base: state.oldBase,
      bytes: readFileSync(join(directory, "old.bin")),
    };
    this.young = {
      base: state.youngBase,
      bytes: readFileSync(join(directory, "young.bin")),
    };
    this.starts = readFileSync(join(directory, "starts.bin"));
    this.stack = {
      base: this.meta.stack.base,
      bytes: readFileSync(join(directory, "stack.bin")),
    };
    this.registry = {
      base: this.meta.descriptor.registry,
      bytes: readFileSync(join(directory, "registry.bin")),
    };
    this.image = readFileSync(imagePath ?? this.meta.image.path);
    this.segments = imageSegments(this.image);
  }

  /** The image file offset of a live address, or -1. */
  imageOffset(address: number): number {
    const file = address - this.meta.image.slide;
    for (const segment of this.segments)
      if (
        file >= segment.address &&
        file < segment.address + Math.min(segment.size, segment.fileSize)
      )
        return segment.fileOffset + (file - segment.address);
    return -1;
  }
  inImage(address: number): boolean {
    return this.imageOffset(address) >= 0;
  }
  /** Reads one little-endian word from any dumped or image memory. */
  readonly read = (address: number): number | undefined => {
    const synthetic = this.synthetic.get(address);
    if (synthetic !== undefined) return synthetic;
    for (const region of [this.old, this.young, this.stack, this.registry]) {
      const offset = address - region.base;
      if (offset >= 0 && offset + 8 <= region.bytes.length)
        return wordAt(region.bytes, offset);
    }
    const offset = this.imageOffset(address);
    if (offset >= 0 && offset + 8 <= this.image.length)
      return wordAt(this.image, offset);
    return undefined;
  };
  /** The region and offset holding a heap address. */
  heapBytes(address: number): { bytes: Buffer; offset: number } | undefined {
    for (const region of [this.old, this.young]) {
      const offset = address - region.base;
      if (offset >= 0 && offset < region.bytes.length)
        return { bytes: region.bytes, offset };
    }
    return undefined;
  }
  /** UTF-16 text of a string object (heap or image literal). */
  stringText(address: number, limit: number): string {
    const length = this.read(address + stringLengthOffset) ?? 0,
      shown = Math.min(length, limit);
    let text = "";
    const heap = this.heapBytes(address);
    for (let index = 0; index < shown; index++) {
      let unit: number;
      if (heap !== undefined)
        unit = heap.bytes.readUInt16LE(
          heap.offset + stringUnitsOffset + index * 2,
        );
      else {
        const offset = this.imageOffset(
          address + stringUnitsOffset + index * 2,
        );
        unit = offset < 0 ? 0xfffd : this.image.readUInt16LE(offset);
      }
      text += String.fromCharCode(unit);
    }
    return length > limit ? text + "…" : text;
  }
}

// Version 2 string layout (packages/abi/src/host.ts).
const stringLengthOffset = 8,
  stringUnitsOffset = 16;
/** Marker (or record descriptor address) and kind flags of a header word. */
export function splitHeader(
  word: number,
  flagsShift: number,
): { readonly marker: number; readonly flags: number } {
  const unit = 2 ** flagsShift;
  return { marker: word % unit, flags: Math.floor(word / unit) % 8 };
}
export function wordAt(bytes: Buffer, offset: number): number {
  return (
    bytes.readUInt32LE(offset) + bytes.readUInt32LE(offset + 4) * 4294967296
  );
}
