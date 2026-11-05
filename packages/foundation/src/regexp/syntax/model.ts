export interface RegExpFlags {
  readonly indices: boolean;
  readonly global: boolean;
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  readonly dotAll: boolean;
  readonly unicode: boolean;
  readonly unicodeSets: boolean;
  readonly sticky: boolean;
}
export type ClassEntry =
  | {
      readonly kind: "property";
      readonly property: string;
      readonly value: string;
      readonly strings: boolean;
      readonly inverted: boolean;
    }
  | { readonly kind: "range"; readonly from: number; readonly to: number }
  | {
      readonly kind: "category";
      readonly category: "digit" | "space" | "word";
      readonly inverted: boolean;
    };
export type ClassSetExpression =
  | { readonly kind: "entry"; readonly entry: ClassEntry }
  | { readonly kind: "strings"; readonly alternatives: readonly string[] }
  | {
      readonly kind: "union" | "intersection" | "subtraction";
      readonly operands: readonly ClassSetExpression[];
    }
  | { readonly kind: "complement"; readonly body: ClassSetExpression };
export type PatternNode =
  | { readonly kind: "unicode-set"; readonly body: ClassSetExpression }
  | { readonly kind: "character"; readonly value: number }
  | { readonly kind: "dot" }
  | {
      readonly kind: "class";
      readonly inverted: boolean;
      readonly entries: readonly ClassEntry[];
    }
  | {
      readonly kind: "assertion";
      readonly assertion: "start" | "end" | "word" | "not-word";
    }
  | { readonly kind: "sequence"; readonly terms: readonly PatternNode[] }
  | {
      readonly kind: "alternation";
      readonly alternatives: readonly PatternNode[];
    }
  | {
      readonly kind: "group";
      readonly capture: number;
      readonly body: PatternNode;
    }
  | {
      readonly kind: "lookaround";
      readonly behind: boolean;
      readonly negative: boolean;
      readonly body: PatternNode;
    }
  | {
      readonly kind: "repeat";
      readonly min: number;
      readonly max: number;
      readonly greedy: boolean;
      readonly body: PatternNode;
    }
  | {
      readonly kind: "modifiers";
      readonly enable: string;
      readonly disable: string;
      readonly body: PatternNode;
    }
  | { readonly kind: "named-backreference"; readonly name: string }
  | { readonly kind: "backreference"; readonly capture: number };
export interface NamedCapture {
  readonly name: string;
  readonly capture: number;
}
export interface RegExpPattern {
  readonly names: readonly NamedCapture[];
  readonly flags: RegExpFlags;
  readonly captures: number;
  readonly body: PatternNode;
}
export interface RegExpDiagnostic {
  readonly kind: "syntax" | "unsupported" | "limit";
  readonly source: "pattern" | "flags";
  readonly offset: number;
  readonly message: string;
}
export type RegExpResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RegExpDiagnostic };
