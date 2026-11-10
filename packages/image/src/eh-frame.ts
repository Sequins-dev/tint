import type { UnwindRow, UnwindRule, UnwindSave } from "@tint/abi/unwind";
/** Registers the call-frame encoding needs for a target, as DWARF numbers. */
export interface CallFrameTarget {
  readonly stackPointer: number;
  readonly framePointer: number;
  readonly returnAddress: number;
  /** Factor of every saved-register offset (the target's word size). */
  readonly dataAlignment: number;
}
export interface FrameDescription {
  /** Address of the described code, in the same space as `sectionAddress`. */
  readonly address: number;
  readonly byteLength: number;
  readonly rule: UnwindRule;
}
export interface EhFrame {
  readonly bytes: Uint8Array;
  /** Section offset of each description's FDE, in input order. */
  readonly offsets: readonly number[];
}
const DW_CFA_advance_loc = 0x40,
  DW_CFA_offset = 0x80,
  DW_CFA_advance_loc1 = 0x02,
  DW_CFA_advance_loc2 = 0x03,
  DW_CFA_advance_loc4 = 0x04,
  DW_CFA_offset_extended = 0x05,
  DW_CFA_same_value = 0x08,
  DW_CFA_def_cfa = 0x0c,
  DW_CFA_offset_extended_sf = 0x11,
  DW_EH_PE_pcrel_sdata4 = 0x1b;
function unsignedLeb(out: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw "ULEB128 invariant";
  let rest = value;
  do {
    const low = rest % 128;
    rest = Math.floor(rest / 128);
    out.push(rest === 0 ? low : low + 128);
  } while (rest !== 0);
}
function signedLeb(out: number[], value: number): void {
  if (!Number.isSafeInteger(value)) throw "SLEB128 invariant";
  let rest = value;
  for (;;) {
    const low = ((rest % 128) + 128) % 128;
    rest = Math.floor(rest / 128);
    const done = (rest === 0 && low < 64) || (rest === -1 && low >= 64);
    out.push(done ? low : low + 128);
    if (done) return;
  }
}
function word32(out: number[], value: number): void {
  const unsigned = ((value % 4294967296) + 4294967296) % 4294967296;
  out.push(
    unsigned % 256,
    Math.floor(unsigned / 256) % 256,
    Math.floor(unsigned / 65536) % 256,
    Math.floor(unsigned / 16777216) % 256,
  );
}
function patch32(out: number[], at: number, value: number): void {
  const bytes: number[] = [];
  word32(bytes, value);
  for (let index = 0; index < 4; index++) out[at + index] = bytes[index] ?? 0;
}
/** Close a CIE/FDE opened at `start` (its length field), padding with
 * DW_CFA_nop so each entry spans a whole number of words. */
function finishEntry(out: number[], start: number): void {
  while ((out.length - start) % 8 !== 0) out.push(0);
  patch32(out, start, out.length - start - 4);
}
/** The rows a rule stands for. A frame rule holds from the function start,
 * matching the body-only convention of compact unwind. */
export function unwindRows(
  rule: UnwindRule,
  target: CallFrameTarget,
): readonly UnwindRow[] {
  const kind = rule.kind;
  if (kind === "rows") {
    if (rule.kind !== "rows") throw "unwind rule invariant";
    return rule.rows;
  }
  if (kind === "leaf")
    return [
      {
        offset: 0,
        cfaRegister: target.stackPointer,
        cfaOffset: 0,
        saves: [],
      },
    ];
  if (rule.kind !== "frame") throw "unwind rule invariant";
  const saves: UnwindSave[] = [
    { register: target.framePointer, offset: -16 },
    { register: target.returnAddress, offset: -8 },
  ];
  for (const saved of rule.saves) {
    if (saved === undefined) throw "unwind save invariant";
    saves.push(saved);
  }
  return [
    {
      offset: 0,
      cfaRegister: target.framePointer,
      cfaOffset: 16,
      saves,
    },
  ];
}
function save(
  out: number[],
  register: number,
  offset: number,
  target: CallFrameTarget,
): void {
  if (offset % target.dataAlignment !== 0) throw "unwind save alignment";
  const factored = offset / -target.dataAlignment;
  if (factored >= 0 && register < 64) {
    out.push(DW_CFA_offset + register);
    unsignedLeb(out, factored);
  } else if (factored >= 0) {
    out.push(DW_CFA_offset_extended);
    unsignedLeb(out, register);
    unsignedLeb(out, factored);
  } else {
    out.push(DW_CFA_offset_extended_sf);
    unsignedLeb(out, register);
    signedLeb(out, factored);
  }
}
function savedOffset(
  saves: readonly UnwindSave[],
  register: number,
): number | undefined {
  for (const saved of saves) {
    if (saved === undefined) throw "unwind save invariant";
    if (saved.register === register) return saved.offset;
  }
  return undefined;
}
function advance(out: number[], delta: number): void {
  if (!Number.isInteger(delta) || delta <= 0) throw "unwind row order";
  if (delta < 64) out.push(DW_CFA_advance_loc + delta);
  else if (delta < 256) out.push(DW_CFA_advance_loc1, delta);
  else if (delta < 65536)
    out.push(DW_CFA_advance_loc2, delta % 256, Math.floor(delta / 256));
  else {
    out.push(DW_CFA_advance_loc4);
    word32(out, delta);
  }
}
/** One CIE followed by an FDE per description, with pc-relative 32-bit code
 * addresses (`zR`, DW_EH_PE_pcrel | DW_EH_PE_sdata4). */
export function buildEhFrame(
  descriptions: readonly FrameDescription[],
  sectionAddress: number,
  target: CallFrameTarget,
): EhFrame {
  const out: number[] = [];
  word32(out, 0);
  word32(out, 0); // CIE id
  out.push(1); // version
  out.push(0x7a, 0x52, 0); // "zR"
  unsignedLeb(out, 1); // code alignment factor
  signedLeb(out, -target.dataAlignment);
  out.push(target.returnAddress);
  unsignedLeb(out, 1); // augmentation data length
  out.push(DW_EH_PE_pcrel_sdata4);
  out.push(DW_CFA_def_cfa);
  unsignedLeb(out, target.stackPointer);
  unsignedLeb(out, 0);
  finishEntry(out, 0);
  const offsets: number[] = [];
  for (const description of descriptions) {
    if (description === undefined) throw "unwind description invariant";
    const start = out.length;
    offsets.push(start);
    word32(out, 0);
    word32(out, out.length); // distance back to the CIE at offset 0
    word32(out, description.address - (sectionAddress + out.length));
    word32(out, description.byteLength);
    unsignedLeb(out, 0); // augmentation data length
    let previous: UnwindRow | undefined;
    for (const row of unwindRows(description.rule, target)) {
      if (row === undefined) throw "unwind row invariant";
      const prior = previous;
      if (prior === undefined) {
        if (row.offset !== 0) throw "unwind first row invariant";
      } else advance(out, row.offset - prior.offset);
      if (
        prior === undefined ||
        prior.cfaRegister !== row.cfaRegister ||
        prior.cfaOffset !== row.cfaOffset
      ) {
        out.push(DW_CFA_def_cfa);
        unsignedLeb(out, row.cfaRegister);
        unsignedLeb(out, row.cfaOffset);
      }
      for (const saved of row.saves) {
        if (saved === undefined) throw "unwind save invariant";
        const before =
          prior === undefined
            ? undefined
            : savedOffset(prior.saves, saved.register);
        if (before === undefined || before !== saved.offset)
          save(out, saved.register, saved.offset, target);
      }
      if (prior !== undefined)
        for (const saved of prior.saves) {
          if (saved === undefined) throw "unwind save invariant";
          if (savedOffset(row.saves, saved.register) === undefined) {
            out.push(DW_CFA_same_value);
            unsignedLeb(out, saved.register);
          }
        }
      previous = row;
    }
    finishEntry(out, start);
  }
  return { bytes: new Uint8Array(out), offsets };
}
