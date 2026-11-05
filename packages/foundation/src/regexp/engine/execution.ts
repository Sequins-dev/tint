import { equalCharacter } from "./case-fold.ts";
import type { RegExpProgram, MatchResult, CaptureRange } from "./model.ts";
import {
  readCharacter,
  matchText,
  lineTerminator,
  wordCharacter,
  entryMatches,
  setEnds,
  orderedEnds,
  type WorkBudget,
} from "./characters.ts";
interface Frame {
  readonly pc: number;
  readonly position: number;
  readonly captures: number[];
  readonly counts: number[];
  readonly starts: number[];
}
interface RunResult {
  readonly kind: "match" | "no-match" | "limit";
  readonly position: number;
  readonly captures: number[];
}
function filled(length: number, value: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < length; i++) result.push(value);
  return result;
}
function run(
  program: RegExpProgram,
  input: string,
  entry: number,
  initialPosition: number,
  initialCaptures: number[],
  direction: number,
  budget: WorkBudget,
): RunResult {
  let pc = entry,
    position = initialPosition,
    captures = initialCaptures,
    counts = filled(program.repeats, 0),
    starts = filled(program.repeats, -1);
  const stack: Frame[] = [],
    unicode = program.flags.unicode || program.flags.unicodeSets;
  function push(next: number, end: number): void {
    stack.push({
      pc: next,
      position: end,
      captures: captures.slice(),
      counts: counts.slice(),
      starts: starts.slice(),
    });
  }
  while (true) {
    if (--budget.remaining < 0) return { kind: "limit", position, captures };
    const instruction = program.instructions[pc];
    if (instruction === undefined) throw "REGEXP_INSTRUCTION_INVARIANT";
    let failed = false;
    switch (instruction.kind) {
      case "accept":
        return { kind: "match", position, captures };
      case "split":
        push(instruction.second, position);
        pc = instruction.first;
        break;
      case "save":
        captures[instruction.slot] = position;
        pc = instruction.next;
        break;
      case "character":
      case "dot":
      case "class": {
        const character = readCharacter(input, position, direction, unicode);
        if (character === undefined) {
          failed = true;
          break;
        }
        let matches = false;
        if (instruction.kind === "character")
          matches = equalCharacter(
            character.value,
            instruction.value,
            instruction.ignoreCase,
            unicode,
          );
        else if (instruction.kind === "dot")
          matches = instruction.dotAll || !lineTerminator(character.value);
        else {
          for (const item of instruction.entries) {
            if (item === undefined) throw "REGEXP_CLASS_INVARIANT";
            if (
              entryMatches(
                item,
                character.value,
                instruction.ignoreCase,
                unicode,
                program.flags.unicodeSets,
              )
            ) {
              matches = true;
              break;
            }
          }
          if (instruction.inverted) matches = !matches;
        }
        if (matches) {
          position = character.end;
          pc = instruction.next;
        } else failed = true;
        break;
      }
      case "set": {
        const ends = orderedEnds(
          setEnds(
            instruction.body,
            input,
            position,
            direction,
            budget,
            instruction.ignoreCase,
          ),
          position,
        );
        const first = ends[0];
        if (first === undefined) {
          failed = true;
          break;
        }
        for (let i = ends.length - 1; i > 0; i--) {
          const end = ends[i];
          if (end === undefined) throw "REGEXP_ENDPOINT_INVARIANT";
          push(instruction.next, end);
        }
        position = first;
        pc = instruction.next;
        break;
      }
      case "assert": {
        let matches = false;
        if (instruction.assertion === "start")
          matches =
            position === 0 ||
            (instruction.multiline &&
              lineTerminator(input.charCodeAt(position - 1)));
        else if (instruction.assertion === "end")
          matches =
            position === input.length ||
            (instruction.multiline &&
              lineTerminator(input.charCodeAt(position)));
        else {
          const boundary =
            wordCharacter(
              input.charCodeAt(position - 1),
              instruction.ignoreCase,
              unicode,
            ) !==
            wordCharacter(
              input.charCodeAt(position),
              instruction.ignoreCase,
              unicode,
            );
          matches = instruction.assertion === "word" ? boundary : !boundary;
        }
        if (matches) pc = instruction.next;
        else failed = true;
        break;
      }
      case "backreference": {
        let start = -1,
          end = -1;
        for (const capture of instruction.captures) {
          if (capture === undefined) throw "REGEXP_CAPTURE_INVARIANT";
          const a = captures[capture * 2],
            b = captures[capture * 2 + 1];
          if (a !== undefined && b !== undefined && a >= 0 && b >= 0) {
            start = a;
            end = b;
            break;
          }
        }
        if (start < 0) {
          pc = instruction.next;
          break;
        }
        const matched = matchText(
          input,
          position,
          input.slice(start, end),
          direction,
          unicode,
          instruction.ignoreCase,
          budget,
        );
        if (matched < 0) failed = true;
        else {
          position = matched;
          pc = instruction.next;
        }
        break;
      }
      case "repeat-enter":
        counts[instruction.slot] = 0;
        starts[instruction.slot] = -1;
        pc = instruction.next;
        break;
      case "repeat-body":
        starts[instruction.slot] = position;
        for (const capture of instruction.captures) {
          if (capture === undefined) throw "REGEXP_CAPTURE_INVARIANT";
          captures[capture * 2] = -1;
          captures[capture * 2 + 1] = -1;
        }
        pc = instruction.next;
        break;
      case "repeat": {
        const count = counts[instruction.slot];
        if (count === undefined) throw "REGEXP_REPEAT_INVARIANT";
        if (count < instruction.min) pc = instruction.body;
        else if (count >= instruction.max) pc = instruction.exit;
        else {
          push(
            instruction.greedy ? instruction.exit : instruction.body,
            position,
          );
          pc = instruction.greedy ? instruction.body : instruction.exit;
        }
        break;
      }
      case "repeat-end": {
        const count = counts[instruction.slot];
        if (count === undefined) throw "REGEXP_REPEAT_INVARIANT";
        if (position === starts[instruction.slot] && count >= instruction.min)
          failed = true;
        else {
          counts[instruction.slot] = count + 1;
          pc = instruction.choice;
        }
        break;
      }
      case "look": {
        const result = run(
          program,
          input,
          instruction.entry,
          position,
          captures.slice(),
          instruction.behind ? -1 : 1,
          budget,
        );
        if (result.kind === "limit") return result;
        if ((result.kind === "match") === instruction.negative) failed = true;
        else {
          if (!instruction.negative) captures = result.captures;
          pc = instruction.next;
        }
        break;
      }
    }
    if (failed) {
      if (budget.remaining < 0) return { kind: "limit", position, captures };
      const frame = stack.pop();
      if (frame === undefined) return { kind: "no-match", position, captures };
      pc = frame.pc;
      position = frame.position;
      captures = frame.captures;
      counts = frame.counts;
      starts = frame.starts;
    }
  }
}
/** Input and capture offsets are UTF-16; execution never mutates the program. */
export function executeRegExp(
  program: RegExpProgram,
  input: string,
  start: number = 0,
  sticky: boolean = program.flags.sticky,
  maxSteps: number = 1000000,
): MatchResult {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(maxSteps) ||
    maxSteps < 1
  )
    return {
      kind: "invalid",
      message:
        "matching requires a nonnegative integer start and positive work budget",
    };
  const budget: WorkBudget = { remaining: maxSteps };
  let position = start;
  // A UTF-16 index into a surrogate pair identifies its containing code point.
  if (
    (program.flags.unicode || program.flags.unicodeSets) &&
    position > 0 &&
    position < input.length
  ) {
    const trail = input.charCodeAt(position),
      lead = input.charCodeAt(position - 1);
    if (trail >= 56320 && trail <= 57343 && lead >= 55296 && lead <= 56319)
      position--;
  }
  while (position <= input.length) {
    const result = run(
      program,
      input,
      program.entry,
      position,
      filled((program.captures + 1) * 2, -1),
      1,
      budget,
    );
    if (result.kind === "limit")
      return {
        kind: "limit",
        message: "regular expression work budget exhausted",
      };
    if (result.kind === "match") {
      result.captures[0] = position;
      result.captures[1] = result.position;
      const captures: (CaptureRange | undefined)[] = [];
      for (let i = 0; i <= program.captures; i++) {
        const from = result.captures[i * 2],
          to = result.captures[i * 2 + 1];
        captures.push(
          from === undefined || to === undefined || from < 0 || to < 0
            ? undefined
            : { start: from, end: to },
        );
      }
      return {
        kind: "match",
        match: { start: position, end: result.position, captures },
      };
    }
    if (sticky || position === input.length) break;
    const character = readCharacter(
      input,
      position,
      1,
      program.flags.unicode || program.flags.unicodeSets,
    );
    if (character === undefined) break;
    position = character.end;
  }
  return { kind: "no-match" };
}
