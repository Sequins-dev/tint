/** Exclusively owned accumulation state; mutate through appendString. */
export interface StringBuilder {
  readonly parts: (string | undefined)[];
}
export function createStringBuilder(): StringBuilder {
  return { parts: [] };
}
/** Merge equal-count runs, bounding repeated copying to logarithmic depth. */
export function appendString(builder: StringBuilder, text: string): void {
  if (text.length === 0) return;
  let part = text,
    level = 0;
  while (true) {
    const previous = builder.parts[level];
    if (previous === undefined) {
      builder.parts[level] = part;
      return;
    }
    part = previous + part;
    builder.parts[level] = undefined;
    level++;
  }
}
/** Returns an immutable snapshot without consuming or changing the builder. */
export function finishString(builder: StringBuilder): string {
  let result = "";
  for (let level = builder.parts.length - 1; level >= 0; level--) {
    const part = builder.parts[level];
    if (part !== undefined) result += part;
  }
  return result;
}
