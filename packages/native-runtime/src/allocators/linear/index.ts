/** Reserve aligned bytes in a caller-owned [top, exclusiveLimit] word pair.
 * Offsets are uint32, failure preserves both words, and success changes only top.
 * This manages ranges, not object lifetimes. Reset/reuse requires a separate proof
 * that no old reference remains. State must not alias the range being handed out.
 * This checked reference path allocates no memory and invokes no callbacks. */
export function reserveLinear(
  state: Uint32Array,
  bytes: number,
  alignment: number = 16,
): number | undefined {
  const top = state[0],
    limit = state[1];
  if (
    top === undefined ||
    limit === undefined ||
    top > limit ||
    !Number.isInteger(bytes) ||
    bytes <= 0 ||
    bytes > 0xffffffff ||
    !Number.isInteger(alignment) ||
    alignment <= 0 ||
    alignment > 0x80000000 ||
    (alignment & (alignment - 1)) !== 0
  )
    return undefined;
  const start = Math.ceil(top / alignment) * alignment;
  const size = Math.ceil(bytes / alignment) * alignment;
  if (start > limit || size > limit - start) return undefined;
  state[0] = start + size;
  return start;
}
