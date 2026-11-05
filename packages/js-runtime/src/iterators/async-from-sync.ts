import {
  iteratorClose,
  type IteratorHooks,
  type IteratorRecord,
} from "./iterator.ts";
import type { GeneratorResumeKind } from "./generator.ts";

export interface AsyncIteratorCapability<Value> {
  readonly resolve: (result: Value) => void;
  readonly reject: (reason: Value) => void;
}
export interface AsyncIteratorHooks<Value> extends IteratorHooks<Value> {
  readonly exceptionValue: (error: unknown) => Value;
  readonly iteratorResult: (value: Value, done: boolean) => Value;
  /** Intrinsic PromiseResolve plus reactions. Setup may throw synchronously;
   * exactly one callback runs later in a job, never during this call. */
  readonly awaitValue: (
    value: Value,
    fulfilled: (value: Value) => void,
    rejected: (reason: Value) => void,
  ) => void;
}

/** Adapt one synchronous iterator call. Requests are not serialized: the source
 * method runs immediately, and only the returned value is assimilated. The
 * caller creates a fresh intrinsic Promise capability for each request. */
export function resumeAsyncFromSyncIterator<Value>(
  record: IteratorRecord<Value>,
  kind: GeneratorResumeKind,
  args: readonly Value[],
  capability: AsyncIteratorCapability<Value>,
  hooks: AsyncIteratorHooks<Value>,
): void {
  let value: Value;
  let done = false;
  try {
    let method = record.nextMethod;
    if (kind !== "next") {
      method = hooks.get(record.iterator, kind);
      if (hooks.isNullish(method)) {
        if (kind === "return") {
          const argument = args.length === 0 ? hooks.undefinedValue : args[0];
          capability.resolve(
            hooks.iteratorResult(
              argument === undefined ? hooks.undefinedValue : argument,
              true,
            ),
          );
          return;
        }
        iteratorClose<Value>(record, false, hooks);
        throw hooks.typeError();
      }
    }
    if (!hooks.isCallable(method)) throw hooks.typeError();
    const result = hooks.call(
      method,
      record.iterator,
      args.length === 0 ? [] : args.slice(0, 1),
    );
    if (!hooks.isObject(result)) throw hooks.typeError();
    done = hooks.truthy(hooks.get(result, "done"));
    value = hooks.get(result, "value");
  } catch (error) {
    capability.reject(hooks.exceptionValue(error));
    return;
  }
  const reject = (error: Value): void => {
    // IteratorClose preserves a pending throw over all cleanup failures.
    if (!done && kind !== "return") iteratorClose<Value>(record, true, hooks);
    capability.reject(error);
  };
  try {
    hooks.awaitValue(
      value,
      (resolved): void => {
        try {
          capability.resolve(hooks.iteratorResult(resolved, done));
        } catch (error) {
          capability.reject(hooks.exceptionValue(error));
        }
      },
      reject,
    );
  } catch (error) {
    reject(hooks.exceptionValue(error));
  }
}
