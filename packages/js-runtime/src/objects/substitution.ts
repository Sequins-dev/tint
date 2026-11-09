/** GetSubstitution's token expansion; named reads stay lazy and observable.
 * Pieces are collected and joined once: appending with `+=` copied the
 * growing result for every token, which is quadratic in the output and
 * exhausted the heap on large captures (staging/sm/String/replace-math.js). */
export function substituteMatch(
  matched: string,
  input: string,
  position: number,
  captures: readonly (string | undefined)[],
  namedCapture: ((name: string) => string | undefined) | undefined,
  replacement: string,
): string {
  const pieces: string[] = [];
  // Start of the pending run of literal replacement text.
  let literal = 0;
  let i = 0;
  while (i < replacement.length) {
    if (
      replacement.charCodeAt(i) !== 36 /* $ */ ||
      i + 1 === replacement.length
    ) {
      i++;
      continue;
    }
    const next = replacement.charAt(i + 1);
    let piece: string | undefined;
    let consumed = 2;
    if (next === "$") piece = "$";
    else if (next === "&") piece = matched;
    else if (next === "`") piece = input.slice(0, position);
    else if (next === "'")
      piece = input.slice(Math.min(position + matched.length, input.length));
    else if (next === "<" && namedCapture !== undefined) {
      const end = replacement.indexOf(">", i + 2);
      if (end >= 0) {
        if (literal < i) pieces.push(replacement.slice(literal, i));
        pieces.push(namedCapture(replacement.slice(i + 2, end)) ?? "");
        i = end + 1;
        literal = i;
        continue;
      }
    } else {
      let capture = replacement.charCodeAt(i + 1) - 48;
      if (capture >= 0 && capture <= 9) {
        const second = replacement.charCodeAt(i + 2) - 48;
        if (
          second >= 0 &&
          second <= 9 &&
          capture * 10 + second > 0 &&
          capture * 10 + second <= captures.length
        ) {
          capture = capture * 10 + second;
          consumed = 3;
        }
        if (capture !== 0 && capture <= captures.length)
          piece = captures[capture - 1] ?? "";
      }
    }
    if (piece === undefined) {
      // A lone `$` is literal text; continue the run after it.
      i++;
      continue;
    }
    if (literal < i) pieces.push(replacement.slice(literal, i));
    pieces.push(piece);
    i += consumed;
    literal = i;
  }
  if (literal === 0) return replacement;
  if (literal < replacement.length) pieces.push(replacement.slice(literal));
  return pieces.join("");
}
