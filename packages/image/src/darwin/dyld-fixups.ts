import { writeUnsigned, writeWord64 } from "@tint/foundation/binary/bytes";
export interface Import {
  readonly name: string;
  readonly libraryOrdinal: number;
}
export interface ImportRequest {
  readonly imports: readonly Import[];
  readonly segmentOffset: number;
  readonly segmentIndex: number;
  readonly segmentCount: number;
  readonly maxByteLength: number;
}
export type FixupError =
  "INVALID_SEGMENT" | "INVALID_IMPORT" | "DUPLICATE_IMPORT" | "SIZE_LIMIT";
export type ImportResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly metadata: Uint8Array;
        readonly slots: Uint8Array;
      };
    }
  | { readonly ok: false; readonly error: FixupError };

const PAGE = 16384;
function uint(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= max;
}
function put(b: Uint8Array, o: number, width: 2 | 4, n: number): void {
  if (!writeUnsigned(b, o, width, n, "little").ok)
    throw "dyld integer invariant";
}
/** Dense eager import slots, one chain per occupied 16-KiB page. */
export function buildImportFixups(request: ImportRequest): ImportResult {
  const r = request,
    count = r.imports.length,
    slotSize = count * 8,
    pages = Math.ceil(slotSize / PAGE);
  if (
    !uint(r.segmentOffset, 0xffffffff) ||
    r.segmentOffset % PAGE !== 0 ||
    !uint(r.segmentCount, 255) ||
    r.segmentCount === 0 ||
    !uint(r.segmentIndex, r.segmentCount - 1)
  )
    return { ok: false, error: "INVALID_SEGMENT" };
  if (
    !uint(r.maxByteLength, 0xffffffff) ||
    count > 0xffffff ||
    pages > 65535 ||
    slotSize > r.maxByteLength ||
    r.segmentOffset + slotSize > 0xffffffff
  )
    return { ok: false, error: "SIZE_LIMIT" };
  let namesSize = 0;
  const seen = new Set<string>();
  for (const entry of r.imports) {
    if (entry === undefined) return { ok: false, error: "INVALID_IMPORT" };
    if (
      !uint(entry.libraryOrdinal, 240) ||
      entry.libraryOrdinal === 0 ||
      entry.name.length === 0
    )
      return { ok: false, error: "INVALID_IMPORT" };
    for (let i = 0; i < entry.name.length; i++) {
      const c = entry.name.charCodeAt(i);
      if (c < 33 || c > 126) return { ok: false, error: "INVALID_IMPORT" };
    }
    const key = String(entry.libraryOrdinal) + ":" + entry.name;
    if (seen.has(key)) return { ok: false, error: "DUPLICATE_IMPORT" };
    seen.add(key);
    namesSize += entry.name.length + 1;
    if (namesSize > 0x800000 || namesSize > r.maxByteLength)
      return { ok: false, error: "SIZE_LIMIT" };
  }
  const starts = 32,
    segment = Math.ceil((starts + 4 + r.segmentCount * 4) / 8) * 8;
  const segmentSize = count === 0 ? 0 : 22 + pages * 2;
  const imports = Math.ceil((segment + segmentSize) / 4) * 4,
    names = imports + count * 4,
    total = names + namesSize;
  if (total + slotSize > r.maxByteLength)
    return { ok: false, error: "SIZE_LIMIT" };
  const metadata = new Uint8Array(total),
    slots = new Uint8Array(slotSize);
  put(metadata, 4, 4, starts);
  put(metadata, 8, 4, imports);
  put(metadata, 12, 4, names);
  put(metadata, 16, 4, count);
  put(metadata, 20, 4, 1);
  put(metadata, starts, 4, r.segmentCount);
  if (count > 0) {
    put(metadata, starts + 4 + r.segmentIndex * 4, 4, segment - starts);
    put(metadata, segment, 4, segmentSize);
    put(metadata, segment + 4, 2, PAGE);
    put(metadata, segment + 6, 2, 6);
    put(metadata, segment + 8, 4, r.segmentOffset);
    put(metadata, segment + 20, 2, pages);
    // Every page begins with a slot, so page_start entries are all zero.
  }
  let nameOffset = 0;
  for (let index = 0; index < count; index++) {
    const entry = r.imports[index];
    if (entry === undefined) throw "dyld import invariant";
    put(
      metadata,
      imports + index * 4,
      4,
      entry.libraryOrdinal + nameOffset * 512,
    );
    for (let c = 0; c < entry.name.length; c++)
      metadata[names + nameOffset + c] = entry.name.charCodeAt(c);
    nameOffset += entry.name.length + 1;
    const next = index + 1 === count || ((index + 1) * 8) % PAGE === 0 ? 0 : 2;
    if (
      !writeWord64(
        slots,
        index * 8,
        { lo: index, hi: 0x80000000 + next * 0x80000 },
        "little",
      ).ok
    )
      throw "dyld pointer invariant";
  }
  return { ok: true, value: { metadata, slots } };
}
