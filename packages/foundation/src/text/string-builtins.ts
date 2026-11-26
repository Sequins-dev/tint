import {
  appendString,
  createStringBuilder,
  finishString,
} from "./string-builder.ts";

/** ECMAScript GetSubstitution for string-search replace / replaceAll. */
function substitute(
  matched: string,
  text: string,
  position: number,
  replacement: string,
): string {
  let dollar = replacement.indexOf("$");
  if (dollar < 0) return replacement;
  const out = createStringBuilder();
  let start = 0;
  const tail = position + matched.length;
  while (dollar >= 0) {
    if (dollar > start) appendString(out, replacement.slice(start, dollar));
    if (dollar + 1 >= replacement.length) {
      appendString(out, "$");
      start = replacement.length;
      break;
    }
    const next = replacement.charCodeAt(dollar + 1);
    if (next === 36) {
      // $$
      appendString(out, "$");
      start = dollar + 2;
    } else if (next === 38) {
      // $&
      appendString(out, matched);
      start = dollar + 2;
    } else if (next === 96) {
      // $`
      appendString(out, text.slice(0, position));
      start = dollar + 2;
    } else if (next === 39) {
      // $'
      appendString(out, text.slice(tail));
      start = dollar + 2;
    } else {
      appendString(out, "$");
      start = dollar + 1;
    }
    dollar = replacement.indexOf("$", start);
  }
  if (start < replacement.length) appendString(out, replacement.slice(start));
  return finishString(out);
}

/** String.prototype.replace for string search and string replacement. */
export function stringReplace(
  text: string,
  search: string,
  replacement: string,
): string {
  const position = text.indexOf(search);
  if (position < 0) return text;
  const sub = substitute(search, text, position, replacement);
  return text.slice(0, position) + sub + text.slice(position + search.length);
}

/** String.prototype.replaceAll for string search and string replacement. */
export function stringReplaceAll(
  text: string,
  search: string,
  replacement: string,
): string {
  const hasDollar = replacement.indexOf("$") >= 0;
  if (search.length === 0) {
    const out = createStringBuilder();
    for (let i = 0; i < text.length; i++) {
      appendString(
        out,
        hasDollar ? substitute("", text, i, replacement) : replacement,
      );
      appendString(out, text.slice(i, i + 1));
    }
    appendString(
      out,
      hasDollar ? substitute("", text, text.length, replacement) : replacement,
    );
    return finishString(out);
  }
  let position = text.indexOf(search);
  if (position < 0) return text;
  const out = createStringBuilder();
  let lastEnd = 0;
  while (position >= 0) {
    if (position > lastEnd) appendString(out, text.slice(lastEnd, position));
    appendString(
      out,
      hasDollar ? substitute(search, text, position, replacement) : replacement,
    );
    lastEnd = position + search.length;
    position = text.indexOf(search, lastEnd);
  }
  if (lastEnd < text.length) appendString(out, text.slice(lastEnd));
  return finishString(out);
}
