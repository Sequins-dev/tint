import {
  ensureRareSlots,
  getPrototype,
  createCallableObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectCall,
  type ObjectCallDispatch,
} from "./operations.ts";
/** Bound call/construct capabilities. Metadata belongs to the language embedding. */
export function createBoundFunction<Key, Value>(
  target: OrdinaryObject<Key, Value>,
  receiver: Value,
  prefix: readonly Value[],
  undefinedValue: Value,
  box: (object: OrdinaryObject<Key, Value>) => Value,
  sameValue: (left: Value, right: Value) => boolean,
): OrdinaryObject<Key, Value> {
  const call = target.internalCall;
  if (call === undefined) throw "BOUND_CALLABLE_INVARIANT";
  const construct = target.internalConstruct;
  const boundArgs = prefix.slice();
  function argumentsFor(args: readonly Value[]): Value[] {
    const values = boundArgs.slice();
    for (let index = 0; index < args.length; index++) {
      const value = args[index];
      values.push(value === undefined ? undefinedValue : value);
    }
    return values;
  }
  const invoke: ObjectCall<Value> = (ignored, args): Value =>
    call(receiver, argumentsFor(args));
  const bound: OrdinaryObject<Key, Value> =
    construct === undefined
      ? createCallableObject<Key, Value>(
          getPrototype<Key, Value>(target),
          invoke,
          target.internalRareSlots?.internalExecutionContext,
        )
      : createConstructorObject<Key, Value>(
          getPrototype<Key, Value>(target),
          invoke,
          (args, newTarget): Value =>
            construct(
              argumentsFor(args),
              sameValue(newTarget, box(bound)) ? box(target) : newTarget,
            ),
          target.internalRareSlots?.internalExecutionContext,
        );
  const rare = ensureRareSlots<Key, Value>(bound);
  rare.internalBoundTarget = target;
  // A bound call forwards without owning a source execution context. Return
  // the next step so repeated tail calls do not retain a forwarding frame.
  rare.internalTailDispatch = (
    ignored,
    args,
  ): ObjectCallDispatch<Key, Value> => ({
    kind: "call",
    target,
    receiver,
    arguments: argumentsFor(args),
  });
  return bound;
}
