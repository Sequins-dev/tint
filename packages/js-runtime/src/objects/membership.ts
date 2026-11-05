import type { ErrorRealm } from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { hasProperty, type ObjectHooks } from "./operations.ts";
import { propertyKeyValue } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";

/** The in operator validates its right operand before coercing the key.
 * Proxy [[HasProperty]] remains a separate capability. */
export function objectValueHasProperty(
  key: unknown,
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: boolean;
} {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) return { error: "type", value: false };
  const converted = propertyKeyValue(key, hooks, realm);
  if (converted.error !== "none")
    return { error: converted.error, value: false };
  return {
    error: "none",
    value: hasProperty<ScriptPropertyKey, unknown>(object, converted.value),
  };
}
