export type GeneratorState =
  "suspended-start" | "suspended-yield" | "executing" | "completed";
export type GeneratorResumeKind = "next" | "return" | "throw";
export type GeneratorOutcome<Value> =
  | { readonly kind: "yield"; readonly result: Value }
  | { readonly kind: "return"; readonly value: Value };
export type GeneratorStep<Value> = (
  kind: GeneratorResumeKind,
  value: Value,
) => GeneratorStepOutcome<Value>;
export type GeneratorStepOutcome<Value> =
  | GeneratorOutcome<Value>
  | {
      readonly kind: "transfer";
      readonly next: GeneratorStep<Value>;
      readonly inputKind: GeneratorResumeKind;
      readonly value: Value;
    };

/** Internal transfers return from the previous native segment before invoking
 * the next one. They neither suspend a generator nor grow its native call stack.
 * Each segment owns its exception scopes; only actual yields escape the driver. */
export function runGeneratorSteps<Value>(
  outcome: GeneratorStepOutcome<Value>,
): GeneratorOutcome<Value> {
  let current = outcome;
  while (current.kind === "transfer") {
    current = current.next(current.inputKind, current.value);
  }
  if (current.kind === "yield")
    return { kind: "yield", result: current.result };
  if (current.kind === "return")
    return { kind: "return", value: current.value };
  throw "GENERATOR_TRANSFER_INVARIANT";
}
export interface GeneratorRecord<Value> {
  state: GeneratorState;
  /** A native continuation captures the frame. Clear it on completion so a
   * retained exhausted generator does not keep its execution state alive. */
  continuation:
    | ((kind: GeneratorResumeKind, value: Value) => GeneratorOutcome<Value>)
    | undefined;
}
export interface GeneratorHooks<Value> {
  readonly undefinedValue: Value;
  readonly typeError: () => Value;
  readonly iteratorResult: (value: Value, done: boolean) => Value;
}

export function createGeneratorRecord<Value>(
  continuation: (
    kind: GeneratorResumeKind,
    value: Value,
  ) => GeneratorOutcome<Value>,
): GeneratorRecord<Value> {
  return { state: "suspended-start", continuation };
}

/** The caller validates the receiver and generator brand. The continuation
 * consumes injected completions at its suspension point and owns pending
 * finally/IteratorClose state. A yield supplies the actual iterator-result
 * object: delegated results must retain identity and observable properties. */
export function resumeGenerator<Value>(
  record: GeneratorRecord<Value>,
  kind: GeneratorResumeKind,
  value: Value,
  hooks: GeneratorHooks<Value>,
): Value {
  const state = record.state;
  // Reject before entering the completion handler: a caught reentrant call
  // must leave the running generator's state and continuation intact.
  if (state === "executing") throw hooks.typeError();
  if (state === "suspended-start" && kind !== "next") {
    record.state = "completed";
    record.continuation = undefined;
  }
  if (record.state === "completed") {
    if (kind === "throw") throw value;
    return hooks.iteratorResult(
      kind === "return" ? value : hooks.undefinedValue,
      true,
    );
  }
  const continuation = record.continuation;
  if (continuation === undefined) throw "generator continuation invariant";
  record.state = "executing";
  try {
    const outcome = continuation(
      kind,
      state === "suspended-start" ? hooks.undefinedValue : value,
    );
    if (outcome.kind === "yield") {
      record.state = "suspended-yield";
      return outcome.result;
    }
    record.state = "completed";
    record.continuation = undefined;
    return hooks.iteratorResult(outcome.value, true);
  } catch (error) {
    record.state = "completed";
    record.continuation = undefined;
    throw error;
  }
}
