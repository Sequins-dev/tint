import { adoptExternal } from "./ffi/primitives.ts";
import {
  readMemoryFloat64,
  readMemoryString,
  writeMemoryFloat64,
  writeMemoryString,
} from "./intrinsics/packet-memory.ts";

/** Trusted access to raw message packets (docs/design-worker-runtime.md):
 * a byte view of a mapping and bulk binary64 and UTF-16 copies, each with the
 * readMemoryWord window contract (address, byteLength, offset). The caller
 * owns the mapping for the whole call and never keeps a view past the
 * packet's lifetime. */
export interface NativePacketMemory {
  /** A byte view of `byteLength` bytes at `address`. */
  view(address: number, byteLength: number): Uint8Array;
  readFloat64(address: number, byteLength: number, offset: number): number;
  writeFloat64(
    address: number,
    byteLength: number,
    offset: number,
    value: number,
  ): number;
  readString(
    address: number,
    byteLength: number,
    offset: number,
    units: number,
  ): string;
  writeString(
    address: number,
    byteLength: number,
    offset: number,
    value: string,
  ): number;
}
/** The embedding must bind the four memory intrinsics this host uses. */
export function nativePacketMemory(): NativePacketMemory {
  return {
    view: (address, byteLength): Uint8Array =>
      adoptExternal(new Uint8Array(0), address, byteLength),
    readFloat64: (address, byteLength, offset): number =>
      readMemoryFloat64(address, byteLength, offset),
    writeFloat64: (address, byteLength, offset, value): number =>
      writeMemoryFloat64(address, byteLength, offset, value),
    readString: (address, byteLength, offset, units): string =>
      readMemoryString(address, byteLength, offset, units),
    writeString: (address, byteLength, offset, value): number =>
      writeMemoryString(address, byteLength, offset, value),
  };
}
