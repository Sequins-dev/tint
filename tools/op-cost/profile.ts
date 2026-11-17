// Leaf (self) samples of a pprofessor capture, by linked address of one
// binary. The gzip-compressed pprof protobuf is decoded here directly, so
// the analysis tools need nothing besides the capture itself. Shared by
// op-cost/analyze.ts and disasm/annotate.ts.
import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
} from "node:fs";
import { basename } from "node:path";
import { gunzipSync } from "node:zlib";

export interface LeafSamples {
  /** Every selected sample in the profile, attributed or not. */
  readonly total: number;
  /** Self samples by linked (unslid) address within the binary's image. */
  readonly byAddress: ReadonlyMap<number, number>;
  /** The thread the samples were restricted to, if any. */
  readonly thread?: number | undefined;
}

export interface LeafOptions {
  /** A `thread_id` label value, or "busiest": the thread with the most leaf
   * samples inside the binary (pprofessor samples every thread on each tick,
   * including blocked ones). Default: all threads. */
  readonly thread?: number | "busiest";
}

interface Field {
  readonly number: number;
  /** Varint and fixed fields. */
  readonly value: number;
  /** Length-delimited fields. */
  readonly bytes: Uint8Array | undefined;
}

/** Protobuf wire decoding. Values above 2^53 lose precision; addresses,
 * identifiers and counts in a profile are far below that. */
function fields(bytes: Uint8Array): Field[] {
  const result: Field[] = [];
  let at = 0;
  const varint = (): number => {
    let value = 0,
      scale = 1;
    for (;;) {
      const byte = bytes[at++];
      if (byte === undefined) throw Error("truncated pprof varint");
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
  };
  while (at < bytes.length) {
    const key = varint(),
      number = Math.floor(key / 8),
      wire = key % 8;
    if (wire === 0) result.push({ number, value: varint(), bytes: undefined });
    else if (wire === 2) {
      const length = varint();
      if (at + length > bytes.length) throw Error("truncated pprof field");
      result.push({
        number,
        value: 0,
        bytes: bytes.subarray(at, at + length),
      });
      at += length;
    } else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else throw Error("unsupported pprof wire type " + wire);
  }
  return result;
}

/** A repeated integer field: packed bytes or one unpacked value. */
function integers(field: Field): number[] {
  if (field.bytes === undefined) return [field.value];
  const values: number[] = [];
  const bytes = field.bytes;
  let at = 0;
  while (at < bytes.length) {
    let value = 0,
      scale = 1;
    for (;;) {
      const byte = bytes[at++];
      if (byte === undefined) throw Error("truncated pprof packed field");
      value += (byte & 127) * scale;
      if (byte < 128) break;
      scale *= 128;
    }
    values.push(value);
  }
  return values;
}

/** The linked address of an image's file offset 0: Mach-O __TEXT starts at
 * 0x100000000; Tint's ELF images link their first segment at 0 (so a
 * mapping's start minus its file offset is the slide). */
function linkedBase(binary: string): number {
  if (!existsSync(binary)) return 0x100000000;
  const magic = Buffer.alloc(4),
    descriptor = openSync(binary, "r");
  try {
    readSync(descriptor, magic, 0, 4, 0);
  } finally {
    closeSync(descriptor);
  }
  return magic.readUInt32BE(0) === 0x7f454c46 ? 0 : 0x100000000;
}

/** Decodes an uncompressed pprof `Profile` message. The binary's mapping
 * gives the runtime slide against its linked addresses (Mach-O from
 * 0x100000000, ELF from 0). */
export function decodeProfile(
  profile: Uint8Array,
  binary: string,
  options: LeafOptions = {},
): LeafSamples {
  const strings: string[] = [],
    decoder = new TextDecoder(),
    locations = new Map<number, number>(),
    mappings: { start: number; offset: number; filename: number }[] = [],
    samples: { leaf: number; count: number; thread: number | undefined }[] = [],
    labelFields: { key: number; number: number }[][] = [];
  for (const field of fields(profile)) {
    const bytes = field.bytes;
    if (bytes === undefined) continue;
    if (field.number === 6) strings.push(decoder.decode(bytes));
    else if (field.number === 4) {
      let id = 0,
        address = 0;
      for (const item of fields(bytes))
        if (item.number === 1) id = item.value;
        else if (item.number === 3) address = item.value;
      locations.set(id, address);
    } else if (field.number === 3) {
      let start = 0,
        offset = 0,
        filename = 0;
      for (const item of fields(bytes))
        if (item.number === 2) start = item.value;
        else if (item.number === 4) offset = item.value;
        else if (item.number === 5) filename = item.value;
      mappings.push({ start, offset, filename });
    } else if (field.number === 2) {
      let leaf: number | undefined,
        count = 0,
        counted = false;
      const labels: { key: number; number: number }[] = [];
      for (const item of fields(bytes))
        if (item.number === 1) leaf ??= integers(item)[0];
        else if (item.number === 2 && !counted) {
          // The first sample value is the sample count.
          count = integers(item)[0] ?? 0;
          counted = true;
        } else if (item.number === 3 && item.bytes !== undefined) {
          let key = 0,
            number = 0;
          for (const part of fields(item.bytes))
            if (part.number === 1) key = part.value;
            else if (part.number === 3) number = part.value;
          labels.push({ key, number });
        }
      labelFields.push(labels);
      samples.push({ leaf: leaf ?? 0, count, thread: undefined });
    }
  }
  const threadKey = strings.indexOf("thread_id");
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index],
      label = labelFields[index]?.find((item) => item.key === threadKey);
    if (sample !== undefined && label !== undefined)
      samples[index] = { ...sample, thread: label.number };
  }
  const name = basename(binary),
    base = linkedBase(binary);
  let slide = 0;
  for (const mapping of mappings)
    if ((strings[mapping.filename] ?? "").endsWith(name)) {
      slide = mapping.start - (base === 0 ? mapping.offset : base);
      break;
    }
  let thread = typeof options.thread === "number" ? options.thread : undefined;
  if (options.thread === "busiest") {
    // Addresses inside the image: at or above its mapping start.
    const inside = new Map<number, number>();
    for (const sample of samples) {
      const address = locations.get(sample.leaf);
      if (
        sample.thread === undefined ||
        address === undefined ||
        address < slide + base ||
        address >= slide + base + 0x100000000
      )
        continue;
      inside.set(
        sample.thread,
        (inside.get(sample.thread) ?? 0) + sample.count,
      );
    }
    let most = 0;
    for (const [id, count] of inside)
      if (count > most) {
        most = count;
        thread = id;
      }
  }
  const byAddress = new Map<number, number>();
  let total = 0;
  for (const sample of samples) {
    if (thread !== undefined && sample.thread !== thread) continue;
    total += sample.count;
    const address = locations.get(sample.leaf);
    if (address === undefined) continue;
    byAddress.set(
      address - slide,
      (byAddress.get(address - slide) ?? 0) + sample.count,
    );
  }
  return { total, byAddress, thread };
}

/** Reads a pprofessor capture (`.pb.gz`, or an uncompressed `.pb`). */
export function leafSamples(
  profile: string,
  binary: string,
  options: LeafOptions = {},
): LeafSamples {
  const file = readFileSync(profile),
    compressed = file[0] === 0x1f && file[1] === 0x8b;
  return decodeProfile(compressed ? gunzipSync(file) : file, binary, options);
}
