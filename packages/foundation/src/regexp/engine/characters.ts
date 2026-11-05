import {
  unicodePropertyRanges,
  containsUnicodeRangeSet,
} from "../../unicode/properties/index.ts";
import {
  canonicalize,
  equalCharacter,
  foldedRange,
  foldedProperty,
} from "./case-fold.ts";
import type { ClassEntry, ClassSetExpression } from "../syntax/index.ts";
export interface Character {
  readonly value: number;
  readonly end: number;
}
export interface WorkBudget {
  remaining: number;
}
export function readCharacter(
  input: string,
  position: number,
  direction: number,
  unicode: boolean,
): Character | undefined {
  if (direction > 0) {
    if (position >= input.length) return undefined;
    const value = unicode
      ? input.codePointAt(position)
      : input.charCodeAt(position);
    if (value === undefined) return undefined;
    return { value, end: position + (value > 65535 ? 2 : 1) };
  }
  if (position <= 0) return undefined;
  let value = input.charCodeAt(position - 1),
    end = position - 1;
  if (unicode && value >= 56320 && value <= 57343 && end > 0) {
    const lead = input.charCodeAt(end - 1);
    if (lead >= 55296 && lead <= 56319) {
      value = (lead - 55296) * 1024 + value - 56320 + 65536;
      end--;
    }
  }
  return { value, end };
}
export function lineTerminator(value: number): boolean {
  return value === 10 || value === 13 || value === 8232 || value === 8233;
}
export function wordCharacter(
  value: number,
  ignoreCase: boolean = false,
  unicode: boolean = false,
): boolean {
  if (ignoreCase && unicode) value = canonicalize(value, true);
  return (
    (value >= 48 && value <= 57) ||
    (value >= 65 && value <= 90) ||
    (value >= 97 && value <= 122) ||
    value === 95
  );
}
export function entryMatches(
  entry: ClassEntry,
  value: number,
  ignoreCase: boolean = false,
  unicode: boolean = false,
  unicodeSets: boolean = false,
): boolean {
  if (entry.kind === "range")
    return ignoreCase
      ? foldedRange(value, entry.from, entry.to, unicode)
      : value >= entry.from && value <= entry.to;
  let member = false;
  if (entry.kind === "property") {
    const ranges = unicodePropertyRanges(entry.property, entry.value);
    if (ranges === undefined) throw "REGEXP_PROPERTY_INVARIANT";
    if (ignoreCase) {
      if (entry.inverted && !unicodeSets)
        return foldedProperty(value, ranges, unicode, true);
      member = foldedProperty(value, ranges, unicode, false);
    } else member = containsUnicodeRangeSet(ranges, value);
  } else if (entry.category === "digit") member = value >= 48 && value <= 57;
  else if (entry.category === "word")
    member = wordCharacter(value, ignoreCase, unicode);
  else
    member =
      (value >= 9 && value <= 13) ||
      value === 32 ||
      value === 160 ||
      value === 5760 ||
      (value >= 8192 && value <= 8202) ||
      value === 8232 ||
      value === 8233 ||
      value === 8239 ||
      value === 8287 ||
      value === 12288 ||
      value === 65279;
  return entry.inverted ? !member : member;
}
function addUnique(result: number[], value: number): void {
  if (!result.includes(value)) result.push(value);
}
/** Set operations compare consumed strings through their unique endpoint. */
export function setEnds(
  set: ClassSetExpression,
  input: string,
  position: number,
  direction: number,
  budget: WorkBudget,
  ignoreCase: boolean = false,
): number[] {
  if (--budget.remaining < 0) return [];
  if (set.kind === "entry") {
    const character = readCharacter(input, position, direction, true);
    return character !== undefined &&
      entryMatches(set.entry, character.value, ignoreCase, true, true)
      ? [character.end]
      : [];
  }
  if (set.kind === "strings") {
    const result: number[] = [];
    for (const value of set.alternatives) {
      if (value === undefined) throw "REGEXP_STRING_INVARIANT";
      const end = matchText(
        input,
        position,
        value,
        direction,
        true,
        ignoreCase,
        budget,
      );
      if (end >= 0) addUnique(result, end);
    }
    return result;
  }
  if (set.kind === "complement") {
    const character = readCharacter(input, position, direction, true);
    if (character === undefined) return [];
    return setEnds(
      set.body,
      input,
      position,
      direction,
      budget,
      ignoreCase,
    ).includes(character.end)
      ? []
      : [character.end];
  }
  let result: number[] = [];
  for (let i = 0; i < set.operands.length; i++) {
    const operand = set.operands[i];
    if (operand === undefined) throw "REGEXP_SET_INVARIANT";
    const values = setEnds(
      operand,
      input,
      position,
      direction,
      budget,
      ignoreCase,
    );
    if (i === 0) result = values;
    else if (set.kind === "union") {
      for (const value of values) {
        if (value === undefined) throw "REGEXP_ENDPOINT_INVARIANT";
        addUnique(result, value);
      }
    } else {
      const retained: number[] = [];
      for (const value of result) {
        if (value === undefined) throw "REGEXP_ENDPOINT_INVARIANT";
        if (values.includes(value) === (set.kind === "intersection"))
          retained.push(value);
      }
      result = retained;
    }
  }
  return result;
}
/** ECMAScript prefers longer class strings before shorter ones. */
export function orderedEnds(
  values: readonly number[],
  position: number,
): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (value === undefined) throw "REGEXP_ENDPOINT_INVARIANT";
    let index = result.length;
    result.push(value);
    while (index > 0) {
      const previous = result[index - 1];
      if (previous === undefined) throw "REGEXP_ENDPOINT_INVARIANT";
      if (Math.abs(previous - position) >= Math.abs(value - position)) break;
      result[index] = previous;
      index--;
    }
    result[index] = value;
  }
  return result;
}

/** Match a captured or class string, preserving input code-point boundaries. */
export function matchText(
  input: string,
  position: number,
  text: string,
  direction: number,
  unicode: boolean,
  ignoreCase: boolean,
  budget: WorkBudget,
): number {
  let offset = direction > 0 ? 0 : text.length;
  while (direction > 0 ? offset < text.length : offset > 0) {
    if (--budget.remaining < 0) return -1;
    const wanted = readCharacter(text, offset, direction, unicode);
    const actual = readCharacter(input, position, direction, unicode);
    if (
      wanted === undefined ||
      actual === undefined ||
      !equalCharacter(actual.value, wanted.value, ignoreCase, unicode)
    )
      return -1;
    offset = wanted.end;
    position = actual.end;
  }
  return position;
}
