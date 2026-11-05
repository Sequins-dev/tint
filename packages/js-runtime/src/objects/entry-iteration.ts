import {
  getScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";
import { viewObjectValue } from "./values.ts";
import { getProperty, type ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
/** AddEntriesFromIterable ordering and IteratorClose, shared by entry consumers.
 * Entry getters run before the caller converts keys or mutates its destination. */
export function addEntriesFromIterable(
  iterable: unknown,
  add: (key: unknown, value: unknown) => void,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const iterator = getScriptIterator(iterable, realm, hooks);
  while (true) {
    // Protocol failures from next/done/value do not close an already failed step.
    const step = stepScriptIterator(iterator);
    if (step.done) return;
    try {
      const pair = viewObjectValue(step.value, realm.objectPrototype);
      if (pair === undefined) throw createRuntimeError(realm, "type");
      const key = getProperty<ScriptPropertyKey, unknown>(
          pair,
          "0",
          step.value,
          hooks,
        ),
        value = getProperty<ScriptPropertyKey, unknown>(
          pair,
          "1",
          step.value,
          hooks,
        );
      add(key, value);
    } catch (error) {
      closeScriptIterator(iterator, true);
      throw error;
    }
  }
}
