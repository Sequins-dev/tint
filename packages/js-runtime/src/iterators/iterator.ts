import type { GeneratorResumeKind } from "./generator.ts";

export interface IteratorRecord<Value> {
  readonly iterator: Value;
  readonly nextMethod: Value;
  done: boolean;
}
export interface IteratorHooks<Value> {
  readonly undefinedValue: Value;
  readonly get: (object: Value, key: string) => Value;
  readonly call: (
    method: Value,
    receiver: Value,
    args: readonly Value[],
  ) => Value;
  readonly isObject: (value: Value) => boolean;
  readonly isCallable: (value: Value) => boolean;
  readonly isNullish: (value: Value) => boolean;
  readonly truthy: (value: Value) => boolean;
  readonly typeError: () => Value;
}
export interface IteratorStep<Value> {
  readonly done: boolean;
  readonly value: Value;
}

/** GetIteratorFromMethod caches next without requiring it to be callable yet. */
export function getIteratorFromMethod<Value>(
  value: Value,
  method: Value,
  hooks: IteratorHooks<Value>,
): IteratorRecord<Value> {
  if (!hooks.isCallable(method)) throw hooks.typeError();
  const iterator = hooks.call(method, value, []);
  if (!hooks.isObject(iterator)) throw hooks.typeError();
  const nextMethod = hooks.get(iterator, "next");
  return { iterator, nextMethod, done: false };
}
/** An explicit argument list distinguishes next() from next(undefined). */
export function iteratorNext<Value>(
  record: IteratorRecord<Value>,
  args: readonly Value[],
  hooks: IteratorHooks<Value>,
): Value {
  try {
    const result = hooks.call(record.nextMethod, record.iterator, args);
    if (!hooks.isObject(result)) throw hooks.typeError();
    return result;
  } catch (error) {
    record.done = true;
    throw error;
  }
}
/** Step without reading value, used for destructuring elisions. */
export function iteratorStep<Value>(
  record: IteratorRecord<Value>,
  hooks: IteratorHooks<Value>,
): IteratorStep<Value> {
  const result = iteratorNext<Value>(record, [], hooks);
  try {
    const done = hooks.truthy(hooks.get(result, "done"));
    if (done) {
      record.done = true;
      return { done: true, value: hooks.undefinedValue };
    }
    return { done: false, value: result };
  } catch (error) {
    record.done = true;
    throw error;
  }
}
export function iteratorStepValue<Value>(
  record: IteratorRecord<Value>,
  hooks: IteratorHooks<Value>,
): IteratorStep<Value> {
  const step = iteratorStep<Value>(record, hooks);
  if (step.done) return step;
  try {
    return { done: false, value: hooks.get(step.value, "value") };
  } catch (error) {
    record.done = true;
    throw error;
  }
}
/** The caller retains its pending completion. A pending throw wins over every
 * close failure; normal/break/continue/return completions propagate close errors.
 * This operation does not decide whether closing is needed or change Done. */
export function iteratorClose<Value>(
  record: IteratorRecord<Value>,
  throwing: boolean,
  hooks: IteratorHooks<Value>,
): void {
  try {
    const method = hooks.get(record.iterator, "return");
    if (hooks.isNullish(method)) return;
    if (!hooks.isCallable(method)) throw hooks.typeError();
    const result = hooks.call(method, record.iterator, []);
    if (!throwing && !hooks.isObject(result)) throw hooks.typeError();
  } catch (error) {
    if (!throwing) throw error;
  }
}

export type YieldDelegateOutcome<Value> =
  | { readonly kind: "yield"; readonly result: Value }
  | { readonly kind: "normal"; readonly value: Value }
  | { readonly kind: "return"; readonly value: Value };

/** One synchronous yield* resumption. The native continuation retains the
 * iterator record across suspension and supplies next(undefined) initially.
 * Normal completion supplies the expression's value; return completion must
 * unwind the enclosing generator. A yielded result is passed through unchanged.
 * No native stack or pending return is retained by this operation. */
export function resumeYieldDelegate<Value>(
  record: IteratorRecord<Value>,
  kind: GeneratorResumeKind,
  value: Value,
  hooks: IteratorHooks<Value>,
): YieldDelegateOutcome<Value> {
  let method = record.nextMethod;
  if (kind !== "next") {
    method = hooks.get(record.iterator, kind);
    if (hooks.isNullish(method)) {
      if (kind === "return") return { kind: "return", value };
      // The missing-throw protocol error is created only after successful
      // cleanup. This is a normal close, not a close preserving the injected
      // exception: a failing return getter/call takes precedence.
      iteratorClose<Value>(record, false, hooks);
      throw hooks.typeError();
    }
    if (!hooks.isCallable(method)) throw hooks.typeError();
  }
  const result = hooks.call(method, record.iterator, [value]);
  if (!hooks.isObject(result)) throw hooks.typeError();
  if (!hooks.truthy(hooks.get(result, "done")))
    return { kind: "yield", result };
  const completedValue = hooks.get(result, "value");
  return kind === "return"
    ? { kind: "return", value: completedValue }
    : { kind: "normal", value: completedValue };
}
