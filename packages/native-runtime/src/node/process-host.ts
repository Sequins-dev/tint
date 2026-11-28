import {
  createUTF8Decoder,
  decodeUTF8,
} from "@tint/foundation/text/text-encoding";
import {
  argumentByteLength,
  argumentCount,
  copyArgument,
  targetArchitecture,
  targetOperatingSystem,
} from "../intrinsics/process.ts";
import { nativeTargetArchAArch64, nativeTargetOSDarwin } from "@tint/abi/host";
import { getpid } from "tint:c/libsystem";

export function processPlatform(): string {
  return targetOperatingSystem() === nativeTargetOSDarwin ? "darwin" : "linux";
}

export function processArchitecture(): string {
  return targetArchitecture() === nativeTargetArchAArch64 ? "arm64" : "x64";
}

export function processId(): number {
  return getpid();
}

/** Number of OS process arguments (`argc`), including `argv[0]`. */
export function processArgumentCount(): number {
  return argumentCount();
}

/** Decode OS `argv[index]` as UTF-8, or undefined if `index` is out of range.
 * Uses non-fatal UTF-8 decoding with `ignoreBOM: true` so every byte sequence
 * decodes cleanly without stripping a leading BOM. */
export function processArgumentAt(index: number): string | undefined {
  const length = argumentByteLength(index);
  if (length < 0) return undefined;
  if (length === 0) return "";
  const bytes = new Uint8Array(length);
  if (copyArgument(index, bytes) !== length) return undefined;
  return decodeUTF8(createUTF8Decoder(false, true), bytes) ?? "";
}
