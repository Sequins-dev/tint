import { writeSigned, writeUnsigned } from "@tint/foundation/binary/bytes";
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
export function ehFrameHeaderSize(count: number): number {
  return 12 + count * 8;
}
function signed32(out: Uint8Array, at: number, value: number): void {
  if (!writeSigned(out, at, 4, value, "little").ok)
    throw "eh_frame_hdr displacement out of range";
}
/**
 * The GNU `.eh_frame_hdr` that PT_GNU_EH_FRAME names: a pc-relative pointer to
 * `.eh_frame`, the FDE count, and a binary-search table of (location, FDE)
 * pairs relative to the header (DW_EH_PE_datarel | sdata4), sorted by
 * location as unwinders require.
 */
export function buildEhFrameHeader(
  headerAddress: number,
  ehFrameAddress: number,
  entries: readonly FrameIndexEntry[],
): Uint8Array {
  const out = new Uint8Array(ehFrameHeaderSize(entries.length));
  out[0] = 1; // version
  out[1] = DW_EH_PE_pcrel_sdata4; // eh_frame_ptr encoding
  out[2] = DW_EH_PE_udata4; // fde_count encoding
  out[3] = DW_EH_PE_datarel_sdata4; // table encoding
  signed32(out, 4, ehFrameAddress - (headerAddress + 4));
  if (!writeUnsigned(out, 8, 4, entries.length, "little").ok)
    throw "eh_frame_hdr count out of range";
  let previous = -1;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === undefined) throw "eh_frame_hdr entry invariant";
    if (entry.location <= previous) throw "eh_frame_hdr entry order";
    previous = entry.location;
    signed32(out, 12 + index * 8, entry.location - headerAddress);
    signed32(out, 16 + index * 8, entry.description - headerAddress);
  }
  return out;
}
