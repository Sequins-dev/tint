import type { OrdinaryObject, Receiver } from "./operations.ts";

export function isCallableObject<Key, Value>(
  object: OrdinaryObject<Key, Value> | undefined,
): boolean {
  return (
    object !== undefined && object.internalRareSlots?.internalCall !== undefined
  );
}

/** The embedding converts the type error to the current realm's exception.
 * An exception from the implementation propagates without interception. */
export function callObject<Key, Value>(
  object: OrdinaryObject<Key, Value> | undefined,
  receiver: Value,
  arguments_: readonly Value[],
  undefinedValue: Value,
): { readonly error: "none" | "type"; readonly value: Value } {
  let target = object;
  let currentReceiver = receiver;
  let currentArguments = arguments_;
  while (true) {
    if (target === undefined) return { error: "type", value: undefinedValue };
    const implementation = target.internalRareSlots?.internalCall;
    if (implementation === undefined)
      return { error: "type", value: undefinedValue };
    const rare = target.internalRareSlots;
    const dispatch = rare === undefined ? undefined : rare.internalTailDispatch;
    if (dispatch !== undefined) {
      const step = dispatch(currentReceiver, currentArguments);
      if (step.kind === "return") return { error: "none", value: step.value };
      target = step.target;
      currentReceiver = step.receiver;
      currentArguments = step.arguments;
      continue;
    }
    const context = target.internalRareSlots?.internalExecutionContext;
    const callReceiver = currentReceiver;
    const callArguments = currentArguments;
    const value =
      context === undefined
        ? implementation(callReceiver, callArguments)
        : context.run((): Value => implementation(callReceiver, callArguments));
    return { error: "none", value };
  }
}

export function constructObject<Key, Value>(
  object: OrdinaryObject<Key, Value> | undefined,
  arguments_: readonly Value[],
  newTarget: Receiver<Key, Value>,
  undefinedValue: Value,
): { readonly error: "none" | "type"; readonly value: Value } {
  if (object === undefined || newTarget.object === undefined)
    return { error: "type", value: undefinedValue };
  const implementation = object.internalRareSlots?.internalConstruct;
  if (
    implementation === undefined ||
    newTarget.object.internalRareSlots?.internalConstruct === undefined
  )
    return { error: "type", value: undefinedValue };
  const context = object.internalRareSlots?.internalExecutionContext;
  const value =
    context === undefined
      ? implementation(arguments_, newTarget.value)
      : context.run((): Value => implementation(arguments_, newTarget.value));
  return { error: "none", value };
}
