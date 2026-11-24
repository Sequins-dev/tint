import type { Instruction } from "../isa.ts";
import {
  nativeStringLengthOffset,
  nativeStringDataOffset,
  nativeStringTwoByteHeader,
  nativeStringSlicedStartOffset,
  nativeHeaderFlagsShift,
} from "@tint/abi/host";
import { createLeafAssembler } from "./leaf.ts";
/** Header bit of the sliced kind flag (nativeStringSlicedFlag). */
const slicedBit = nativeHeaderFlagsShift + 1;
export type StringHelper =
  | "string-starts-with"
  | "string-equal"
  | "string-code-unit"
  | "string-concat-copy"
  | "string-write-copy"
  | "string-slice-bounds"
  | "string-slice-kind"
  | "string-slice-copy"
  | "string-index-of"
  | "string-last-index-of"
  | "string-ascii-prefix"
  | "bytes-ascii-prefix"
  | "string-copy-latin1"
  | "bytes-copy"
  | "string-ascii-upper"
  | "string-ascii-lower"
  | "string-utf8-length"
  | "string-write-utf8"
  | "bytes-utf8-measure"
  | "bytes-utf8-decode";
/** Flat strings: header (marker 1) at +0, then the length in UTF-16 code
 * units and the units (nativeStringLengthOffset, nativeStringDataOffset).
 * The header is nativeStringTwoByteHeader for two-byte units, else the
 * one-byte header (every unit at most 0xFF, one byte each). Strings are
 * canonical: a two-byte string holds a unit above 0xFF, so equal strings
 * have equal headers and a one-byte string never contains a two-byte one
 * (docs/design-one-byte-strings.md). Mutators never see collector header
 * bits, so a header compares exactly. All helpers are nonallocating. Valid
 * strings fit in a uint32-sized allocation. */
/** Byte alignment of each string helper's first instruction. */
export const stringHelperAlignment = 64;
export function stringHelper(kind: StringHelper): readonly Instruction[] {
  // Loop heads on 32-byte boundaries: helpers start on stringHelperAlignment
  // boundaries, so their copy and search loops (at most eight instructions)
  // never straddle a 64-byte fetch block, wherever the code before them
  // ends.
  const asm = createLeafAssembler(32),
    emit = asm.emit,
    label = asm.label,
    branch = asm.branch;
  function compare(a: number, b: number): void {
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: a,
      rm: b,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  }
  function compareImmediate(register: number, value: number): void {
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: register,
      immediate: value,
      shift: 0,
      setFlags: true,
    });
  }
  /** Flags: eq when the header in `register` is the two-byte header (of a
   * flat string, or of a sliced one after flattenBase or sliceData). */
  function testTwoByte(register: number): void {
    compareImmediate(register, nativeStringTwoByteHeader);
  }
  /** Branches to `flat` when the header in `header` is a flat string's: one
   * bit test of the sliced flag. A slice falls through with the flag
   * cleared, so its header becomes the flat header of its kind. Clobbers
   * `scratch` on the slice path only. */
  function sliceTest(flat: string, header: number, scratch: number): void {
    asm.testBit(flat, header, slicedBit, false);
    emit({ op: "movz", width: 64, rd: scratch, immediate: 2, shift: 48 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: header,
      rn: header,
      rm: scratch,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  }
  /** Loads a slice's start offset into `start` and its parent into
   * `parent` (which may be `slice`). */
  function sliceFields(slice: number, start: number, parent: number): void {
    emit({
      op: "ldp",
      width: 64,
      rt: start,
      rt2: parent,
      rn: slice,
      offset: nativeStringSlicedStartOffset,
      mode: "offset",
    });
  }
  /** When bit 17 of the header high word in `high` marks the string in
   * `base` as sliced, sets `base` to its parent plus its start, the base
   * that flat data addressing reads its units from. Clobbers `scratch`. */
  function sliceBase(
    flat: string,
    base: number,
    high: number,
    scratch: number,
  ): void {
    asm.testBit(flat, high, slicedBit - 32, false);
    sliceFields(base, scratch, base);
    emit({
      op: "add-reg",
      width: 64,
      rd: base,
      rn: base,
      rm: scratch,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    label(flat);
  }
  /** Makes the string in `base` (header in `header`, lengths already read)
   * flat for the code that follows: a sliced string's header loses its
   * sliced flag, and `base` becomes its parent plus its start offset, so
   * the flat data addressing (base + data offset) reaches its units.
   * Clobbers `scratch`. */
  function flattenBase(
    prefix: string,
    base: number,
    header: number,
    scratch: number,
  ): void {
    sliceTest(prefix + "-flat", header, scratch);
    sliceFields(base, scratch, base);
    emit({
      op: "add-reg",
      width: 64,
      rd: base,
      rn: base,
      rm: scratch,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    label(prefix + "-flat");
  }
  /** Like flattenBase, but sets `data` (holding the flat address, `string`
   * plus the data offset) to a sliced string's first unit and leaves
   * `string` unchanged. Clobbers `scratch`. */
  function sliceData(
    prefix: string,
    string: number,
    header: number,
    data: number,
    scratch: number,
  ): void {
    sliceTest(prefix + "-flat", header, scratch);
    sliceFields(string, scratch, data);
    emit({
      op: "add-reg",
      width: 64,
      rd: data,
      rn: data,
      rm: scratch,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    advance(data, nativeStringDataOffset);
    label(prefix + "-flat");
  }
  function advance(register: number, bytes: number): void {
    emit({
      op: "add-imm",
      width: 64,
      rd: register,
      rn: register,
      immediate: bytes,
      shift: 0,
      setFlags: false,
    });
  }
  function decrement(register: number, amount: number): void {
    emit({
      op: "sub-imm",
      width: 64,
      rd: register,
      rn: register,
      immediate: amount,
      shift: 0,
      setFlags: true,
    });
  }
  function move(rd: number, rn: number): void {
    emit({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
  }
  /** rd = base + (index << shift) + data offset. */
  function dataAddress(
    rd: number,
    base: number,
    index: number,
    shift: number,
  ): void {
    emit({
      op: "add-reg",
      width: 64,
      rd,
      rn: base,
      rm: index,
      shift: "lsl",
      amount: shift,
      setFlags: false,
    });
    advance(rd, nativeStringDataOffset);
  }
  function double(register: number): void {
    emit({
      op: "add-reg",
      width: 64,
      rd: register,
      rn: register,
      rm: register,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  }
  // The copy loops take x13 source, x14 destination and x15 count, advance
  // x13 and x14 past what they copied, and clobber x12, x15/x16 and v0.
  // They read and write exactly the counted bytes. Sixteen at a time
  // through v0 while sixteen remain; then a remainder of 2-16 bytes is two
  // overlapping loads and stores of its first and last 2, 4 or 8 bytes,
  // without a loop.
  function copyBytes(prefix: string): void {
    compareImmediate(15, 16);
    branch(prefix + "-small", "ls");
    label(prefix + "-vectors");
    emit({ op: "ldr-q", qt: 0, rn: 13, offset: 0 });
    emit({ op: "str-q", qt: 0, rn: 14, offset: 0 });
    advance(13, 16);
    advance(14, 16);
    decrement(15, 16);
    compareImmediate(15, 16);
    branch(prefix + "-vectors", "hi");
    label(prefix + "-small");
    function overlapping(name: string, width: 2 | 4 | 8): void {
      const size: 1 | 2 | 3 = width === 2 ? 1 : width === 4 ? 2 : 3;
      label(prefix + name);
      if (width === 2) emit({ op: "ldrh", rt: 16, rn: 13, offset: 0 });
      else
        emit({
          op: "ldr",
          width: width === 4 ? 32 : 64,
          rt: 16,
          rn: 13,
          offset: 0,
        });
      decrement(15, width);
      emit({
        op: "ldr-indexed",
        size,
        fp: false,
        rt: 12,
        rn: 13,
        rm: 15,
        scaled: false,
      });
      if (width === 2) emit({ op: "strh", rt: 16, rn: 14, offset: 0 });
      else
        emit({
          op: "str",
          width: width === 4 ? 32 : 64,
          rt: 16,
          rn: 14,
          offset: 0,
        });
      emit({
        op: "str-indexed",
        size,
        fp: false,
        rt: 12,
        rn: 14,
        rm: 15,
        scaled: false,
      });
      advance(15, width);
      branch(prefix + "-advance");
    }
    compareImmediate(15, 8);
    branch(prefix + "-eight", "cs");
    compareImmediate(15, 4);
    branch(prefix + "-four", "cs");
    compareImmediate(15, 2);
    branch(prefix + "-two", "cs");
    compareImmediate(15, 0);
    branch(prefix + "-done", "eq");
    emit({ op: "ldrb", rt: 16, rn: 13, offset: 0 });
    emit({ op: "strb", rt: 16, rn: 14, offset: 0 });
    branch(prefix + "-advance");
    overlapping("-eight", 8);
    overlapping("-four", 4);
    overlapping("-two", 2);
    label(prefix + "-advance");
    emit({
      op: "add-reg",
      width: 64,
      rd: 13,
      rn: 13,
      rm: 15,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "add-reg",
      width: 64,
      rd: 14,
      rn: 14,
      rm: 15,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    label(prefix + "-done");
  }
  /** One-byte units at x13 into two-byte units at x14; x15 units. Eight
   * at a time through v0 (UXTL), then four, two and one by the remaining
   * count's bits. Leaves x13 and x14 past the units and x15 zero; clobbers
   * x16 and v0. */
  function widenUnits(prefix: string): void {
    compareImmediate(15, 8);
    branch(prefix + "-tail", "cc");
    label(prefix + "-vectors");
    emit({ op: "ldr-d", rt: 0, rn: 13, offset: 0 });
    emit({ op: "uxtl-8h", vd: 0, vn: 0 });
    emit({ op: "str-q", qt: 0, rn: 14, offset: 0 });
    advance(13, 8);
    advance(14, 16);
    decrement(15, 8);
    compareImmediate(15, 8);
    branch(prefix + "-vectors", "cs");
    // Fewer than eight remain: four, two and one by the count's bits,
    // reading and writing only those units (no loop).
    label(prefix + "-tail");
    asm.testBit(prefix + "-two", 15, 2, false);
    emit({ op: "ldr", width: 32, rt: 16, rn: 13, offset: 0 });
    emit({ op: "fmov-s-w", rd: 0, rn: 16 });
    emit({ op: "uxtl-8h", vd: 0, vn: 0 });
    emit({ op: "str-d", rt: 0, rn: 14, offset: 0 });
    advance(13, 4);
    advance(14, 8);
    label(prefix + "-two");
    asm.testBit(prefix + "-one", 15, 1, false);
    emit({ op: "ldrh", rt: 16, rn: 13, offset: 0 });
    emit({ op: "fmov-s-w", rd: 0, rn: 16 });
    emit({ op: "uxtl-8h", vd: 0, vn: 0 });
    emit({ op: "fmov-w-s", rd: 16, rn: 0 });
    emit({ op: "str", width: 32, rt: 16, rn: 14, offset: 0 });
    advance(13, 2);
    advance(14, 4);
    label(prefix + "-one");
    asm.testBit(prefix + "-done", 15, 0, false);
    emit({ op: "ldrb", rt: 16, rn: 13, offset: 0 });
    emit({ op: "strh", rt: 16, rn: 14, offset: 0 });
    advance(13, 1);
    advance(14, 2);
    label(prefix + "-done");
    // As the loops leave it: no units remain.
    emit({ op: "movz", width: 64, rd: 15, immediate: 0, shift: 0 });
  }
  /** Two-byte units at x13, each at most 0xFF, into one byte each at x14;
   * x15 units. Eight at a time through v0 (XTN), then four, two and one by
   * the remaining count's bits. Leaves x13 and x14 past the units and x15
   * zero; clobbers x16 and v0. */
  function narrowUnits(prefix: string): void {
    compareImmediate(15, 8);
    branch(prefix + "-tail", "cc");
    label(prefix + "-vectors");
    emit({ op: "ldr-q", qt: 0, rn: 13, offset: 0 });
    emit({ op: "xtn-8b", vd: 0, vn: 0 });
    emit({ op: "str-d", rt: 0, rn: 14, offset: 0 });
    advance(13, 16);
    advance(14, 8);
    decrement(15, 8);
    compareImmediate(15, 8);
    branch(prefix + "-vectors", "cs");
    // Fewer than eight remain: four, two and one by the count's bits,
    // reading and writing only those units (no loop).
    label(prefix + "-tail");
    asm.testBit(prefix + "-two", 15, 2, false);
    emit({ op: "ldr-d", rt: 0, rn: 13, offset: 0 });
    emit({ op: "xtn-8b", vd: 0, vn: 0 });
    emit({ op: "fmov-w-s", rd: 16, rn: 0 });
    emit({ op: "str", width: 32, rt: 16, rn: 14, offset: 0 });
    advance(13, 8);
    advance(14, 4);
    label(prefix + "-two");
    asm.testBit(prefix + "-one", 15, 1, false);
    emit({ op: "ldr", width: 32, rt: 16, rn: 13, offset: 0 });
    emit({ op: "fmov-s-w", rd: 0, rn: 16 });
    emit({ op: "xtn-8b", vd: 0, vn: 0 });
    emit({ op: "fmov-w-s", rd: 16, rn: 0 });
    emit({ op: "strh", rt: 16, rn: 14, offset: 0 });
    advance(13, 4);
    advance(14, 2);
    label(prefix + "-one");
    asm.testBit(prefix + "-done", 15, 0, false);
    emit({ op: "ldrh", rt: 16, rn: 13, offset: 0 });
    emit({ op: "strb", rt: 16, rn: 14, offset: 0 });
    advance(13, 2);
    advance(14, 1);
    label(prefix + "-done");
    // As the loops leave it: no units remain.
    emit({ op: "movz", width: 64, rd: 15, immediate: 0, shift: 0 });
  }
  /** Compares x11 (at least one) bytes at x9 and x10 exactly, a word while
   * eight remain, then branches to "equal" or "different". Clobbers x9-x11,
   * x14 and x15. */
  function compareBytes(prefix: string): void {
    compareImmediate(11, 8);
    branch(prefix + "-tail", "cc");
    label(prefix + "-words");
    emit({ op: "ldr", width: 64, rt: 14, rn: 9, offset: 0 });
    emit({ op: "ldr", width: 64, rt: 15, rn: 10, offset: 0 });
    compare(14, 15);
    branch("different", "ne");
    advance(9, 8);
    advance(10, 8);
    decrement(11, 8);
    compareImmediate(11, 8);
    branch(prefix + "-words", "cs");
    label(prefix + "-tail");
    compareImmediate(11, 0);
    branch("equal", "eq");
    label(prefix + "-bytes");
    emit({ op: "ldrb", rt: 14, rn: 9, offset: 0 });
    emit({ op: "ldrb", rt: 15, rn: 10, offset: 0 });
    compare(14, 15);
    branch("different", "ne");
    advance(9, 1);
    advance(10, 1);
    decrement(11, 1);
    branch(prefix + "-bytes", "ne");
    branch("equal");
  }
  /** x12 (or `register`) = `unit` in each of the four halfwords of a
   * word. */
  function repeatedHalfwords(unit: number, register: number = 12): void {
    emit({ op: "movz", width: 64, rd: register, immediate: unit, shift: 0 });
    emit({ op: "movk", width: 64, rd: register, immediate: unit, shift: 16 });
    emit({ op: "movk", width: 64, rd: register, immediate: unit, shift: 32 });
    emit({ op: "movk", width: 64, rd: register, immediate: unit, shift: 48 });
  }
  function addImmediate(
    rd: number,
    rn: number,
    value: number,
    shift: 0 | 12 = 0,
  ): void {
    emit({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate: value,
      shift,
      setFlags: false,
    });
  }
  function subtractImmediate(
    rd: number,
    rn: number,
    value: number,
    shift: 0 | 12 = 0,
  ): void {
    emit({
      op: "sub-imm",
      width: 64,
      rd,
      rn,
      immediate: value,
      shift,
      setFlags: false,
    });
  }
  /** rd = rn + (rm << amount). */
  function addShifted(
    rd: number,
    rn: number,
    rm: number,
    amount: number,
  ): void {
    emit({
      op: "add-reg",
      width: 64,
      rd,
      rn,
      rm,
      shift: "lsl",
      amount,
      setFlags: false,
    });
  }
  /** rd = (rn >> low) & (2^width - 1) (UBFX). */
  function field(rd: number, rn: number, low: number, width: number): void {
    emit({
      op: "ubfm",
      width: 64,
      rd,
      rn,
      immr: low,
      imms: low + width - 1,
    });
  }
  /** Stores `unit`'s UTF-8 continuation byte for bits [low, low + 6) at
   * [x14 + at]: 0x80 | those bits. Clobbers x10. */
  function continuation(unit: number, low: number, at: number): void {
    field(10, unit, low, 6);
    addImmediate(10, 10, 0x80);
    emit({ op: "strb", rt: 10, rn: 14, offset: at });
  }
  /** Branches to `fail` unless the byte at [x13 + at] is a continuation
   * byte in [lower, upper]. Clobbers x9. */
  function expectContinuation(
    at: number,
    lower: number,
    upper: number,
    fail: string,
  ): void {
    emit({ op: "ldrb", rt: 9, rn: 13, offset: at });
    subtractImmediate(9, 9, lower);
    compareImmediate(9, upper - lower);
    branch(fail, "hi");
  }
  /** x16 = (x16 << 6) | (the byte at [x13 + at] & 63): one continuation
   * byte's payload appended. Clobbers x10. */
  function appendPayload(at: number): void {
    emit({ op: "ldrb", rt: 10, rn: 13, offset: at });
    field(10, 10, 0, 6);
    addShifted(16, 10, 16, 6);
  }
  /** Advances the source (x13) by `source` bytes and its remaining count
   * (x15) by `count`, the destination (x14) by `destination` bytes and its
   * remaining capacity (x12, or `capacity`) by `room`. */
  function step(
    source: number,
    count: number,
    destination: number,
    room: number,
    capacity: number = 12,
  ): void {
    advance(13, source);
    subtractImmediate(15, 15, count);
    if (destination > 0) advance(14, destination);
    if (room > 0) subtractImmediate(capacity, capacity, room);
  }
  /** Scans x15 units of `width` bytes at x13 for the first at 0x80 or
   * above: x9 = the number of units before it (x15 when there is none).
   * Sixteen bytes at a time, then a word, test the units' bits from 7 up
   * against the mask in x12; the first flagged unit of a word is its
   * lowest set bit (RBIT, CLZ). Preserves x11; clobbers x10 and x12-x16. */
  function asciiPrefix(prefix: string, width: 1 | 2): void {
    move(14, 13);
    if (width === 2) double(15);
    repeatedHalfwords(width === 1 ? 0x8080 : 0xff80);
    label(prefix + "-pairs");
    compareImmediate(15, 16);
    branch(prefix + "-word", "cc");
    emit({
      op: "ldp",
      width: 64,
      rt: 16,
      rt2: 9,
      rn: 14,
      offset: 0,
      mode: "offset",
    });
    emit({ op: "orr-reg", width: 64, rd: 10, rn: 16, rm: 9 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 10, rm: 12 });
    compareImmediate(10, 0);
    branch(prefix + "-pair-flagged", "ne");
    advance(14, 16);
    decrement(15, 16);
    branch(prefix + "-pairs");
    label(prefix + "-pair-flagged");
    emit({ op: "and-reg", width: 64, rd: 10, rn: 16, rm: 12 });
    compareImmediate(10, 0);
    branch(prefix + "-flagged", "ne");
    advance(14, 8);
    emit({ op: "and-reg", width: 64, rd: 10, rn: 9, rm: 12 });
    branch(prefix + "-flagged");
    label(prefix + "-word");
    compareImmediate(15, 8);
    branch(prefix + "-units", "cc");
    emit({ op: "ldr", width: 64, rt: 16, rn: 14, offset: 0 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 16, rm: 12 });
    compareImmediate(10, 0);
    branch(prefix + "-flagged", "ne");
    advance(14, 8);
    decrement(15, 8);
    label(prefix + "-units");
    compareImmediate(15, 0);
    branch(prefix + "-end", "eq");
    if (width === 1) emit({ op: "ldrb", rt: 16, rn: 14, offset: 0 });
    else emit({ op: "ldrh", rt: 16, rn: 14, offset: 0 });
    compareImmediate(16, 0x80);
    branch(prefix + "-end", "cs");
    advance(14, width);
    decrement(15, width);
    branch(prefix + "-units");
    // x10: the flagged word's mask bits. The lowest set bit's unit: bit
    // index >> 3 bytes, or (bit index >> 4) * 2 for halfwords.
    label(prefix + "-flagged");
    emit({ op: "rbit", rd: 10, rn: 10 });
    emit({ op: "clz", rd: 10, rn: 10 });
    emit({
      op: "ubfm",
      width: 64,
      rd: 10,
      rn: 10,
      immr: width === 1 ? 3 : 4,
      imms: 63,
    });
    emit({
      op: "add-reg",
      width: 64,
      rd: 14,
      rn: 14,
      rm: 10,
      shift: "lsl",
      amount: width - 1,
      setFlags: false,
    });
    label(prefix + "-end");
    emit({
      op: "sub-reg",
      width: 64,
      rd: 9,
      rn: 14,
      rm: 13,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    if (width === 2)
      emit({ op: "ubfm", width: 64, rd: 9, rn: 9, immr: 1, imms: 63 });
  }
  /** One ASCII case step over sixteen one-byte units: v0 = [x13] with
   * each byte b where b - v2 < v3 (unsigned) flipped by v4, stored to
   * [x14]. Clobbers v0 and v1. */
  function asciiCaseVector(): void {
    emit({ op: "ldr-q", qt: 0, rn: 13, offset: 0 });
    emit({ op: "sub-16b", vd: 1, vn: 0, vm: 2 });
    emit({ op: "cmhi-16b", vd: 1, vn: 3, vm: 1 });
    emit({ op: "and-16b", vd: 1, vn: 1, vm: 4 });
    emit({ op: "eor-16b", vd: 0, vn: 0, vm: 1 });
    emit({ op: "str-q", qt: 0, rn: 14, offset: 0 });
  }
  /** x15 units of `width` bytes from x13 to x14, each in [first, first +
   * 26) moved 32 toward the other case; then branches to "done". Clobbers
   * x12-x16. */
  function asciiCaseUnits(name: string, width: 1 | 2, first: number): void {
    label(name);
    compareImmediate(15, 0);
    branch("done", "eq");
    label(name + "-unit");
    if (width === 1) emit({ op: "ldrb", rt: 16, rn: 13, offset: 0 });
    else emit({ op: "ldrh", rt: 16, rn: 13, offset: 0 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 12,
      rn: 16,
      immediate: first,
      shift: 0,
      setFlags: false,
    });
    compareImmediate(12, 25);
    branch(name + "-store", "hi");
    if (first === 0x61)
      emit({
        op: "sub-imm",
        width: 64,
        rd: 16,
        rn: 16,
        immediate: 32,
        shift: 0,
        setFlags: false,
      });
    else advance(16, 32);
    label(name + "-store");
    if (width === 1) emit({ op: "strb", rt: 16, rn: 14, offset: 0 });
    else emit({ op: "strh", rt: 16, rn: 14, offset: 0 });
    advance(13, width);
    advance(14, width);
    decrement(15, 1);
    branch(name + "-unit", "ne");
    branch("done");
  }
  function resultLabels(): void {
    label("equal");
    emit({ op: "movz", width: 32, rd: 9, immediate: 1, shift: 0 });
    emit({ op: "ret", rn: 30 });
    label("different");
    emit({ op: "movz", width: 32, rd: 9, immediate: 0, shift: 0 });
    emit({ op: "ret", rn: 30 });
  }
  /** Searches for x10's units in x9's: x9/x10 point at the data, x12 is
   * the search length (at least one), x13 the first candidate start and x11
   * the last one (reverse: the other way round, both inclusive). Scans for
   * the first search unit, then compares the rest; `source` and `search`
   * are the unit widths. Returns the start in d0, else -1. Clobbers
   * x13-x16. */
  function search(
    prefix: string,
    source: 1 | 2,
    pattern: 1 | 2,
    reverse: boolean,
  ): void {
    function unit(rt: number, base: number, index: number, width: 1 | 2): void {
      emit({
        op: "ldr-indexed",
        size: width === 1 ? 0 : 1,
        fp: false,
        rt,
        rn: base,
        rm: index,
        scaled: width === 2,
      });
    }
    function first(): void {
      if (pattern === 1) emit({ op: "ldrb", rt: 15, rn: 10, offset: 0 });
      else emit({ op: "ldrh", rt: 15, rn: 10, offset: 0 });
    }
    first();
    label(prefix + "-scan");
    unit(14, 9, 13, source);
    compare(14, 15);
    branch(prefix + "-candidate", "eq");
    label(prefix + "-next");
    if (reverse) {
      decrement(13, 1);
      branch(prefix + "-scan", "ge");
    } else {
      advance(13, 1);
      compare(13, 11);
      branch(prefix + "-scan", "le");
    }
    branch("not-found");
    // The first unit matched at x13: compare units 1..length-1.
    label(prefix + "-candidate");
    emit({ op: "movz", width: 64, rd: 16, immediate: 1, shift: 0 });
    label(prefix + "-rest");
    compare(16, 12);
    branch("found", "ge");
    emit({
      op: "add-reg",
      width: 64,
      rd: 14,
      rn: 13,
      rm: 16,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    unit(14, 9, 14, source);
    unit(15, 10, 16, pattern);
    compare(14, 15);
    branch(prefix + "-mismatch", "ne");
    advance(16, 1);
    branch(prefix + "-rest");
    label(prefix + "-mismatch");
    first();
    branch(prefix + "-next");
  }
  if (kind === "string-index-of" || kind === "string-last-index-of") {
    // x9 source, x10 search, d0 an integer position in [0, length] -> d0
    // the first start at or after it (last-index-of: at or before it), or
    // -1. Clobbers x9-x16, d0 and flags. A two-byte search never occurs in
    // a one-byte source (canonical kinds).
    const reverse = kind === "string-last-index-of";
    emit({ op: "fcvtzs-x-d", rd: 13, rn: 0 });
    emit({
      op: "ldr",
      width: 32,
      rt: 11,
      rn: 9,
      offset: nativeStringLengthOffset,
    });
    emit({
      op: "ldr",
      width: 32,
      rt: 12,
      rn: 10,
      offset: nativeStringLengthOffset,
    });
    // The empty string occurs at the position itself.
    compareImmediate(12, 0);
    branch("found", "eq");
    // x11: the last start at which the search fits.
    emit({
      op: "sub-reg",
      width: 64,
      rd: 11,
      rn: 11,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    branch("not-found", "lt");
    if (reverse) {
      compare(13, 11);
      branch("bounded", "le");
      move(13, 11);
      label("bounded");
    } else {
      compare(13, 11);
      branch("not-found", "gt");
    }
    emit({ op: "ldr", width: 64, rt: 14, rn: 9, offset: 0 });
    emit({ op: "ldr", width: 64, rt: 15, rn: 10, offset: 0 });
    flattenBase("source", 9, 14, 16);
    flattenBase("search", 10, 15, 16);
    advance(9, nativeStringDataOffset);
    advance(10, nativeStringDataOffset);
    testTwoByte(15);
    branch("search-one-byte", "ne");
    testTwoByte(14);
    branch("not-found", "ne");
    search("two", 2, 2, reverse);
    label("search-one-byte");
    testTwoByte(14);
    branch("widened", "eq");
    search("one", 1, 1, reverse);
    label("widened");
    search("mixed", 2, 1, reverse);
    label("found");
    emit({ op: "scvtf-d-x", rd: 0, rn: 13 });
    emit({ op: "ret", rn: 30 });
    label("not-found");
    emit({ op: "movz", width: 64, rd: 13, immediate: 0, shift: 0 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 13,
      rn: 13,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "scvtf-d-x", rd: 0, rn: 13 });
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-slice-bounds") {
    // x9 source, d0 begin, d1 limit, x10 limit-present -> x12 begin, x13 count.
    // Preserves x9. Clamp before integer conversion; valid flat strings
    // bound results below 2^31.
    emit({
      op: "ldr",
      width: 32,
      rt: 12,
      rn: 9,
      offset: nativeStringLengthOffset,
    });
    emit({ op: "ucvtf-d-w", rd: 2, rn: 12 });
    emit({ op: "fmov-d-x", rd: 3, rn: "zr" });
    compareImmediate(10, 0);
    branch("limit-present", "ne");
    emit({ op: "fmov-d-d", rd: 1, rn: 2 });
    label("limit-present");
    function normalize(reg: number, prefix: string): void {
      emit({ op: "fcmp", rn: reg, rm: reg });
      branch(prefix + "-ordered", "vc");
      emit({ op: "fmov-d-d", rd: reg, rn: 3 });
      label(prefix + "-ordered");
      emit({ op: "frintz", rd: reg, rn: reg });
      emit({ op: "fcmp", rn: reg, rm: 3 });
      branch(prefix + "-positive", "ge");
      emit({ op: "fadd", rd: reg, rn: reg, rm: 2 });
      emit({ op: "fcmp", rn: reg, rm: 3 });
      branch(prefix + "-positive", "ge");
      emit({ op: "fmov-d-d", rd: reg, rn: 3 });
      label(prefix + "-positive");
      emit({ op: "fcmp", rn: reg, rm: 2 });
      branch(prefix + "-bounded", "le");
      emit({ op: "fmov-d-d", rd: reg, rn: 2 });
      label(prefix + "-bounded");
    }
    normalize(0, "begin");
    normalize(1, "limit");
    emit({ op: "fcvtzs-w-d", rd: 12, rn: 0 });
    emit({ op: "fcvtzs-w-d", rd: 13, rn: 1 });
    compare(13, 12);
    branch("nonempty", "hi");
    emit({ op: "movz", width: 64, rd: 13, immediate: 0, shift: 0 });
    emit({ op: "ret", rn: 30 });
    label("nonempty");
    emit({
      op: "sub-reg",
      width: 64,
      rd: 13,
      rn: 13,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-slice-kind") {
    // x9 source, x12 begin, x13 count -> x14 1 when the slice is one-byte,
    // else 0. Preserves x9, x12 and x13; clobbers x10, x11, x15, x16, v0,
    // v1 and flags. A one-byte source and an empty slice are one-byte; a
    // two-byte source's units are scanned for one above 0xFF: eight at a
    // time by their high bytes (SHRN), then four, then one.
    emit({ op: "movz", width: 64, rd: 14, immediate: 1, shift: 0 });
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    // A sliced source is read through a flattened copy of its pointer.
    move(15, 9);
    flattenBase("source", 15, 10, 11);
    testTwoByte(10);
    branch("done", "ne");
    dataAddress(15, 15, 12, 1);
    move(16, 13);
    compareImmediate(16, 8);
    branch("quads", "cc");
    label("vectors");
    emit({ op: "ldr-q", qt: 0, rn: 15, offset: 0 });
    emit({ op: "shrn-8b-8", vd: 1, vn: 0 });
    emit({ op: "fmov-x-d", rd: 10, rn: 1 });
    compareImmediate(10, 0);
    branch("wide", "ne");
    advance(15, 16);
    decrement(16, 8);
    compareImmediate(16, 8);
    branch("vectors", "cs");
    label("quads");
    // The high byte of each of four units.
    emit({ op: "movz", width: 64, rd: 11, immediate: 0xff00, shift: 0 });
    emit({ op: "movk", width: 64, rd: 11, immediate: 0xff00, shift: 16 });
    emit({ op: "movk", width: 64, rd: 11, immediate: 0xff00, shift: 32 });
    emit({ op: "movk", width: 64, rd: 11, immediate: 0xff00, shift: 48 });
    compareImmediate(16, 4);
    branch("tail", "cc");
    label("words");
    emit({ op: "ldr", width: 64, rt: 10, rn: 15, offset: 0 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 10, rm: 11 });
    compareImmediate(10, 0);
    branch("wide", "ne");
    advance(15, 8);
    decrement(16, 4);
    compareImmediate(16, 4);
    branch("words", "cs");
    label("tail");
    compareImmediate(16, 0);
    branch("done", "eq");
    label("units");
    emit({ op: "ldrh", rt: 10, rn: 15, offset: 0 });
    compareImmediate(10, 0xff);
    branch("wide", "hi");
    advance(15, 2);
    decrement(16, 1);
    branch("units", "ne");
    emit({ op: "ret", rn: 30 });
    label("wide");
    emit({ op: "movz", width: 64, rd: 14, immediate: 0, shift: 0 });
    label("done");
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-slice-copy") {
    // x9 fresh destination, x10 source, x11 begin, x12 count, x13 the
    // destination header (string-slice-kind's choice). Preserves x9;
    // clobbers x10-x16. A one-byte slice of a two-byte source narrows.
    emit({ op: "ldr", width: 64, rt: 16, rn: 10, offset: 0 });
    flattenBase("source", 10, 16, 14);
    emit({ op: "str", width: 64, rt: 13, rn: 9, offset: 0 });
    emit({
      op: "str",
      width: 64,
      rt: 12,
      rn: 9,
      offset: nativeStringLengthOffset,
    });
    move(15, 12);
    emit({
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 9,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    testTwoByte(13);
    branch("one-byte", "ne");
    dataAddress(13, 10, 11, 1);
    double(15);
    copyBytes("two");
    emit({ op: "ret", rn: 30 });
    label("one-byte");
    testTwoByte(16);
    branch("narrow", "eq");
    dataAddress(13, 10, 11, 0);
    copyBytes("one");
    emit({ op: "ret", rn: 30 });
    label("narrow");
    dataAddress(13, 10, 11, 1);
    narrowUnits("narrow");
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-concat-copy") {
    // x9 fresh destination, x10/x11 rooted inputs, x12 the destination
    // header (one-byte exactly when both inputs are). Preserves x9;
    // clobbers x12-x16. Allocation extent and combined length have already
    // been checked by the caller.
    emit({ op: "str", width: 64, rt: 12, rn: 9, offset: 0 });
    emit({
      op: "ldr",
      width: 32,
      rt: 13,
      rn: 10,
      offset: nativeStringLengthOffset,
    });
    emit({
      op: "ldr",
      width: 32,
      rt: 14,
      rn: 11,
      offset: nativeStringLengthOffset,
    });
    emit({
      op: "add-reg",
      width: 64,
      rd: 13,
      rn: 13,
      rm: 14,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "str",
      width: 64,
      rt: 13,
      rn: 9,
      offset: nativeStringLengthOffset,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 9,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    // x14 runs on from the left part into the right one.
    // A sliced part is read through its unit address (x12 is free once
    // the destination's kind is chosen).
    function part(source: number, prefix: string, wide: boolean): void {
      emit({
        op: "ldr",
        width: 32,
        rt: 15,
        rn: source,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: source,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      emit({ op: "ldr", width: 64, rt: 16, rn: source, offset: 0 });
      sliceData(prefix + "-source", source, 16, 13, 12);
      if (!wide) {
        copyBytes(prefix);
        return;
      }
      testTwoByte(16);
      branch(prefix + "-widen", "ne");
      double(15);
      copyBytes(prefix);
      branch(prefix + "-next");
      label(prefix + "-widen");
      widenUnits(prefix + "-widen");
      label(prefix + "-next");
    }
    testTwoByte(12);
    branch("one-byte", "ne");
    part(10, "left", true);
    part(11, "right", true);
    emit({ op: "ret", rn: 30 });
    label("one-byte");
    part(10, "left-one", false);
    part(11, "right-one", false);
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-write-copy") {
    // x9 fresh target, x10 source, x11 unit offset. Clobbers x11-x16 and
    // flags. The builder sized the target for every write and chose its
    // kind from every source; an overrun or a two-byte source in a
    // one-byte target is a compiler invariant failure and traps instead of
    // corrupting the heap.
    emit({
      op: "ldr",
      width: 32,
      rt: 12,
      rn: 10,
      offset: nativeStringLengthOffset,
    });
    emit({
      op: "ldr",
      width: 32,
      rt: 13,
      rn: 9,
      offset: nativeStringLengthOffset,
    });
    emit({
      op: "add-reg",
      width: 64,
      rd: 15,
      rn: 11,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    compare(15, 13);
    branch("write-bounded", "ls");
    emit({ op: "brk", immediate: 3 });
    label("write-bounded");
    move(15, 12);
    emit({
      op: "add-imm",
      width: 64,
      rd: 13,
      rn: 10,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "ldr", width: 64, rt: 16, rn: 10, offset: 0 });
    sliceData("source", 10, 16, 13, 14);
    emit({ op: "ldr", width: 64, rt: 12, rn: 9, offset: 0 });
    testTwoByte(12);
    branch("one-byte", "ne");
    dataAddress(14, 9, 11, 1);
    testTwoByte(16);
    branch("widen", "ne");
    double(15);
    copyBytes("two");
    emit({ op: "ret", rn: 30 });
    label("widen");
    widenUnits("widen");
    emit({ op: "ret", rn: 30 });
    label("one-byte");
    testTwoByte(16);
    branch("one-byte-source", "ne");
    emit({ op: "brk", immediate: 3 });
    label("one-byte-source");
    dataAddress(14, 9, 11, 0);
    copyBytes("one");
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-equal") {
    // x9/x10 distinct strings of equal length in w12, w11/w13 their
    // header high words (the kind flags), which are equal or include a
    // slice's: the inline prelude's filter. -> w9 boolean. Clobbers x9-x15
    // and flags. The n data bytes are compared a word at a time, the last
    // word overlapping the one before it. Each string has at least eight
    // data bytes, so a shorter text compares one word with the bytes past
    // its length shifted out; slices have more than eight.
    emit({ op: "orr-reg", width: 64, rd: 15, rn: 11, rm: 13 });
    asm.testBit("sliced", 15, slicedBit - 32, true);
    label("compare");
    compareImmediate(12, 0);
    branch("equal", "eq");
    asm.testBit("byte-count", 11, nativeHeaderFlagsShift - 32, true);
    double(12);
    label("byte-count");
    advance(9, nativeStringDataOffset);
    advance(10, nativeStringDataOffset);
    compareImmediate(12, 8);
    branch("long", "hi");
    // n <= 8: one word, shifted left by (8 - n) * 8 to drop padding bytes.
    emit({ op: "ldr", width: 64, rt: 14, rn: 9, offset: 0 });
    emit({ op: "ldr", width: 64, rt: 15, rn: 10, offset: 0 });
    emit({ op: "eor-reg", width: 64, rd: 14, rn: 14, rm: 15 });
    emit({ op: "movz", width: 64, rd: 13, immediate: 8, shift: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 13,
      rn: 13,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "ubfm", width: 64, rd: 13, rn: 13, immr: 61, imms: 60 });
    emit({ op: "lslv", width: 64, rd: 14, rn: 14, rm: 13 });
    compareImmediate(14, 0);
    branch("equal", "eq");
    branch("different");
    label("long");
    // x11 the last word's offset (n - 8); words before it, then that word.
    emit({
      op: "sub-imm",
      width: 64,
      rd: 11,
      rn: 12,
      immediate: 8,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "movz", width: 64, rd: 13, immediate: 0, shift: 0 });
    label("words");
    emit({
      op: "ldr-indexed",
      size: 3,
      fp: false,
      rt: 14,
      rn: 9,
      rm: 13,
      scaled: false,
    });
    emit({
      op: "ldr-indexed",
      size: 3,
      fp: false,
      rt: 15,
      rn: 10,
      rm: 13,
      scaled: false,
    });
    compare(14, 15);
    branch("different", "ne");
    advance(13, 8);
    compare(13, 11);
    branch("words", "cc");
    emit({
      op: "ldr-indexed",
      size: 3,
      fp: false,
      rt: 14,
      rn: 9,
      rm: 11,
      scaled: false,
    });
    emit({
      op: "ldr-indexed",
      size: 3,
      fp: false,
      rt: 15,
      rn: 10,
      rm: 11,
      scaled: false,
    });
    compare(14, 15);
    branch("different", "ne");
    branch("equal");
    resultLabels();
    // A slice equals only a string of its kind (bit 16 of the high words);
    // each slice is read from its parent plus its start, then compared as
    // flat units.
    label("sliced");
    emit({ op: "eor-reg", width: 64, rd: 15, rn: 11, rm: 13 });
    asm.testBit("different", 15, nativeHeaderFlagsShift - 32, true);
    sliceBase("left-flat", 9, 11, 14);
    sliceBase("right-flat", 10, 13, 14);
    branch("compare");
  } else if (kind === "string-starts-with") {
    // x9 source, x10 search, d0 position -> w9 boolean. Clobbers x9-x15,
    // d0/d1 and flags. Clamp to [0,length], not relative to end. A
    // two-byte search never occurs in a one-byte source; a one-byte search
    // in a two-byte source compares each unit widened.
    emit({ op: "fcmp", rn: 0, rm: 0 });
    branch("position-ordered", "vc");
    emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
    label("position-ordered");
    emit({ op: "frintz", rd: 0, rn: 0 });
    emit({ op: "fmov-d-x", rd: 1, rn: "zr" });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    branch("position-positive", "ge");
    emit({ op: "fmov-d-d", rd: 0, rn: 1 });
    label("position-positive");
    emit({
      op: "ldr",
      width: 32,
      rt: 12,
      rn: 9,
      offset: nativeStringLengthOffset,
    });
    emit({ op: "ucvtf-d-w", rd: 1, rn: 12 });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    branch("position-bounded", "le");
    emit({ op: "fmov-d-d", rd: 0, rn: 1 });
    label("position-bounded");
    emit({ op: "fcvtzs-w-d", rd: 13, rn: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 12,
      rn: 12,
      rm: 13,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "ldr",
      width: 32,
      rt: 11,
      rn: 10,
      offset: nativeStringLengthOffset,
    });
    compare(11, 12);
    branch("different", "hi");
    compareImmediate(11, 0);
    branch("equal", "eq");
    emit({ op: "ldr", width: 64, rt: 14, rn: 9, offset: 0 });
    emit({ op: "ldr", width: 64, rt: 15, rn: 10, offset: 0 });
    flattenBase("source", 9, 14, 16);
    flattenBase("search", 10, 15, 16);
    testTwoByte(15);
    branch("search-one-byte", "ne");
    testTwoByte(14);
    branch("different", "ne");
    dataAddress(9, 9, 13, 1);
    advance(10, nativeStringDataOffset);
    double(11);
    compareBytes("two");
    label("search-one-byte");
    testTwoByte(14);
    branch("widened", "eq");
    dataAddress(9, 9, 13, 0);
    advance(10, nativeStringDataOffset);
    compareBytes("one");
    label("widened");
    dataAddress(9, 9, 13, 1);
    advance(10, nativeStringDataOffset);
    label("widened-units");
    emit({ op: "ldrh", rt: 14, rn: 9, offset: 0 });
    emit({ op: "ldrb", rt: 15, rn: 10, offset: 0 });
    compare(14, 15);
    branch("different", "ne");
    advance(9, 2);
    advance(10, 1);
    decrement(11, 1);
    branch("widened-units", "ne");
    branch("equal");
    resultLabels();
  } else if (kind === "bytes-ascii-prefix") {
    // x13 the first byte, x15 the count -> x9 the leading bytes below
    // 0x80. Preserves x11; clobbers x10 and x12-x16.
    asciiPrefix("bytes", 1);
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-ascii-prefix") {
    // x9 string, x11 begin, x15 count (in range) -> x9 the leading units
    // below 0x80. Preserves x11; clobbers x10 and x12-x16.
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    flattenBase("source", 9, 10, 14);
    testTwoByte(10);
    branch("two-byte", "eq");
    dataAddress(13, 9, 11, 0);
    asciiPrefix("one", 1);
    emit({ op: "ret", rn: 30 });
    label("two-byte");
    dataAddress(13, 9, 11, 1);
    asciiPrefix("two", 2);
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-ascii-upper" || kind === "string-ascii-lower") {
    // x9 fresh destination (header and length written), x10 source of the
    // same kind and length: copies the units with each ASCII letter of the
    // other case mapped, every other unit unchanged. One-byte units go
    // sixteen at a time (unit - first letter < 26 selects the 0x20 flip),
    // with an overlapping last vector for the tail; short and two-byte
    // strings go unit by unit. Clobbers x10-x16 and v0-v4.
    const first = kind === "string-ascii-upper" ? 0x61 : 0x41;
    emit({
      op: "ldr",
      width: 32,
      rt: 15,
      rn: 10,
      offset: nativeStringLengthOffset,
    });
    emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
    emit({
      op: "add-imm",
      width: 64,
      rd: 13,
      rn: 10,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    sliceData("source", 10, 11, 13, 12);
    emit({
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 9,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    testTwoByte(11);
    branch("halfwords", "eq");
    compareImmediate(15, 16);
    branch("bytes", "cc");
    emit({ op: "movi-16b", vd: 2, immediate: first });
    emit({ op: "movi-16b", vd: 3, immediate: 26 });
    emit({ op: "movi-16b", vd: 4, immediate: 0x20 });
    label("vectors");
    asciiCaseVector();
    advance(13, 16);
    advance(14, 16);
    decrement(15, 16);
    compareImmediate(15, 16);
    branch("vectors", "cs");
    compareImmediate(15, 0);
    branch("done", "eq");
    // The last sixteen units again, overlapping: x16 = 16 - remaining.
    emit({ op: "movz", width: 64, rd: 16, immediate: 16, shift: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 16,
      rn: 16,
      rm: 15,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 13,
      rn: 13,
      rm: 16,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 14,
      rn: 14,
      rm: 16,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    asciiCaseVector();
    branch("done");
    asciiCaseUnits("bytes", 1, first);
    asciiCaseUnits("halfwords", 2, first);
    label("done");
    emit({ op: "ret", rn: 30 });
  } else if (kind === "bytes-copy") {
    // x13 source, x14 destination, x15 count. Clobbers x12-x16 and v0.
    copyBytes("copy");
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-copy-latin1") {
    // x9 string, x11 begin, x14 destination, x15 count (in range) -> x9
    // the count, or -1 when a unit is above 0xFF (the destination is then
    // partly written). A two-byte string narrows eight units at a time,
    // checking their high bytes (SHRN). Clobbers x10-x16, v0 and v1.
    move(10, 15);
    emit({ op: "ldr", width: 64, rt: 12, rn: 9, offset: 0 });
    flattenBase("source", 9, 12, 16);
    testTwoByte(12);
    branch("two-byte", "eq");
    dataAddress(13, 9, 11, 0);
    copyBytes("one");
    move(9, 10);
    emit({ op: "ret", rn: 30 });
    label("two-byte");
    dataAddress(13, 9, 11, 1);
    compareImmediate(15, 8);
    branch("tail", "cc");
    label("vectors");
    emit({ op: "ldr-q", qt: 0, rn: 13, offset: 0 });
    emit({ op: "shrn-8b-8", vd: 1, vn: 0 });
    emit({ op: "fmov-x-d", rd: 16, rn: 1 });
    compareImmediate(16, 0);
    branch("wide", "ne");
    emit({ op: "xtn-8b", vd: 0, vn: 0 });
    emit({ op: "str-d", rt: 0, rn: 14, offset: 0 });
    advance(13, 16);
    advance(14, 8);
    decrement(15, 8);
    compareImmediate(15, 8);
    branch("vectors", "cs");
    label("tail");
    compareImmediate(15, 0);
    branch("narrowed", "eq");
    label("units");
    emit({ op: "ldrh", rt: 16, rn: 13, offset: 0 });
    compareImmediate(16, 0xff);
    branch("wide", "hi");
    emit({ op: "strb", rt: 16, rn: 14, offset: 0 });
    advance(13, 2);
    advance(14, 1);
    decrement(15, 1);
    branch("units", "ne");
    label("narrowed");
    move(9, 10);
    emit({ op: "ret", rn: 30 });
    label("wide");
    emit({ op: "movz", width: 64, rd: 9, immediate: 0, shift: 0 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 9,
      rn: 9,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-utf8-length") {
    // x9 string, x11 begin, x15 count (in range) -> x9 the units' UTF-8
    // byte length: one per unit, plus one per one-byte unit at 0x80 or
    // above (sixteen bytes per step: bit 7 of each, summed by a multiply);
    // two-byte units below 0x80 eight, then four, per step, then one
    // scalar at a time (a pair inside the range is four bytes, a lone
    // surrogate three).
    // Preserves x11; clobbers x10 and x12-x16.
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    flattenBase("source", 9, 10, 14);
    testTwoByte(10);
    branch("two-byte", "eq");
    dataAddress(13, 9, 11, 0);
    move(9, 15);
    repeatedHalfwords(0x8080);
    repeatedHalfwords(0x0101, 14);
    label("one-pairs");
    compareImmediate(15, 16);
    branch("one-word", "cc");
    emit({
      op: "ldp",
      width: 64,
      rt: 16,
      rt2: 10,
      rn: 13,
      offset: 0,
      mode: "offset",
    });
    emit({ op: "and-reg", width: 64, rd: 16, rn: 16, rm: 12 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 10, rm: 12 });
    field(16, 16, 7, 57);
    emit({
      op: "add-reg",
      width: 64,
      rd: 16,
      rn: 16,
      rm: 10,
      shift: "lsr",
      amount: 7,
      setFlags: false,
    });
    // Each byte of x16 now counts 0-2; their sum (at most 16) is the top
    // byte of x16 * 0x0101010101010101.
    emit({ op: "madd", width: 64, rd: 16, rn: 16, rm: 14, ra: "zr" });
    field(16, 16, 56, 8);
    addShifted(9, 9, 16, 0);
    step(16, 16, 0, 0);
    branch("one-pairs");
    label("one-word");
    compareImmediate(15, 8);
    branch("one-units", "cc");
    emit({ op: "ldr", width: 64, rt: 16, rn: 13, offset: 0 });
    emit({ op: "and-reg", width: 64, rd: 16, rn: 16, rm: 12 });
    field(16, 16, 7, 57);
    emit({ op: "madd", width: 64, rd: 16, rn: 16, rm: 14, ra: "zr" });
    field(16, 16, 56, 8);
    addShifted(9, 9, 16, 0);
    step(8, 8, 0, 0);
    label("one-units");
    compareImmediate(15, 0);
    branch("done", "eq");
    emit({ op: "ldrb", rt: 16, rn: 13, offset: 0 });
    field(16, 16, 7, 1);
    addShifted(9, 9, 16, 0);
    step(1, 1, 0, 0);
    branch("one-units");
    label("two-byte");
    dataAddress(13, 9, 11, 1);
    emit({ op: "movz", width: 64, rd: 9, immediate: 0, shift: 0 });
    repeatedHalfwords(0xff80);
    label("two-pairs");
    compareImmediate(15, 8);
    branch("two-word", "cc");
    emit({
      op: "ldp",
      width: 64,
      rt: 16,
      rt2: 10,
      rn: 13,
      offset: 0,
      mode: "offset",
    });
    emit({ op: "orr-reg", width: 64, rd: 10, rn: 10, rm: 16 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 10, rm: 12 });
    asm.zeroBranch("two-word", 10, true);
    advance(9, 8);
    step(16, 8, 0, 0);
    branch("two-pairs");
    label("two-word");
    compareImmediate(15, 4);
    branch("two-scalar", "cc");
    emit({ op: "ldr", width: 64, rt: 16, rn: 13, offset: 0 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 16, rm: 12 });
    asm.zeroBranch("two-scalar", 10, true);
    advance(9, 4);
    step(8, 4, 0, 0);
    branch("two-pairs");
    label("two-scalar");
    compareImmediate(15, 0);
    branch("done", "eq");
    emit({ op: "ldrh", rt: 16, rn: 13, offset: 0 });
    compareImmediate(16, 0x80);
    branch("two-one", "cc");
    compareImmediate(16, 0x800);
    branch("two-two", "cc");
    // x10 = unit - 0xD800: a high surrogate is below 0x400.
    subtractImmediate(10, 16, 0xd, 12);
    subtractImmediate(10, 10, 0x800);
    compareImmediate(10, 0x400);
    branch("two-three", "cs");
    compareImmediate(15, 2);
    branch("two-three", "cc");
    emit({ op: "ldrh", rt: 10, rn: 13, offset: 2 });
    subtractImmediate(10, 10, 0xd, 12);
    subtractImmediate(10, 10, 0xc00);
    compareImmediate(10, 0x400);
    branch("two-three", "cs");
    advance(9, 4);
    step(4, 2, 0, 0);
    branch("two-pairs");
    label("two-three");
    advance(9, 1);
    label("two-two");
    advance(9, 1);
    label("two-one");
    advance(9, 1);
    step(2, 1, 0, 0);
    branch("two-pairs");
    label("done");
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-write-utf8") {
    // x9 string, x11 begin, x15 count (in range), x14 destination, x12 its
    // capacity in bytes -> x9 the units encoded: scalar by scalar while
    // the next one fits. Units below 0x80 go eight at a time (one-byte:
    // one word; two-byte: narrowed with XTN). Clobbers x10-x16 and v0.
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    flattenBase("source", 9, 10, 16);
    testTwoByte(10);
    branch("two-byte", "eq");
    dataAddress(13, 9, 11, 0);
    move(9, 15);
    repeatedHalfwords(0x8080, 11);
    label("one-words");
    compareImmediate(15, 8);
    branch("one-unit", "cc");
    compareImmediate(12, 8);
    branch("one-unit", "cc");
    emit({ op: "ldr", width: 64, rt: 16, rn: 13, offset: 0 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 16, rm: 11 });
    asm.zeroBranch("one-unit", 10, true);
    emit({ op: "str", width: 64, rt: 16, rn: 14, offset: 0 });
    step(8, 8, 8, 8);
    branch("one-words");
    label("one-unit");
    asm.zeroBranch("done", 15, false);
    emit({ op: "ldrb", rt: 16, rn: 13, offset: 0 });
    compareImmediate(16, 0x80);
    branch("one-two", "cs");
    asm.zeroBranch("done", 12, false);
    emit({ op: "strb", rt: 16, rn: 14, offset: 0 });
    step(1, 1, 1, 1);
    branch("one-words");
    label("one-two");
    compareImmediate(12, 2);
    branch("done", "cc");
    field(10, 16, 6, 2);
    addImmediate(10, 10, 0xc0);
    emit({ op: "strb", rt: 10, rn: 14, offset: 0 });
    continuation(16, 0, 1);
    step(1, 1, 2, 2);
    branch("one-words");
    label("two-byte");
    dataAddress(13, 9, 11, 1);
    move(9, 15);
    repeatedHalfwords(0xff80, 11);
    label("two-vectors");
    compareImmediate(15, 8);
    branch("two-unit", "cc");
    compareImmediate(12, 8);
    branch("two-unit", "cc");
    emit({
      op: "ldp",
      width: 64,
      rt: 16,
      rt2: 10,
      rn: 13,
      offset: 0,
      mode: "offset",
    });
    emit({ op: "orr-reg", width: 64, rd: 10, rn: 10, rm: 16 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 10, rm: 11 });
    asm.zeroBranch("two-unit", 10, true);
    emit({ op: "ldr-q", qt: 0, rn: 13, offset: 0 });
    emit({ op: "xtn-8b", vd: 0, vn: 0 });
    emit({ op: "str-d", rt: 0, rn: 14, offset: 0 });
    step(16, 8, 8, 8);
    branch("two-vectors");
    label("two-unit");
    asm.zeroBranch("done", 15, false);
    emit({ op: "ldrh", rt: 16, rn: 13, offset: 0 });
    compareImmediate(16, 0x80);
    branch("two-multi", "cs");
    asm.zeroBranch("done", 12, false);
    emit({ op: "strb", rt: 16, rn: 14, offset: 0 });
    step(2, 1, 1, 1);
    branch("two-vectors");
    label("two-multi");
    compareImmediate(16, 0x800);
    branch("two-wide", "cs");
    compareImmediate(12, 2);
    branch("done", "cc");
    field(10, 16, 6, 5);
    addImmediate(10, 10, 0xc0);
    emit({ op: "strb", rt: 10, rn: 14, offset: 0 });
    continuation(16, 0, 1);
    step(2, 1, 2, 2);
    branch("two-vectors");
    label("two-wide");
    // x10 = unit - 0xD800: not a surrogate at 0x800 or more, a low one
    // (alone: U+FFFD) at 0x400 or more.
    subtractImmediate(10, 16, 0xd, 12);
    subtractImmediate(10, 10, 0x800);
    compareImmediate(10, 0x800);
    branch("two-three", "cs");
    compareImmediate(10, 0x400);
    branch("two-lone", "cs");
    compareImmediate(15, 2);
    branch("two-lone", "cc");
    emit({ op: "ldrh", rt: 10, rn: 13, offset: 2 });
    subtractImmediate(10, 10, 0xd, 12);
    subtractImmediate(10, 10, 0xc00);
    compareImmediate(10, 0x400);
    branch("two-lone", "cs");
    compareImmediate(12, 4);
    branch("done", "cc");
    // The pair's point: 0x10000 + ((high & 0x3FF) << 10) + (low - 0xDC00).
    emit({ op: "ubfm", width: 64, rd: 16, rn: 16, immr: 54, imms: 9 });
    addShifted(16, 16, 10, 0);
    addImmediate(16, 16, 0x10, 12);
    field(10, 16, 18, 3);
    addImmediate(10, 10, 0xf0);
    emit({ op: "strb", rt: 10, rn: 14, offset: 0 });
    continuation(16, 12, 1);
    continuation(16, 6, 2);
    continuation(16, 0, 3);
    step(4, 2, 4, 4);
    branch("two-vectors");
    label("two-lone");
    emit({ op: "movz", width: 64, rd: 16, immediate: 0xfffd, shift: 0 });
    label("two-three");
    compareImmediate(12, 3);
    branch("done", "cc");
    field(10, 16, 12, 4);
    addImmediate(10, 10, 0xe0);
    emit({ op: "strb", rt: 10, rn: 14, offset: 0 });
    continuation(16, 6, 1);
    continuation(16, 0, 2);
    step(2, 1, 3, 3);
    branch("two-vectors");
    label("done");
    emit({
      op: "sub-reg",
      width: 64,
      rd: 9,
      rn: 9,
      rm: 15,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "ret", rn: 30 });
  } else if (kind === "bytes-utf8-measure") {
    // x13 the first byte, x15 the count -> x12 the bytes of the longest
    // prefix of complete valid UTF-8 sequences, x15 the bytes after it, x11
    // their UTF-16 units and x14 1 when every scalar is at most 0xFF (C2
    // and C3 leads only), else 0. ASCII bytes go sixteen, then eight, at a
    // time. Clobbers x9, x10, x13 and x16.
    move(10, 13);
    emit({ op: "movz", width: 64, rd: 11, immediate: 0, shift: 0 });
    emit({ op: "movz", width: 64, rd: 14, immediate: 1, shift: 0 });
    repeatedHalfwords(0x8080);
    label("pairs");
    compareImmediate(15, 16);
    branch("word", "cc");
    emit({
      op: "ldp",
      width: 64,
      rt: 16,
      rt2: 9,
      rn: 13,
      offset: 0,
      mode: "offset",
    });
    emit({ op: "orr-reg", width: 64, rd: 16, rn: 16, rm: 9 });
    emit({ op: "and-reg", width: 64, rd: 16, rn: 16, rm: 12 });
    asm.zeroBranch("word", 16, true);
    advance(11, 16);
    step(16, 16, 0, 0);
    branch("pairs");
    label("word");
    compareImmediate(15, 8);
    branch("byte", "cc");
    emit({ op: "ldr", width: 64, rt: 16, rn: 13, offset: 0 });
    emit({ op: "and-reg", width: 64, rd: 16, rn: 16, rm: 12 });
    asm.zeroBranch("byte", 16, true);
    advance(11, 8);
    step(8, 8, 0, 0);
    branch("pairs");
    label("byte");
    asm.zeroBranch("end", 15, false);
    emit({ op: "ldrb", rt: 16, rn: 13, offset: 0 });
    compareImmediate(16, 0x80);
    branch("lead", "cs");
    advance(11, 1);
    step(1, 1, 0, 0);
    branch("pairs");
    label("lead");
    subtractImmediate(9, 16, 0xc2);
    compareImmediate(9, 0xdf - 0xc2);
    branch("two", "ls");
    subtractImmediate(9, 16, 0xe0);
    compareImmediate(9, 0xf);
    branch("three", "ls");
    subtractImmediate(9, 16, 0xf0);
    compareImmediate(9, 4);
    branch("four", "ls");
    branch("end");
    label("two");
    compareImmediate(15, 2);
    branch("end", "cc");
    expectContinuation(1, 0x80, 0xbf, "end");
    compareImmediate(16, 0xc3);
    branch("two-narrow", "ls");
    emit({ op: "movz", width: 64, rd: 14, immediate: 0, shift: 0 });
    label("two-narrow");
    advance(11, 1);
    step(2, 2, 0, 0);
    branch("pairs");
    label("three");
    compareImmediate(15, 3);
    branch("end", "cc");
    compareImmediate(16, 0xe0);
    branch("three-e0", "eq");
    compareImmediate(16, 0xed);
    branch("three-ed", "eq");
    expectContinuation(1, 0x80, 0xbf, "end");
    branch("three-last");
    label("three-e0");
    expectContinuation(1, 0xa0, 0xbf, "end");
    branch("three-last");
    label("three-ed");
    expectContinuation(1, 0x80, 0x9f, "end");
    label("three-last");
    expectContinuation(2, 0x80, 0xbf, "end");
    emit({ op: "movz", width: 64, rd: 14, immediate: 0, shift: 0 });
    advance(11, 1);
    step(3, 3, 0, 0);
    branch("pairs");
    label("four");
    compareImmediate(15, 4);
    branch("end", "cc");
    compareImmediate(16, 0xf0);
    branch("four-f0", "eq");
    compareImmediate(16, 0xf4);
    branch("four-f4", "eq");
    expectContinuation(1, 0x80, 0xbf, "end");
    branch("four-last");
    label("four-f0");
    expectContinuation(1, 0x90, 0xbf, "end");
    branch("four-last");
    label("four-f4");
    expectContinuation(1, 0x80, 0x8f, "end");
    label("four-last");
    expectContinuation(2, 0x80, 0xbf, "end");
    expectContinuation(3, 0x80, 0xbf, "end");
    emit({ op: "movz", width: 64, rd: 14, immediate: 0, shift: 0 });
    advance(11, 2);
    step(4, 4, 0, 0);
    branch("pairs");
    label("end");
    emit({
      op: "sub-reg",
      width: 64,
      rd: 12,
      rn: 13,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "ret", rn: 30 });
  } else if (kind === "bytes-utf8-decode") {
    // x9 a fresh string (header and length written), x11 its length, x13
    // the source bytes, x15 their count (bytes-utf8-measure's prefix):
    // writes the decoded units. Leads are not revalidated, but writes stay
    // within the x11 units and reads within the x15 bytes whatever the
    // bytes hold (a shared buffer may change after measuring); units left
    // unwritten are zero. ASCII bytes go eight at a time (two-byte: sixteen,
    // then eight, widened with UXTL). Clobbers x9-x16, v0 and v1.
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    emit({
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 9,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    repeatedHalfwords(0x8080, 9);
    testTwoByte(10);
    branch("two-byte", "eq");
    label("one-words");
    compareImmediate(15, 8);
    branch("one-unit", "cc");
    compareImmediate(11, 8);
    branch("one-unit", "cc");
    emit({ op: "ldr", width: 64, rt: 16, rn: 13, offset: 0 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 16, rm: 9 });
    asm.zeroBranch("one-unit", 10, true);
    emit({ op: "str", width: 64, rt: 16, rn: 14, offset: 0 });
    step(8, 8, 8, 8, 11);
    branch("one-words");
    label("one-unit");
    asm.zeroBranch("one-pad", 15, false);
    asm.zeroBranch("done", 11, false);
    emit({ op: "ldrb", rt: 16, rn: 13, offset: 0 });
    compareImmediate(16, 0x80);
    branch("one-pair", "cs");
    emit({ op: "strb", rt: 16, rn: 14, offset: 0 });
    step(1, 1, 1, 1, 11);
    branch("one-words");
    // A C2 or C3 lead: the unit's low byte is (lead << 6) + payload.
    label("one-pair");
    compareImmediate(15, 2);
    branch("one-pad", "cc");
    emit({ op: "ldrb", rt: 10, rn: 13, offset: 1 });
    field(10, 10, 0, 6);
    addShifted(10, 10, 16, 6);
    emit({ op: "strb", rt: 10, rn: 14, offset: 0 });
    step(2, 2, 1, 1, 11);
    branch("one-words");
    label("one-pad");
    asm.zeroBranch("done", 11, false);
    emit({ op: "strb", rt: "zr", rn: 14, offset: 0 });
    advance(14, 1);
    decrement(11, 1);
    branch("one-pad");
    label("two-byte");
    label("two-pairs");
    compareImmediate(15, 16);
    branch("two-words", "cc");
    compareImmediate(11, 16);
    branch("two-words", "cc");
    emit({
      op: "ldp",
      width: 64,
      rt: 16,
      rt2: 10,
      rn: 13,
      offset: 0,
      mode: "offset",
    });
    emit({ op: "orr-reg", width: 64, rd: 12, rn: 16, rm: 10 });
    emit({ op: "and-reg", width: 64, rd: 12, rn: 12, rm: 9 });
    asm.zeroBranch("two-words", 12, true);
    emit({ op: "fmov-d-x", rd: 0, rn: 16 });
    emit({ op: "fmov-d-x", rd: 1, rn: 10 });
    emit({ op: "uxtl-8h", vd: 0, vn: 0 });
    emit({ op: "uxtl-8h", vd: 1, vn: 1 });
    emit({ op: "str-q", qt: 0, rn: 14, offset: 0 });
    emit({ op: "str-q", qt: 1, rn: 14, offset: 16 });
    step(16, 16, 32, 16, 11);
    branch("two-pairs");
    label("two-words");
    compareImmediate(15, 8);
    branch("two-unit", "cc");
    compareImmediate(11, 8);
    branch("two-unit", "cc");
    emit({ op: "ldr", width: 64, rt: 16, rn: 13, offset: 0 });
    emit({ op: "and-reg", width: 64, rd: 10, rn: 16, rm: 9 });
    asm.zeroBranch("two-unit", 10, true);
    emit({ op: "fmov-d-x", rd: 0, rn: 16 });
    emit({ op: "uxtl-8h", vd: 0, vn: 0 });
    emit({ op: "str-q", qt: 0, rn: 14, offset: 0 });
    step(8, 8, 16, 8, 11);
    branch("two-pairs");
    label("two-unit");
    asm.zeroBranch("two-pad", 15, false);
    asm.zeroBranch("done", 11, false);
    emit({ op: "ldrb", rt: 16, rn: 13, offset: 0 });
    compareImmediate(16, 0x80);
    branch("two-multi", "cs");
    emit({ op: "strh", rt: 16, rn: 14, offset: 0 });
    step(1, 1, 2, 1, 11);
    branch("two-pairs");
    label("two-multi");
    compareImmediate(16, 0xe0);
    branch("two-three", "cs");
    compareImmediate(15, 2);
    branch("two-pad", "cc");
    field(16, 16, 0, 5);
    appendPayload(1);
    emit({ op: "strh", rt: 16, rn: 14, offset: 0 });
    step(2, 2, 2, 1, 11);
    branch("two-pairs");
    label("two-three");
    compareImmediate(16, 0xf0);
    branch("two-four", "cs");
    compareImmediate(15, 3);
    branch("two-pad", "cc");
    field(16, 16, 0, 4);
    appendPayload(1);
    appendPayload(2);
    emit({ op: "strh", rt: 16, rn: 14, offset: 0 });
    step(3, 3, 2, 1, 11);
    branch("two-pairs");
    label("two-four");
    compareImmediate(15, 4);
    branch("two-pad", "cc");
    compareImmediate(11, 2);
    branch("two-pad", "cc");
    field(16, 16, 0, 3);
    appendPayload(1);
    appendPayload(2);
    appendPayload(3);
    // A surrogate pair: 0xD800 + (p >> 10) and 0xDC00 + (p & 0x3FF), for
    // p = point - 0x10000.
    subtractImmediate(16, 16, 0x10, 12);
    field(10, 16, 10, 10);
    addImmediate(10, 10, 0xd, 12);
    addImmediate(10, 10, 0x800);
    emit({ op: "strh", rt: 10, rn: 14, offset: 0 });
    field(10, 16, 0, 10);
    addImmediate(10, 10, 0xd, 12);
    addImmediate(10, 10, 0xc00);
    emit({ op: "strh", rt: 10, rn: 14, offset: 2 });
    step(4, 4, 4, 2, 11);
    branch("two-pairs");
    label("two-pad");
    asm.zeroBranch("done", 11, false);
    emit({ op: "strh", rt: "zr", rn: 14, offset: 0 });
    advance(14, 2);
    decrement(11, 1);
    branch("two-pad");
    label("done");
    emit({ op: "ret", rn: 30 });
  } else {
    // x9 object, d0 numeric index -> d0 Number using charCodeAt's integer
    // conversion. Clobbers x9-x12, d0/d1 and flags. Flat allocation bounds
    // keep valid indices < 2^31.
    emit({ op: "fcmp", rn: 0, rm: 0 });
    branch("ordered", "vc");
    emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
    label("ordered");
    emit({ op: "frintz", rd: 0, rn: 0 });
    emit({ op: "fmov-d-x", rd: 1, rn: "zr" });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    branch("invalid", "mi");
    emit({
      op: "ldr",
      width: 32,
      rt: 10,
      rn: 9,
      offset: nativeStringLengthOffset,
    });
    emit({ op: "ucvtf-d-w", rd: 1, rn: 10 });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    branch("invalid", "ge");
    emit({ op: "fcvtzs-w-d", rd: 10, rn: 0 });
    emit({ op: "ldr", width: 64, rt: 11, rn: 9, offset: 0 });
    flattenBase("source", 9, 11, 12);
    testTwoByte(11);
    branch("one-byte", "ne");
    emit({
      op: "add-reg",
      width: 64,
      rd: 9,
      rn: 9,
      rm: 10,
      shift: "lsl",
      amount: 1,
      setFlags: false,
    });
    emit({ op: "ldrh", rt: 10, rn: 9, offset: nativeStringDataOffset });
    emit({ op: "ucvtf-d-w", rd: 0, rn: 10 });
    emit({ op: "ret", rn: 30 });
    label("one-byte");
    emit({
      op: "add-reg",
      width: 64,
      rd: 9,
      rn: 9,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "ldrb", rt: 10, rn: 9, offset: nativeStringDataOffset });
    emit({ op: "ucvtf-d-w", rd: 0, rn: 10 });
    emit({ op: "ret", rn: 30 });
    label("invalid");
    emit({ op: "movz", width: 64, rd: 10, immediate: 0x7ff8, shift: 48 });
    emit({ op: "fmov-d-x", rd: 0, rn: 10 });
    emit({ op: "ret", rn: 30 });
  }
  return asm.finish();
}
