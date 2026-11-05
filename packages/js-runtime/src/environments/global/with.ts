import { scriptBoolean } from "../../objects/index.ts";
import {
  toObjectValue,
  viewObjectValue,
  wellKnownSymbol,
  type ScriptPropertyKey,
  type ErrorRealm,
  type OrdinaryObject,
} from "../../objects/index.ts";
import { createObjectEnvironment } from "./object.ts";
import { createObjectScope, type EnvironmentScope } from "./scope.ts";

/** ToObject happens before entering the environment, including primitive boxing. */
export function createWithScope(
  outer: EnvironmentScope<ScriptPropertyKey, unknown>,
  value: unknown,
  realm: ErrorRealm,
): EnvironmentScope<ScriptPropertyKey, unknown> {
  const hooks = outer.global.hooks;
  const object = toObjectValue(value, realm, hooks);
  const record = createObjectEnvironment<ScriptPropertyKey, unknown>(
    object,
    object,
    true,
    {
      undefinedValue: undefined,
      sameValue: hooks.sameValue,
      call: hooks.call,
      keyForName: outer.global.keyForName,
      unscopablesKey: wellKnownSymbol(realm.symbolRegistry, "unscopables"),
      asObject: (
        item,
      ): OrdinaryObject<ScriptPropertyKey, unknown> | undefined =>
        viewObjectValue(item, realm.objectPrototype),
      truthy: (item): boolean => scriptBoolean(item, realm.objectPrototype),
    },
  );
  return createObjectScope<ScriptPropertyKey, unknown>(outer, record);
}
