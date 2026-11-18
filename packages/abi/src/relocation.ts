/** Format-neutral address relocation contract. Instruction encodings stay with
 * the target adapter; the image writer resolves destinations relative to the image's virtual base. */
export type ImageAddressTarget =
  | { readonly kind: "data"; readonly offset: number }
  | { readonly kind: "import"; readonly name: string };
export interface ImageAddressReference {
  readonly offset: number;
  readonly byteLength: number;
  readonly alignment: number;
  readonly target: ImageAddressTarget;
}
export type ImageAddressPatchStatus = "complete" | "invalid" | "range";
/** A trusted target adapter patches its declared instruction window before
 * UUID/signature finalization. When file and VM placement differ, siteAddress
 * supplies the VM offset of the instruction at siteOffset. */
export type ImageAddressPatcher = (
  bytes: Uint8Array,
  referenceIndex: number,
  siteOffset: number,
  targetOffset: number,
  siteAddress?: number,
) => ImageAddressPatchStatus;

/** Code offsets are logical offsets within the hosted image. A destination
 * can map them onto one contiguous range or multiple file segments. */
export interface CodeOutput {
  readonly write: (source: Uint8Array, offset: number) => void;
  readonly patch: (
    offset: number,
    byteLength: number,
    update: (bytes: Uint8Array, offset: number) => string | undefined,
  ) => string | undefined;
}
export interface CodePlan {
  readonly byteLength: number;
  readonly write: (output: CodeOutput, base: number) => string | undefined;
}
export function contiguousCodeOutput(
  bytes: Uint8Array,
  codeOffset: number,
): CodeOutput {
  return {
    write: (source, offset) => bytes.set(source, codeOffset + offset),
    patch: (offset, _byteLength, update) => update(bytes, codeOffset + offset),
  };
}
