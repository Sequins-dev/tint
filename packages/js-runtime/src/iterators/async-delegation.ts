import type { GeneratorResumeKind } from "./generator.ts";
import type { IteratorHooks, IteratorRecord } from "./iterator.ts";

export type AsyncYieldDelegateOutcome<Value> =
  | { readonly kind: "await"; readonly value: Value }
  | { readonly kind: "yield"; readonly value: Value }
  | { readonly kind: "normal"; readonly value: Value }
  | { readonly kind: "return"; readonly value: Value };

/** A yield* continuation with explicit Await boundaries. The caller performs
 * intrinsic Await and resumes with next/throw; yielded values retain their identity. A normal completion resumes the expression, while return unwinds
 * the enclosing generator. No Promise implementation or native frame is owned
 * here. The enclosing generator supplies next(undefined) on first entry. */
export function createAsyncYieldDelegate<Value>(
  record: IteratorRecord<Value>,
  hooks: IteratorHooks<Value>,
): (
  kind: GeneratorResumeKind,
  value: Value,
) => AsyncYieldDelegateOutcome<Value> {
  let phase: "resume" | "result" | "close" | "missing-return" = "resume";
  let returning = false;
  return (kind, value): AsyncYieldDelegateOutcome<Value> => {
    const previous = phase;
    phase = "resume";
    if (previous !== "resume") {
      if (kind === "throw") throw value;
      if (previous === "missing-return") return { kind: "return", value };
      if (!hooks.isObject(value)) throw hooks.typeError();
      if (previous === "close") throw hooks.typeError();
      const done = hooks.truthy(hooks.get(value, "done"));
      const resultValue = hooks.get(value, "value");
      if (done)
        return returning
          ? { kind: "return", value: resultValue }
          : { kind: "normal", value: resultValue };
      return { kind: "yield", value: resultValue };
    }
    let method = record.nextMethod;
    if (kind !== "next") {
      method = hooks.get(record.iterator, kind);
      if (hooks.isNullish(method)) {
        if (kind === "return") {
          phase = "missing-return";
          return { kind: "await", value };
        }
        const close = hooks.get(record.iterator, "return");
        if (hooks.isNullish(close)) throw hooks.typeError();
        if (!hooks.isCallable(close)) throw hooks.typeError();
        const result = hooks.call(close, record.iterator, []);
        phase = "close";
        return { kind: "await", value: result };
      }
    }
    if (!hooks.isCallable(method)) throw hooks.typeError();
    const result = hooks.call(method, record.iterator, [value]);
    returning = kind === "return";
    phase = "result";
    return { kind: "await", value: result };
  };
}
