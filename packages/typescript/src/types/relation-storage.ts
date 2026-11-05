/** Dense solver scratch, preserving exact numeric IDs and the -1 edge sentinel.
 * Capacity is independent of each query's initialized logical prefix. */
export function growRelationStorage(
  storage: Float64Array,
  required: number,
): Float64Array {
  if (!Number.isInteger(required) || required < 0 || required > 536870906)
    throw "RELATION_STORAGE_LIMIT";
  if (required <= storage.length) return storage;
  let capacity = Math.max(64, storage.length);
  while (capacity < required) {
    if (capacity > 268435453) {
      capacity = required;
      break;
    }
    capacity *= 2;
  }
  const grown = new Float64Array(capacity);
  grown.set(storage);
  return grown;
}
