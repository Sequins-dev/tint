import {
  createThisBinding,
  bindThisValue,
  getThisBinding,
  type ThisBinding,
  type BindingResult,
} from "../environments/records/index.ts";
import { constructObject } from "./call.ts";
import type { ObjectHooks, OrdinaryObject, Receiver } from "./operations.ts";

/** Per-invocation state, shared by lexical arrows and never by separate calls. */
export interface DerivedConstruction<Key, Value> {
  readonly newTarget: Receiver<Key, Value>;
  readonly thisBinding: ThisBinding<Value>;
  readonly initialize: (receiver: Value) => void;
}

export function createDerivedConstruction<Key, Value>(
  newTarget: Receiver<Key, Value>,
  undefinedValue: Value,
  initialize: (receiver: Value) => void,
): DerivedConstruction<Key, Value> {
  return {
    newTarget,
    thisBinding: createThisBinding<Value>(undefinedValue),
    initialize,
  };
}

export function getDerivedThis<Key, Value>(
  context: DerivedConstruction<Key, Value>,
): BindingResult<Value> {
  return getThisBinding<Value>(context.thisBinding);
}

/** The caller captures GetSuperConstructor before argument evaluation. Check
 * constructibility afterwards; a second call still constructs before BindThisValue
 * rejects it. Fields run after binding, so abrupt initialization does not undo this. */
export function constructSuper<Key, Value>(
  context: DerivedConstruction<Key, Value>,
  constructor: OrdinaryObject<Key, Value> | undefined,
  args: readonly Value[],
  undefinedValue: Value,
): BindingResult<Value> {
  const result = constructObject<Key, Value>(
    constructor,
    args,
    context.newTarget,
    undefinedValue,
  );
  if (result.error !== "none") return result;
  const error = bindThisValue<Value>(context.thisBinding, result.value);
  if (error !== "none") return { error, value: undefinedValue };
  context.initialize(result.value);
  return result;
}

/** A returned object wins even before super. Other defined values are TypeErrors;
 * undefined (including falling off the body) reads the possibly uninitialized this. */
export function finishDerivedConstruction<Key, Value>(
  context: DerivedConstruction<Key, Value>,
  returned: Receiver<Key, Value>,
  hooks: ObjectHooks<Value>,
): BindingResult<Value> {
  if (returned.object !== undefined)
    return { error: "none", value: returned.value };
  if (!hooks.sameValue(returned.value, hooks.undefinedValue))
    return { error: "type", value: hooks.undefinedValue };
  return getDerivedThis<Key, Value>(context);
}
