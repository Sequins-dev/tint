import { nativeHostedContextByteLength } from "@tint/abi/host";
import type {
  ImageAddressPatcher,
  ImageAddressReference,
  ImageAddressTarget,
} from "@tint/abi/relocation";
import { patchRelative } from "../isa.ts";
import type {
  Condition,
  Gpr,
  Immediate,
  Instruction,
  LabelReference,
  Memory,
  RelativeFixup,
  Xmm,
} from "../isa.ts";

// The managed result holds a 16-byte header and up to two payload words.
export const resultBytes = 32;
export const resultPayload = 16;
export const normal = 1;
export const thrown = 2;
export const hostedThreadEntryLabel = "tint:hosted-thread-entry";

export const managedBaseOffset = 8;
export const allocatorEntryOffset = 16;
export const allocatorEnvironmentOffset = 24;
export const managedLengthOffset = 32;
export const argumentCountOffset = 40;
export const argumentsOffset = 48;
export const allocationStateOffset = 56;
export const externalMemoryOffset = 64;
export const heapCursorOffset = nativeHostedContextByteLength;
export const heapEndOffset = heapCursorOffset + 8;
export const contextBytes = heapEndOffset + 8;

export type Emit = (instruction: Instruction) => void;

export function gpr(index: number): Gpr<64> {
  return { kind: "gpr", width: 64, index };
}
export function word(index: number): Gpr<32> {
  return { kind: "gpr", width: 32, index };
}
export function byte(index: number): Gpr<8> {
  return { kind: "gpr", width: 8, index };
}
export function xmm(index: number): Xmm {
  return { kind: "xmm", index };
}
export function mem(base: number, disp: number): Memory<64> {
  return { kind: "mem", width: 64, address: { kind: "base", base, disp } };
}
export function rip(name: string): Memory<64> {
  return {
    kind: "mem",
    width: 64,
    address: { kind: "rip", disp: label(name) },
  };
}
export function label(name: string): LabelReference {
  return { kind: "label", label: name };
}
export function imm(value: number): {
  readonly kind: "imm32";
  readonly value: number;
} {
  return { kind: "imm32", value };
}
export function bits(lo: number, hi: number): Immediate {
  return { kind: "imm64", value: { lo, hi } };
}
export function setBoolean(emit: Emit, cc: Condition, reg: number): void {
  emit({ op: "setcc", cc, dst: byte(reg) });
  emit({ op: "movzx", dst: word(reg), src: byte(reg) });
}

export interface ImageRelocations {
  readonly addressFixups: readonly ImageAddressReference[];
  readonly patchAddress: ImageAddressPatcher;
}

/** The image writer gets the exact rel32 or rel64 field and its PC base. */
export function imageRelocations(
  fixups: readonly RelativeFixup[],
  external: ReadonlyMap<string, ImageAddressTarget>,
): ImageRelocations {
  const addressFixups: ImageAddressReference[] = [];
  for (const fixup of fixups) {
    if (fixup === undefined) throw "rel32 fixup invariant";
    const target = external.get(fixup.ref.label);
    if (target === undefined) throw "rel32 symbol invariant";
    addressFixups.push({
      offset: fixup.fieldOffset,
      byteLength: fixup.byteLength,
      alignment: 1,
      target,
    });
  }
  const patchAddress: ImageAddressPatcher = (
    bytes,
    index,
    siteOffset,
    targetOffset,
    siteAddress,
  ) => {
    const fixup = fixups[index];
    if (fixup === undefined) return "invalid";
    return patchRelative(bytes, fixup, siteOffset, targetOffset, siteAddress);
  };
  return { addressFixups, patchAddress };
}
