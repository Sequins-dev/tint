/** The System V ABI symbol hash (`DT_HASH`), computed over a name's bytes. */
export function elfHash(name: Uint8Array): number {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = ((hash << 4) + (name[index] ?? 0)) >>> 0;
    const high = (hash & 0xf0000000) >>> 0;
    if (high !== 0) hash = (hash ^ (high >>> 24)) >>> 0;
    hash = (hash & ~high) >>> 0;
  }
  return hash;
}
/**
 * A `DT_HASH` table for a dynamic symbol table whose entry 0 is the null
 * symbol: nbucket, nchain, the buckets and one chain word per symbol. `names`
 * holds the encoded names of symbols 1..n. Each bucket heads a chain through
 * its symbols in decreasing index order; 0 (the null symbol) ends a chain.
 */
export function sysvHashTable(names: readonly Uint8Array[]): Uint32Array {
  const symbolCount = names.length + 1;
  const bucketCount = names.length === 0 ? 1 : names.length;
  const table = new Uint32Array(2 + bucketCount + symbolCount);
  table[0] = bucketCount;
  table[1] = symbolCount;
  for (let index = 1; index < symbolCount; index++) {
    const name = names[index - 1];
    if (name === undefined) throw "ELF hash name invariant";
    const bucket = 2 + (elfHash(name) % bucketCount);
    table[2 + bucketCount + index] = table[bucket] ?? 0;
    table[bucket] = index;
  }
  return table;
}
