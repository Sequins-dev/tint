import type { ScriptPropertyKey } from "./symbols.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import { viewObjectValue } from "./values.ts";
import {
  getPrivateElement,
  setPrivateElement,
  hasPrivateElement,
  type PrivateName,
} from "./private-elements.ts";

export function getPrivateObjectValue(
  value: unknown,
  name: PrivateName,
  hooks: ObjectHooks<unknown>,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): { readonly error: "none" | "type"; readonly value: unknown } {
  return getPrivateElement<ScriptPropertyKey, unknown>(
    { value, object: viewObjectValue(value, witness) },
    name,
    hooks,
  );
}
export function setPrivateObjectValue(
  receiver: unknown,
  name: PrivateName,
  value: unknown,
  hooks: ObjectHooks<unknown>,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): "none" | "type" {
  return setPrivateElement<ScriptPropertyKey, unknown>(
    { value: receiver, object: viewObjectValue(receiver, witness) },
    name,
    value,
    hooks,
  );
}
export function hasPrivateObjectValue(
  value: unknown,
  name: PrivateName,
  hooks: ObjectHooks<unknown>,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): { readonly error: "none" | "type"; readonly value: boolean } {
  const object = viewObjectValue(value, witness);
  if (object === undefined) return { error: "type", value: false };
  return {
    error: "none",
    value: hasPrivateElement<ScriptPropertyKey, unknown>(object, name),
  };
}
