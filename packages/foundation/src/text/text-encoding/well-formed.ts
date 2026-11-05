import {
  createStringBuilder,
  appendString,
  finishString,
} from "../string-builder.ts";
/** Return the first unpaired surrogate at or after a code-point boundary. */
function unpairedSurrogate(value: string, start: number): number {
  for (let index = start; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit >= 0xdc00) return index;
    const next = value.charCodeAt(index + 1);
    if (!(next >= 0xdc00 && next <= 0xdfff)) return index;
    index++;
  }
  return -1;
}
export function isWellFormedUTF16(value: string): boolean {
  return unpairedSurrogate(value, 0) < 0;
}
/** Replace lone UTF-16 surrogates without normalizing or changing valid pairs. */
export function toWellFormedUTF16(value: string): string {
  let invalid = unpairedSurrogate(value, 0);
  if (invalid < 0) return value;
  const output = createStringBuilder();
  let start = 0;
  while (invalid >= 0) {
    appendString(output, value.slice(start, invalid));
    appendString(output, "\ufffd");
    start = invalid + 1;
    invalid = unpairedSurrogate(value, start);
  }
  appendString(output, value.slice(start));
  return finishString(output);
}
