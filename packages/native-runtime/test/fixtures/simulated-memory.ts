/** Stand-in for intrinsics/memory.ts in Node tests: a word-addressed memory
 * that a test installs with `simulate`. Only the leaves the Cheney evacuator
 * uses are provided. */
let words: Map<number, number> = new Map();
export function simulate(memory: Map<number, number>): void {
  words = memory;
}
export function readMemoryWord(
  address: number,
  byteLength: number,
  offset: number,
): number {
  const at = address + offset;
  if (at % 8 !== 0 || byteLength < 8) throw new Error("unaligned read " + at);
  return words.get(at) ?? 0;
}
export function writeMemoryWord(
  address: number,
  byteLength: number,
  offset: number,
  value: number,
): number {
  const at = address + offset;
  if (at % 8 !== 0 || byteLength < 8) throw new Error("unaligned write " + at);
  words.set(at, value);
  return 0;
}
export function moveMemory(
  address: number,
  byteLength: number,
  destinationOffset: number,
  sourceOffset: number,
  count: number,
): number {
  const copied: number[] = [];
  for (let offset = 0; offset < count; offset += 8)
    copied.push(words.get(address + sourceOffset + offset) ?? 0);
  copied.forEach((value, index) =>
    words.set(address + destinationOffset + index * 8, value),
  );
  return 0;
}
