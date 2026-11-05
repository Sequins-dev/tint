/** Allocate whole words covering bitCount bits; padding bits share the fill value. */
export function createBits(bitCount: number, filled: boolean): Uint32Array {
  if (!Number.isInteger(bitCount) || bitCount < 0 || bitCount > 0xffffffff)
    throw "INVALID_BIT_CAPACITY";
  const words = new Uint32Array(Math.ceil(bitCount / 32));
  if (filled) words.fill(0xffffffff);
  return words;
}
export function hasBit(words: Uint32Array, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= words.length * 32)
    return false;
  return ((words[index >>> 5] ?? 0) & (1 << (index & 31))) !== 0;
}
export function setBit(words: Uint32Array, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= words.length * 32)
    throw "INVALID_BIT_INDEX";
  const word = index >>> 5;
  words[word] = (words[word] ?? 0) | (1 << (index & 31));
}
export function intersectBits(target: Uint32Array, source: Uint32Array): void {
  if (target.length !== source.length) throw "BIT_VECTOR_LENGTH_MISMATCH";
  target.forEach((value, word) => {
    target[word] = value & (source[word] ?? 0);
  });
}
export function equalBits(left: Uint32Array, right: Uint32Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, word) => value === right[word]);
}
export function copyBits(source: Uint32Array): Uint32Array {
  return source.slice();
}

/** Intersect with a source window, treating addedBit (relative to target) as set
 * in that incoming window. -1 means no added bit. Source and destination must be
 * disjoint or exactly the same window; shifted overlapping views are unsupported.
 * Save the affected incoming bit once so the word loop needs no edge-specific test. */
export function intersectBitRange(
  target: Uint32Array,
  source: Uint32Array,
  sourceWordOffset: number,
  addedBit: number = -1,
): boolean {
  validateBitRange(target, source, sourceWordOffset, addedBit);
  const word = addedBit >>> 5,
    mask = 1 << (addedBit & 31),
    preserved = addedBit < 0 ? 0 : (target[word] ?? 0) & mask;
  let surviving = preserved;
  for (let i = 0; i < target.length; i++) {
    const value = (target[i] ?? 0) & (source[sourceWordOffset + i] ?? 0);
    target[i] = value;
    surviving |= value;
  }
  if (addedBit >= 0) target[word] = (target[word] ?? 0) | preserved;
  return surviving !== 0;
}

/** Replace with a source window and optionally establish one incoming edge bit.
 * Windows must be disjoint or identical, as for intersectBitRange. */
export function copyBitRange(
  target: Uint32Array,
  source: Uint32Array,
  sourceWordOffset: number,
  addedBit: number = -1,
): boolean {
  validateBitRange(target, source, sourceWordOffset, addedBit);
  let surviving = 0;
  for (let i = 0; i < target.length; i++) {
    const value = source[sourceWordOffset + i] ?? 0;
    target[i] = value;
    surviving |= value;
  }
  if (addedBit >= 0) {
    const word = addedBit >>> 5;
    target[word] = (target[word] ?? 0) | (1 << (addedBit & 31));
    return true;
  }
  return surviving !== 0;
}
function validateBitRange(
  target: Uint32Array,
  source: Uint32Array,
  sourceWordOffset: number,
  addedBit: number,
): void {
  if (
    !Number.isInteger(sourceWordOffset) ||
    sourceWordOffset < 0 ||
    sourceWordOffset > source.length - target.length ||
    !Number.isInteger(addedBit) ||
    addedBit < -1 ||
    addedBit >= target.length * 32
  )
    throw "INVALID_BIT_RANGE";
}

/** Intersect disjoint or identical matrix windows, adding one incoming bit.
 * Returns whether any destination fact changed; validation precedes mutation. */
export function intersectBitWindows(
  target: Uint32Array,
  targetWordOffset: number,
  source: Uint32Array,
  sourceWordOffset: number,
  wordCount: number,
  addedBit: number = -1,
): boolean {
  if (
    !Number.isInteger(wordCount) ||
    wordCount < 0 ||
    !Number.isInteger(targetWordOffset) ||
    targetWordOffset < 0 ||
    targetWordOffset > target.length - wordCount ||
    !Number.isInteger(sourceWordOffset) ||
    sourceWordOffset < 0 ||
    sourceWordOffset > source.length - wordCount ||
    !Number.isInteger(addedBit) ||
    addedBit < -1 ||
    addedBit >= wordCount * 32
  )
    throw "INVALID_BIT_RANGE";
  const addedWord = addedBit < 0 ? -1 : addedBit >>> 5,
    mask = 1 << (addedBit & 31);
  let changed = false;
  for (let i = 0; i < wordCount; i++) {
    const position = targetWordOffset + i,
      previous = target[position] ?? 0,
      incoming =
        (source[sourceWordOffset + i] ?? 0) | (i === addedWord ? mask : 0),
      value = (previous & incoming) >>> 0;
    if (value !== previous) {
      target[position] = value;
      changed = true;
    }
  }
  return changed;
}
