/** GetSubstitution's token expansion; named reads stay lazy and observable. */
export function substituteMatch(
  matched: string,
  input: string,
  position: number,
  captures: readonly (string | undefined)[],
  namedCapture: ((name: string) => string | undefined) | undefined,
  replacement: string,
): string {
  let output = "";
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement.charAt(i);
    if (c !== "$" || i + 1 === replacement.length) {
      output += c;
      continue;
    }
    const next = replacement.charAt(i + 1);
    if (next === "$") output += "$";
    else if (next === "&") output += matched;
    else if (next === "`") output += input.slice(0, position);
    else if (next === "'")
      output += input.slice(Math.min(position + matched.length, input.length));
    else if (next === "<" && namedCapture !== undefined) {
      const end = replacement.indexOf(">", i + 2);
      if (end < 0) {
        output += "$";
        continue;
      }
      output += namedCapture(replacement.slice(i + 2, end)) ?? "";
      i = end;
      continue;
    } else {
      let capture = replacement.charCodeAt(i + 1) - 48;
      if (capture < 0 || capture > 9) {
        output += "$";
        continue;
      }
      const second = replacement.charCodeAt(i + 2) - 48;
      if (
        second >= 0 &&
        second <= 9 &&
        capture * 10 + second > 0 &&
        capture * 10 + second <= captures.length
      ) {
        capture = capture * 10 + second;
        i++;
      }
      if (capture === 0 || capture > captures.length) {
        output += "$";
        continue;
      }
      output += captures[capture - 1] ?? "";
    }
    i++;
  }
  return output;
}
