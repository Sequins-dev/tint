import { isIDStart, isIDContinue } from "@tint/foundation/unicode/identifiers";
import { createScanner } from "@tint/foundation/text/text-scanner";
import type { SourceTextView } from "@tint/source/text";
import type { Result, Token, Diagnostic } from "./model.ts";
function line(c: number): boolean {
  return c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
}
function space(c: number): boolean {
  return (
    line(c) ||
    c === 9 ||
    c === 11 ||
    c === 12 ||
    c === 32 ||
    c === 160 ||
    c === 0xfeff ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}
function start(c: number): boolean {
  return c === 36 || c === 95 || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function digit(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}
function part(c: number): boolean {
  return start(c) || (c >= 48 && c <= 57);
}
function identifierStart(point: number): boolean {
  return point < 128 ? start(point) : isIDStart(point);
}
function identifierPart(point: number): boolean {
  return point < 128
    ? part(point)
    : point === 0x200c || point === 0x200d || isIDContinue(point);
}
export type SlashGoal = "division" | "regexp";
export interface TokenScanner {
  readonly next: (goal?: SlashGoal) => Result<Token>;
  /** Save this scanner's state; the returned callback restores it repeatedly. */
  readonly checkpoint: () => () => void;
  /** Replace the most recently scanned slash punctuator with a regexp token. */
  readonly rescanRegExp: (slash: Token) => Result<Token>;
}
/** Incremental lexical stream. Terminal states persist until checkpoint restoration. */
export function createTokenScanner(
  source: SourceTextView,
  maxTokens: number = 1000000,
  htmlComments: boolean = false,
): TokenScanner {
  const operators = [
    ">>>=",
    "&&=",
    "||=",
    "??=",
    "===",
    "!==",
    ">>>",
    "**=",
    "<<=",
    ">>=",
    "...",
    "=>",
    "==",
    "!=",
    "<=",
    ">=",
    "&&",
    "||",
    "??",
    "?.",
    "++",
    "--",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "**",
    "<<",
    ">>",
    "&=",
    "|=",
    "^=",
  ];
  const s = createScanner(source.text),
    abort = {};
  let templateBraces: number[] = [];
  let failure: Diagnostic | undefined;
  let count = 0;
  let eof: Token | undefined;
  function fail(
    message: string,
    at: number,
    code: Diagnostic["code"] = "LEXICAL_ERROR",
    feature?: Diagnostic["feature"],
  ): never {
    const position = source.positionAt(at);
    if (!position.ok) throw "lexer position invariant";
    failure = {
      ...(feature === undefined ? {} : { feature }),
      code,
      message,
      start: at,
      end: Math.min(source.text.length, Math.max(at + 1, s.offset())),
      position: position.value,
    };
    throw abort;
  }
  function digits(base: number, required: boolean): void {
    let count = 0,
      separator = false;
    for (;;) {
      const c = s.peekCode(),
        d = digit(c);
      if (d >= 0 && d < base) {
        s.advance();
        count++;
        separator = false;
      } else if (c === 95) {
        if (count === 0 || separator)
          fail("misplaced numeric separator", s.offset());
        separator = true;
        s.advance();
      } else break;
    }
    if (separator || (required && count === 0))
      fail("expected numeric digit", s.offset());
  }
  function hex(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const d = digit(s.peekCode());
      if (d < 0) fail("invalid hexadecimal escape", s.offset());
      value = value * 16 + d;
      s.advance();
    }
    return value;
  }
  function unicodePoint(begin: number): number {
    if (!s.match("{")) return hex(4);
    let point = 0,
      count = 0;
    while (s.peekCode() !== 125 && !s.done()) {
      const d = digit(s.peekCode());
      if (d < 0) fail("invalid Unicode escape", s.offset());
      point = point * 16 + d;
      count++;
      if (point > 0x10ffff) fail("Unicode escape out of range", begin);
      s.advance();
    }
    if (count === 0 || !s.match("}"))
      fail("unterminated Unicode escape", begin);
    return point;
  }
  function quotedText(continuation: boolean = false): {
    value: string;
    substitution: boolean;
    invalidEscape: boolean;
    legacyEscape: boolean;
  } {
    const quote = continuation ? 96 : s.peekCode(),
      begin = s.offset();
    s.advance();
    let value = "";
    let invalidEscape = false;
    let legacyEscape = false;
    while (!s.done()) {
      const c = s.peekCode();
      s.advance();
      if (c === quote)
        return { value, substitution: false, invalidEscape, legacyEscape };
      if (quote === 96 && c === 36 && s.peekCode() === 123) {
        s.advance();
        return { value, substitution: true, invalidEscape, legacyEscape };
      }
      if (c === 10 || c === 13) {
        if (quote !== 96) fail("unterminated string", begin);
        if (c === 13 && s.peekCode() === 10) s.advance();
        value += "\n";
        continue;
      }
      if (c !== 92) {
        value += String.fromCharCode(c);
        continue;
      }
      if (s.done()) fail("unterminated escape", begin);
      const escaped = s.peekCode();
      s.advance();
      if (line(escaped)) {
        if (escaped === 13 && s.peekCode() === 10) s.advance();
        continue;
      }
      try {
        if (escaped === 120) {
          value += String.fromCharCode(hex(2));
          continue;
        }
        if (escaped === 117) {
          value += String.fromCodePoint(unicodePoint(begin));
          continue;
        }
        if (escaped >= 48 && escaped <= 57) {
          const legacy =
            escaped !== 48 || (s.peekCode() >= 48 && s.peekCode() <= 57);
          if (legacy && quote === 96)
            fail("legacy numeric escape in template", begin);
          if (legacy) legacyEscape = true;
          if (escaped >= 56) value += String.fromCharCode(escaped);
          else {
            let code = escaped - 48;
            const limit = escaped <= 51 ? 2 : 1;
            for (
              let i = 0;
              i < limit && s.peekCode() >= 48 && s.peekCode() <= 55;
              i++
            ) {
              code = code * 8 + s.peekCode() - 48;
              s.advance();
            }
            value += String.fromCharCode(code);
          }
          continue;
        }
      } catch (error) {
        if (quote !== 96 || error !== abort) throw error;
        failure = undefined;
        invalidEscape = true;
        continue;
      }
      if (escaped === 110) value += "\n";
      else if (escaped === 114) value += "\r";
      else if (escaped === 116) value += "\t";
      else if (escaped === 98) value += "\b";
      else if (escaped === 102) value += "\f";
      else if (escaped === 118) value += "\v";
      else value += String.fromCharCode(escaped);
    }
    return fail("unterminated string", begin);
  }
  // This identifies the literal boundary only. Pattern and flag validation
  // belong to the RegExp grammar, not the input-element grammar.
  function regexpText(begin: number): string {
    s.advance();
    let inClass = false;
    for (;;) {
      if (s.done() || line(s.peekCode()))
        fail("unterminated regular expression literal", begin);
      const c = s.peekCode();
      s.advance();
      if (c === 92) {
        if (s.done() || line(s.peekCode()))
          fail("unterminated regular expression escape", begin);
        s.advance();
      } else if (c === 91) inClass = true;
      else if (c === 93) inClass = false;
      else if (c === 47 && !inClass) break;
    }
    for (;;) {
      const point = source.text.codePointAt(s.offset()) ?? -1;
      if (!identifierPart(point)) break;
      s.advance(point > 0xffff ? 2 : 1);
    }
    return source.text.slice(begin, s.offset());
  }
  function next(goal: SlashGoal = "division"): Result<Token> {
    if (failure !== undefined) return { ok: false, error: failure };
    if (eof !== undefined) return { ok: true, value: eof };
    try {
      if (
        !Number.isInteger(maxTokens) ||
        maxTokens < 1 ||
        maxTokens > 0xffffffff
      )
        fail("invalid token budget", 0, "LIMIT");
      let lineBreakBefore = false;
      for (;;) {
        if (space(s.peekCode())) {
          if (line(s.peekCode())) lineBreakBefore = true;
          s.advance();
          continue;
        }
        if (s.match("//")) {
          s.eatWhile((c) => !line(c));
          continue;
        }
        if (
          htmlComments &&
          (s.match("<!--") ||
            ((lineBreakBefore || count === 0) && s.match("-->")))
        ) {
          s.eatWhile((c) => !line(c));
          continue;
        }
        const mark = s.mark();
        if (s.match("/*")) {
          while (!s.done() && !source.text.startsWith("*/", s.offset())) {
            if (line(s.peekCode())) lineBreakBefore = true;
            s.advance();
          }
          if (!s.match("*/")) fail("unterminated block comment", mark);
          continue;
        }
        if (s.offset() === 0 && s.match("#!")) {
          s.eatWhile((c) => !line(c));
          continue;
        }
        break;
      }
      const begin = s.offset();
      if (count >= maxTokens) fail("token budget exceeded", begin, "LIMIT");
      count++;
      if (s.done()) {
        if (templateBraces.length !== 0)
          fail("unterminated template substitution", begin);
        eof = {
          kind: "eof",
          value: "",
          start: begin,
          end: begin,
          lineBreakBefore,
        };
        return { ok: true, value: eof };
      }
      const c = s.peekCode();
      let kind: Token["kind"], value: string;
      let escapedIdentifier = false;
      let legacyNumeric = false;
      let invalidEscape = false;
      let legacyEscape = false;
      if (
        c === 125 &&
        templateBraces.length !== 0 &&
        templateBraces[templateBraces.length - 1] === 0
      ) {
        const part = quotedText(true);
        kind = part.substitution ? "template-middle" : "template-tail";
        value = part.value;
        invalidEscape = part.invalidEscape;
        legacyEscape = part.legacyEscape;
        if (!part.substitution) templateBraces.pop();
      } else if (c === 47 && goal === "regexp") {
        kind = "regexp";
        value = regexpText(begin);
      } else if (
        c === 35 ||
        start(c) ||
        c === 92 ||
        (c > 127 && identifierStart(source.text.codePointAt(begin) ?? -1))
      ) {
        const privateIdentifier = c === 35;
        kind = privateIdentifier ? "private-identifier" : "identifier";
        if (privateIdentifier) {
          s.advance();
          const point = source.text.codePointAt(s.offset()) ?? -1;
          if (s.peekCode() !== 92 && !identifierStart(point))
            fail("private identifier requires an identifier name", begin);
        }
        value = s.eatWhile(part);
        for (;;) {
          const next = s.peekCode();
          if (next !== 92 && next < 128) break;
          let point: number;
          if (next === 92) {
            escapedIdentifier = true;
            s.advance();
            if (!s.match("u"))
              fail("identifier escape must be Unicode", s.offset() - 1);
            point = unicodePoint(begin);
            if (
              !(value.length === 0
                ? identifierStart(point)
                : identifierPart(point))
            )
              fail("invalid escaped identifier character", begin);
          } else {
            point = source.text.codePointAt(s.offset()) ?? -1;
            if (
              !(value.length === 0
                ? identifierStart(point)
                : identifierPart(point))
            )
              break;
            s.advance(point > 0xffff ? 2 : 1);
          }
          value += String.fromCodePoint(point) + s.eatWhile(part);
        }
        if (privateIdentifier) value = "#" + value;
      } else if (c === 34 || c === 39 || c === 96) {
        const part = quotedText();
        kind =
          c === 96
            ? part.substitution
              ? "template-head"
              : "template"
            : "string";
        value = part.value;
        invalidEscape = part.invalidEscape;
        if (part.substitution) templateBraces.push(0);
        legacyEscape = part.legacyEscape;
      } else if (
        (c >= 48 && c <= 57) ||
        (c === 46 && s.peekCode(1) >= 48 && s.peekCode(1) <= 57)
      ) {
        kind = "number";
        let integer = true;
        if (
          c === 48 &&
          (s.peekCode(1) === 120 ||
            s.peekCode(1) === 88 ||
            s.peekCode(1) === 98 ||
            s.peekCode(1) === 66 ||
            s.peekCode(1) === 111 ||
            s.peekCode(1) === 79)
        ) {
          const prefix = s.peekCode(1);
          s.advance(2);
          digits(
            prefix === 120 || prefix === 88
              ? 16
              : prefix === 98 || prefix === 66
                ? 2
                : 8,
            true,
          );
        } else {
          if (c === 48 && s.peekCode(1) === 95)
            fail("numeric separator after leading zero", begin);
          legacyNumeric =
            c === 48 && s.peekCode(1) >= 48 && s.peekCode(1) <= 57;
          if (c === 46) {
            integer = false;
            s.advance();
            digits(10, true);
          } else {
            digits(10, true);
            if (s.match(".")) {
              integer = false;
              digits(10, false);
            }
          }
          if (s.peekCode() === 101 || s.peekCode() === 69) {
            integer = false;
            s.advance();
            if (s.peekCode() === 43 || s.peekCode() === 45) s.advance();
            digits(10, true);
          }
        }
        if (s.peekCode() === 110) {
          if (!integer) fail("BigInt literal requires integer syntax", begin);
          s.advance();
          kind = "bigint";
        }
        if (
          part(s.peekCode()) ||
          s.peekCode() === 92 ||
          (s.peekCode() > 127 && !space(s.peekCode()))
        )
          fail("invalid numeric suffix", s.offset());
        value = source.text.substring(begin, s.offset());
        if (legacyNumeric) {
          if (kind === "bigint" || value.includes("_"))
            fail("invalid legacy numeric literal", begin);
          let octal = true,
            digitsEnd = 0;
          while (digitsEnd < value.length) {
            const digit = value.charCodeAt(digitsEnd);
            if (digit < 48 || digit > 57) break;
            if (digit > 55) octal = false;
            digitsEnd++;
          }
          if (octal) {
            if (digitsEnd !== value.length)
              fail("octal literal cannot have fraction or exponent", begin);
            value = "0o" + value.slice(1);
          }
        }
      } else {
        kind = "punctuation";
        value = "";
        for (const operator of operators) {
          if (operator === undefined) throw "operator table invariant";
          if (
            !(
              operator === "?." &&
              s.peekCode(2) >= 48 &&
              s.peekCode(2) <= 57
            ) &&
            s.match(operator)
          ) {
            value = operator;
            break;
          }
        }
        if (value === "") {
          const char = source.text.charAt(begin);
          if (!"{}()[];,:.?+-*/%<>=!~&|^@".includes(char))
            fail("invalid character", begin);
          s.advance();
          value = char;
        }
      }
      if (kind === "punctuation" && templateBraces.length !== 0) {
        const index = templateBraces.length - 1;
        const depth = templateBraces[index];
        if (depth === undefined) throw "TEMPLATE_BRACE_INVARIANT";
        if (value === "{") templateBraces[index] = depth + 1;
        else if (value === "}") templateBraces[index] = depth - 1;
      }
      const token: Token = {
        ...(escapedIdentifier ? { escaped: true } : {}),
        ...(invalidEscape ? { invalidEscape: true } : {}),
        ...(legacyEscape ? { legacyEscape: true } : {}),
        ...(legacyNumeric ? { legacyNumeric: true } : {}),
        kind,
        value,
        start: begin,
        end: s.offset(),
        lineBreakBefore,
      };
      return { ok: true, value: token };
    } catch (error) {
      if (error !== abort) throw error;
    }
    if (failure !== undefined) return { ok: false, error: failure };
    throw "LEXER_RESULT_INVARIANT";
  }
  function checkpoint(): () => void {
    const offset = s.offset(),
      savedCount = count,
      savedEof = eof,
      savedFailure = failure,
      savedBraces = templateBraces.slice();
    return () => {
      if (!s.restore(offset)) throw "LEXER_CHECKPOINT_INVARIANT";
      count = savedCount;
      eof = savedEof;
      failure = savedFailure;
      templateBraces = savedBraces.slice();
    };
  }
  function rescanRegExp(slash: Token): Result<Token> {
    if (
      failure !== undefined ||
      eof !== undefined ||
      slash.end !== s.offset() ||
      slash.kind !== "punctuation" ||
      (slash.value !== "/" && slash.value !== "/=")
    )
      throw "LEXER_RESCAN_INVARIANT";
    if (!s.restore(slash.start)) throw "LEXER_RESCAN_OFFSET_INVARIANT";
    count--;
    const result = next("regexp");
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      value: { ...result.value, lineBreakBefore: slash.lineBreakBefore },
    };
  }
  return { next, checkpoint, rescanRegExp };
}
/** Eager adapter for callers that need the complete token list. */
export function scan(
  source: SourceTextView,
  maxTokens: number = 1000000,
): Result<readonly Token[]> {
  const scanner = createTokenScanner(source, maxTokens);
  const tokens: Token[] = [];
  for (;;) {
    const result = scanner.next();
    if (!result.ok) return { ok: false, error: result.error };
    tokens.push(result.value);
    if (result.value.kind === "eof") break;
  }
  return { ok: true, value: tokens };
}
