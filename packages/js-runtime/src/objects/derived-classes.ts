import { createSourceExecutionContext } from "./jobs.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  getPrototype,
  createConstructorObject,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { viewObjectValue } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  initializeClassFields,
  initializeClassPrivateMethods,
  type ClassPrivateMethod,
  initializeClassConstructor,
  classConstructorContext,
  type ClassField,
} from "./classes.ts";
import {
  createDerivedConstruction,
  constructSuper,
  finishDerivedConstruction,
  type DerivedConstruction,
} from "./derived-construction.ts";

export type DerivedClassBody = (
  context: DerivedConstruction<ScriptPropertyKey, unknown>,
  args: readonly unknown[],
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
) => unknown;

/** Heritage validation/evaluation belongs to the source adapter. parent is the
 * constructor's prototype (Function.prototype for extends null); prototype is the
 * separately prepared instance home. Neither is inferred from newTarget. */
export function createDerivedClass(
  name: string,
  length: number,
  body: DerivedClassBody | undefined,
  fields: readonly ClassField[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  parent: OrdinaryObject<ScriptPropertyKey, unknown>,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  privateMethods: readonly ClassPrivateMethod[] = [],
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const execution = createSourceExecutionContext(realm);
  const constructor: OrdinaryObject<ScriptPropertyKey, unknown> =
    createConstructorObject<ScriptPropertyKey, unknown>(
      parent,
      (receiver, args): unknown => {
        throw createRuntimeError(realm, "type");
      },
      (args, newTarget): unknown => {
        const target = viewObjectValue(newTarget, realm.objectPrototype);
        const context = createDerivedConstruction<ScriptPropertyKey, unknown>(
          { value: newTarget, object: target },
          undefined,
          (receiver): void => {
            const instance = viewObjectValue(receiver, realm.objectPrototype);
            if (instance === undefined)
              throw "DERIVED_CONSTRUCT_RESULT_INVARIANT";
            initializeClassPrivateMethods(instance, privateMethods, realm);
            initializeClassFields(instance, fields, realm, hooks);
          },
        );
        const returned = execution.run((): unknown => {
          if (body === undefined) {
            // The implicit constructor forwards its argument list without invoking
            // a user-visible iterator. Resolve the current constructor parent each time.
            const made = constructSuper<ScriptPropertyKey, unknown>(
              context,
              getPrototype<ScriptPropertyKey, unknown>(constructor),
              args,
              undefined,
            );
            if (made.error !== "none")
              throw createRuntimeError(realm, made.error);
            return made.value;
          }
          return body(context, args, constructor);
        });
        const result = finishDerivedConstruction<ScriptPropertyKey, unknown>(
          context,
          {
            value: returned,
            object: viewObjectValue(returned, realm.objectPrototype),
          },
          hooks,
        );
        if (result.error !== "none") {
          const active = realm.agent.activeContext;
          throw createRuntimeError(
            active === undefined ? realm : active.realm,
            result.error,
          );
        }
        return result.value;
      },
      classConstructorContext(realm),
    );
  initializeClassConstructor(constructor, prototype, name, length, hooks);
  return constructor;
}

/** Evaluate the heritage value before computed elements. Constructibility is
 * checked before observable prototype lookup; null selects a null instance chain
 * but leaves the constructor inheriting from Function.prototype. */
export function classHeritage(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): {
  readonly constructorParent: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly prototypeParent:
    OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
} {
  if (value === null)
    return {
      constructorParent: realm.functionPrototype,
      prototypeParent: undefined,
    };
  const constructor = viewObjectValue(value, realm.objectPrototype);
  if (constructor === undefined || constructor.internalConstruct === undefined)
    throw createRuntimeError(realm, "type");
  const prototypeValue = getProperty<ScriptPropertyKey, unknown>(
    constructor,
    "prototype",
    value,
    hooks,
  );
  if (prototypeValue === null)
    return { constructorParent: constructor, prototypeParent: undefined };
  const prototype = viewObjectValue(prototypeValue, realm.objectPrototype);
  if (prototype === undefined) throw createRuntimeError(realm, "type");
  return { constructorParent: constructor, prototypeParent: prototype };
}
