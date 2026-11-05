import {
  createStringBuilder,
  appendString,
  finishString,
} from "@tint/foundation/text/string-builder";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { stringValue } from "./coercion.ts";
import { scriptSameValue } from "./values.ts";
import {
  getScriptIteratorUnstarted,
  getScriptIteratorDirect,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { type ObjectHooks } from "./operations.ts";

export function installIteratorSearch(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.iteratorPrototype,
    "includes",
    builtinFunction(
      realm.functionPrototype,
      "includes",
      1,
      (receiver, args): unknown => {
        const pending = getScriptIteratorUnstarted(receiver, realm, hooks);
        const argument = args[1];
        let skip = 0;
        try {
          if (argument !== undefined) {
            if (
              typeof argument !== "number" ||
              (!Number.isInteger(argument) &&
                argument !== Infinity &&
                argument !== -Infinity)
            )
              throw createRuntimeError(realm, "type");
            skip = argument;
          }
          if (skip < 0 || (skip > 9007199254740991 && skip !== Infinity))
            throw createRuntimeError(realm, "range");
        } catch (error) {
          closeScriptIterator(pending, true);
          throw error;
        }
        const iterator = getScriptIteratorDirect(receiver, realm, hooks);
        let skipped = 0;
        while (true) {
          const step = stepScriptIterator(iterator);
          if (step.done) return false;
          if (skipped < skip) {
            skipped++;
            continue;
          }
          if (
            scriptSameValue(step.value, args[0]) ||
            (step.value === 0 && args[0] === 0)
          ) {
            closeScriptIterator(iterator, false);
            return true;
          }
        }
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.iteratorPrototype,
    "join",
    builtinFunction(
      realm.functionPrototype,
      "join",
      1,
      (receiver, args): unknown => {
        const pending = getScriptIteratorUnstarted(receiver, realm, hooks);
        let separator = ",";
        try {
          if (args[0] !== undefined) {
            const converted = stringValue(args[0], hooks, realm);
            if (converted.error === "unsupported")
              return rejectUnsupportedExecution(realm);
            if (converted.error !== "none")
              throw createRuntimeError(realm, "type");
            separator = converted.value;
          }
        } catch (error) {
          closeScriptIterator(pending, true);
          throw error;
        }
        const iterator = getScriptIteratorDirect(receiver, realm, hooks),
          builder = createStringBuilder();
        let first = true;
        while (true) {
          const step = stepScriptIterator(iterator);
          if (step.done) return finishString(builder);
          if (first) first = false;
          else appendString(builder, separator);
          if (step.value !== undefined && step.value !== null) {
            try {
              const converted = stringValue(step.value, hooks, realm);
              if (converted.error === "unsupported")
                return rejectUnsupportedExecution(realm);
              if (converted.error !== "none")
                throw createRuntimeError(realm, "type");
              appendString(builder, converted.value);
            } catch (error) {
              closeScriptIterator(iterator, true);
              throw error;
            }
          }
        }
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
