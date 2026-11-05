import { unicodeProperty } from "./unicode-properties.ts";
import { isIDStart, isIDContinue } from "../../unicode/identifiers/index.ts";
import { parseRegExpFlags } from "./flags.ts";
import type {
  PatternNode,
  NamedCapture,
  ClassEntry,
  ClassSetExpression,
  RegExpDiagnostic,
  RegExpPattern,
  RegExpResult,
} from "./model.ts";
function decimal(c: number): boolean {
  return c >= 48 && c <= 57;
}
function hex(c: number): number {
  return decimal(c)
    ? c - 48
    : c >= 65 && c <= 70
      ? c - 55
      : c >= 97 && c <= 102
        ? c - 87
        : -1;
}
/** Count capturing parentheses without interpreting escapes or class contents. */
function capturesIn(
  text: string,
  sets: boolean,
): {
  readonly total: number;
  readonly named: boolean;
} {
  let named = false;
  let count = 0,
    classDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "\\") {
      i++;
      continue;
    }
    if (classDepth > 0) {
      if (c === "]") classDepth--;
      else if (sets && c === "[") classDepth++;
      continue;
    }
    if (c === "[") classDepth++;
    else if (
      c === "(" &&
      (text.charAt(i + 1) !== "?" ||
        (text.charAt(i + 2) === "<" &&
          text.charAt(i + 3) !== "=" &&
          text.charAt(i + 3) !== "!"))
    ) {
      count++;
      if (text.charAt(i + 1) === "?") named = true;
    }
  }
  return { total: count, named };
}
interface SetOperand {
  readonly body: ClassSetExpression;
  readonly character: number | undefined;
  readonly strings: boolean;
  readonly range: boolean;
}

interface Branch {
  readonly id: number;
  readonly alternative: number;
}
interface NamedOccurrence {
  readonly name: string;
  readonly path: readonly Branch[];
}
function disjointPaths(
  left: readonly Branch[],
  right: readonly Branch[],
): boolean {
  for (const a of left) {
    if (a === undefined) throw "REGEXP_BRANCH_INVARIANT";
    for (const b of right) {
      if (b === undefined) throw "REGEXP_BRANCH_INVARIANT";
      if (a.id === b.id && a.alternative !== b.alternative) return true;
    }
  }
  return false;
}
export function parseRegExp(
  pattern: string,
  flagText: string,
): RegExpResult<RegExpPattern> {
  const parsedFlags = parseRegExpFlags(flagText);
  if (!parsedFlags.ok) return { ok: false, error: parsedFlags.error };
  const flags = parsedFlags.value,
    unicode = flags.unicode || flags.unicodeSets,
    totalCaptures = capturesIn(pattern, flags.unicodeSets),
    abort = {};
  let index = 0,
    captures = 0,
    depth = 0,
    nodes = 0;
  const names: NamedCapture[] = [],
    occurrences: NamedOccurrence[] = [],
    path: Branch[] = [];
  const references: { readonly name: string; readonly offset: number }[] = [];
  let nextDisjunction = 0;
  let failure: RegExpDiagnostic | undefined;
  function fail(
    message: string,
    kind: RegExpDiagnostic["kind"] = "syntax",
    at: number = index,
  ): never {
    failure = { kind, source: "pattern", offset: at, message };
    throw abort;
  }
  function peek(): string {
    return pattern.charAt(index);
  }
  function eat(value: string): boolean {
    if (peek() !== value) return false;
    index++;
    return true;
  }
  function character(value: number): PatternNode {
    return { kind: "character", value };
  }
  function readCharacter(): number {
    const value = unicode
      ? (pattern.codePointAt(index) ?? -1)
      : pattern.charCodeAt(index);
    index += value > 0xffff ? 2 : 1;
    return value;
  }
  function hexadecimal(count: number): number | undefined {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const digit = hex(pattern.charCodeAt(index + i));
      if (digit < 0) return undefined;
      value = value * 16 + digit;
    }
    index += count;
    return value;
  }
  function bracedCodePoint(at: number): number {
    let value = 0,
      digits = 0;
    while (hex(pattern.charCodeAt(index)) >= 0) {
      value = value * 16 + hex(pattern.charCodeAt(index));
      index++;
      digits++;
      if (value > 0x10ffff)
        fail("Unicode escape exceeds code point range", "syntax", at);
    }
    if (digits === 0 || !eat("}")) fail("invalid Unicode escape", "syntax", at);
    return value;
  }
  function namePoint(): number {
    if (!eat("\\")) {
      const value = pattern.codePointAt(index) ?? -1;
      index += value > 0xffff ? 2 : 1;
      return value;
    }
    const at = index - 1;
    if (!eat("u")) fail("group name escape must be Unicode", "syntax", at);
    if (eat("{")) return bracedCodePoint(at);
    const value = hexadecimal(4);
    if (value === undefined) fail("invalid group name escape", "syntax", at);
    if (
      value >= 0xd800 &&
      value <= 0xdbff &&
      pattern.startsWith("\\u", index)
    ) {
      const saved = index;
      index += 2;
      const low = hexadecimal(4);
      if (low !== undefined && low >= 0xdc00 && low <= 0xdfff)
        return 0x10000 + (value - 0xd800) * 1024 + low - 0xdc00;
      index = saved;
    }
    return value;
  }
  function groupName(): string {
    let name = "";
    while (index < pattern.length && peek() !== ">") {
      const at = index,
        point = namePoint();
      const allowed =
        point === 36 ||
        point === 95 ||
        (name === ""
          ? isIDStart(point)
          : isIDContinue(point) || point === 0x200c || point === 0x200d);
      if (!allowed) fail("invalid capture group name", "syntax", at);
      name += String.fromCodePoint(point);
    }
    if (name === "" || !eat(">"))
      fail("unterminated or empty capture group name");
    return name;
  }
  function registerName(name: string, capture: number): void {
    for (const prior of occurrences) {
      if (prior === undefined) throw "REGEXP_NAME_INVARIANT";
      if (prior.name === name && !disjointPaths(prior.path, path))
        fail("duplicate capture group name");
    }
    occurrences.push({ name, path: path.slice() });
    names.push({ name, capture });
  }
  function escape(inClass: boolean): PatternNode {
    const at = index - 1;
    if (index >= pattern.length) fail("trailing escape", "syntax", at);
    const c = peek();
    index++;
    if ("dDsSwW".includes(c)) {
      const category =
        c === "d" || c === "D"
          ? "digit"
          : c === "s" || c === "S"
            ? "space"
            : "word";
      return {
        kind: "class",
        inverted: false,
        entries: [
          {
            kind: "category",
            category,
            inverted: c === "D" || c === "S" || c === "W",
          },
        ],
      };
    }
    if (c === "b")
      return inClass ? character(8) : { kind: "assertion", assertion: "word" };
    if (c === "B" && !inClass)
      return { kind: "assertion", assertion: "not-word" };
    if (c === "f") return character(12);
    if (c === "n") return character(10);
    if (c === "r") return character(13);
    if (c === "t") return character(9);
    if (c === "v") return character(11);
    if (c === "c") {
      const code = pattern.charCodeAt(index);
      if (
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (!unicode && inClass && (decimal(code) || code === 95))
      ) {
        index++;
        return character(code % 32);
      }
      if (unicode) fail("invalid control escape", "syntax", at);
      // Annex B treats the backslash as a literal when it cannot begin a
      // control escape. Leave c for the next atom (and its own quantifier).
      index = at + 1;
      return character(92);
    }
    if (c === "x" || c === "u") {
      if (c === "u" && unicode && eat("{")) {
        return character(bracedCodePoint(at));
      }
      const value = hexadecimal(c === "x" ? 2 : 4);
      if (value === undefined) {
        if (unicode) fail("invalid hexadecimal escape", "syntax", at);
        return character(c.charCodeAt(0));
      }
      if (
        c === "u" &&
        unicode &&
        value >= 0xd800 &&
        value <= 0xdbff &&
        pattern.startsWith("\\u", index)
      ) {
        const saved = index;
        index += 2;
        const low = hexadecimal(4);
        if (low !== undefined && low >= 0xdc00 && low <= 0xdfff)
          return character(0x10000 + (value - 0xd800) * 1024 + low - 0xdc00);
        index = saved;
      }
      return character(value);
    }
    if (decimal(c.charCodeAt(0))) {
      const begin = index - 1;
      if (c !== "0" && !inClass) {
        let end = index;
        while (decimal(pattern.charCodeAt(end))) end++;
        const reference = Number(pattern.slice(begin, end));
        if (reference <= totalCaptures.total) {
          index = end;
          return { kind: "backreference", capture: reference };
        }
      }
      if (unicode) {
        if (c === "0" && !decimal(pattern.charCodeAt(index)))
          return character(0);
        fail("invalid decimal escape", "syntax", at);
      }
      if (c >= "0" && c <= "7") {
        let value = c.charCodeAt(0) - 48,
          remaining = c <= "3" ? 2 : 1;
        while (remaining > 0 && peek() >= "0" && peek() <= "7") {
          value = value * 8 + pattern.charCodeAt(index) - 48;
          index++;
          remaining--;
        }
        return character(value);
      }
      return character(c.charCodeAt(0));
    }
    if (c === "k" && (unicode || totalCaptures.named)) {
      if (inClass)
        fail(
          "named reference is not allowed in a character class",
          "syntax",
          at,
        );
      if (!eat("<"))
        fail("named reference requires a group name", "syntax", at);
      const name = groupName();
      references.push({ name, offset: at });
      return { kind: "named-backreference", name };
    }
    if (unicode && (c === "p" || c === "P")) {
      if (!eat("{")) fail("property escape requires braces", "syntax", at);
      const start = index;
      while (index < pattern.length && peek() !== "}") index++;
      const expression = pattern.slice(start, index);
      if (!eat("}")) fail("unterminated property escape", "syntax", at);
      const property = unicodeProperty(expression, flags.unicodeSets);
      if (property === undefined)
        fail("invalid Unicode property", "syntax", at);
      if (property.strings && c === "P")
        fail("cannot complement a string property", "syntax", at);
      return {
        kind: "class",
        inverted: false,
        entries: [
          {
            kind: "property",
            property: property.property,
            value: property.value,
            strings: property.strings,
            inverted: c === "P",
          },
        ],
      };
    }
    if (
      unicode &&
      !"^$\\.*+?()[]{}|/".includes(c) &&
      !(
        inClass &&
        (c === "-" || (flags.unicodeSets && "&!#%,:;<=>@`~".includes(c)))
      )
    )
      fail("invalid identity escape", "syntax", at);
    return character(c.charCodeAt(0));
  }
  function classAtom(): PatternNode {
    return eat("\\") ? escape(true) : character(readCharacter());
  }
  function appendClass(entries: ClassEntry[], node: PatternNode): void {
    if (node.kind === "character")
      entries.push({ kind: "range", from: node.value, to: node.value });
    else if (node.kind === "class")
      for (const entry of node.entries) {
        if (entry === undefined) throw "REGEXP_CLASS_INVARIANT";
        entries.push(entry);
      }
    else throw "REGEXP_CLASS_ATOM_INVARIANT";
  }
  function setEntry(entry: ClassEntry, value: number | undefined): SetOperand {
    return {
      body: { kind: "entry", entry },
      character: value,
      strings: entry.kind === "property" && entry.strings,
      range: false,
    };
  }
  function setCharacter(): number {
    if (index >= pattern.length) fail("missing set character");
    if (eat("\\")) {
      const escaped = escape(true);
      if (escaped.kind !== "character")
        fail("set string or range requires a character");
      return escaped.value;
    }
    const c = peek();
    if ("()[]{}/-\\|".includes(c)) fail("unescaped set syntax character");
    if ("&!#$%*+,.:;<=>?@^`~".includes(c) && pattern.charAt(index + 1) === c)
      fail("reserved doubled set punctuation");
    return readCharacter();
  }
  function setStrings(): SetOperand {
    // The caller consumed \q; alternatives preserve order and empty strings.
    if (!eat("{")) fail("set string requires braces");
    const alternatives: string[] = [];
    let value = "",
      length = 0,
      strings = false;
    while (index < pattern.length && peek() !== "}") {
      if (eat("|")) {
        alternatives.push(value);
        strings = strings || length !== 1;
        value = "";
        length = 0;
      } else {
        value += String.fromCodePoint(setCharacter());
        length++;
      }
    }
    if (!eat("}")) fail("unterminated set string");
    alternatives.push(value);
    return {
      body: { kind: "strings", alternatives },
      character: undefined,
      strings: strings || length !== 1,
      range: false,
    };
  }
  function setOperand(): SetOperand {
    if (++nodes > 1000000) fail("pattern atom limit", "limit");
    if (eat("[")) return setClass();
    if (peek() === "\\") {
      const next = pattern.charAt(index + 1);
      if (next === "q") {
        index += 2;
        return setStrings();
      }
      if (next !== "" && "dDsSwWpP".includes(next)) {
        index++;
        const escaped = escape(true);
        if (escaped.kind !== "class") throw "REGEXP_SET_ESCAPE_INVARIANT";
        const entry = escaped.entries[0];
        if (entry === undefined) throw "REGEXP_SET_ENTRY_INVARIANT";
        return setEntry(entry, undefined);
      }
    }
    const value = setCharacter();
    return setEntry({ kind: "range", from: value, to: value }, value);
  }
  function setUnionItem(): SetOperand {
    const left = setOperand();
    if (peek() !== "-" || pattern.charAt(index + 1) === "-") return left;
    index++;
    const from = left.character;
    if (from === undefined) fail("set range requires character endpoints");
    const to = setCharacter();
    if (from > to) fail("reversed character class range");
    return {
      body: { kind: "entry", entry: { kind: "range", from, to } },
      character: undefined,
      strings: false,
      range: true,
    };
  }
  function setOperator(): string {
    const pair = pattern.slice(index, index + 2);
    return pair === "&&" || pair === "--" ? pair : "";
  }
  function setClass(): SetOperand {
    if (++depth > 128) fail("pattern nesting limit", "limit");
    const inverted = eat("^");
    const operands: ClassSetExpression[] = [];
    let kind: "union" | "intersection" | "subtraction" = "union";
    let strings = false;
    if (peek() !== "]") {
      const first = setUnionItem();
      operands.push(first.body);
      strings = first.strings;
      const operator = setOperator();
      if (operator !== "") {
        if (first.range)
          fail("set range cannot be an intersection or subtraction operand");
        kind = operator === "&&" ? "intersection" : "subtraction";
        while (setOperator() === operator) {
          index += 2;
          if (operator === "&&" && peek() === "&")
            fail("invalid set intersection");
          const right = setOperand();
          operands.push(right.body);
          if (kind === "intersection") strings = strings && right.strings;
        }
      } else {
        while (index < pattern.length && peek() !== "]") {
          const item = setUnionItem();
          operands.push(item.body);
          strings = strings || item.strings;
        }
      }
    }
    if (!eat("]")) fail("unterminated or mixed set expression");
    if (inverted && strings) fail("cannot complement a set containing strings");
    depth--;
    const body: ClassSetExpression = { kind, operands };
    return {
      body: inverted ? { kind: "complement", body } : body,
      character: undefined,
      strings,
      range: false,
    };
  }
  function characterClass(): PatternNode {
    const inverted = eat("^"),
      entries: ClassEntry[] = [];
    while (index < pattern.length && peek() !== "]") {
      const left = classAtom();
      if (
        peek() === "-" &&
        pattern.charAt(index + 1) !== "]" &&
        index + 1 < pattern.length
      ) {
        index++;
        const right = classAtom();
        if (left.kind === "character" && right.kind === "character") {
          if (left.value > right.value) fail("reversed character class range");
          entries.push({ kind: "range", from: left.value, to: right.value });
        } else {
          if (unicode)
            fail("character class escape cannot be a range endpoint");
          appendClass(entries, left);
          entries.push({ kind: "range", from: 45, to: 45 });
          appendClass(entries, right);
        }
      } else appendClass(entries, left);
    }
    if (!eat("]")) fail("unterminated character class");
    return { kind: "class", inverted, entries };
  }
  function quantifier():
    | { readonly min: number; readonly max: number; readonly greedy: boolean }
    | undefined {
    const begin = index;
    let min = 0,
      max = Infinity;
    if (eat("*")) min = 0;
    else if (eat("+")) min = 1;
    else if (eat("?")) max = 1;
    else if (eat("{")) {
      const first = index;
      while (decimal(pattern.charCodeAt(index))) index++;
      if (first === index) {
        index = begin;
        return undefined;
      }
      min = Number(pattern.slice(first, index));
      max = min;
      if (eat(",")) {
        const second = index;
        while (decimal(pattern.charCodeAt(index))) index++;
        max =
          second === index ? Infinity : Number(pattern.slice(second, index));
      }
      if (!eat("}")) {
        index = begin;
        return undefined;
      }
      if (
        min > Number.MAX_SAFE_INTEGER ||
        (max !== Infinity && max > Number.MAX_SAFE_INTEGER)
      )
        fail("quantifier exceeds exact integer capacity", "limit", begin);
      if (min > max) fail("quantifier bounds are reversed", "syntax", begin);
    } else return undefined;
    return { min, max, greedy: !eat("?") };
  }
  function modifierSequence(): string {
    let result = "";
    while (peek() !== "" && "ims".includes(peek())) {
      const flag = peek();
      if (result.includes(flag)) fail("duplicate group modifier");
      result += flag;
      index++;
    }
    return result;
  }
  function groupModifiers(): {
    readonly enable: string;
    readonly disable: string;
  } {
    const enable = modifierSequence();
    const disable = eat("-") ? modifierSequence() : "";
    if (enable === "" && disable === "")
      fail("group modifiers must not be empty");
    for (let i = 0; i < enable.length; i++)
      if (disable.includes(enable.charAt(i)))
        fail("group modifier cannot be both enabled and disabled");
    if (!eat(":")) fail("group modifiers require a colon");
    return { enable, disable };
  }
  function atom(): PatternNode {
    if (++nodes > 1000000) fail("pattern node limit", "limit");
    const c = peek();
    index++;
    if (c === "\\") return escape(false);
    if (c === "[")
      return flags.unicodeSets
        ? { kind: "unicode-set", body: setClass().body }
        : characterClass();
    if (c === ".") return { kind: "dot" };
    if (c === "^" || c === "$")
      return { kind: "assertion", assertion: c === "^" ? "start" : "end" };
    if (c === "(") {
      let modifiers:
        { readonly enable: string; readonly disable: string } | undefined;
      let capture = 0,
        look = false,
        negative = false,
        behind = false;
      if (eat("?")) {
        if (eat(":")) {
        } else if (eat("=")) look = true;
        else if (eat("!")) {
          look = true;
          negative = true;
        } else if (eat("<")) {
          behind = true;
          look = true;
          if (eat("=")) {
          } else if (eat("!")) negative = true;
          else {
            look = false;
            behind = false;
            const name = groupName();
            captures++;
            capture = captures;
            registerName(name, capture);
          }
        } else if ("ims-".includes(peek()) && peek() !== "")
          modifiers = groupModifiers();
        else fail("invalid group prefix");
      } else {
        captures++;
        capture = captures;
      }
      const body = disjunction();
      if (!eat(")")) fail("unterminated group");
      if (modifiers !== undefined)
        return {
          kind: "modifiers",
          enable: modifiers.enable,
          disable: modifiers.disable,
          body,
        };
      return look
        ? { kind: "lookaround", body, behind, negative }
        : { kind: "group", body, capture };
    }
    if (c === "*" || c === "+" || c === "?")
      fail("nothing to repeat", "syntax", index - 1);
    if (c === "{") {
      index--;
      const repeat = quantifier();
      if (repeat !== undefined) fail("nothing to repeat");
      index++;
    }
    if (unicode && (c === "{" || c === "}" || c === "]"))
      fail("unescaped syntax character", "syntax", index - 1);
    index--;
    return character(readCharacter());
  }
  function alternative(): PatternNode {
    const terms: PatternNode[] = [];
    while (index < pattern.length && peek() !== "|" && peek() !== ")") {
      let term = atom();
      const repeat = quantifier();
      if (repeat !== undefined) {
        if (
          term.kind === "assertion" ||
          (term.kind === "lookaround" && (unicode || term.behind))
        )
          fail("assertion cannot be quantified");
        term = {
          kind: "repeat",
          body: term,
          min: repeat.min,
          max: repeat.max,
          greedy: repeat.greedy,
        };
      }
      terms.push(term);
    }
    const first = terms[0];
    return terms.length === 1 && first !== undefined
      ? first
      : { kind: "sequence", terms };
  }
  function disjunction(): PatternNode {
    if (++depth > 128) fail("pattern nesting limit", "limit");
    const id = nextDisjunction++;
    let branch = 0;
    path.push({ id, alternative: branch });
    const alternatives: PatternNode[] = [alternative()];
    while (eat("|")) {
      branch++;
      path[path.length - 1] = { id, alternative: branch };
      alternatives.push(alternative());
    }
    path.pop();
    depth--;
    const first = alternatives[0];
    if (first === undefined) throw "REGEXP_ALTERNATIVE_INVARIANT";
    return alternatives.length === 1
      ? first
      : { kind: "alternation", alternatives };
  }
  try {
    const body = disjunction();
    if (index !== pattern.length) fail("unmatched closing parenthesis");
    for (const reference of references) {
      if (reference === undefined) throw "REGEXP_REFERENCE_INVARIANT";
      if (!names.some((group) => group.name === reference.name))
        fail("unknown capture group name", "syntax", reference.offset);
    }
    return { ok: true, value: { flags, captures, names, body } };
  } catch (error) {
    if (error !== abort) throw error;
  }
  if (failure !== undefined) return { ok: false, error: failure };
  throw "REGEXP_PARSE_INVARIANT";
}
