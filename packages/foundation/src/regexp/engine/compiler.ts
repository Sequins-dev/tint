import { stringPropertyNames } from "./string-property-data.ts";
import { unicodePropertyRanges } from "../../unicode/properties/index.ts";
import {
  parseRegExp,
  type PatternNode,
  type ClassEntry,
  type ClassSetExpression,
  type RegExpResult,
} from "../syntax/index.ts";
import type { CompiledClassSet, Instruction, RegExpProgram } from "./model.ts";
interface Options {
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  readonly dotAll: boolean;
}
function captureNumbers(node: PatternNode, result: number[]): void {
  if (node.kind === "group") {
    if (node.capture > 0) result.push(node.capture);
    captureNumbers(node.body, result);
  } else if (
    node.kind === "repeat" ||
    node.kind === "lookaround" ||
    node.kind === "modifiers"
  )
    captureNumbers(node.body, result);
  else if (node.kind === "sequence")
    for (const term of node.terms) {
      if (term === undefined) throw "REGEXP_TERM_INVARIANT";
      captureNumbers(term, result);
    }
  else if (node.kind === "alternation")
    for (const term of node.alternatives) {
      if (term === undefined) throw "REGEXP_TERM_INVARIANT";
      captureNumbers(term, result);
    }
}
export function compileRegExp(
  pattern: string,
  flags: string,
): RegExpResult<RegExpProgram> {
  const parsed = parseRegExp(pattern, flags);
  if (!parsed.ok) return parsed;
  const syntax = parsed.value,
    instructions: Instruction[] = [];
  let repeats = 0,
    unsupported = "";
  const abort = {};
  function reject(message: string): never {
    unsupported = message;
    throw abort;
  }
  function push(instruction: Instruction): number {
    const index = instructions.length;
    instructions.push(instruction);
    return index;
  }
  function validateEntry(entry: ClassEntry): void {
    if (
      entry.kind === "property" &&
      (entry.strings ||
        unicodePropertyRanges(entry.property, entry.value) === undefined)
    )
      reject("Unicode property membership tables are not implemented");
  }
  function prepareEntry(entry: ClassEntry): CompiledClassSet {
    if (entry.kind !== "property" || !entry.strings) {
      validateEntry(entry);
      return { kind: "entry", entry };
    }
    if (!stringPropertyNames.includes(entry.property))
      reject("Unicode string property tables are not implemented");
    return { kind: "string-property", property: entry.property };
  }
  function prepareSet(set: ClassSetExpression): CompiledClassSet {
    if (set.kind === "entry") return prepareEntry(set.entry);
    if (set.kind === "strings") return set;
    if (set.kind === "complement")
      return { kind: "complement", body: prepareSet(set.body) };
    const operands: CompiledClassSet[] = [];
    for (const child of set.operands) {
      if (child === undefined) throw "REGEXP_SET_INVARIANT";
      operands.push(prepareSet(child));
    }
    return { kind: set.kind, operands };
  }
  function emit(
    node: PatternNode,
    next: number,
    options: Options,
    direction: number,
  ): number {
    if (node.kind === "modifiers") {
      const enable = node.enable,
        disable = node.disable;
      return emit(
        node.body,
        next,
        {
          ignoreCase:
            enable.includes("i") ||
            (!disable.includes("i") && options.ignoreCase),
          multiline:
            enable.includes("m") ||
            (!disable.includes("m") && options.multiline),
          dotAll:
            enable.includes("s") || (!disable.includes("s") && options.dotAll),
        },
        direction,
      );
    }
    if (node.kind === "character")
      return push({
        kind: "character",
        ignoreCase: options.ignoreCase,
        value: node.value,
        next,
      });
    if (node.kind === "dot")
      return push({ kind: "dot", dotAll: options.dotAll, next });
    if (node.kind === "class") {
      if (
        node.entries.some((entry) => entry.kind === "property" && entry.strings)
      ) {
        const operands: CompiledClassSet[] = [];
        for (const entry of node.entries) {
          if (entry === undefined) throw "REGEXP_CLASS_INVARIANT";
          operands.push(prepareEntry(entry));
        }
        return push({
          kind: "set",
          ignoreCase: options.ignoreCase,
          body: { kind: "union", operands },
          next,
        });
      }
      for (const entry of node.entries) {
        if (entry === undefined) throw "REGEXP_CLASS_INVARIANT";
        validateEntry(entry);
      }
      return push({
        kind: "class",
        ignoreCase: options.ignoreCase,
        entries: node.entries,
        inverted: node.inverted,
        next,
      });
    }
    if (node.kind === "unicode-set") {
      return push({
        kind: "set",
        ignoreCase: options.ignoreCase,
        body: prepareSet(node.body),
        next,
      });
    }
    if (node.kind === "assertion")
      return push({
        kind: "assert",
        ignoreCase: options.ignoreCase,
        assertion: node.assertion,
        multiline: options.multiline,
        next,
      });
    if (node.kind === "sequence") {
      let entry = next;
      for (
        let i = direction > 0 ? node.terms.length - 1 : 0;
        direction > 0 ? i >= 0 : i < node.terms.length;
        i -= direction
      ) {
        const term = node.terms[i];
        if (term === undefined) throw "REGEXP_SEQUENCE_INVARIANT";
        entry = emit(term, entry, options, direction);
      }
      return entry;
    }
    if (node.kind === "alternation") {
      let entry = -1;
      for (let i = node.alternatives.length - 1; i >= 0; i--) {
        const branch = node.alternatives[i];
        if (branch === undefined) throw "REGEXP_ALTERNATIVE_INVARIANT";
        const first = emit(branch, next, options, direction);
        entry =
          entry < 0 ? first : push({ kind: "split", first, second: entry });
      }
      return entry < 0 ? next : entry;
    }
    if (node.kind === "group") {
      if (node.capture === 0) return emit(node.body, next, options, direction);
      const firstSlot = node.capture * 2 + (direction > 0 ? 0 : 1),
        lastSlot = node.capture * 2 + (direction > 0 ? 1 : 0);
      const end = push({ kind: "save", slot: lastSlot, next });
      return push({
        kind: "save",
        slot: firstSlot,
        next: emit(node.body, end, options, direction),
      });
    }
    if (node.kind === "repeat") {
      const slot = repeats++;
      const choice = push({ kind: "accept" });
      const end = push({ kind: "repeat-end", slot, min: node.min, choice });
      const body = emit(node.body, end, options, direction),
        captures: number[] = [];
      captureNumbers(node.body, captures);
      const begin = push({ kind: "repeat-body", slot, captures, next: body });
      instructions[choice] = {
        kind: "repeat",
        slot,
        min: node.min,
        max: node.max,
        greedy: node.greedy,
        body: begin,
        exit: next,
      };
      return push({ kind: "repeat-enter", slot, next: choice });
    }
    if (node.kind === "lookaround") {
      const accept = push({ kind: "accept" }),
        entry = emit(node.body, accept, options, node.behind ? -1 : 1);
      return push({
        kind: "look",
        entry,
        behind: node.behind,
        negative: node.negative,
        next,
      });
    }
    if (node.kind === "backreference")
      return push({
        kind: "backreference",
        ignoreCase: options.ignoreCase,
        captures: [node.capture],
        next,
      });
    const captures: number[] = [];
    for (const named of syntax.names) {
      if (named === undefined) throw "REGEXP_NAME_INVARIANT";
      if (named.name === node.name) captures.push(named.capture);
    }
    return push({
      kind: "backreference",
      ignoreCase: options.ignoreCase,
      captures,
      next,
    });
  }
  try {
    const accept = push({ kind: "accept" });
    const entry = emit(syntax.body, accept, syntax.flags, 1);
    return {
      ok: true,
      value: {
        instructions,
        entry,
        captures: syntax.captures,
        repeats,
        flags: syntax.flags,
        names: syntax.names,
      },
    };
  } catch (error) {
    if (error !== abort) throw error;
  }
  return {
    ok: false,
    error: {
      kind: "unsupported",
      source: "pattern",
      offset: 0,
      message: unsupported,
    },
  };
}
