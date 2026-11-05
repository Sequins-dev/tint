import { alignUp } from "../binary/bytes.ts";
export interface Storage {
  readonly size: number;
  readonly alignment: number;
}
export interface Field extends Storage {
  readonly id: string;
}
export interface PlacedField extends Field {
  readonly offset: number;
}
export interface RecordLayout extends Storage {
  readonly fields: readonly PlacedField[];
}
export interface TaggedLayout extends Storage {
  readonly tagOffset: number;
  readonly tagWidth: 1 | 2 | 4;
  readonly payloadOffset: number;
  readonly variants: readonly Field[];
}
export interface TargetDataLayout {
  readonly pointerSize: 4 | 8;
  readonly wordSize: 4 | 8;
  readonly allocationAlignment: number;
  readonly frameAlignment: number;
  readonly maxAlignment: number;
}
export interface ObjectLayout {
  readonly descriptorOffset: number;
  readonly flagsOffset: number;
  readonly payloadOffset: number;
  readonly byteLength: number;
  readonly alignment: number;
}
export interface RootRecordLayout extends Storage {
  readonly previousOffset: number;
  readonly descriptorOffset: number;
  readonly slotsOffset: number;
}
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error:
        "INVALID_TARGET" | "INVALID_STORAGE" | "DUPLICATE_FIELD" | "LIMIT";
    };
export interface LayoutPlanner {
  readonly record: (fields: readonly Field[]) => Result<RecordLayout>;
  readonly tagged: (
    tagWidth: 1 | 2 | 4,
    variants: readonly Field[],
  ) => Result<TaggedLayout>;
  readonly object: (
    payload: Storage,
    tailBytes?: number,
  ) => Result<ObjectLayout>;
  readonly rootRecord: () => RootRecordLayout;
}
function natural(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
}
function power(n: number): boolean {
  return natural(n) && n > 0 && n <= 0x40000000 && (n & (n - 1)) === 0;
}
export function createLayoutPlanner(
  target: TargetDataLayout,
  maxBytes: number,
): Result<LayoutPlanner> {
  const pointerSize = target.pointerSize,
    wordSize = target.wordSize,
    allocationAlignment = target.allocationAlignment,
    frameAlignment = target.frameAlignment,
    maxAlignment = target.maxAlignment;
  if (
    !natural(maxBytes) ||
    !power(maxAlignment) ||
    !power(allocationAlignment) ||
    !power(frameAlignment) ||
    allocationAlignment < maxAlignment ||
    frameAlignment < maxAlignment ||
    (pointerSize !== 4 && pointerSize !== 8) ||
    (wordSize !== 4 && wordSize !== 8) ||
    pointerSize > maxAlignment ||
    wordSize > maxAlignment
  )
    return { ok: false, error: "INVALID_TARGET" };
  function align(n: number, a: number): number {
    const r = alignUp(n, a);
    if (!r.ok) throw "bounded alignment invariant";
    return r.value;
  }
  const flagsOffset = align(pointerSize, wordSize),
    headerSize = flagsOffset + wordSize,
    rootSize = align(3 * pointerSize, frameAlignment);
  if (headerSize > maxBytes || rootSize > maxBytes)
    return { ok: false, error: "LIMIT" };
  function valid(s: Storage): boolean {
    return natural(s.size) && power(s.alignment) && s.alignment <= maxAlignment;
  }
  function fieldsValid(fields: readonly Field[]): Result<undefined> {
    const names = new Set<string>();
    for (const f of fields) {
      if (f === undefined) return { ok: false, error: "INVALID_STORAGE" };
      if (!valid(f) || f.id.length === 0)
        return { ok: false, error: "INVALID_STORAGE" };
      if (names.has(f.id)) return { ok: false, error: "DUPLICATE_FIELD" };
      names.add(f.id);
    }
    return { ok: true, value: undefined };
  }
  function record(fields: readonly Field[]): Result<RecordLayout> {
    const checked = fieldsValid(fields);
    if (!checked.ok) return checked;
    let offset = 0,
      alignment = 1;
    const placed: PlacedField[] = [];
    for (const f of fields) {
      if (f === undefined) throw "validated field invariant";
      alignment = Math.max(alignment, f.alignment);
      offset = align(offset, f.alignment);
      if (f.size > maxBytes - offset) return { ok: false, error: "LIMIT" };
      placed.push({ id: f.id, size: f.size, alignment: f.alignment, offset });
      offset += f.size;
    }
    const size = align(offset, alignment);
    return size > maxBytes
      ? { ok: false, error: "LIMIT" }
      : { ok: true, value: { size, alignment, fields: placed } };
  }
  function tagged(
    tagWidth: 1 | 2 | 4,
    variants: readonly Field[],
  ): Result<TaggedLayout> {
    if (
      ![1, 2, 4].includes(tagWidth) ||
      tagWidth > maxAlignment ||
      variants.length === 0 ||
      variants.length >
        (tagWidth === 1 ? 256 : tagWidth === 2 ? 65536 : 4294967296)
    )
      return { ok: false, error: "INVALID_STORAGE" };
    const checked = fieldsValid(variants);
    if (!checked.ok) return checked;
    let alignment: number = tagWidth,
      payloadSize = 0;
    const copy: Field[] = [];
    for (const v of variants) {
      if (v === undefined) throw "validated variant invariant";
      alignment = Math.max(alignment, v.alignment);
      payloadSize = Math.max(payloadSize, v.size);
      copy.push({ id: v.id, size: v.size, alignment: v.alignment });
    }
    const payloadOffset = align(tagWidth, alignment),
      size = align(payloadOffset + payloadSize, alignment);
    return size > maxBytes
      ? { ok: false, error: "LIMIT" }
      : {
          ok: true,
          value: {
            size,
            alignment,
            tagOffset: 0,
            tagWidth,
            payloadOffset,
            variants: copy,
          },
        };
  }
  function object(
    payload: Storage,
    tailBytes: number = 0,
  ): Result<ObjectLayout> {
    if (!valid(payload) || !natural(tailBytes))
      return { ok: false, error: "INVALID_STORAGE" };
    const payloadOffset = align(headerSize, payload.alignment),
      byteLength = align(
        payloadOffset + payload.size + tailBytes,
        allocationAlignment,
      );
    return byteLength > maxBytes
      ? { ok: false, error: "LIMIT" }
      : {
          ok: true,
          value: {
            descriptorOffset: 0,
            flagsOffset,
            payloadOffset,
            byteLength,
            alignment: allocationAlignment,
          },
        };
  }
  return {
    ok: true,
    value: {
      record,
      tagged,
      object,
      rootRecord: () => ({
        size: rootSize,
        alignment: frameAlignment,
        previousOffset: 0,
        descriptorOffset: pointerSize,
        slotsOffset: 2 * pointerSize,
      }),
    },
  };
}
