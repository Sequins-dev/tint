import { installIteratorZip } from "./iterator-zip.ts";
import { createArrayFromList } from "./array-like.ts";
import { numberValue } from "./coercion.ts";
import {
  createGeneratorRecord,
  resumeGenerator,
  type GeneratorOutcome,
  type GeneratorRecord,
} from "../iterators/index.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { viewObjectValue, getObjectValueProperty } from "./values.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import {
  getScriptCallbackIterator,
  getScriptIteratorFlattenable,
  getScriptIteratorUnstarted,
  createScriptIteratorHooks,
  getScriptIteratorDirect,
  skipScriptIterator,
  type ScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";

/** Lazy helpers use the generator state machine but have a separate brand. */
export function installIteratorHelpers(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
): void {
  const prototype = createObject<ScriptPropertyKey, unknown>(
    realm.iteratorPrototype,
  );
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Iterator Helper",
    false,
    true,
    hooks,
  );
  for (const name of ["next", "return"]) {
    if (name === undefined) throw "ITERATOR_HELPER_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          const object = viewObjectValue(receiver, realm.objectPrototype);
          const data =
            object === undefined
              ? undefined
              : exoticSlots(object).internalIteratorHelperData;
          if (data === undefined) throw createRuntimeError(realm, "type");
          const generator = data.generator;
          if (name === "return" && generator.state === "suspended-start") {
            // Completion is visible to reentrant calls made by the return getter.
            generator.state = "completed";
            generator.continuation = undefined;
            data.close();
            return createIteratorResult(undefined, true, realm, hooks);
          }
          return resumeGenerator<unknown>(
            generator,
            name === "next" ? "next" : "return",
            undefined,
            {
              undefinedValue: undefined,
              typeError: (): unknown => createRuntimeError(realm, "type"),
              iteratorResult: (value, done): unknown =>
                createIteratorResult(value, done, realm, hooks),
            },
          );
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  installIteratorZip(constructor, prototype, realm, hooks);
  function wrap(
    generator: GeneratorRecord<unknown>,
    iterator: ScriptIterator | undefined,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const helper = createObject<ScriptPropertyKey, unknown>(prototype);
    ensureExoticSlots(helper).internalIteratorHelperData = {
      generator,
      close: (): void => {
        if (iterator !== undefined) closeScriptIterator(iterator, false);
      },
    };
    return helper;
  }
  for (const name of ["map", "filter", "flatMap"]) {
    if (name === undefined) throw "ITERATOR_MAPPING_NAME_INVARIANT";
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
          let inner: ScriptIterator | undefined = undefined;
          const generator = createGeneratorRecord<unknown>(
            (kind, value): GeneratorOutcome<unknown> => {
              if (kind === "return") {
                if (inner !== undefined) {
                  try {
                    closeScriptIterator(inner, false);
                  } catch (error) {
                    closeScriptIterator(iterator, true);
                    throw error;
                  }
                }
                closeScriptIterator(iterator, false);
                return { kind: "return", value: undefined };
              }
              while (true) {
                if (inner !== undefined) {
                  try {
                    const step = stepScriptIterator(inner);
                    if (!step.done)
                      return {
                        kind: "yield",
                        result: createIteratorResult(
                          step.value,
                          false,
                          realm,
                          hooks,
                        ),
                      };
                  } catch (error) {
                    // An inner protocol failure closes the outer iterator only.
                    closeScriptIterator(iterator, true);
                    throw error;
                  }
                  inner = undefined;
                  index++;
                }
                const step = stepScriptIterator(iterator);
                if (step.done) return { kind: "return", value: undefined };
                let mapped: unknown = undefined;
                try {
                  mapped = protocol.call(callback, undefined, [
                    step.value,
                    index,
                  ]);
                  if (name === "flatMap") {
                    inner = getScriptIteratorFlattenable(
                      mapped,
                      "reject",
                      realm,
                      hooks,
                    );
                    continue;
                  }
                } catch (error) {
                  closeScriptIterator(iterator, true);
                  throw error;
                }
                index++;
                if (name === "map" || protocol.truthy(mapped))
                  return {
                    kind: "yield",
                    result: createIteratorResult(
                      name === "map" ? mapped : step.value,
                      false,
                      realm,
                      hooks,
                    ),
                  };
              }
            },
          );
          return wrap(generator, iterator);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  for (const name of ["take", "drop"]) {
    if (name === undefined) throw "ITERATOR_LIMIT_NAME_INVARIANT";
    builtinProperty(
      realm.iteratorPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const pending = getScriptIteratorUnstarted(receiver, realm, hooks);
          let remaining = 0;
          try {
            const converted = numberValue(args[0], hooks, realm);
            if (converted.error === "unsupported")
              return rejectUnsupportedExecution(realm);
            if (converted.error !== "none")
              throw createRuntimeError(realm, "type");
            const limit = converted.value;
            // The pinned suite follows the updated finite safe-integer limit.
            if (
              limit !== limit ||
              (limit > 9007199254740991 && limit !== Infinity)
            )
              throw createRuntimeError(realm, "range");
            remaining = Math.trunc(limit);
            if (remaining < 0) throw createRuntimeError(realm, "range");
          } catch (error) {
            closeScriptIterator(pending, true);
            throw error;
          }
          const iterator = getScriptIteratorDirect(receiver, realm, hooks);
          const generator = createGeneratorRecord<unknown>(
            (kind, value): GeneratorOutcome<unknown> => {
              if (kind === "return" || (name === "take" && remaining === 0)) {
                closeScriptIterator(iterator, false);
                return { kind: "return", value: undefined };
              }
              if (name === "drop") {
                while (remaining > 0) {
                  remaining--;
                  // Dropped results must not read their value property.
                  skipScriptIterator(iterator);
                  if (iterator.record.done)
                    return { kind: "return", value: undefined };
                }
              } else remaining--;
              const step = stepScriptIterator(iterator);
              if (step.done) return { kind: "return", value: undefined };
              return {
                kind: "yield",
                result: createIteratorResult(step.value, false, realm, hooks),
              };
            },
          );
          return wrap(generator, iterator);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  for (const name of ["chunks", "windows"]) {
    if (name === undefined) throw "ITERATOR_CHUNKING_NAME_INVARIANT";
    builtinProperty(
      realm.iteratorPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const pending = getScriptIteratorUnstarted(receiver, realm, hooks);
          let size = 0;
          let partial = false;
          try {
            const argument = args[0];
            if (typeof argument !== "number" || !Number.isInteger(argument))
              throw createRuntimeError(realm, "type");
            if (argument < 1 || argument > 4294967295)
              throw createRuntimeError(realm, "range");
            size = argument;
            if (name === "windows") {
              const undersized = args[1] === undefined ? "only-full" : args[1];
              if (undersized !== "only-full" && undersized !== "allow-partial")
                throw createRuntimeError(realm, "type");
              partial = undersized === "allow-partial";
            }
          } catch (error) {
            closeScriptIterator(pending, true);
            throw error;
          }
          const iterator = getScriptIteratorDirect(receiver, realm, hooks);
          let buffer: unknown[] = [];
          let exhausted = false;
          const generator = createGeneratorRecord<unknown>(
            (kind, value): GeneratorOutcome<unknown> => {
              if (kind === "return") {
                closeScriptIterator(iterator, false);
                return { kind: "return", value: undefined };
              }
              if (exhausted) return { kind: "return", value: undefined };
              while (true) {
                const step = stepScriptIterator(iterator);
                if (step.done) {
                  exhausted = true;
                  if (
                    buffer.length === 0 ||
                    (name === "windows" && (!partial || buffer.length === size))
                  )
                    return { kind: "return", value: undefined };
                } else {
                  if (name === "windows" && buffer.length === size)
                    buffer.shift();
                  buffer.push(step.value);
                  if (buffer.length < size) continue;
                }
                const values = createArrayFromList(
                  buffer,
                  0,
                  realm.arrayPrototype,
                  realm,
                  hooks,
                );
                if (name === "chunks") buffer = [];
                return {
                  kind: "yield",
                  result: createIteratorResult(values, false, realm, hooks),
                };
              }
            },
          );
          return wrap(generator, iterator);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(
    constructor,
    "concat",
    builtinFunction(
      realm.functionPrototype,
      "concat",
      0,
      (receiver, args): unknown => {
        const protocol = createScriptIteratorHooks(realm, hooks);
        const iterables: {
          readonly value: unknown;
          readonly method: unknown;
        }[] = [];
        const symbol = wellKnownSymbol(realm.symbolRegistry, "iterator");
        for (const item of args) {
          if (!protocol.isObject(item)) throw createRuntimeError(realm, "type");
          const property = getObjectValueProperty(item, symbol, hooks, realm);
          if (property.error === "unsupported")
            return rejectUnsupportedExecution(realm);
          if (property.error !== "none")
            throw createRuntimeError(realm, "type");
          const method = property.value;
          if (!protocol.isCallable(method))
            throw createRuntimeError(realm, "type");
          iterables.push({ value: item, method });
        }
        let index = 0;
        let active: ScriptIterator | undefined = undefined;
        const generator = createGeneratorRecord<unknown>(
          (kind, value): GeneratorOutcome<unknown> => {
            if (kind === "return") {
              if (active !== undefined) closeScriptIterator(active, false);
              return { kind: "return", value: undefined };
            }
            while (true) {
              if (active === undefined) {
                if (index === iterables.length)
                  return { kind: "return", value: undefined };
                const iterable = iterables[index];
                if (iterable === undefined)
                  throw "ITERATOR_CONCAT_INDEX_INVARIANT";
                active = getScriptIteratorDirect(
                  protocol.call(iterable.method, iterable.value, []),
                  realm,
                  hooks,
                );
              }
              const step = stepScriptIterator(active);
              if (!step.done)
                return {
                  kind: "yield",
                  result: createIteratorResult(step.value, false, realm, hooks),
                };
              active = undefined;
              index++;
            }
          },
        );
        // No underlying iterator has been opened before the first resume.
        return wrap(generator, undefined);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
