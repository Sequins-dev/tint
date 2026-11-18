import {
  writeSigned,
  writeUnsigned,
  writeWord64,
} from "@tint/foundation/binary/bytes";
/** One `.eh_frame_hdr` search-table entry, as virtual addresses. */
export interface FrameIndexEntry {
  /** First code address the FDE describes. */
  readonly location: number;
  /** Address of the FDE in `.eh_frame`. */
  readonly description: number;
}
const DW_EH_PE_udata4 = 0x03,
  DW_EH_PE_pcrel_sdata4 = 0x1b,
  DW_EH_PE_datarel_sdata4 = 0x3b;
/** Bytes of a header indexing `count` descriptions. */
export function ehFrameHeaderSize(
  count: number,
  wide: boolean = false,
): number {
  return wide ? 16 + count * 16 : 12 + count * 8;
}
function signed(
  out: Uint8Array,
  at: number,
  value: number,
  wide: boolean,
): void {
  if (wide && Number.isSafeInteger(value)) {
    const hi = Math.floor(value / 0x100000000);
    if (
      writeWord64(
        out,
        at,
        { lo: value - hi * 0x100000000, hi: hi >>> 0 },
        "little",
      ).ok
    )
      return;
  }
  if (wide || !writeSigned(out, at, 4, value, "little").ok)
    throw "eh_frame_hdr displacement out of range";
}
/**
 * The GNU `.eh_frame_hdr` that PT_GNU_EH_FRAME names: a pc-relative pointer to
 * `.eh_frame`, the FDE count, and a binary-search table of (location, FDE)
 * pairs relative to the header (DW_EH_PE_datarel), sorted by
 * location as unwinders require.
 */
export function buildEhFrameHeader(
  headerAddress: number,
  ehFrameAddress: number,
  entries: readonly FrameIndexEntry[],
  forceWide: boolean = false,
): Uint8Array {
  const fits = (delta: number): boolean =>
    delta >= -0x80000000 && delta < 0x80000000;
  const wide =
    forceWide ||
    !fits(ehFrameAddress - (headerAddress + 4)) ||
    entries.some(
      (entry) =>
        !fits(entry.location - headerAddress) ||
        !fits(entry.description - headerAddress),
    );
  const width = wide ? 8 : 4;
  const start = 8 + width;
  const out = new Uint8Array(ehFrameHeaderSize(entries.length, wide));
  out[0] = 1; // version
  out[1] = wide ? 0x1c : DW_EH_PE_pcrel_sdata4; // eh_frame_ptr encoding
  out[2] = DW_EH_PE_udata4; // fde_count encoding
  out[3] = wide ? 0x3c : DW_EH_PE_datarel_sdata4; // table encoding
  signed(out, 4, ehFrameAddress - (headerAddress + 4), wide);
  if (!writeUnsigned(out, 4 + width, 4, entries.length, "little").ok)
    throw "eh_frame_hdr count out of range";
  let previous = -1;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === undefined) throw "eh_frame_hdr entry invariant";
    if (entry.location <= previous) throw "eh_frame_hdr entry order";
    previous = entry.location;
    const at = start + index * width * 2;
    signed(out, at, entry.location - headerAddress, wide);
    signed(out, at + width, entry.description - headerAddress, wide);
  }
  return out;
}
