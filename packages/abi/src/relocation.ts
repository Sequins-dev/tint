/** Format-neutral address relocation contract. Instruction encodings stay with
 * the target adapter; the image writer resolves file-relative destinations. */
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
 * UUID/signature finalization. Offsets are relative to the unsigned image. */
export type ImageAddressPatcher = (
  bytes: Uint8Array,
  referenceIndex: number,
  siteOffset: number,
  targetOffset: number,
) => ImageAddressPatchStatus;
