import type { UnwindRange, UnwindRule } from "@tint/abi/unwind";
import {
  buildEhFrame,
  type CallFrameTarget,
  type FrameDescription,
} from "../../eh-frame.ts";
/** arm64 compact unwind encodings (mach-o/compact_unwind_encoding.h). */
const UNWIND_ARM64_MODE_FRAMELESS = 0x02000000,
  UNWIND_ARM64_MODE_DWARF = 0x03000000,
  UNWIND_ARM64_MODE_FRAME = 0x04000000,
  UNWIND_NONE = 0;
const ARM64_TARGET: CallFrameTarget = {
  stackPointer: 31,
  framePointer: 29,
  returnAddress: 30,
  dataAlignment: 8,
};
const PAGE_BYTES = 4096,
  PAGE_HEADER_BYTES = 12,
  MAX_DELTA = 0xffffff,
  MAX_ENCODING_INDEX = 255;
export interface UnwindSections {
  /** `__TEXT,__eh_frame`: FDEs for rules compact unwind cannot express. */
  readonly ehFrame: Uint8Array;
  /** `__TEXT,__unwind_info`. */
  readonly unwindInfo: Uint8Array;
}
interface Entry {
  readonly start: number;
  readonly encoding: number;
}
/** Leaves and frames that save nothing beyond the frame record. */
function isCompact(rule: UnwindRule): boolean {
  const kind = rule.kind;
  if (kind === "leaf") return true;
  if (kind === "rows") return false;
  if (rule.kind !== "frame") throw "unwind rule invariant";
  return rule.saves.length === 0;
}
function put32(out: Uint8Array, at: number, value: number): void {
  out[at] = value % 256;
  out[at + 1] = Math.floor(value / 256) % 256;
  out[at + 2] = Math.floor(value / 65536) % 256;
  out[at + 3] = Math.floor(value / 16777216) % 256;
}
function put16(out: Uint8Array, at: number, value: number): void {
  out[at] = value % 256;
  out[at + 1] = Math.floor(value / 256) % 256;
}
/**
 * Encode call-frame rules as compact unwind entries, falling back to DWARF
 * FDEs. Leaves and plain frame records get compact encodings; frames with
 * other saves (whose layout compact unwind cannot express) and explicit rows
 * use `__eh_frame`. Gaps between ranges have no unwind information.
 *
 * `ranges` are code-relative and sorted; `codeAddress` and `ehFrameAddress`
 * are offsets from the image's Mach-O header.
 */
export function buildUnwindSections(
  ranges: readonly UnwindRange[],
  codeAddress: number,
  ehFrameAddress: number,
): UnwindSections {
  const descriptions: FrameDescription[] = [];
  for (const range of ranges) {
    if (range === undefined) throw "unwind range invariant";
    if (!isCompact(range.rule))
      descriptions.push({
        address: codeAddress + range.offset,
        byteLength: range.byteLength,
        rule: range.rule,
      });
  }
  const ehFrame = buildEhFrame(descriptions, ehFrameAddress, ARM64_TARGET);
  const entries: Entry[] = [];
  let dwarfIndex = 0,
    end = -1;
  for (const range of ranges) {
    if (range === undefined) throw "unwind range invariant";
    const start = codeAddress + range.offset;
    if (start < end) throw "unwind range overlap";
    if (end >= 0 && start > end)
      entries.push({ start: end, encoding: UNWIND_NONE });
    const rule = range.rule;
    let encoding: number;
    if (rule.kind === "leaf") encoding = UNWIND_ARM64_MODE_FRAMELESS;
    else if (isCompact(rule)) encoding = UNWIND_ARM64_MODE_FRAME;
    else {
      const offset = ehFrame.offsets[dwarfIndex++];
      if (offset === undefined || offset > MAX_DELTA)
        throw "unwind FDE offset invariant";
      encoding = UNWIND_ARM64_MODE_DWARF + offset;
    }
    // Adjacent ranges with one encoding share an entry (DWARF encodings are
    // distinct per FDE, so those never merge).
    const last = entries[entries.length - 1];
    if (last === undefined || last.encoding !== encoding)
      entries.push({ start, encoding });
    end = start + range.byteLength;
  }
  // Encodings used by more than one entry are shared; the rest stay per page.
  const counts = new Map<number, number>();
  for (const entry of entries)
    if (entry !== undefined)
      counts.set(entry.encoding, (counts.get(entry.encoding) ?? 0) + 1);
  const common: number[] = [];
  for (const [encoding, count] of counts)
    if (count > 1 && common.length < 127) common.push(encoding);
  common.sort((left, right) => left - right);
  // Split entries into compressed second-level pages.
  const pages: { first: number; count: number; local: number[] }[] = [];
  let index = 0;
  while (index < entries.length) {
    const first = entries[index];
    if (first === undefined) throw "unwind entry invariant";
    const local: number[] = [];
    let count = 0;
    while (index + count < entries.length) {
      const entry = entries[index + count];
      if (entry === undefined) throw "unwind entry invariant";
      if (entry.start - first.start > MAX_DELTA) break;
      const shared = common.includes(entry.encoding);
      const isNew = !shared && !local.includes(entry.encoding);
      const localCount = local.length + (isNew ? 1 : 0);
      if (
        PAGE_HEADER_BYTES + (count + 1 + localCount) * 4 > PAGE_BYTES ||
        common.length + localCount > MAX_ENCODING_INDEX + 1
      )
        break;
      if (isNew) local.push(entry.encoding);
      count++;
    }
    if (count === 0) throw "unwind page invariant";
    pages.push({ first: index, count, local });
    index += count;
  }
  const headerBytes = 28,
    commonOffset = headerBytes,
    indexOffset = commonOffset + common.length * 4,
    indexCount = pages.length + 1,
    lsdaOffset = indexOffset + indexCount * 12;
  let pagesBytes = 0;
  for (const page of pages) {
    if (page === undefined) throw "unwind page invariant";
    pagesBytes += PAGE_HEADER_BYTES + (page.count + page.local.length) * 4;
  }
  const out = new Uint8Array(lsdaOffset + pagesBytes);
  put32(out, 0, 1); // version
  put32(out, 4, commonOffset);
  put32(out, 8, common.length);
  put32(out, 12, indexOffset); // no personalities
  put32(out, 16, 0);
  put32(out, 20, indexOffset);
  put32(out, 24, indexCount);
  for (let i = 0; i < common.length; i++)
    put32(out, commonOffset + i * 4, common[i] ?? 0);
  let pageOffset = lsdaOffset;
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    if (page === undefined) throw "unwind page invariant";
    const first = entries[page.first];
    if (first === undefined) throw "unwind entry invariant";
    put32(out, indexOffset + p * 12, first.start);
    put32(out, indexOffset + p * 12 + 4, pageOffset);
    put32(out, indexOffset + p * 12 + 8, lsdaOffset);
    put32(out, pageOffset, 3); // UNWIND_SECOND_LEVEL_COMPRESSED
    put16(out, pageOffset + 4, PAGE_HEADER_BYTES);
    put16(out, pageOffset + 6, page.count);
    put16(out, pageOffset + 8, PAGE_HEADER_BYTES + page.count * 4);
    put16(out, pageOffset + 10, page.local.length);
    for (let i = 0; i < page.count; i++) {
      const entry = entries[page.first + i];
      if (entry === undefined) throw "unwind entry invariant";
      const shared = common.indexOf(entry.encoding);
      const encodingIndex =
        shared >= 0
          ? shared
          : common.length + page.local.indexOf(entry.encoding);
      put32(
        out,
        pageOffset + PAGE_HEADER_BYTES + i * 4,
        encodingIndex * 16777216 + (entry.start - first.start),
      );
    }
    for (let i = 0; i < page.local.length; i++)
      put32(
        out,
        pageOffset + PAGE_HEADER_BYTES + (page.count + i) * 4,
        page.local[i] ?? 0,
      );
    pageOffset += PAGE_HEADER_BYTES + (page.count + page.local.length) * 4;
  }
  // The sentinel index entry marks the end of the described code.
  put32(out, indexOffset + pages.length * 12, end < 0 ? codeAddress : end);
  put32(out, indexOffset + pages.length * 12 + 4, 0);
  put32(out, indexOffset + pages.length * 12 + 8, lsdaOffset);
  return { ehFrame: ehFrame.bytes, unwindInfo: out };
}
