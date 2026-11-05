import {
  createSymbolValue,
  viewSymbolValue,
  registeredSymbol,
  registeredSymbolKey,
  wellKnownSymbol,
  symbolDescriptiveString,
  type SymbolValue,
  type ScriptPropertyKey,
} from "./symbols.ts";
import {
  createConstructorObject,
  defineOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { stringValue } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

/** Symbol has [[Construct]], but invoking it always throws. Registry ownership
 * is explicit in the realm, allowing an embedding to share it across realms. */
export function installSymbolIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function text(value: unknown): string {
    const result = stringValue(value, hooks, realm);
    if (result.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function extract(value: unknown): SymbolValue {
    const direct = viewSymbolValue(value);
    if (direct !== undefined) return direct;
    const object = viewObjectValue(value, realm.objectPrototype);
    const data =
      object === undefined ? undefined : object.internalPrimitiveData;
    if (data !== undefined && data.kind === "symbol") {
      const symbol = viewSymbolValue(data.value);
      if (symbol !== undefined) return symbol;
    }
    throw createRuntimeError(realm, "type");
  }
  const prototype = realm.symbolPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown =>
      createSymbolValue(args[0] === undefined ? undefined : text(args[0])),
    (args, newTarget): unknown => {
      throw createRuntimeError(realm, "type");
    },
  );
  builtinFunctionMetadata(constructor, "Symbol", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    constructor,
    "for",
    builtinFunction(
      realm.functionPrototype,
      "for",
      1,
      (receiver, args): unknown =>
        registeredSymbol(realm.symbolRegistry, text(args[0])),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "keyFor",
    builtinFunction(
      realm.functionPrototype,
      "keyFor",
      1,
      (receiver, args): unknown => {
        const symbol = viewSymbolValue(args[0]);
        if (symbol === undefined) throw createRuntimeError(realm, "type");
        return registeredSymbolKey(realm.symbolRegistry, symbol);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "toString",
    builtinFunction(
      realm.functionPrototype,
      "toString",
      0,
      (receiver, args): unknown => symbolDescriptiveString(extract(receiver)),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "valueOf",
    builtinFunction(
      realm.functionPrototype,
      "valueOf",
      0,
      (receiver, args): unknown => extract(receiver),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  const description = builtinFunction(
    realm.functionPrototype,
    "get description",
    0,
    (receiver, args): unknown => extract(receiver).description,
    hooks,
  );
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      prototype,
      "description",
      {
        fields: 60,
        value: undefined,
        writable: false,
        get: description,
        set: undefined,
        enumerable: false,
        configurable: true,
      },
      hooks,
    ) !== "accepted"
  )
    throw "SYMBOL_DESCRIPTION_INVARIANT";
  for (const name of [
    "asyncDispose",
    "asyncIterator",
    "dispose",
    "hasInstance",
    "isConcatSpreadable",
    "iterator",
    "match",
    "matchAll",
    "replace",
    "search",
    "species",
    "split",
    "toPrimitive",
    "toStringTag",
    "unscopables",
  ]) {
    if (name === undefined) throw "WELL_KNOWN_SYMBOL_NAME_INVARIANT";
    builtinProperty(
      constructor,
      name,
      wellKnownSymbol(realm.symbolRegistry, name),
      false,
      false,
      hooks,
    );
  }
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toPrimitive"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.toPrimitive]",
      1,
      (receiver, args): unknown => extract(receiver),
      hooks,
    ),
    false,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Symbol",
    false,
    true,
    hooks,
  );
  builtinProperty(global, "Symbol", constructor, true, true, hooks);
}
