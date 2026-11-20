import type { GeneratorContracts, GeneratorResumeKind } from "./generator.ts";

export type AsyncGeneratorOutcome<Value> =
  | { readonly kind: "await"; readonly value: Value }
  | { readonly kind: "yield"; readonly value: Value }
  | { readonly kind: "return"; readonly value: Value };
/** Ordinary source yield/return expressions perform their implicit Await before
 * supplying an outcome. Delegation can yield a raw iterator value. An implicit
 * return adds no await job. */
export type AsyncGeneratorContinuation<Value> = (
  kind: GeneratorResumeKind,
  value: Value,
) => AsyncGeneratorOutcome<Value>;
/** A compiled nonsuspending body distinguishes fallthrough from an explicit
 * return expression. Bare return and fallthrough complete directly. */
export interface AsyncGeneratorBodyCompletion<Value> {
  readonly kind: "direct" | "await";
  readonly value: Value;
}
/** Adapt a native body to the protocol without inventing an Await for fallthrough.
 * The protocol handles pre-start requests and releases this continuation on done. */
export function createAsyncReturnContinuation<Value>(
  execute: () => AsyncGeneratorBodyCompletion<Value>,
): AsyncGeneratorContinuation<Value> {
  let state: "initial" | "awaiting" | "completed" = "initial";
  return (kind, value): AsyncGeneratorOutcome<Value> => {
    if (state === "awaiting") {
      state = "completed";
      if (kind === "throw") throw value;
      if (kind !== "next") throw "ASYNC_RETURN_RESUMPTION_INVARIANT";
      return { kind: "return", value };
    }
    if (state !== "initial" || kind !== "next")
      throw "ASYNC_RETURN_ENTRY_INVARIANT";
    state = "completed";
    const completion = execute();
    if (completion.kind === "direct")
      return { kind: "return", value: completion.value };
    state = "awaiting";
    return { kind: "await", value: completion.value };
  };
}

export interface AsyncGeneratorCapability<Value> {
  readonly resolve: (result: Value) => void;
  readonly reject: (reason: Value) => void;
}
export interface AsyncGeneratorHooks<Value> {
  readonly undefinedValue: Value;
  readonly exceptionValue: (error: unknown) => Value;
  readonly iteratorResult: (value: Value, done: boolean) => Value;
  /** Schedule exactly one reaction. Setup may throw synchronously; callbacks
   * must run as jobs. Settlement hooks follow intrinsic Promise semantics. */
  readonly awaitValue: (
    value: Value,
    fulfilled: (value: Value) => void,
    rejected: (reason: Value) => void,
  ) => void;
}
interface AsyncGeneratorRequest<Value> {
  readonly kind: GeneratorResumeKind;
  readonly value: Value;
  readonly capability: AsyncGeneratorCapability<Value>;
  next: AsyncGeneratorRequest<Value> | undefined;
}
type AwaitTarget = "body" | "yield-return" | "completed-return";
interface AwaitResumption<Value> {
  readonly target: AwaitTarget;
  readonly kind: "next" | "throw";
  readonly value: Value;
}
export interface AsyncGeneratorRecord<Value> {
  state:
    | "suspended-start"
    | "suspended-yield"
    | "executing"
    | "draining-queue"
    | "completed";
  continuation: AsyncGeneratorContinuation<Value> | undefined;
  readonly contracts: AsyncGeneratorContracts<Value> | undefined;
  head: AsyncGeneratorRequest<Value> | undefined;
  tail: AsyncGeneratorRequest<Value> | undefined;
  running: boolean;
  waiting: boolean;
  pending: AwaitResumption<Value> | undefined;
}
export interface AsyncGeneratorContracts<
  Value,
> extends GeneratorContracts<Value> {
  readonly typeError: () => Value;
}
export function createAsyncGeneratorRecord<Value>(
  continuation: AsyncGeneratorContinuation<Value>,
  contracts?: AsyncGeneratorContracts<Value>,
): AsyncGeneratorRecord<Value> {
  return {
    state: "suspended-start",
    continuation,
    contracts,
    head: undefined,
    tail: undefined,
    running: false,
    waiting: false,
    pending: undefined,
  };
}
function settleReturn<Value>(
  record: AsyncGeneratorRecord<Value>,
  value: Value,
  hooks: AsyncGeneratorHooks<Value>,
): void {
  const contracts = record.contracts;
  const accepts = contracts?.acceptsReturn;
  if (contracts !== undefined && accepts !== undefined && !accepts(value))
    settleRequest<Value>(record, contracts.typeError(), true, true, hooks);
  else settleRequest<Value>(record, value, false, true, hooks);
}
function settleRequest<Value>(
  record: AsyncGeneratorRecord<Value>,
  value: Value,
  throwing: boolean,
  done: boolean,
  hooks: AsyncGeneratorHooks<Value>,
): void {
  const request = record.head;
  if (request === undefined) throw "ASYNC_GENERATOR_REQUEST_INVARIANT";
  record.head = request.next;
  if (record.head === undefined) record.tail = undefined;
  request.next = undefined;
  // Remove before resolving: iterator-result then lookup can enqueue requests.
  if (throwing) request.capability.reject(value);
  else request.capability.resolve(hooks.iteratorResult(value, done));
}
function awaitInput<Value>(
  record: AsyncGeneratorRecord<Value>,
  target: AwaitTarget,
  value: Value,
  hooks: AsyncGeneratorHooks<Value>,
): void {
  record.waiting = true;
  const resume = (kind: "next" | "throw", result: Value): void => {
    record.waiting = false;
    record.pending = { target, kind, value: result };
    drainAsyncGenerator<Value>(record, hooks);
  };
  try {
    hooks.awaitValue(
      value,
      (result) => resume("next", result),
      (error) => resume("throw", error),
    );
  } catch (error) {
    resume("throw", hooks.exceptionValue(error));
  }
}
function continueBody<Value>(
  record: AsyncGeneratorRecord<Value>,
  kind: GeneratorResumeKind,
  value: Value,
  hooks: AsyncGeneratorHooks<Value>,
): void {
  const continuation = record.continuation;
  if (continuation === undefined)
    throw "ASYNC_GENERATOR_CONTINUATION_INVARIANT";
  let outcome: AsyncGeneratorOutcome<Value>;
  try {
    outcome = continuation(kind, value);
  } catch (error) {
    record.continuation = undefined;
    record.state = "draining-queue";
    settleRequest<Value>(
      record,
      hooks.exceptionValue(error),
      true,
      true,
      hooks,
    );
    return;
  }
  if (outcome.kind === "await") {
    awaitInput<Value>(record, "body", outcome.value, hooks);
  } else if (outcome.kind === "yield") {
    settleRequest<Value>(record, outcome.value, false, false, hooks);
    record.state = "suspended-yield";
  } else {
    record.continuation = undefined;
    record.state = "draining-queue";
    settleReturn<Value>(record, outcome.value, hooks);
  }
}
/** One iterative pump owns execution. Reentrant requests append to the FIFO;
 * synchronous Await setup failures feed the loop rather than recurse. */
function drainAsyncGenerator<Value>(
  record: AsyncGeneratorRecord<Value>,
  hooks: AsyncGeneratorHooks<Value>,
): void {
  if (record.running) return;
  record.running = true;
  try {
    while (!record.waiting) {
      const request = record.head;
      if (request === undefined) {
        if (record.state === "draining-queue") record.state = "completed";
        break;
      }
      const pending = record.pending;
      if (pending !== undefined) {
        record.pending = undefined;
        if (pending.target === "completed-return") {
          if (pending.kind === "throw")
            settleRequest<Value>(record, pending.value, true, true, hooks);
          else settleReturn<Value>(record, pending.value, hooks);
        } else {
          const kind: GeneratorResumeKind =
            pending.target === "yield-return" && pending.kind === "next"
              ? "return"
              : pending.kind;
          continueBody<Value>(record, kind, pending.value, hooks);
        }
      } else if (
        record.state === "draining-queue" ||
        record.state === "completed"
      ) {
        record.state = "draining-queue";
        if (request.kind === "return") {
          awaitInput<Value>(record, "completed-return", request.value, hooks);
        } else {
          settleRequest<Value>(
            record,
            request.kind === "throw" ? request.value : hooks.undefinedValue,
            request.kind === "throw",
            true,
            hooks,
          );
        }
      } else {
        const initial = record.state === "suspended-start";
        record.state = "executing";
        if (!initial && request.kind === "return") {
          awaitInput<Value>(record, "yield-return", request.value, hooks);
        } else {
          const contracts = record.contracts;
          const accepts = contracts?.acceptsNext;
          const invalid =
            !initial &&
            request.kind === "next" &&
            accepts !== undefined &&
            !accepts(request.value);
          continueBody<Value>(
            record,
            invalid ? "throw" : request.kind,
            invalid && contracts !== undefined
              ? contracts.typeError()
              : initial
                ? hooks.undefinedValue
                : request.value,
            hooks,
          );
        }
      }
    }
  } finally {
    record.running = false;
  }
}
/** Receiver/brand validation and creation of the request's Promise capability
 * belong to the object adapter. This protocol owns ordered resumptions only. */
export function enqueueAsyncGenerator<Value>(
  record: AsyncGeneratorRecord<Value>,
  kind: GeneratorResumeKind,
  value: Value,
  capability: AsyncGeneratorCapability<Value>,
  hooks: AsyncGeneratorHooks<Value>,
): void {
  if (record.state === "suspended-start" && kind !== "next") {
    record.state = "completed";
    record.continuation = undefined;
  }
  if (record.state === "completed" && kind !== "return") {
    if (kind === "throw") capability.reject(value);
    else capability.resolve(hooks.iteratorResult(hooks.undefinedValue, true));
    return;
  }
  const request: AsyncGeneratorRequest<Value> = {
    kind,
    value,
    capability,
    next: undefined,
  };
  const tail = record.tail;
  if (tail === undefined) record.head = request;
  else tail.next = request;
  record.tail = request;
  drainAsyncGenerator<Value>(record, hooks);
}

export type AsyncGeneratorStep<Value> = (
  kind: GeneratorResumeKind,
  value: Value,
) => AsyncGeneratorStepOutcome<Value>;
export type AsyncGeneratorStepOutcome<Value> =
  | AsyncGeneratorOutcome<Value>
  | {
      readonly kind: "transfer";
      readonly next: AsyncGeneratorStep<Value>;
      readonly inputKind: GeneratorResumeKind;
      readonly value: Value;
    };
/** Native segment transfers never suspend or retain the preceding call frame. */
export function runAsyncGeneratorSteps<Value>(
  outcome: AsyncGeneratorStepOutcome<Value>,
): AsyncGeneratorOutcome<Value> {
  let current = outcome;
  while (current.kind === "transfer")
    current = current.next(current.inputKind, current.value);
  if (current.kind === "await") return { kind: "await", value: current.value };
  if (current.kind === "yield") return { kind: "yield", value: current.value };
  if (current.kind === "return")
    return { kind: "return", value: current.value };
  throw "ASYNC_GENERATOR_TRANSFER_INVARIANT";
}
