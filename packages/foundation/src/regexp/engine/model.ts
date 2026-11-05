import type {
  ClassEntry,
  ClassSetExpression,
  NamedCapture,
  RegExpFlags,
} from "../syntax/index.ts";
export type Instruction =
  | { readonly kind: "accept" }
  | {
      readonly kind: "character";
      readonly ignoreCase: boolean;
      readonly value: number;
      readonly next: number;
    }
  | { readonly kind: "dot"; readonly dotAll: boolean; readonly next: number }
  | {
      readonly kind: "class";
      readonly ignoreCase: boolean;
      readonly entries: readonly ClassEntry[];
      readonly inverted: boolean;
      readonly next: number;
    }
  | {
      readonly kind: "set";
      readonly ignoreCase: boolean;
      readonly body: ClassSetExpression;
      readonly next: number;
    }
  | {
      readonly kind: "assert";
      readonly ignoreCase: boolean;
      readonly assertion: "start" | "end" | "word" | "not-word";
      readonly multiline: boolean;
      readonly next: number;
    }
  | { readonly kind: "save"; readonly slot: number; readonly next: number }
  | {
      readonly kind: "backreference";
      readonly ignoreCase: boolean;
      readonly captures: readonly number[];
      readonly next: number;
    }
  | { readonly kind: "split"; readonly first: number; readonly second: number }
  | {
      readonly kind: "repeat-enter";
      readonly slot: number;
      readonly next: number;
    }
  | {
      readonly kind: "repeat";
      readonly slot: number;
      readonly min: number;
      readonly max: number;
      readonly greedy: boolean;
      readonly body: number;
      readonly exit: number;
    }
  | {
      readonly kind: "repeat-body";
      readonly slot: number;
      readonly captures: readonly number[];
      readonly next: number;
    }
  | {
      readonly kind: "repeat-end";
      readonly slot: number;
      readonly min: number;
      readonly choice: number;
    }
  | {
      readonly kind: "look";
      readonly entry: number;
      readonly behind: boolean;
      readonly negative: boolean;
      readonly next: number;
    };
/** Ordered control-flow program; addresses are instruction indices, not host pointers. */
export interface RegExpProgram {
  readonly instructions: readonly Instruction[];
  readonly entry: number;
  readonly captures: number;
  readonly repeats: number;
  readonly flags: RegExpFlags;
  readonly names: readonly NamedCapture[];
}
export interface CaptureRange {
  readonly start: number;
  readonly end: number;
}
export interface RegExpMatch {
  readonly start: number;
  readonly end: number;
  readonly captures: readonly (CaptureRange | undefined)[];
}
export type MatchResult =
  | { readonly kind: "match"; readonly match: RegExpMatch }
  | { readonly kind: "no-match" }
  | { readonly kind: "limit"; readonly message: string }
  | { readonly kind: "invalid"; readonly message: string };
