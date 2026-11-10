/** Dense uint32 storage. Mutate this implementation state only through the API. */
export interface WordBuffer {
  length: number;
  tail: Uint32Array;
  tailUsed: number;
  readonly pageWords: number;
  readonly maxWords: number;
  readonly pages: Uint32Array[];
}
/** Allocate pages lazily; total bytes remain inside the uint32 address domain. */
export function createWordBuffer(
  pageWords: number = 16384,
  maxWords: number = 1073741823,
): WordBuffer {
  if (
    !Number.isInteger(pageWords) ||
    pageWords <= 0 ||
    pageWords > 1073741823 ||
    !Number.isInteger(maxWords) ||
    maxWords < 0 ||
    maxWords > 1073741823
  )
    throw "INVALID_WORD_BUFFER_POLICY";
  return {
    length: 0,
    tail: new Uint32Array(0),
    tailUsed: 0,
    pageWords,
    maxWords,
    pages: [],
  };
}
export function appendWord(buffer: WordBuffer, value: number): void {
  const index = buffer.length;
  if (index >= buffer.maxWords) throw "WORD_BUFFER_LIMIT";
  let page = buffer.tail;
  if (buffer.tailUsed === page.length) {
    page = new Uint32Array(Math.min(buffer.pageWords, buffer.maxWords - index));
    buffer.pages.push(page);
    buffer.tail = page;
    buffer.tailUsed = 0;
  }
  page[buffer.tailUsed] = value;
  buffer.tailUsed = buffer.tailUsed + 1;
  buffer.length = index + 1;
}
export function readWord(
  buffer: WordBuffer,
  index: number,
): number | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= buffer.length)
    return undefined;
  const tailStart = buffer.length - buffer.tailUsed;
  const page =
    index >= tailStart
      ? buffer.tail
      : buffer.pages[Math.floor(index / buffer.pageWords)];
  if (page === undefined) throw "WORD_BUFFER_PAGE_INVARIANT";
  return page[index % buffer.pageWords];
}
/** Patching is limited to existing words and never extends logical length. */
export function writeWord(
  buffer: WordBuffer,
  index: number,
  value: number,
): void {
  if (!Number.isInteger(index) || index < 0 || index >= buffer.length)
    throw "WORD_BUFFER_BOUNDS";
  const tailStart = buffer.length - buffer.tailUsed;
  const page =
    index >= tailStart
      ? buffer.tail
      : buffer.pages[Math.floor(index / buffer.pageWords)];
  if (page === undefined) throw "WORD_BUFFER_PAGE_INVARIANT";
  page[index % buffer.pageWords] = value;
}
/** Drop words from the end, keeping the first `length`; later appends reuse
 * the retained page storage. */
export function truncateWords(buffer: WordBuffer, length: number): void {
  if (!Number.isInteger(length) || length < 0 || length > buffer.length)
    throw "WORD_BUFFER_BOUNDS";
  const pagesNeeded = Math.ceil(length / buffer.pageWords);
  while (buffer.pages.length > pagesNeeded) buffer.pages.pop();
  const last = buffer.pages[pagesNeeded - 1];
  buffer.tail = last === undefined ? new Uint32Array(0) : last;
  buffer.tailUsed =
    pagesNeeded === 0 ? 0 : length - (pagesNeeded - 1) * buffer.pageWords;
  buffer.length = length;
}
