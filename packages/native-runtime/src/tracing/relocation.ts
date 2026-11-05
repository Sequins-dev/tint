import type { ReadWord } from "./scan.ts";
/** Resolve an exact live allocation start; undefined rejects a missing target. */
export type ForwardReference = (address: number) => number | undefined;
function pointer(address: number): boolean {
  return Number.isSafeInteger(address) && address > 0 && address % 8 === 0;
}
/** Resolve an array's derived data pointer through its original owner chain.
 * Call only with a completely validated live inventory and immutable original
 * headers. This computes a fixup; it neither writes nor authorizes moving memory.
 * Borrowed backing is external and unchanged. No allocations occur. */
export function relocateNativeArrayData(
  read: ReadWord,
  address: number,
  forward: ForwardReference,
  maxOwners: number = 1000000,
): number | undefined {
  if (
    !pointer(address) ||
    !Number.isInteger(maxOwners) ||
    maxOwners < 0 ||
    maxOwners > 0xffffffff
  )
    return undefined;
  let current = address,
    initialData = 0,
    childData = 0,
    childBytes = 0;
  for (let depth = 0; depth < maxOwners; depth++) {
    if (!pointer(current) || !Number.isSafeInteger(current + 40))
      return undefined;
    const marker = read(current),
      flags = read(current + 8),
      length = read(current + 16),
      data = read(current + 24);
    if (
      marker === undefined ||
      flags === undefined ||
      length === undefined ||
      data === undefined ||
      !Number.isInteger(marker) ||
      marker < 2 ||
      marker > 5 ||
      !Number.isInteger(flags) ||
      flags < 0 ||
      flags > 2 ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > 0xffffffff ||
      !Number.isSafeInteger(data) ||
      data < 0
    )
      return undefined;
    const width = marker === 2 ? 1 : marker === 3 ? 2 : marker === 4 ? 4 : 8,
      bytes = length * width;
    if (!Number.isSafeInteger(data + bytes) || (data === 0 && bytes > 0))
      return undefined;
    if (depth === 0) initialData = data;
    else if (
      childData < data ||
      childData - data > bytes ||
      childBytes > bytes - (childData - data)
    )
      return undefined;
    if (flags === 1) return initialData;
    if (flags === 0) {
      if (data !== current + 32) return undefined;
      const destination = forward(current);
      if (
        destination === undefined ||
        !pointer(destination) ||
        !Number.isSafeInteger(destination + 32 + bytes)
      )
        return undefined;
      return destination + (initialData - current);
    }
    const owner = read(current + 32);
    if (owner === undefined || !pointer(owner)) return undefined;
    childData = data;
    childBytes = bytes;
    current = owner;
  }
  return undefined;
}
