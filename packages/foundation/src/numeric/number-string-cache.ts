// The number-string cache behind numberToString (V8's NumberStringCache), and
// strings' cached array indices behind stringToNumber (V8's cached array
// index in a string's hash field).
// Native builds bind each function to the IR instruction its comment names
// (project intrinsics, like text/latin1.ts): a direct-mapped table owned by
// the runtime and dropped at every collection (nativeNumberStringCacheWord
// in @tint/abi/host). The portable bodies are a cache that holds nothing,
// which numberToString's results never depend on.

/** The string cached for `value` (by its exact bits), or "" when none is:
 * no number converts to "" (`number-string-cached`). */
export function numberStringCached(value: number): string {
  return "";
}

/** Caches `text`, `value`'s string, which is never "" (`number-string-cache`). */
export function cacheNumberString(value: number, text: string): void {}

/** The array index `text` is the canonical decimal of, as cached in its
 * index field (nativeStringIndexFieldOffset in @tint/abi/host), else -1:
 * the portable body caches nothing (`string-index-cached`). */
export function cachedArrayIndex(text: string): number {
  return -1;
}

/** Caches `value`, an array index below 2^20 whose canonical decimal (digits
 * only, no leading zero but "0" itself) `text` is, in its index field
 * (`string-index-cache`). */
export function cacheArrayIndex(text: string, value: number): void {}
