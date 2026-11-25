import {
  createGeneratorRecord,
  type GeneratorOutcome,
} from "../iterators/index.ts";
import { createArrayFromList } from "./array-like.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";
import {
  ensureExoticSlots,
  createObject,
  createDataProperty,
  getOwnProperty,
  getProperty,
  ownKeys,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import {
  createScriptIteratorHooks,
  getScriptIterator,
  getScriptIteratorFlattenable,
  stepScriptIterator,
  skipScriptIterator,
  closeScriptIterator,
  type ScriptIterator,
} from "./iteration.ts";

/** Close remaining iterators in reverse acquisition order, retaining the first error. */
function closeAll(
  iterators: readonly ScriptIterator[],
  throwing: boolean,
): void {
  let failed = false;
  let first: unknown = undefined;
  for (let i = iterators.length - 1; i >= 0; i--) {
    const iterator = iterators[i];
    if (iterator === undefined) throw "ZIP_ITERATOR_INVARIANT";
    try {
      closeScriptIterator(iterator, throwing || failed);
    } catch (error) {
      if (!failed) first = error;
      failed = true;
    }
  }
  if (failed && !throwing) throw first;
}

/** Joint iteration shares the existing helper brand and generator resumption rules. */
export function installIteratorZip(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  for (const name of ["zip", "zipKeyed"]) {
    if (name === undefined) throw "ZIP_NAME_INVARIANT";
    builtinProperty(
      constructor,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const protocol = createScriptIteratorHooks(realm, hooks);
          const input = args[0],
            options = args[1];
          const object = viewObjectValue(input, realm.objectPrototype);
          if (
            object === undefined ||
            (options !== undefined && !protocol.isObject(options))
          )
            throw createRuntimeError(realm, "type");
          const optionMode =
            options === undefined ? undefined : protocol.get(options, "mode");
          const mode = optionMode === undefined ? "shortest" : optionMode;
          if (mode !== "shortest" && mode !== "longest" && mode !== "strict")
            throw createRuntimeError(realm, "type");
          const paddingOption =
            mode === "longest" && options !== undefined
              ? protocol.get(options, "padding")
              : undefined;
          if (paddingOption !== undefined && !protocol.isObject(paddingOption))
            throw createRuntimeError(realm, "type");
          const iterators: ScriptIterator[] = [],
            keys: ScriptPropertyKey[] = [],
            padding: unknown[] = [];
          let outer: ScriptIterator | undefined = undefined;
          try {
            if (name === "zip") {
              const inputIterator = getScriptIterator(input, realm, hooks);
              outer = inputIterator;
              while (true) {
                const step = stepScriptIterator(inputIterator);
                if (step.done) break;
                iterators.push(
                  getScriptIteratorFlattenable(
                    step.value,
                    "reject",
                    realm,
                    hooks,
                  ),
                );
              }
            } else {
              for (const key of ownKeys<ScriptPropertyKey, unknown>(
                object,
                (key): number => scriptPropertyKeyOrder(key),
              )) {
                if (key === undefined) throw "ZIP_KEY_INVARIANT";
                const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
                  object,
                  key,
                );
                if (descriptor === undefined || !descriptor.enumerable)
                  continue;
                // Symbol keys must follow the same Get semantics as string keys.
                const value = getProperty<ScriptPropertyKey, unknown>(
                  object,
                  key,
                  input,
                  hooks,
                );
                if (value === undefined) continue;
                keys.push(key);
                iterators.push(
                  getScriptIteratorFlattenable(value, "reject", realm, hooks),
                );
              }
            }
          } catch (error) {
            closeAll(iterators, true);
            if (outer !== undefined) closeScriptIterator(outer, true);
            throw error;
          }
          try {
            if (mode === "longest") {
              if (paddingOption === undefined) {
                for (let i = 0; i < iterators.length; i++)
                  padding.push(undefined);
              } else if (name === "zip") {
                const iterator = getScriptIterator(paddingOption, realm, hooks);
                for (let i = 0; i < iterators.length; i++)
                  padding.push(stepScriptIterator(iterator).value);
                closeScriptIterator(iterator, false);
              } else {
                const paddingObject = viewObjectValue(
                  paddingOption,
                  realm.objectPrototype,
                );
                if (paddingObject === undefined) throw "ZIP_PADDING_INVARIANT";
                for (const key of keys) {
                  if (key === undefined) throw "ZIP_KEY_INVARIANT";
                  padding.push(
                    getProperty<ScriptPropertyKey, unknown>(
                      paddingObject,
                      key,
                      paddingOption,
                      hooks,
                    ),
                  );
                }
              }
            }
          } catch (error) {
            closeAll(iterators, true);
            throw error;
          }
          const generator = createGeneratorRecord<unknown>(
            (kind, value): GeneratorOutcome<unknown> => {
              try {
                if (kind === "return") {
                  closeAll(iterators, false);
                  return { kind: "return", value: undefined };
                }
                if (iterators.length === 0)
                  return { kind: "return", value: undefined };
                const values: unknown[] = [];
                for (let i = 0; i < iterators.length; i++) {
                  const iterator = iterators[i];
                  if (iterator === undefined) throw "ZIP_ITERATOR_INVARIANT";
                  const step = stepScriptIterator(iterator);
                  if (!step.done) {
                    values.push(step.value);
                    continue;
                  }
                  if (mode === "shortest") {
                    closeAll(iterators, false);
                    return { kind: "return", value: undefined };
                  }
                  if (mode === "strict") {
                    if (i !== 0) throw createRuntimeError(realm, "type");
                    for (let k = 1; k < iterators.length; k++) {
                      const other = iterators[k];
                      if (other === undefined) throw "ZIP_ITERATOR_INVARIANT";
                      skipScriptIterator(other);
                      if (!other.record.done)
                        throw createRuntimeError(realm, "type");
                    }
                    return { kind: "return", value: undefined };
                  }
                  let open = false;
                  for (const other of iterators) {
                    if (other === undefined) throw "ZIP_ITERATOR_INVARIANT";
                    if (!other.record.done) open = true;
                  }
                  if (!open) return { kind: "return", value: undefined };
                  values.push(padding[i]);
                }
                let result: OrdinaryObject<ScriptPropertyKey, unknown>;
                if (name === "zip")
                  result = createArrayFromList(
                    values,
                    0,
                    realm.arrayPrototype,
                    realm,
                    hooks,
                  );
                else {
                  result = createObject<ScriptPropertyKey, unknown>(undefined);
                  for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    if (key === undefined) throw "ZIP_KEY_INVARIANT";
                    if (
                      !createDataProperty<ScriptPropertyKey, unknown>(
                        result,
                        key,
                        values[i],
                        hooks,
                      )
                    )
                      throw "ZIP_RESULT_INVARIANT";
                  }
                }
                return {
                  kind: "yield",
                  result: createIteratorResult(result, false, realm, hooks),
                };
              } catch (error) {
                closeAll(iterators, true);
                throw error;
              }
            },
          );
          const helper = createObject<ScriptPropertyKey, unknown>(prototype);
          ensureExoticSlots(helper).internalIteratorHelperData = {
            generator,
            close: (): void => closeAll(iterators, false),
          };
          return helper;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
