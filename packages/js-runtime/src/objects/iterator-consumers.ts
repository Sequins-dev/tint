import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  getScriptCallbackIterator,
  getScriptIteratorDirect,
  collectScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";

/** Eager consumers share stepping and close precedence with language iteration. */
export function installIteratorConsumers(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.iteratorPrototype,
    "toArray",
    builtinFunction(
      realm.functionPrototype,
      "toArray",
      0,
      (receiver, args): unknown =>
        collectScriptIterator(
          getScriptIteratorDirect(receiver, realm, hooks),
          realm,
          hooks,
        ),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["forEach", "some", "every", "find", "reduce"]) {
    if (name === undefined) throw "ITERATOR_CONSUMER_NAME_INVARIANT";
    builtinProperty(
      realm.iteratorPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const callback = args[0];
          const iterator = getScriptCallbackIterator(
            receiver,
            callback,
            realm,
            hooks,
          );
          const protocol = iterator.hooks;
          let index = 0;
          let accumulator = args[1];
          if (name === "reduce" && args.length < 2) {
            const first = stepScriptIterator(iterator);
            if (first.done) throw createRuntimeError(realm, "type");
            accumulator = first.value;
            index = 1;
          }
          while (true) {
            // Protocol errors do not trigger IteratorClose.
            const step = stepScriptIterator(iterator);
            if (step.done) {
              if (name === "reduce") return accumulator;
              if (name === "some") return false;
              if (name === "every") return true;
              return undefined;
            }
            let result: unknown = undefined;
            try {
              result = protocol.call(
                callback,
                undefined,
                name === "reduce"
                  ? [accumulator, step.value, index]
                  : [step.value, index],
              );
            } catch (error) {
              closeScriptIterator(iterator, true);
              throw error;
            }
            if (name === "reduce") accumulator = result;
            if (
              ((name === "some" || name === "find") &&
                protocol.truthy(result)) ||
              (name === "every" && !protocol.truthy(result))
            ) {
              closeScriptIterator(iterator, false);
              return name === "find" ? step.value : name === "some";
            }
            index++;
          }
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
