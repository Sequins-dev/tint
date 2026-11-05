import type { RegExpMatch } from "@tint/foundation/regexp/engine";
/** Empty strings are valid values; undefined marks invalidated legacy state. */
export interface RegExpLegacyState {
  readonly values: (string | undefined)[];
}
export function createRegExpLegacyState(): RegExpLegacyState {
  const values: (string | undefined)[] = [];
  for (let i = 0; i < 14; i++) values.push("");
  return { values };
}
export function invalidateRegExpLegacyState(state: RegExpLegacyState): void {
  for (let i = 0; i < 14; i++) state.values[i] = undefined;
}
export function updateRegExpLegacyState(
  state: RegExpLegacyState,
  input: string,
  match: RegExpMatch,
): void {
  state.values[0] = input;
  state.values[1] = input.slice(match.start, match.end);
  const last =
    match.captures.length > 1
      ? match.captures[match.captures.length - 1]
      : undefined;
  state.values[2] = last === undefined ? "" : input.slice(last.start, last.end);
  state.values[3] = input.slice(0, match.start);
  state.values[4] = input.slice(match.end);
  for (let i = 0; i < 9; i++) {
    const capture = match.captures[i + 1];
    state.values[i + 5] =
      capture === undefined ? "" : input.slice(capture.start, capture.end);
  }
}
