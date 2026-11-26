import { installArrayFactories } from "./array-factories.ts";
import { createArrayFromList } from "./array-like.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createConstructorObject,
  defineOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createArrayObject } from "./arrays.ts";
import { installArrayPrototype } from "./array-prototype.ts";
import {
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { isArrayValue } from "./values.ts";
import type { ErrorRealm } from "./errors.ts";

/** Array constructor and identity operations. Prototype algorithms and iterator
 * intrinsics are installed separately as their runtime capabilities become available. */
export function installArrayIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function build(
    args: readonly unknown[],
    prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const first = args[0];
    if (args.length === 1 && typeof first === "number")
      return createArrayObject<ScriptPropertyKey, unknown>(
        first,
        prototype,
        realm.arrayHooks,
        hooks,
      );
    return createArrayFromList(args, 0, prototype, realm, hooks);
  }
  const constructor: OrdinaryObject<ScriptPropertyKey, unknown> =
    createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown => build(args, realm.arrayPrototype),
      (args, target): unknown =>
        build(
          args,
          target === constructor
            ? realm.arrayPrototype
            : constructorPrototype(target, "array", realm, hooks),
        ),
    );
  realm.arrayConstructor = constructor;
  const species = builtinFunction(
    realm.functionPrototype,
    "get [Symbol.species]",
    0,
    (receiver, args): unknown => receiver,
    hooks,
  );
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      constructor,
      wellKnownSymbol(realm.symbolRegistry, "species"),
      {
        fields: 52,
        value: undefined,
        writable: false,
        get: species,
        set: undefined,
        enumerable: false,
        configurable: true,
      },
      hooks,
    ) !== "accepted"
  )
    throw "ARRAY_SPECIES_INVARIANT";
  builtinFunctionMetadata(constructor, "Array", 1, hooks);
  builtinProperty(
    constructor,
    "prototype",
    realm.arrayPrototype,
    false,
    false,
    hooks,
  );
  builtinProperty(
    realm.arrayPrototype,
    "constructor",
    constructor,
    true,
    true,
    hooks,
  );
  const isArray = builtinFunction(
    realm.functionPrototype,
    "isArray",
    1,
    (receiver, args): unknown => isArrayValue(args[0], realm),
    hooks,
  );
  builtinProperty(constructor, "isArray", isArray, true, true, hooks);
  builtinProperty(global, "Array", constructor, true, true, hooks);
  realm.intrinsicFunctions.array = constructor;
  installArrayPrototype(realm, hooks);
  installArrayFactories(constructor, realm, hooks);
}
