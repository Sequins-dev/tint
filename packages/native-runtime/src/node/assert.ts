import { codedError, invalidArgument } from "./coded-errors.ts";
import { inspect } from "./util-inspect.ts";
import { deepCompare, type ComparisonMode } from "./value-comparison.ts";

type Message = string | Error;
type Matcher = RegExp | Function | object | string;
type CheckFunction = () => unknown;

interface AssertionOptions {
  readonly message?: string | null | undefined;
  readonly actual?: unknown;
  readonly expected?: unknown;
  readonly operator?: string;
  readonly stackStartFn?: Function;
  readonly diff?: "simple" | "full";
}

function display(value: unknown): string {
  if (value instanceof Error) return value.name + ": " + value.message;
  return inspect(value, {
    depth: 4,
    colors: false,
    sorted: true,
    customInspect: false,
  });
}

function assertionMessage(
  operator: string | undefined,
  actual: unknown,
  expected: unknown,
): string {
  if (operator === "fail") return "Failed";
  if (operator === "ok") return "The expression evaluated to a falsy value";
  if (
    operator === "strictEqual" &&
    typeof actual === "number" &&
    typeof expected === "number"
  )
    return (
      "Expected values to be strictly equal:\n\n" +
      display(actual) +
      " !== " +
      display(expected) +
      "\n"
    );
  if (
    operator === "strictEqual" ||
    operator === "deepStrictEqual" ||
    operator === "partialDeepStrictEqual"
  )
    return (
      "Expected values to be strictly " +
      (operator === "strictEqual" ? "" : "deep-") +
      "equal:\n\n" +
      "+ actual - expected\n\n+ " +
      display(actual) +
      "\n- " +
      display(expected) +
      "\n"
    );
  if (operator === "notStrictEqual" || operator === "notDeepStrictEqual")
    return (
      'Expected "actual" to be strictly unequal to:\n\n' +
      display(expected) +
      "\n"
    );
  return display(actual) + " " + operator + " " + display(expected);
}

export class AssertionError extends Error {
  readonly code: "ERR_ASSERTION" = "ERR_ASSERTION";
  readonly actual: unknown;
  readonly expected: unknown;
  readonly operator: string | undefined;
  readonly diff: "simple" | "full";
  readonly generatedMessage: boolean;

  constructor(options: AssertionOptions) {
    if (options === null || typeof options !== "object")
      throw invalidArgument("options", "of type object", options);
    const operator = options.operator;
    const generated = options.message === undefined || options.message === null;
    super(
      generated
        ? assertionMessage(operator, options.actual, options.expected)
        : String(options.message),
    );
    Object.defineProperty(this, "name", {
      value: "AssertionError",
      writable: true,
      configurable: true,
    });
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = operator;
    this.diff = options.diff ?? "simple";
    this.generatedMessage = generated;
    const capture: unknown = Reflect.get(Error, "captureStackTrace");
    if (typeof capture === "function")
      Reflect.apply(capture, Error, [
        this,
        options.stackStartFn ?? AssertionError,
      ]);
  }

  override toString(): string {
    return this.name + " [" + this.code + "]: " + this.message;
  }
}

function failure(
  actual: unknown,
  expected: unknown,
  operator: string,
  caller: Function,
  message?: Message,
  diff?: "simple" | "full",
): never {
  if (message instanceof Error) throw message;
  throw new AssertionError({
    actual,
    expected,
    operator,
    message,
    ...(diff === undefined ? {} : { diff }),
    stackStartFn: caller,
  });
}

function requireArguments(count: number, expected: string): void {
  if (count < 2) throw codedError(new TypeError(expected), "ERR_MISSING_ARGS");
}
function requirePair(count: number): void {
  requireArguments(
    count,
    'The "actual" and "expected" arguments must be specified',
  );
}

export function ok(value?: unknown, message?: Message): void {
  if (!value) {
    if (message instanceof Error) throw message;
    const error = new AssertionError({
      actual: value,
      expected: true,
      operator: "==",
      stackStartFn: ok,
      message,
    });
    if (error.generatedMessage)
      error.message =
        arguments.length === 0
          ? "No value argument passed to `assert.ok()`"
          : "The expression evaluated to a falsy value";
    throw error;
  }
}
function assert(value?: unknown, message?: Message): void {
  if (arguments.length === 0) ok();
  else ok(value, message);
}

export function fail(message?: Message): never {
  return failure(undefined, undefined, "fail", fail, message);
}

export function equal(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  if (actual != expected && !(Number.isNaN(actual) && Number.isNaN(expected)))
    failure(actual, expected, "==", equal, message);
}
export function notEqual(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  if (actual == expected || (Number.isNaN(actual) && Number.isNaN(expected)))
    failure(actual, expected, "!=", notEqual, message);
}
export function strictEqual(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  if (!Object.is(actual, expected))
    failure(actual, expected, "strictEqual", strictEqual, message);
}
export function notStrictEqual(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  if (Object.is(actual, expected))
    failure(actual, expected, "notStrictEqual", notStrictEqual, message);
}

function verifyDeep(
  actual: unknown,
  expected: unknown,
  mode: ComparisonMode,
  negated: boolean,
  operator: string,
  caller: Function,
  message?: Message,
  skipPrototype: boolean = false,
  diff?: "simple" | "full",
): void {
  if (deepCompare(actual, expected, mode, skipPrototype) === negated)
    failure(actual, expected, operator, caller, message, diff);
}

export function deepEqual(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  verifyDeep(actual, expected, "loose", false, "deepEqual", deepEqual, message);
}
export function notDeepEqual(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  verifyDeep(
    actual,
    expected,
    "loose",
    true,
    "notDeepEqual",
    notDeepEqual,
    message,
  );
}
export function deepStrictEqual(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  verifyDeep(
    actual,
    expected,
    "strict",
    false,
    "deepStrictEqual",
    deepStrictEqual,
    message,
  );
}
export function notDeepStrictEqual(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  verifyDeep(
    actual,
    expected,
    "strict",
    true,
    "notDeepStrictEqual",
    notDeepStrictEqual,
    message,
  );
}
export function partialDeepStrictEqual(
  actual: unknown,
  expected: unknown,
  message?: Message,
): void {
  requirePair(arguments.length);
  verifyDeep(
    actual,
    expected,
    "partial",
    false,
    "partialDeepStrictEqual",
    partialDeepStrictEqual,
    message,
  );
}

function checkRegexp(
  value: unknown,
  regexp: RegExp,
  inverse: boolean,
  caller: Function,
  message?: Message,
): void {
  if (!(regexp instanceof RegExp))
    throw invalidArgument("regexp", "an instance of RegExp", regexp);
  if (
    typeof value === "string" &&
    RegExp.prototype.test.call(regexp, value) !== inverse
  )
    return;
  const heading =
    typeof value !== "string"
      ? 'The "string" argument must be of type string. Received ' +
        display(value)
      : "The input was expected to " +
        (inverse ? "not " : "") +
        "match the regular expression " +
        String(regexp) +
        ". Input:\n\n" +
        display(value) +
        "\n";
  failure(
    value,
    regexp,
    inverse ? "doesNotMatch" : "match",
    caller,
    message ?? heading,
  );
}
export function match(value: string, regexp: RegExp, message?: Message): void {
  checkRegexp(value, regexp, false, match, message);
}
export function doesNotMatch(
  value: string,
  regexp: RegExp,
  message?: Message,
): void {
  checkRegexp(value, regexp, true, doesNotMatch, message);
}

interface Captured {
  readonly failed: boolean;
  readonly thrown: unknown;
}
function syncResult(fn: CheckFunction): Captured {
  if (typeof fn !== "function")
    throw invalidArgument("fn", "of type function", fn);
  try {
    fn();
    return { failed: false, thrown: undefined };
  } catch (error) {
    return { failed: true, thrown: error };
  }
}
function promiseLike(value: unknown): boolean {
  return (
    value instanceof Promise ||
    (typeof value === "object" &&
      value !== null &&
      typeof Reflect.get(value, "then") === "function" &&
      typeof Reflect.get(value, "catch") === "function")
  );
}
async function asyncResult(
  input: PromiseLike<unknown> | CheckFunction,
): Promise<Captured> {
  const value = typeof input === "function" ? input() : input;
  if (!promiseLike(value)) {
    if (typeof input !== "function")
      throw invalidArgument(
        "asyncFn",
        "of type function or an instance of Promise",
        input,
      );
    throw codedError(
      new TypeError("Expected the function to return a Promise"),
      "ERR_INVALID_RETURN_VALUE",
    );
  }
  try {
    await value;
    return { failed: false, thrown: undefined };
  } catch (error) {
    return { failed: true, thrown: error };
  }
}

function matchesError(value: unknown, expected: Matcher): boolean {
  if (typeof expected === "string") return false;
  if (expected instanceof RegExp)
    return RegExp.prototype.test.call(expected, String(value));
  if (typeof expected === "function") {
    if (
      typeof Reflect.get(expected, "prototype") === "object" &&
      value instanceof expected
    )
      return true;
    if (expected === Error || Error.isPrototypeOf(expected)) return false;
    return Reflect.apply(expected, {}, [value]) === true;
  }
  const fields = Object.keys(expected);
  if (expected instanceof Error) {
    fields.push("name", "message");
  } else if (fields.length === 0) {
    throw codedError(
      new TypeError("The argument 'error' may not be an empty object"),
      "ERR_INVALID_ARG_VALUE",
    );
  }
  if (value === null || typeof value !== "object") return false;
  for (const key of fields) {
    if (key === undefined) continue;
    const test: unknown = Reflect.get(expected, key);
    const actual: unknown = Reflect.get(value, key);
    if (!(key in value)) return false;
    if (test instanceof RegExp && typeof actual === "string") {
      if (!RegExp.prototype.test.call(test, actual)) return false;
    } else if (!deepCompare(actual, test, "strict")) return false;
  }
  return true;
}

function checkError(
  result: Captured,
  expected: Matcher | undefined,
  message: Message | undefined,
  negated: boolean,
  async: boolean,
  caller: Function,
): void {
  if (typeof expected === "string") {
    if (message !== undefined)
      throw invalidArgument("error", "of type object or function", expected);
    if (
      result.failed &&
      (result.thrown === expected ||
        (result.thrown instanceof Error && result.thrown.message === expected))
    )
      throw codedError(
        new TypeError("The error message is identical to the supplied message"),
        "ERR_AMBIGUOUS_ARGUMENT",
      );
    message = expected;
    expected = undefined;
  }
  if (
    expected !== undefined &&
    expected !== null &&
    typeof expected !== "object" &&
    typeof expected !== "function"
  )
    throw invalidArgument("error", "of type object or function", expected);
  if (expected === null) expected = undefined;
  if (negated) {
    if (!result.failed) return;
    if (expected !== undefined && !matchesError(result.thrown, expected))
      throw result.thrown;
    failure(
      result.thrown,
      expected,
      async ? "doesNotReject" : "doesNotThrow",
      caller,
      message ?? "Got unwanted " + (async ? "rejection" : "exception"),
    );
  } else {
    if (!result.failed)
      failure(
        undefined,
        expected,
        async ? "rejects" : "throws",
        caller,
        "Missing expected " +
          (async ? "rejection" : "exception") +
          (message === undefined ? "." : ": " + String(message)),
      );
    if (expected !== undefined && !matchesError(result.thrown, expected)) {
      failure(
        result.thrown,
        expected,
        async ? "rejects" : "throws",
        caller,
        message,
      );
    }
  }
}
export function throws(
  fn: CheckFunction,
  expected?: Matcher,
  message?: Message,
): void {
  checkError(syncResult(fn), expected, message, false, false, throws);
}
export function doesNotThrow(
  fn: CheckFunction,
  expected?: Matcher,
  message?: Message,
): void {
  checkError(syncResult(fn), expected, message, true, false, doesNotThrow);
}
export async function rejects(
  input: PromiseLike<unknown> | CheckFunction,
  expected?: Matcher,
  message?: Message,
): Promise<void> {
  checkError(await asyncResult(input), expected, message, false, true, rejects);
}
export async function doesNotReject(
  input: PromiseLike<unknown> | CheckFunction,
  expected?: Matcher,
  message?: Message,
): Promise<void> {
  checkError(
    await asyncResult(input),
    expected,
    message,
    true,
    true,
    doesNotReject,
  );
}
export function ifError(value: unknown): void {
  if (value !== null && value !== undefined)
    failure(
      value,
      null,
      "ifError",
      ifError,
      "ifError got unwanted exception: " +
        (value instanceof Error && value.message
          ? value.message
          : display(value)),
    );
}

interface AssertOptions {
  readonly strict?: boolean;
  readonly skipPrototype?: boolean;
  readonly diff?: "simple" | "full";
}
export class Assert {
  readonly #strict: boolean;
  readonly #skipPrototype: boolean;
  readonly #diff: "simple" | "full";
  constructor(options?: AssertOptions) {
    if (
      options !== undefined &&
      (options === null || typeof options !== "object")
    )
      throw invalidArgument("options", "of type object", options);
    this.#strict = options?.strict ?? true;
    this.#skipPrototype = options?.skipPrototype === true;
    const diff = options?.diff;
    if (diff !== undefined && diff !== "simple" && diff !== "full")
      throw codedError(
        new TypeError("options.diff must be 'simple' or 'full'"),
        "ERR_INVALID_ARG_VALUE",
      );
    this.#diff = diff ?? "simple";
  }
  ok = ok;
  fail = fail;
  strictEqual(actual: unknown, expected: unknown, message?: Message): void {
    requirePair(arguments.length);
    if (!Object.is(actual, expected))
      failure(
        actual,
        expected,
        "strictEqual",
        strictEqual,
        message,
        this.#diff,
      );
  }
  notStrictEqual(actual: unknown, expected: unknown, message?: Message): void {
    requirePair(arguments.length);
    if (Object.is(actual, expected))
      failure(
        actual,
        expected,
        "notStrictEqual",
        notStrictEqual,
        message,
        this.#diff,
      );
  }
  equal(actual: unknown, expected: unknown, message?: Message): void {
    requirePair(arguments.length);
    if (this.#strict) this.strictEqual(actual, expected, message);
    else equal(actual, expected, message);
  }
  notEqual(actual: unknown, expected: unknown, message?: Message): void {
    requirePair(arguments.length);
    if (this.#strict) this.notStrictEqual(actual, expected, message);
    else notEqual(actual, expected, message);
  }
  deepEqual(actual: unknown, expected: unknown, message?: Message): void {
    requirePair(arguments.length);
    if (this.#strict) this.deepStrictEqual(actual, expected, message);
    else deepEqual(actual, expected, message);
  }
  notDeepEqual(actual: unknown, expected: unknown, message?: Message): void {
    requirePair(arguments.length);
    if (this.#strict) this.notDeepStrictEqual(actual, expected, message);
    else notDeepEqual(actual, expected, message);
  }
  deepStrictEqual(actual: unknown, expected: unknown, message?: Message): void {
    requirePair(arguments.length);
    verifyDeep(
      actual,
      expected,
      "strict",
      false,
      "deepStrictEqual",
      deepStrictEqual,
      message,
      this.#skipPrototype,
      this.#diff,
    );
  }
  notDeepStrictEqual(
    actual: unknown,
    expected: unknown,
    message?: Message,
  ): void {
    requirePair(arguments.length);
    verifyDeep(
      actual,
      expected,
      "strict",
      true,
      "notDeepStrictEqual",
      notDeepStrictEqual,
      message,
      this.#skipPrototype,
      this.#diff,
    );
  }
  partialDeepStrictEqual = partialDeepStrictEqual;
  throws = throws;
  doesNotThrow = doesNotThrow;
  rejects = rejects;
  doesNotReject = doesNotReject;
  ifError = ifError;
  match = match;
  doesNotMatch = doesNotMatch;
}

const shared = {
  Assert,
  AssertionError,
  ok,
  fail,
  strictEqual,
  notStrictEqual,
  deepStrictEqual,
  notDeepStrictEqual,
  partialDeepStrictEqual,
  throws,
  doesNotThrow,
  rejects,
  doesNotReject,
  ifError,
  match,
  doesNotMatch,
};
export const strict = Object.assign(
  function strict(value?: unknown, message?: Message): void {
    if (arguments.length === 0) ok();
    else ok(value, message);
  },
  shared,
  {
    equal: strictEqual,
    notEqual: notStrictEqual,
    deepEqual: deepStrictEqual,
    notDeepEqual: notDeepStrictEqual,
  },
);
Object.assign(strict, { strict });
export default Object.assign(assert, shared, {
  strict,
  equal,
  notEqual,
  deepEqual,
  notDeepEqual,
});
