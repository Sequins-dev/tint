import { writeSigned, writeWord64 } from "@tint/foundation/binary/bytes";
import { fromParts, type Word64 } from "@tint/foundation/binary/word64";

export type IntegerWidth = 8 | 16 | 32 | 64;
type Wide = 16 | 32 | 64;
type DwordOrQword = 32 | 64;

/** Architectural register numbers 0–15. At width 8, 4–7 are SPL–DIL. */
export interface Gpr<W> {
  readonly kind: "gpr";
  readonly width: W;
  readonly index: number;
}

export interface Xmm {
  readonly kind: "xmm";
  readonly index: number;
}

export interface LabelReference {
  readonly kind: "label";

  readonly label: string;
  readonly addend?: number;
  /** Used for a bounded entry jump before the far scratch pair is saved. */
  readonly near?: true;
}

/** A numeric relative operand is a signed displacement from next RIP. */
export type Relative = number | LabelReference;

export type Address =
  | {
      readonly kind: "base";
      readonly base?: number | undefined;
      readonly index?: number | undefined;
      readonly scale?: 1 | 2 | 4 | 8 | undefined;
      readonly disp: number;
    }
  | { readonly kind: "rip"; readonly disp: Relative };

export interface Memory<W> {
  readonly kind: "mem";
  readonly width: W;
  readonly address: Address;
}

type Rm<W> = Gpr<W> | Memory<W>;
type XmmRm<W> = Xmm | Memory<W>;

type SmallImmediate = {
  readonly kind: "imm8" | "imm16" | "imm32";
  readonly value: number;
};
export type Immediate =
  SmallImmediate | { readonly kind: "imm64"; readonly value: Word64 };

export type Condition =
  | "o"
  | "no"
  | "b"
  | "ae"
  | "e"
  | "ne"
  | "be"
  | "a"
  | "s"
  | "ns"
  | "p"
  | "np"
  | "l"
  | "ge"
  | "le"
  | "g";

type Alu = "add" | "or" | "adc" | "sbb" | "and" | "sub" | "xor" | "cmp";
type Unary =
  "inc" | "dec" | "not" | "neg" | "mul" | "imul-one" | "div" | "idiv";
type Shift = "rol" | "ror" | "shl" | "shr" | "sar";
type ScalarDouble =
  "addsd" | "subsd" | "mulsd" | "divsd" | "sqrtsd" | "minsd" | "maxsd";

type Encodable =
  | {
      readonly op: "mov";
      readonly dst: Rm<IntegerWidth>;
      readonly src: Rm<IntegerWidth> | Immediate;
    }
  | {
      readonly op: Alu | "test";
      readonly dst: Rm<IntegerWidth>;
      readonly src: Rm<IntegerWidth> | SmallImmediate;
    }
  | {
      readonly op: "xchg" | "lock-cmpxchg" | "lock-xadd";
      readonly dst: Memory<IntegerWidth>;
      readonly src: Gpr<IntegerWidth>;
    }
  | { readonly op: Unary; readonly dst: Rm<IntegerWidth> }
  | {
      readonly op: Shift;
      readonly dst: Rm<IntegerWidth>;
      readonly count: number | "cl";
    }
  | { readonly op: "imul"; readonly dst: Gpr<Wide>; readonly src: Rm<Wide> }
  | {
      readonly op: "imul-imm";
      readonly dst: Gpr<Wide>;
      readonly src: Rm<Wide>;
      readonly immediate: SmallImmediate;
    }
  | {
      readonly op: "lea";
      readonly dst: Gpr<Wide>;
      readonly src: Memory<IntegerWidth>;
    }
  | {
      readonly op: "movzx" | "movsx";
      readonly dst: Gpr<Wide>;
      readonly src: Rm<8 | 16 | 32>;
    }
  | {
      readonly op: "cmovcc";
      readonly cc: Condition;
      readonly dst: Gpr<Wide>;
      readonly src: Rm<Wide>;
    }
  | { readonly op: "setcc"; readonly cc: Condition; readonly dst: Rm<8> }
  | { readonly op: "jcc"; readonly cc: Condition; readonly target: Relative }
  | { readonly op: "call" | "jmp"; readonly target: Relative | Rm<64> }
  | { readonly op: "push"; readonly src: Rm<64> | SmallImmediate }
  | { readonly op: "pop"; readonly dst: Rm<64> }
  | {
      readonly op:
        "ret" | "nop" | "pause" | "cdq" | "cqo" | "ud2" | "syscall" | "cpuid";
    }
  | { readonly op: "movsd"; readonly dst: XmmRm<64>; readonly src: XmmRm<64> }
  | {
      readonly op: ScalarDouble;
      readonly dst: Xmm;
      readonly src: XmmRm<64>;
    }
  | {
      readonly op: "comisd" | "ucomisd" | "cvtsd2ss";
      readonly dst: Xmm;
      readonly src: XmmRm<64>;
    }
  | {
      readonly op: "andpd" | "orpd" | "xorpd";
      readonly dst: Xmm;
      readonly src: XmmRm<128>;
    }
  | { readonly op: "cvtss2sd"; readonly dst: Xmm; readonly src: XmmRm<32> }
  | {
      readonly op: "cvtsi2sd";
      readonly dst: Xmm;
      readonly src: Rm<DwordOrQword>;
    }
  | {
      readonly op: "cvtsd2si" | "cvttsd2si";
      readonly dst: Gpr<DwordOrQword>;
      readonly src: XmmRm<64>;
    }
  | { readonly op: "movd"; readonly dst: Xmm; readonly src: Gpr<32> }
  | { readonly op: "movd"; readonly dst: Gpr<32>; readonly src: Xmm }
  | { readonly op: "movq"; readonly dst: Xmm; readonly src: Gpr<64> }
  | { readonly op: "movq"; readonly dst: Gpr<64>; readonly src: Xmm };

export type Instruction =
  | Encodable
  | { readonly op: "label"; readonly name: string }
  | { readonly op: "align-entry" };

type Register = Gpr<IntegerWidth> | Xmm;
type RmOperand = Register | Memory<IntegerWidth | 128>;
type FieldWidth = 1 | 2 | 4;
export interface RelativeFixup {
  readonly ref: LabelReference;
  readonly fieldOffset: number;
  readonly byteLength: 4 | 8;
  nextOffset: number;
}

interface Encoding {
  readonly bytes: ByteBuffer;
  fixups: RelativeFixup[];
  readonly far: boolean;
}

const codeChunkBytes = 65536;
interface ByteBuffer {
  readonly chunks: Uint8Array[];
  chunk: Uint8Array;
  used: number;
  length: number;
}

function byteBuffer(): ByteBuffer {
  return {
    chunks: [],
    chunk: new Uint8Array(0),
    used: codeChunkBytes,
    length: 0,
  };
}

/** Keep output bytes in typed chunks during emission, independent of the
 * managed representation and capacity of ordinary Number arrays. */
function append(buffer: ByteBuffer, value: number): void {
  if (buffer.used === codeChunkBytes) {
    const chunk = new Uint8Array(codeChunkBytes);
    buffer.chunks.push(chunk);
    buffer.chunk = chunk;
    buffer.used = 0;
  }
  buffer.chunk[buffer.used] = value;
  buffer.used++;
  buffer.length++;
}

function encodedBytes(buffer: ByteBuffer, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of buffer.chunks) {
    if (chunk === undefined) throw "x86-64 byte chunk invariant";
    const available = buffer.length - offset;
    bytes.set(
      available < codeChunkBytes ? chunk.subarray(0, available) : chunk,
      offset,
    );
    offset += codeChunkBytes;
  }
  return bytes;
}

function invalid(message: string): never {
  throw "x86-64 encoder: " + message;
}

function describeRelative(value: Relative): string {
  if (typeof value === "number") return String(value);
  return value.addend === undefined
    ? value.label
    : value.label + " (addend=" + String(value.addend) + ")";
}

function describeOperand(operand: RmOperand | Immediate): string {
  switch (operand.kind) {
    case "gpr":
      return "gpr" + String(operand.width) + "[" + String(operand.index) + "]";
    case "xmm":
      return "xmm" + String(operand.index);
    case "mem": {
      const address = operand.address;
      const prefix = "mem" + String(operand.width) + "(";
      if (address.kind === "rip")
        return prefix + "rip, disp=" + describeRelative(address.disp) + ")";
      const index =
        address.index === undefined
          ? ""
          : ", index=" +
            String(address.index) +
            ", scale=" +
            String(address.scale ?? 1);
      const base = address.base;
      return (
        prefix +
        "base=" +
        (base === undefined ? "none" : String(base)) +
        index +
        ", disp=" +
        String(address.disp) +
        ")"
      );
    }
    case "imm64":
      return (
        "imm64(hi=" +
        String(operand.value.hi) +
        ", lo=" +
        String(operand.value.lo) +
        ")"
      );
    default:
      return operand.kind + "(" + String(operand.value) + ")";
  }
}

function describeInstruction(insn: Encodable): string {
  const opcode = insn.op + " ";
  switch (insn.op) {
    case "jcc":
      return opcode + insn.cc + ", " + describeRelative(insn.target);
    case "jmp":
    case "call": {
      const target = insn.target;
      return (
        opcode +
        (typeof target === "number" || target.kind === "label"
          ? describeRelative(target)
          : describeOperand(target))
      );
    }
    case "push":
      return opcode + describeOperand(insn.src);
    case "setcc":
      return opcode + insn.cc + ", " + describeOperand(insn.dst);
    case "pop":
    case "inc":
    case "dec":
    case "not":
    case "neg":
    case "mul":
    case "imul-one":
    case "div":
    case "idiv":
      return opcode + describeOperand(insn.dst);
    case "rol":
    case "ror":
    case "shl":
    case "shr":
    case "sar": {
      const count = insn.count;
      return (
        opcode +
        describeOperand(insn.dst) +
        ", " +
        (typeof count === "number" ? String(count) : count)
      );
    }
    case "imul-imm":
      return (
        opcode +
        describeOperand(insn.dst) +
        ", " +
        describeOperand(insn.src) +
        ", " +
        describeOperand(insn.immediate)
      );
    case "cmovcc":
      return (
        opcode +
        insn.cc +
        ", " +
        describeOperand(insn.dst) +
        ", " +
        describeOperand(insn.src)
      );
    case "mov":
    case "add":
    case "or":
    case "adc":
    case "sbb":
    case "and":
    case "sub":
    case "xor":
    case "cmp":
    case "test":
    case "xchg":
    case "lock-cmpxchg":
    case "lock-xadd":
    case "imul":
    case "lea":
    case "movzx":
    case "movsx":
    case "movsd":
    case "addsd":
    case "subsd":
    case "mulsd":
    case "divsd":
    case "sqrtsd":
    case "minsd":
    case "maxsd":
    case "comisd":
    case "ucomisd":
    case "cvtsd2ss":
    case "andpd":
    case "orpd":
    case "xorpd":
    case "cvtss2sd":
    case "cvtsi2sd":
    case "cvtsd2si":
    case "cvttsd2si":
    case "movd":
    case "movq":
      return (
        opcode + describeOperand(insn.dst) + ", " + describeOperand(insn.src)
      );
    default:
      return insn.op;
  }
}

function fits(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function signedLimit(width: FieldWidth): number {
  return width === 1 ? 0x80 : width === 2 ? 0x8000 : 0x80000000;
}

function fitsSigned(value: number, width: FieldWidth): boolean {
  const limit = signedLimit(width);
  return fits(value, -limit, limit - 1);
}

/** Patch a rel32 field in a buffer. Address coordinates may be beyond the
 * buffer, but must share an origin and be non-negative safe integers. */
export function writeRel32(
  bytes: Uint8Array,
  fieldOffset: number,
  nextOffset: number,
  targetOffset: number,
  addend: number = 0,
): void {
  if (
    !fits(nextOffset, 0, Number.MAX_SAFE_INTEGER) ||
    !fits(targetOffset, 0, Number.MAX_SAFE_INTEGER) ||
    !fits(addend, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  )
    invalid("invalid rel32 address or addend");
  // The difference of two non-negative safe integers is exact. If adding
  // the addend leaves the safe range, the result cannot fit rel32 either.
  const disp = targetOffset - nextOffset + addend;
  if (!fitsSigned(disp, 4)) invalid("rel32 displacement out of range");
  if (!writeSigned(bytes, fieldOffset, 4, disp, "little").ok)
    invalid("invalid rel32 field offset");
}

/** Patch in image coordinates, including when the output window and VM
 * address have different origins. */
export function patchRelative(
  bytes: Uint8Array,
  fixup: RelativeFixup,
  site: number,
  target: number,
  address: number = site,
): "complete" | "invalid" | "range" {
  const next = address + fixup.nextOffset - fixup.fieldOffset;
  const distance = target - next + (fixup.ref.addend ?? 0);
  if (!Number.isSafeInteger(distance)) return "range";
  if (fixup.byteLength === 4) {
    if (!fitsSigned(distance, 4)) return "range";
    return writeSigned(bytes, site, 4, distance, "little").ok
      ? "complete"
      : "invalid";
  }
  return writeWord64(
    bytes,
    site,
    { lo: distance >>> 0, hi: Math.floor(distance / 0x100000000) >>> 0 },
    "little",
  ).ok
    ? "complete"
    : "invalid";
}

function patchChunkRelative(
  buffer: ByteBuffer,
  fixup: RelativeFixup,
  target: number,
  scratch: Uint8Array,
): void {
  const page = Math.floor(fixup.fieldOffset / codeChunkBytes);
  const offset = fixup.fieldOffset % codeChunkBytes;
  const chunk = buffer.chunks[page];
  if (chunk === undefined) invalid("missing relative fixup chunk");
  const first = codeChunkBytes - offset;
  const spansChunks = fixup.byteLength > first;
  const status = patchRelative(
    spansChunks ? scratch : chunk,
    fixup,
    spansChunks ? 0 : offset,
    target,
    fixup.fieldOffset,
  );
  if (status === "range") invalid("rel32 displacement out of range");
  if (status !== "complete") invalid("invalid relative fixup field");
  if (spansChunks) {
    const next = buffer.chunks[page + 1];
    if (next === undefined) invalid("missing relative fixup chunk");
    chunk.set(scratch.subarray(0, first), offset);
    next.set(scratch.subarray(first, fixup.byteLength));
  }
}

function lowBits(bytes: ByteBuffer, value: number, width: FieldWidth): void {
  for (let i = 0; i < width; i++) {
    append(bytes, value & 0xff);
    value = value >>> 8;
  }
}

function displacement(bytes: ByteBuffer, value: number, width: 1 | 4): void {
  if (!fitsSigned(value, width)) invalid("displacement out of range");
  lowBits(bytes, value, width);
}

function relative(out: Encoding, value: Relative): void {
  if (typeof value === "number") displacement(out.bytes, value, 4);
  else {
    out.fixups.push({
      ref: value,
      fieldOffset: out.bytes.length,
      byteLength: 4,
      nextOffset: 0,
    });
    lowBits(out.bytes, 0, 4);
  }
}

/** LEA r14,[RIP] / MOVABS r15,delta / LEA r14,[r14+r15]. Both registers
 * are reserved by the far model. None of the three instructions sets flags. */
function farAddress(out: Encoding, target: LabelReference): void {
  const bytes = out.bytes;
  append(bytes, 0x4c);
  append(bytes, 0x8d);
  append(bytes, 0x35);
  append(bytes, 0);
  append(bytes, 0);
  append(bytes, 0);
  append(bytes, 0);
  const nextOffset = bytes.length;
  append(bytes, 0x49);
  append(bytes, 0xbf);
  out.fixups.push({
    ref: target,
    fieldOffset: bytes.length,
    byteLength: 8,
    nextOffset,
  });
  lowBits(bytes, 0, 4);
  lowBits(bytes, 0, 4);
  append(bytes, 0x4f);
  append(bytes, 0x8d);
  append(bytes, 0x34);
  append(bytes, 0x3e);
}

const farTransferBytes = 24;
function farTransfer(
  out: Encoding,
  target: LabelReference,
  call: boolean,
): void {
  farAddress(out, target);
  append(out.bytes, 0x41);
  append(out.bytes, 0xff);
  append(out.bytes, call ? 0xd6 : 0xe6);
}

function registerIndex(index: number): number {
  if (!fits(index, 0, 15)) invalid("invalid register index");
  return index;
}

function integerWidth(width: number): IntegerWidth {
  if (width !== 8 && width !== 16 && width !== 32 && width !== 64)
    invalid("invalid integer width");
  return width;
}

function wide(width: IntegerWidth): Wide {
  if (width === 8) invalid("expected a 16-, 32- or 64-bit operand width");
  return width;
}

function requireWidth(actual: number, expected: number): void {
  if (actual !== expected) invalid("operand width mismatch");
}

function needsByteRex(reg: Register): boolean {
  return reg.kind === "gpr" && reg.width === 8 && reg.index >= 4;
}

function legacyWidth(width: IntegerWidth): number {
  return width === 16 ? 0x66 : 0;
}

function immediateWidth(immediate: SmallImmediate): FieldWidth {
  switch (immediate.kind) {
    case "imm8":
      return 1;
    case "imm16":
      return 2;
    case "imm32":
      return 4;
    default:
      return invalid("invalid immediate kind");
  }
}

function fullImmediateWidth(width: IntegerWidth): FieldWidth {
  return width === 8 ? 1 : width === 16 ? 2 : 4;
}

function emitImmediate(
  bytes: ByteBuffer,
  value: number,
  width: FieldWidth,
  signExtended: boolean,
): void {
  const limit = signedLimit(width);
  if (!fits(value, -limit, signExtended ? limit - 1 : limit * 2 - 1))
    invalid("immediate out of range");
  lowBits(bytes, value, width);
}

/** opcode packs a possible 0F escape in the high byte. REX stores W/R/X/B
 * in its low nibble, with bit 6 also used to request a bare REX prefix. */
function opcodeBytes(
  bytes: ByteBuffer,
  legacy: number,
  rex: number,
  opcode: number,
): void {
  if (legacy !== 0) append(bytes, legacy);
  if (rex !== 0) append(bytes, 0x40 | rex);
  if (opcode > 0xff) append(bytes, opcode >>> 8);
  append(bytes, opcode & 0xff);
}

/** A numeric reg field is a group opcode extension (/0–/7). */
function modRm(
  out: Encoding,
  legacy: number,
  wide64: boolean,
  opcode: number,
  reg: Register | number,
  rm: RmOperand,
  locked: boolean = false,
): void {
  const bytes = out.bytes;
  const regIndex = typeof reg === "number" ? reg : registerIndex(reg.index);
  let rex = (wide64 ? 8 : 0) | (regIndex >= 8 ? 4 : 0);
  if (typeof reg !== "number" && needsByteRex(reg)) rex |= 0x40;
  const regField = (regIndex & 7) << 3;
  if (rm.kind !== "mem") {
    const index = registerIndex(rm.index);
    if (index >= 8) rex |= 1;
    if (needsByteRex(rm)) rex |= 0x40;
    opcodeBytes(bytes, legacy, rex, opcode);
    append(bytes, 0xc0 | regField | (index & 7));
    return;
  }
  const address = rm.address;
  if (address.kind === "rip") {
    const displacement = address.disp;
    if (typeof displacement !== "number" && out.far) {
      if (typeof reg !== "number" && reg.kind === "gpr" && regIndex >= 14)
        invalid("far address uses a reserved register");
      farAddress(out, displacement);
      if (locked) append(bytes, 0xf0);
      opcodeBytes(bytes, legacy, rex | 1, opcode);
      append(bytes, regField | 6); // [r14]
      return;
    }
    if (locked) append(bytes, 0xf0);
    opcodeBytes(bytes, legacy, rex, opcode);
    append(bytes, regField | 5);
    relative(out, displacement);
    return;
  }
  if (address.kind !== "base") invalid("invalid memory address");
  const base = address.base;
  const index = address.index;
  const scale = address.scale ?? 1;
  if (base !== undefined && !fits(base, 0, 15))
    invalid("invalid base register");
  if (index !== undefined && (!fits(index, 0, 15) || index === 4))
    invalid("invalid index register");
  if (
    (index === undefined && address.scale !== undefined) ||
    (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8)
  )
    invalid("invalid index scale");

  const baseField = base === undefined ? 5 : base & 7;
  const disp = address.disp;
  let mod = 0;
  if (base !== undefined && (disp !== 0 || baseField === 5))
    mod = fitsSigned(disp, 1) ? 1 : 2;
  const sib = index !== undefined || base === undefined || baseField === 4;
  if (base !== undefined && base >= 8) rex |= 1;
  if (index !== undefined && index >= 8) rex |= 2;
  if (locked) append(bytes, 0xf0);
  opcodeBytes(bytes, legacy, rex, opcode);
  append(bytes, (mod << 6) | regField | (sib ? 4 : baseField));
  if (sib) {
    const scaleField = scale === 1 ? 0 : scale === 2 ? 1 : scale === 4 ? 2 : 3;
    const indexField = index === undefined ? 4 : index & 7;
    append(bytes, (scaleField << 6) | (indexField << 3) | baseField);
  }
  if (mod === 1) displacement(bytes, disp, 1);
  if (mod === 2 || base === undefined) displacement(bytes, disp, 4);
}

function integerRm(
  out: Encoding,
  width: IntegerWidth,
  opcode: number,
  reg: Register | number,
  rm: RmOperand,
  locked: boolean = false,
): void {
  modRm(out, legacyWidth(width), width === 64, opcode, reg, rm, locked);
}

function registerOpcode(
  bytes: ByteBuffer,
  width: IntegerWidth,
  rexW: boolean,
  opcode: number,
  reg: Gpr<IntegerWidth>,
): void {
  const index = registerIndex(reg.index);
  const rex =
    (rexW ? 8 : 0) | (index >= 8 ? 1 : 0) | (needsByteRex(reg) ? 0x40 : 0);
  opcodeBytes(bytes, legacyWidth(width), rex, opcode + (index & 7));
}

function move(
  out: Encoding,
  dst: Rm<IntegerWidth>,
  src: Rm<IntegerWidth> | Immediate,
): void {
  const width = integerWidth(dst.width);
  if (src.kind === "gpr" || src.kind === "mem") {
    requireWidth(src.width, width);
    if (src.kind === "gpr")
      integerRm(out, width, width === 8 ? 0x88 : 0x89, src, dst);
    else if (dst.kind === "gpr")
      integerRm(out, width, width === 8 ? 0x8a : 0x8b, dst, src);
    else invalid("invalid mov operands: two memory operands");
    return;
  }
  if (src.kind === "imm64") {
    if (width !== 64 || dst.kind !== "gpr")
      invalid("imm64 mov requires a 64-bit register operand");
    const word = fromParts(src.value.lo, src.value.hi);
    if (!word.ok) invalid("invalid imm64 immediate word");
    registerOpcode(out.bytes, width, true, 0xb8, dst);
    lowBits(out.bytes, word.value.lo, 4);
    lowBits(out.bytes, word.value.hi, 4);
    return;
  }
  const size = immediateWidth(src);
  if (size !== fullImmediateWidth(width))
    invalid("invalid mov immediate width");
  if (dst.kind === "gpr" && width !== 64)
    registerOpcode(out.bytes, width, false, width === 8 ? 0xb0 : 0xb8, dst);
  else integerRm(out, width, width === 8 ? 0xc6 : 0xc7, 0, dst);
  emitImmediate(out.bytes, src.value, size, width === 64);
}

function aluGroup(op: Alu | "test"): number {
  switch (op) {
    case "add":
    case "test":
      return 0;
    case "or":
      return 1;
    case "adc":
      return 2;
    case "sbb":
      return 3;
    case "and":
      return 4;
    case "sub":
      return 5;
    case "xor":
      return 6;
    case "cmp":
      return 7;
  }
}

function alu(
  out: Encoding,
  op: Alu | "test",
  dst: Rm<IntegerWidth>,
  src: Rm<IntegerWidth> | SmallImmediate,
): void {
  const width = integerWidth(dst.width);
  const wideOpcode = width === 8 ? 0 : 1;
  const group = aluGroup(op);
  const base = group << 3;
  if (src.kind === "gpr" || src.kind === "mem") {
    requireWidth(src.width, width);
    if (src.kind === "gpr")
      integerRm(
        out,
        width,
        (op === "test" ? 0x84 : base) + wideOpcode,
        src,
        dst,
      );
    else if (dst.kind === "gpr")
      integerRm(
        out,
        width,
        (op === "test" ? 0x84 : base + 2) + wideOpcode,
        dst,
        src,
      );
    else invalid("invalid ALU operands: two memory operands");
    return;
  }
  const size = immediateWidth(src);
  const short = op !== "test" && width !== 8 && size === 1;
  if (!short && size !== fullImmediateWidth(width))
    invalid("invalid ALU immediate width");
  if (!short && dst.kind === "gpr" && dst.index === 0)
    opcodeBytes(
      out.bytes,
      legacyWidth(width),
      width === 64 ? 8 : 0,
      (op === "test" ? 0xa8 : base + 4) + wideOpcode,
    );
  else {
    const opcode =
      op === "test" ? 0xf6 + wideOpcode : short ? 0x83 : 0x80 + wideOpcode;
    integerRm(out, width, opcode, group, dst);
  }
  emitImmediate(out.bytes, src.value, size, short || width === 64);
}

function unaryGroup(op: Unary): number {
  switch (op) {
    case "inc":
      return 0;
    case "dec":
      return 1;
    case "not":
      return 2;
    case "neg":
      return 3;
    case "mul":
      return 4;
    case "imul-one":
      return 5;
    case "div":
      return 6;
    case "idiv":
      return 7;
  }
}

function shiftGroup(op: Shift): number {
  switch (op) {
    case "rol":
      return 0;
    case "ror":
      return 1;
    case "shl":
      return 4;
    case "shr":
      return 5;
    case "sar":
      return 7;
  }
}

function conditionCode(cc: Condition): number {
  switch (cc) {
    case "o":
      return 0;
    case "no":
      return 1;
    case "b":
      return 2;
    case "ae":
      return 3;
    case "e":
      return 4;
    case "ne":
      return 5;
    case "be":
      return 6;
    case "a":
      return 7;
    case "s":
      return 8;
    case "ns":
      return 9;
    case "p":
      return 10;
    case "np":
      return 11;
    case "l":
      return 12;
    case "ge":
      return 13;
    case "le":
      return 14;
    case "g":
      return 15;
    default:
      return invalid("invalid condition code");
  }
}

function sseSource(src: XmmRm<32 | 64 | 128>, width: 32 | 64 | 128): void {
  if (src.kind === "mem") requireWidth(src.width, width);
  else if (src.kind !== "xmm") invalid("expected an XMM or memory operand");
}

function scalarOpcode(op: ScalarDouble): number {
  switch (op) {
    case "sqrtsd":
      return 0x0f51;
    case "addsd":
      return 0x0f58;
    case "mulsd":
      return 0x0f59;
    case "subsd":
      return 0x0f5c;
    case "minsd":
      return 0x0f5d;
    case "divsd":
      return 0x0f5e;
    case "maxsd":
      return 0x0f5f;
  }
}

function emit(out: Encoding, insn: Encodable): void {
  const bytes = out.bytes;
  switch (insn.op) {
    case "mov":
      return move(out, insn.dst, insn.src);
    case "add":
    case "or":
    case "adc":
    case "sbb":
    case "and":
    case "sub":
    case "xor":
    case "cmp":
    case "test":
      return alu(out, insn.op, insn.dst, insn.src);
    case "inc":
    case "dec":
    case "not":
    case "neg":
    case "mul":
    case "imul-one":
    case "div":
    case "idiv": {
      const width = integerWidth(insn.dst.width);
      const group = unaryGroup(insn.op);
      const opcode = (group < 2 ? 0xfe : 0xf6) + (width === 8 ? 0 : 1);
      return integerRm(out, width, opcode, group, insn.dst);
    }
    case "rol":
    case "ror":
    case "shl":
    case "shr":
    case "sar": {
      const width = integerWidth(insn.dst.width);
      const count = insn.count;
      if (count !== "cl" && !fits(count, 0, 255))
        invalid("shift count out of range");
      const opcode =
        (count === 1 ? 0xd0 : count === "cl" ? 0xd2 : 0xc0) +
        (width === 8 ? 0 : 1);
      integerRm(out, width, opcode, shiftGroup(insn.op), insn.dst);
      if (typeof count === "number" && count !== 1) append(bytes, count);
      return;
    }
    case "imul":
    case "imul-imm": {
      const width = wide(integerWidth(insn.dst.width));
      requireWidth(insn.src.width, width);
      if (insn.op === "imul")
        return integerRm(out, width, 0x0faf, insn.dst, insn.src);
      const size = immediateWidth(insn.immediate);
      if (size !== 1 && size !== fullImmediateWidth(width))
        invalid("invalid imul immediate width");
      integerRm(out, width, size === 1 ? 0x6b : 0x69, insn.dst, insn.src);
      return emitImmediate(
        bytes,
        insn.immediate.value,
        size,
        size === 1 || width === 64,
      );
    }
    case "xchg":
    case "lock-cmpxchg":
    case "lock-xadd": {
      const width = integerWidth(insn.dst.width);
      requireWidth(insn.src.width, width);
      if (insn.dst.kind !== "mem") invalid("expected an atomic memory operand");
      const opcode =
        insn.op === "xchg"
          ? 0x86
          : insn.op === "lock-cmpxchg"
            ? 0x0fb0
            : 0x0fc0;
      return integerRm(
        out,
        width,
        opcode + (width === 8 ? 0 : 1),
        insn.src,
        insn.dst,
        insn.op !== "xchg",
      );
    }
    case "lea": {
      if (insn.src.kind !== "mem") invalid("lea requires a memory operand");
      return integerRm(
        out,
        wide(integerWidth(insn.dst.width)),
        0x8d,
        insn.dst,
        insn.src,
      );
    }
    case "movsx":
    case "movzx": {
      const width = wide(integerWidth(insn.dst.width));
      const source = integerWidth(insn.src.width);
      if (source >= width || (source === 32 && insn.op === "movzx"))
        invalid("invalid extension operand width");
      const opcode =
        source === 32
          ? 0x63
          : (insn.op === "movsx" ? 0x0fbe : 0x0fb6) + (source === 8 ? 0 : 1);
      return integerRm(out, width, opcode, insn.dst, insn.src);
    }
    case "cmovcc": {
      const width = wide(integerWidth(insn.dst.width));
      requireWidth(insn.src.width, width);
      return integerRm(
        out,
        width,
        0x0f40 + conditionCode(insn.cc),
        insn.dst,
        insn.src,
      );
    }
    case "setcc":
      requireWidth(insn.dst.width, 8);
      return integerRm(out, 8, 0x0f90 + conditionCode(insn.cc), 0, insn.dst);
    case "jcc": {
      const target = insn.target;
      if (typeof target !== "number" && out.far) {
        append(bytes, 0x70 + (conditionCode(insn.cc) ^ 1));
        append(bytes, farTransferBytes);
        return farTransfer(out, target, false);
      }
      opcodeBytes(bytes, 0, 0, 0x0f80 + conditionCode(insn.cc));
      return relative(out, target);
    }
    case "call":
    case "jmp": {
      const target = insn.target;
      const call = insn.op === "call";
      if (
        out.far &&
        typeof target !== "number" &&
        target.kind === "label" &&
        target.near !== true
      )
        return farTransfer(out, target, call);
      if (typeof target === "number" || target.kind === "label") {
        append(bytes, call ? 0xe8 : 0xe9);
        return relative(out, target);
      }
      requireWidth(target.width, 64);
      return modRm(out, 0, false, 0xff, call ? 2 : 4, target);
    }
    case "push": {
      const src = insn.src;
      if (src.kind === "gpr" || src.kind === "mem") {
        requireWidth(src.width, 64);
        if (src.kind === "gpr")
          return registerOpcode(bytes, 64, false, 0x50, src);
        return modRm(out, 0, false, 0xff, 6, src);
      }
      const size = immediateWidth(src);
      if (size === 2) invalid("invalid push immediate width");
      append(bytes, size === 1 ? 0x6a : 0x68);
      return emitImmediate(bytes, src.value, size, true);
    }
    case "pop": {
      const dst = insn.dst;
      requireWidth(dst.width, 64);
      if (dst.kind === "gpr")
        return registerOpcode(bytes, 64, false, 0x58, dst);
      return modRm(out, 0, false, 0x8f, 0, dst);
    }
    case "ret":
      append(bytes, 0xc3);
      return;
    case "cpuid":
      append(bytes, 0x0f);
      append(bytes, 0xa2);
      return;
    case "ud2":
    case "syscall":
      append(bytes, 0x0f);
      append(bytes, insn.op === "ud2" ? 0x0b : 0x05);
      return;
    case "nop":
      append(bytes, 0x90);
      return;
    case "pause":
      append(bytes, 0xf3);
      append(bytes, 0x90);
      return;
    case "cdq":
    case "cqo":
      return opcodeBytes(bytes, 0, insn.op === "cqo" ? 8 : 0, 0x99);
    case "movsd": {
      const src = insn.src;
      const dst = insn.dst;
      sseSource(src, 64);
      sseSource(dst, 64);
      if (dst.kind === "xmm") return modRm(out, 0xf2, false, 0x0f10, dst, src);
      if (src.kind === "xmm") return modRm(out, 0xf2, false, 0x0f11, src, dst);
      return invalid("invalid movsd operands: two memory operands");
    }
    case "addsd":
    case "subsd":
    case "mulsd":
    case "divsd":
    case "sqrtsd":
    case "minsd":
    case "maxsd":
      sseSource(insn.src, 64);
      return modRm(out, 0xf2, false, scalarOpcode(insn.op), insn.dst, insn.src);
    case "comisd":
    case "ucomisd":
      sseSource(insn.src, 64);
      return modRm(
        out,
        0x66,
        false,
        insn.op === "comisd" ? 0x0f2f : 0x0f2e,
        insn.dst,
        insn.src,
      );
    case "andpd":
    case "orpd":
    case "xorpd":
      sseSource(insn.src, 128);
      return modRm(
        out,
        0x66,
        false,
        insn.op === "andpd" ? 0x0f54 : insn.op === "orpd" ? 0x0f56 : 0x0f57,
        insn.dst,
        insn.src,
      );
    case "cvtsd2ss":
      sseSource(insn.src, 64);
      return modRm(out, 0xf2, false, 0x0f5a, insn.dst, insn.src);
    case "cvtss2sd":
      sseSource(insn.src, 32);
      return modRm(out, 0xf3, false, 0x0f5a, insn.dst, insn.src);
    case "cvtsi2sd":
      if (insn.src.width !== 64) requireWidth(insn.src.width, 32);
      return modRm(
        out,
        0xf2,
        insn.src.width === 64,
        0x0f2a,
        insn.dst,
        insn.src,
      );
    case "cvtsd2si":
    case "cvttsd2si":
      if (insn.dst.width !== 64) requireWidth(insn.dst.width, 32);
      sseSource(insn.src, 64);
      return modRm(
        out,
        0xf2,
        insn.dst.width === 64,
        insn.op === "cvtsd2si" ? 0x0f2d : 0x0f2c,
        insn.dst,
        insn.src,
      );
    case "movd":
    case "movq": {
      const src = insn.src;
      const dst = insn.dst;
      const is64 = insn.op === "movq";
      const width = is64 ? 64 : 32;
      if (dst.kind === "xmm" && src.kind === "gpr") {
        requireWidth(src.width, width);
        return modRm(out, 0x66, is64, 0x0f6e, dst, src);
      }
      if (dst.kind === "gpr" && src.kind === "xmm") {
        requireWidth(dst.width, width);
        return modRm(out, 0x66, is64, 0x0f7e, src, dst);
      }
      return invalid("invalid bit transfer operands");
    }
    default:
      return invalid("unsupported instruction");
  }
}

/** Encode a block with byte-position labels. Near transfers and symbolic RIP
 * operands retain their full rel32 fields regardless of target distance. */
export interface EncodedLayout {
  readonly bytes: Uint8Array;
  readonly labels: ReadonlyMap<string, number>;
  readonly externalFixups: readonly RelativeFixup[];
}

export function encode(instructions: readonly Instruction[]): Uint8Array {
  return encodeLayout(instructions).bytes;
}

/** Resolve local labels immediately and report authorized external sites for
 * final image placement. Both use the actual end of the encoded instruction. */
export function encodeLayout(
  instructions: readonly Instruction[],
  isExternal?: (label: string) => boolean,
  far: boolean = false,
): EncodedLayout {
  const assembler = createAssembler(far);
  for (const instruction of instructions) assembler.instruction(instruction);
  return assembler.finish(isExternal);
}

export interface Assembler {
  readonly labels: ReadonlyMap<string, number>;
  readonly byteLength: () => number;
  readonly instruction: (insn: Instruction) => void;
  readonly beginScope: () => void;
  readonly endScope: (keep: (name: string) => boolean) => void;
  readonly finish: (
    isExternal?: (label: string) => boolean,
    byteLength?: number,
  ) => EncodedLayout;
}

/** Stream instructions into encoding storage and keep only symbols and
 * relocation windows until final placement. */
export function createAssembler(far: boolean = false): Assembler {
  const out: Encoding = { bytes: byteBuffer(), fixups: [], far };
  const labels = new Map<string, number>();
  const scopeLabels: string[] = [];
  const scratch = new Uint8Array(8);
  let scopeFixupStart = -1;
  let finished = false;
  function instruction(insn: Instruction): void {
    if (finished) invalid("assembler already finalized");
    if (insn.op === "label") {
      if (labels.has(insn.name)) invalid("duplicate label: " + insn.name);
      labels.set(insn.name, out.bytes.length);
      if (scopeFixupStart >= 0) scopeLabels.push(insn.name);
    } else if (insn.op === "align-entry") {
      while (out.bytes.length % 4 !== 0) append(out.bytes, 0x90);
    } else {
      const before = out.fixups.length;
      try {
        emit(out, insn);
      } catch (error) {
        if (typeof error === "string")
          throw error + " while encoding " + describeInstruction(insn);
        throw error;
      }
      // Any relative field in this instruction is relative to its end.
      const fixup = out.fixups[before];
      if (fixup !== undefined && fixup.byteLength === 4)
        fixup.nextOffset = out.bytes.length;
    }
  }

  function beginScope(): void {
    if (finished) invalid("assembler already finalized");
    scopeLabels.length = 0;
    scopeFixupStart = out.fixups.length;
  }

  function endScope(keep: (name: string) => boolean): void {
    if (finished) invalid("assembler already finalized");
    if (scopeFixupStart < 0) return;
    let kept = scopeFixupStart;
    for (let i = scopeFixupStart; i < out.fixups.length; i++) {
      const fixup = out.fixups[i];
      if (fixup === undefined) throw "rel32 fixup invariant";
      const target = labels.get(fixup.ref.label);
      if (target !== undefined) {
        patchChunkRelative(out.bytes, fixup, target, scratch);
      } else {
        out.fixups[kept++] = fixup;
      }
    }
    out.fixups.length = kept;
    for (const name of scopeLabels) {
      if (name !== undefined && !keep(name)) labels.delete(name);
    }
    scopeLabels.length = 0;
    scopeFixupStart = -1;
  }

  function finish(
    isExternal?: (label: string) => boolean,
    byteLength: number = out.bytes.length,
  ): EncodedLayout {
    if (finished) invalid("assembler already finalized");
    if (!Number.isSafeInteger(byteLength) || byteLength < out.bytes.length)
      invalid("assembly output is smaller than instruction bytes or invalid");
    finished = true;
    const externalFixups: RelativeFixup[] = [];
    for (const fixup of out.fixups) {
      if (fixup === undefined) throw "rel32 fixup invariant";
      const target = labels.get(fixup.ref.label);
      if (target === undefined) {
        if (isExternal?.(fixup.ref.label) !== true)
          invalid("undefined label: " + fixup.ref.label);
        externalFixups.push(fixup);
        continue;
      }
      patchChunkRelative(out.bytes, fixup, target, scratch);
    }
    // The compiler can accumulate millions of local relocations. Drop their
    // records and backing list before allocating the contiguous output.
    out.fixups = [];
    const bytes = encodedBytes(out.bytes, byteLength);
    out.bytes.chunks.length = 0;
    out.bytes.chunk = new Uint8Array(0);
    return { bytes, labels, externalFixups };
  }
  return {
    labels,
    byteLength: (): number => out.bytes.length,
    instruction,
    beginScope,
    endScope,
    finish,
  };
}
