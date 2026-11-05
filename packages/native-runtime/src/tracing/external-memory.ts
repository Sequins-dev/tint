export interface ExternalMemoryRegistry {
  readonly register: (base: number, byteLength: number) => boolean;
  readonly contains: (address: number, byteLength: number) => boolean;
}
function validRange(base: number, byteLength: number): boolean {
  return (
    Number.isSafeInteger(base) &&
    base > 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength > 0 &&
    Number.isSafeInteger(base + byteLength)
  );
}
function overlaps(
  base: number,
  length: number,
  other: number,
  otherLength: number,
): boolean {
  return base < other + otherLength && other < base + length;
}
/** Permanent external leaf/metadata grants; this does not map or inspect memory.
 * The owner proves mapping, read permission and lifetime, and retains exclusive
 * mutation of storage and reserved windows. Granted objects must not contain
 * managed references that need scanning. Registration never allocates or revokes.
 * Storage is [count, base, length, ...]; reserved is [base, length, ...].
 * Typed buffers keep the registry usable before collection runtimes exist.
 * Adjacent grants remain separate. */
export function createExternalMemoryRegistry(
  storage: Float64Array,
  reserved: Float64Array,
): ExternalMemoryRegistry | undefined {
  if (storage.length < 3 || storage.length % 2 !== 1 || storage[0] !== 0)
    return undefined;
  const capacity = (storage.length - 1) / 2;
  if (reserved.length % 2 !== 0) return undefined;
  for (let index = 0; index < reserved.length; index += 2) {
    const base = reserved[index],
      length = reserved[index + 1];
    if (base === undefined || length === undefined || !validRange(base, length))
      return undefined;
  }
  function count(): number {
    const value = storage[0];
    return value !== undefined &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= capacity
      ? value
      : -1;
  }
  return {
    register: (base, byteLength): boolean => {
      const size = count();
      if (size < 0 || !validRange(base, byteLength)) return false;
      for (let index = 0; index < reserved.length; index += 2) {
        const other = reserved[index],
          length = reserved[index + 1];
        if (
          other === undefined ||
          length === undefined ||
          overlaps(base, byteLength, other, length)
        )
          return false;
      }
      let duplicate = false;
      for (let index = 0; index < size; index++) {
        const other = storage[1 + index * 2],
          length = storage[2 + index * 2];
        if (
          other === undefined ||
          length === undefined ||
          !validRange(other, length)
        )
          return false;
        if (other === base && length === byteLength) duplicate = true;
        else if (overlaps(base, byteLength, other, length)) return false;
      }
      if (duplicate) return true;
      if (size === capacity) return false;
      storage[1 + size * 2] = base;
      storage[2 + size * 2] = byteLength;
      storage[0] = size + 1;
      return true;
    },
    contains: (address, byteLength): boolean => {
      const size = count();
      if (size < 0 || !validRange(address, byteLength)) return false;
      for (let index = 0; index < size; index++) {
        const base = storage[1 + index * 2],
          length = storage[2 + index * 2];
        if (
          base === undefined ||
          length === undefined ||
          !validRange(base, length)
        )
          return false;
        if (
          address >= base &&
          byteLength <= length &&
          address - base <= length - byteLength
        )
          return true;
      }
      return false;
    },
  };
}
