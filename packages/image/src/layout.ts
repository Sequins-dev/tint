import {
  alignUp,
  writeUnsigned,
  writeSigned,
  writeWord64,
  type Endian,
} from "@tint/foundation/binary/bytes";
import {
  add,
  fromParts,
  fromSafeInteger,
  toSafeInteger,
  type Word64,
} from "@tint/foundation/binary/word64";
export interface Fragment {
  readonly id: string;
  readonly order: number;
  readonly alignment: number;
  readonly bytes: Uint8Array;
  /** Reserve zero-filled space after the supplied bytes. */
  readonly byteLength?: number | undefined;
}
export interface SymbolDefinition {
  readonly id: string;
  readonly fragment: string;
  readonly offset: number;
}
export interface SymbolReference {
  readonly symbol: string;
  readonly addend: number;
}
interface FixupSite {
  readonly id: string;
  readonly fragment: string;
  readonly offset: number;
  readonly width: 1 | 2 | 4 | 8;
  readonly endian: Endian;
  readonly target: SymbolReference;
}
export type Fixup =
  | (FixupSite & {
      readonly kind: "absolute";
      readonly addressSpace: "file" | "virtual";
    })
  | (FixupSite & {
      readonly kind: "relative";
      readonly origin: SymbolReference;
    });
export interface LayoutRequest {
  readonly fragments: readonly Fragment[];
  readonly symbols: readonly SymbolDefinition[];
  readonly fixups: readonly Fixup[];
  readonly virtualBase: Word64;
  readonly maxByteLength: number;
}
export interface Placement {
  readonly id: string;
  readonly fileOffset: number;
  readonly byteLength: number;
}
export interface ResolvedSymbol {
  readonly id: string;
  readonly fileOffset: number;
  readonly virtualAddress: Word64;
}
interface Layout {
  readonly byteLength: number;
  readonly write: (bytes: Uint8Array) => void;
  readonly placements: readonly Placement[];
  readonly symbols: readonly ResolvedSymbol[];
}
export interface LinkedImage {
  readonly bytes: Uint8Array;
  readonly placements: readonly Placement[];
  readonly symbols: readonly ResolvedSymbol[];
}
export type LayoutErrorCode =
  | "INVALID_INPUT"
  | "DUPLICATE_ID"
  | "UNKNOWN_FRAGMENT"
  | "UNKNOWN_SYMBOL"
  | "OUT_OF_BOUNDS"
  | "OVERFLOW"
  | "SIZE_LIMIT"
  | "OVERLAPPING_FIXUPS"
  | "VALUE_OUT_OF_RANGE"
  | "ALLOCATION_FAILED";
export interface LayoutError {
  readonly code: LayoutErrorCode;
  readonly subject: string;
}
export type LayoutResult =
  | { readonly ok: true; readonly value: LinkedImage }
  | { readonly ok: false; readonly error: LayoutError };
type Failure = { readonly ok: false; readonly error: LayoutError };
function fail(code: LayoutErrorCode, subject: string): Failure {
  return { ok: false, error: { code, subject } };
}
function safe(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
}
function signedSafe(n: number): boolean {
  return (
    Number.isInteger(n) &&
    n >= -Number.MAX_SAFE_INTEGER &&
    n <= Number.MAX_SAFE_INTEGER
  );
}
function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function coordinate(
  ref: SymbolReference,
  symbols: Map<string, ResolvedSymbol>,
): { readonly ok: true; readonly value: number } | Failure {
  const symbol = symbols.get(ref.symbol);
  if (symbol === undefined) return fail("UNKNOWN_SYMBOL", ref.symbol);
  if (!signedSafe(ref.addend)) return fail("INVALID_INPUT", ref.symbol);
  if (
    ref.addend < -symbol.fileOffset ||
    ref.addend > Number.MAX_SAFE_INTEGER - symbol.fileOffset
  )
    return fail("OVERFLOW", ref.symbol);
  return { ok: true, value: symbol.fileOffset + ref.addend };
}

/** Links one contiguous image. Input buffers are borrowed read-only for this call. */
export function link(request: LayoutRequest): LayoutResult {
  const layout = planLayout(request);
  if (!layout.ok) return layout;
  const plan = layout.value;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(plan.byteLength);
  } catch {
    return fail("ALLOCATION_FAILED", "output");
  }
  plan.write(bytes);
  return {
    ok: true,
    value: { bytes, placements: plan.placements, symbols: plan.symbols },
  };
}

/** Resolve file and VM placement before allocating the final output. */
export function planLayout(
  request: LayoutRequest,
): { readonly ok: true; readonly value: Layout } | Failure {
  if (
    !safe(request.maxByteLength) ||
    !fromParts(request.virtualBase.lo, request.virtualBase.hi).ok
  )
    return fail("INVALID_INPUT", "options");
  const fragments = request.fragments.slice();
  const fragmentIds = new Set<string>();
  for (const f of fragments) {
    if (f === undefined) return fail("INVALID_INPUT", "missing fragment");
    if (
      f.id.length === 0 ||
      !signedSafe(f.order) ||
      !safe(f.alignment) ||
      f.alignment === 0
    )
      return fail("INVALID_INPUT", f.id);
    if (fragmentIds.has(f.id)) return fail("DUPLICATE_ID", f.id);
    fragmentIds.add(f.id);
  }
  fragments.sort((a, b): number => {
    if (a === undefined || b === undefined) throw "fragment invariant";
    return a.order < b.order
      ? -1
      : a.order > b.order
        ? 1
        : compareId(a.id, b.id);
  });
  const placements: Placement[] = [];
  const placementMap = new Map<string, Placement>();
  let size = 0;
  for (const f of fragments) {
    if (f === undefined) return fail("INVALID_INPUT", "missing fragment");
    const aligned = alignUp(size, f.alignment);
    if (!aligned.ok) return fail("OVERFLOW", f.id);
    const length = f.byteLength ?? f.bytes.length;
    if (!safe(length) || length < f.bytes.length)
      return fail("INVALID_INPUT", f.id);
    if (
      aligned.value > request.maxByteLength ||
      length > request.maxByteLength - aligned.value
    )
      return fail("SIZE_LIMIT", f.id);
    const placement = {
      id: f.id,
      fileOffset: aligned.value,
      byteLength: length,
    };
    placements.push(placement);
    placementMap.set(f.id, placement);
    size = aligned.value + length;
  }
  // Validate even an unreferenced image's virtual extent (last byte, not one-past).
  const last = fromSafeInteger(size === 0 ? 0 : size - 1);
  if (!last.ok || !add(request.virtualBase, last.value).ok)
    return fail("OVERFLOW", "virtual extent");
  const symbols: ResolvedSymbol[] = [];
  const symbolMap = new Map<string, ResolvedSymbol>();
  const definitions = request.symbols.slice().sort((a, b): number => {
    if (a === undefined || b === undefined) throw "symbol invariant";
    return compareId(a.id, b.id);
  });
  for (const s of definitions) {
    if (s === undefined) return fail("INVALID_INPUT", "missing symbol");
    if (s.id.length === 0 || !safe(s.offset))
      return fail("INVALID_INPUT", s.id);
    if (symbolMap.has(s.id)) return fail("DUPLICATE_ID", s.id);
    const p = placementMap.get(s.fragment);
    if (p === undefined) return fail("UNKNOWN_FRAGMENT", s.fragment);
    if (s.offset > p.byteLength) return fail("OUT_OF_BOUNDS", s.id);
    const offset = fromSafeInteger(p.fileOffset + s.offset);
    if (!offset.ok) return fail("OVERFLOW", s.id);
    const address = add(request.virtualBase, offset.value);
    if (!address.ok) return fail("OVERFLOW", s.id);
    const resolved = {
      id: s.id,
      fileOffset: p.fileOffset + s.offset,
      virtualAddress: address.value,
    };
    symbols.push(resolved);
    symbolMap.set(s.id, resolved);
  }
  const fixupIds = new Set<string>();
  const sites: { readonly fixup: Fixup; readonly offset: number }[] = [];
  for (const f of request.fixups) {
    if (f === undefined) return fail("INVALID_INPUT", "missing fixup");
    if (
      f.id.length === 0 ||
      !safe(f.offset) ||
      (f.width !== 1 && f.width !== 2 && f.width !== 4 && f.width !== 8) ||
      (f.endian !== "little" && f.endian !== "big")
    )
      return fail("INVALID_INPUT", f.id);
    if (fixupIds.has(f.id)) return fail("DUPLICATE_ID", f.id);
    fixupIds.add(f.id);
    const p = placementMap.get(f.fragment);
    if (p === undefined) return fail("UNKNOWN_FRAGMENT", f.fragment);
    if (f.offset > p.byteLength || f.width > p.byteLength - f.offset)
      return fail("OUT_OF_BOUNDS", f.id);
    sites.push({ fixup: f, offset: p.fileOffset + f.offset });
  }
  sites.sort((a, b): number => {
    if (a === undefined || b === undefined) throw "fixup site invariant";
    return a.offset - b.offset || compareId(a.fixup.id, b.fixup.id);
  });
  let end = 0;
  const patches: { readonly offset: number; readonly bytes: Uint8Array }[] = [];
  for (const site of sites) {
    if (site === undefined) throw "fixup site invariant";
    const f = site.fixup;
    if (site.offset < end) return fail("OVERLAPPING_FIXUPS", f.id);
    end = site.offset + f.width;
    const target = coordinate(f.target, symbolMap);
    if (!target.ok) return target;
    const width = f.width;
    const patch = new Uint8Array(width);
    if (f.kind === "relative") {
      const origin = coordinate(f.origin, symbolMap);
      if (!origin.ok) return origin;
      const displacement = target.value - origin.value;
      if (width === 8) {
        const encoded = fromParts(
          displacement >>> 0,
          Math.floor(displacement / 0x100000000) >>> 0,
        );
        if (!encoded.ok || !writeWord64(patch, 0, encoded.value, f.endian).ok)
          return fail("VALUE_OUT_OF_RANGE", f.id);
      } else if (!writeSigned(patch, 0, width, displacement, f.endian).ok)
        return fail("VALUE_OUT_OF_RANGE", f.id);
    } else if (f.kind === "absolute") {
      const offset = fromSafeInteger(target.value);
      if (!offset.ok) return fail("OVERFLOW", f.id);
      if (f.addressSpace !== "file" && f.addressSpace !== "virtual")
        return fail("INVALID_INPUT", f.id);
      const address =
        f.addressSpace === "file"
          ? offset
          : add(request.virtualBase, offset.value);
      if (!address.ok) return fail("OVERFLOW", f.id);
      if (width === 8) {
        if (!writeWord64(patch, 0, address.value, f.endian).ok)
          return fail("VALUE_OUT_OF_RANGE", f.id);
      } else {
        const n = toSafeInteger(address.value);
        if (!n.ok || !writeUnsigned(patch, 0, width, n.value, f.endian).ok)
          return fail("VALUE_OUT_OF_RANGE", f.id);
      }
    } else return fail("INVALID_INPUT", "fixup kind");
    patches.push({ offset: site.offset, bytes: patch });
  }
  function write(bytes: Uint8Array): void {
    for (const f of fragments) {
      if (f === undefined) throw "fragment invariant";
      const p = placementMap.get(f.id);
      if (p === undefined) throw "fragment placement invariant";
      bytes.set(f.bytes, p.fileOffset);
    }
    for (const patch of patches) {
      if (patch === undefined) throw "patch invariant";
      bytes.set(patch.bytes, patch.offset);
    }
  }
  return { ok: true, value: { byteLength: size, write, placements, symbols } };
}
