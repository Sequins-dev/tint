import type {
  ImageAddressTarget,
  ImageAddressReference,
  ImageAddressPatcher,
} from "@tint/abi/relocation";
import { patchRelativeAddress, relativeAddressByteLength } from "./isa.ts";
export interface AArch64AddressReference {
  readonly offset: number;
  readonly rd: number;
  readonly scratch: number;
  readonly target: ImageAddressTarget;
  /** A farRelativeAddress site (docs/large-images.md). */
  readonly far?: true | undefined;
}
/** Keeps register/encoding knowledge in the target, independent of image format. */
export function aarch64ImageRelocations(
  references: readonly AArch64AddressReference[],
): {
  readonly addressFixups: readonly ImageAddressReference[];
  readonly patchAddress: ImageAddressPatcher;
} {
  const captured = references.map((reference): AArch64AddressReference => {
    const target = reference.target;
    return {
      offset: reference.offset,
      rd: reference.rd,
      scratch: reference.scratch,
      target:
        target.kind === "data"
          ? { kind: "data", offset: target.offset }
          : { kind: "import", name: target.name },
      far: reference.far === true ? true : undefined,
    };
  });
  return {
    addressFixups: captured.map((reference) => ({
      offset: reference.offset,
      byteLength: relativeAddressByteLength(reference.far === true),
      alignment: 4,
      target: reference.target,
    })),
    patchAddress: (
      bytes: Uint8Array,
      index: number,
      siteOffset: number,
      targetOffset: number,
    ) => {
      const reference = captured[index];
      if (reference === undefined) return "invalid";
      const patched = patchRelativeAddress(bytes, {
        offset: siteOffset,
        targetOffset,
        rd: reference.rd,
        scratch: reference.scratch,
      });
      return patched.ok
        ? "complete"
        : patched.error === "OUT_OF_RANGE"
          ? "range"
          : "invalid";
    },
  };
}
