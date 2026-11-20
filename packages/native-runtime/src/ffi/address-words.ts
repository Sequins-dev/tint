import { Cell } from "tint:c/dl";
import { stableBytes } from "./primitives.ts";

/** Trusted word-preserving memory bindings used by the Node adapter. */
export function adoptExternalWords(
  empty: Uint8Array,
  low: number,
  high: number,
  byteLength: number,
): Uint8Array {
  throw "HOST_UNAVAILABLE";
}

/** Store the exact base address of a stable byte view in an eight-byte cell. */
export function byteAddressInto(
  view: Uint8Array,
  destination: Uint8Array,
): void {
  throw "HOST_UNAVAILABLE";
}

/** Borrow foreign bytes at an exact address with no ownership transfer. */
export function bytesAtWords(address: bigint, length: number): Uint8Array {
  const max = 0xffffffffffffffffn;
  if (address < 0n || address > max || (address === 0n && length !== 0))
    throw new TypeError("invalid C address");
  if (!Number.isInteger(length) || length < 0 || length > 4294967295)
    throw new RangeError("invalid foreign byte length");
  if (length > 0 && BigInt(length - 1) > max - address)
    throw new RangeError("foreign bytes extend past the address space");
  if (address === 0n) return new Uint8Array(0);
  return adoptExternalWords(
    new Uint8Array(0),
    Number(address & 0xffffffffn),
    Number((address >> 32n) & 0xffffffffn),
    length,
  ).subarray(0);
}

/** The backing address of a stable buffer or stable subview. */
export function stableAddressWords(bytes: Uint8Array): bigint {
  if (!stableBytes(bytes))
    throw new TypeError("bytes do not have stable backing");
  const address = new Uint8Array(Cell.size);
  byteAddressInto(bytes, address);
  const halves = Cell.view(address).halves;
  return (BigInt(halves.high) << 32n) | BigInt(halves.low);
}
