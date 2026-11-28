declare module "node:assert" {
  export type Message = string | Error;
  export type ErrorMatcher =
    RegExp | object | ((error: unknown) => boolean) | string;
  export interface AssertionOptions {
    message?: string | null;
    actual?: unknown;
    expected?: unknown;
    operator?: string;
    stackStartFn?: Function;
    diff?: "simple" | "full";
  }
  export class AssertionError extends Error {
    constructor(options: AssertionOptions);
    readonly code: "ERR_ASSERTION";
    readonly actual: unknown;
    readonly expected: unknown;
    readonly operator: string | undefined;
    readonly diff: "simple" | "full";
    readonly generatedMessage: boolean;
  }
  export function ok(value: unknown, message?: Message): asserts value;
  export function fail(message?: Message): never;
  export function equal(
    actual: unknown,
    expected: unknown,
    message?: Message,
  ): void;
  export function notEqual(
    actual: unknown,
    expected: unknown,
    message?: Message,
  ): void;
  export function strictEqual<T>(
    actual: unknown,
    expected: T,
    message?: Message,
  ): asserts actual is T;
  export function notStrictEqual(
    actual: unknown,
    expected: unknown,
    message?: Message,
  ): void;
  export function deepEqual(
    actual: unknown,
    expected: unknown,
    message?: Message,
  ): void;
  export function notDeepEqual(
    actual: unknown,
    expected: unknown,
    message?: Message,
  ): void;
  export function deepStrictEqual<T>(
    actual: unknown,
    expected: T,
    message?: Message,
  ): asserts actual is T;
  export function notDeepStrictEqual(
    actual: unknown,
    expected: unknown,
    message?: Message,
  ): void;
  export function partialDeepStrictEqual(
    actual: unknown,
    expected: unknown,
    message?: Message,
  ): void;
  export function match(value: string, regexp: RegExp, message?: Message): void;
  export function doesNotMatch(
    value: string,
    regexp: RegExp,
    message?: Message,
  ): void;
  export function ifError(value: unknown): asserts value is null | undefined;
  export function throws(
    fn: () => unknown,
    error?: ErrorMatcher,
    message?: Message,
  ): void;
  export function doesNotThrow(
    fn: () => unknown,
    error?: ErrorMatcher,
    message?: Message,
  ): void;
  export function rejects(
    fn: PromiseLike<unknown> | (() => PromiseLike<unknown>),
    error?: ErrorMatcher,
    message?: Message,
  ): Promise<void>;
  export function doesNotReject(
    fn: PromiseLike<unknown> | (() => PromiseLike<unknown>),
    error?: ErrorMatcher,
    message?: Message,
  ): Promise<void>;

  export interface AssertOptions {
    strict?: boolean;
    skipPrototype?: boolean;
    diff?: "simple" | "full";
  }
  interface AssertionMethods {
    ok: typeof ok;
    fail: typeof fail;
    equal: typeof equal;
    notEqual: typeof notEqual;
    strictEqual: typeof strictEqual;
    notStrictEqual: typeof notStrictEqual;
    deepEqual: typeof deepEqual;
    notDeepEqual: typeof notDeepEqual;
    deepStrictEqual: typeof deepStrictEqual;
    notDeepStrictEqual: typeof notDeepStrictEqual;
    partialDeepStrictEqual: typeof partialDeepStrictEqual;
    match: typeof match;
    doesNotMatch: typeof doesNotMatch;
    ifError: typeof ifError;
    throws: typeof throws;
    doesNotThrow: typeof doesNotThrow;
    rejects: typeof rejects;
    doesNotReject: typeof doesNotReject;
  }
  export class Assert {
    constructor(options?: AssertOptions);
  }
  export interface Assert extends AssertionMethods {}
  interface AssertionFunction extends AssertionMethods {
    (value: unknown, message?: Message): asserts value;
    Assert: typeof Assert;
    AssertionError: typeof AssertionError;
    strict: StrictAssertionFunction;
  }
  interface StrictAssertionFunction extends AssertionFunction {
    equal: typeof strictEqual;
    deepEqual: typeof deepStrictEqual;
  }
  export const strict: StrictAssertionFunction;
  const assert: AssertionFunction;
  export default assert;
}
declare module "node:assert/strict" {
  export * from "node:assert";
  export {
    strict as default,
    strictEqual as equal,
    notStrictEqual as notEqual,
    deepStrictEqual as deepEqual,
    notDeepStrictEqual as notDeepEqual,
  } from "node:assert";
}
