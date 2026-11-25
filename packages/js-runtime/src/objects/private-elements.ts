import {
  ensureRareSlots,
  isExtensible,
  type OrdinaryObject,
  type ObjectHooks,
  type Receiver,
} from "./operations.ts";

/** Identity is allocated for each class evaluation; spelling is diagnostic only. */
export interface PrivateName {
  readonly description: string;
}
export type PrivateMethod<Value> = {
  readonly name: PrivateName;
} & (
  | { readonly kind: "method"; readonly value: Value }
  | {
      readonly kind: "accessor";
      readonly get: Value | undefined;
      readonly set: Value | undefined;
    }
);

export type PrivateElement<Value> =
  | PrivateMethod<Value>
  | {
      readonly name: PrivateName;
      readonly kind: "field";
      value: Value;
      readonly acceptsValue?: ((value: Value) => boolean) | undefined;
    };

export function createPrivateName(description: string): PrivateName {
  return { description };
}

/** Private elements are own internal state: neither prototypes nor properties participate. */
function findPrivateElement<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  name: PrivateName,
): PrivateElement<Value> | undefined {
  const rare = object.internalRareSlots;
  const elements =
    rare === undefined ? undefined : rare.internalPrivateElements;
  if (elements === undefined) return undefined;
  for (const element of elements) {
    if (element === undefined) throw "PRIVATE_ELEMENT_INVARIANT";
    if (element.name === name) return element;
  }
  return undefined;
}

export function hasPrivateElement<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  name: PrivateName,
): boolean {
  return findPrivateElement<Key, Value>(object, name) !== undefined;
}

function addPrivateElement<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  element: PrivateElement<Value>,
): "none" | "type" {
  if (hasPrivateElement<Key, Value>(object, element.name)) return "type";
  const rare = ensureRareSlots<Key, Value>(object);
  let elements = rare.internalPrivateElements;
  if (elements === undefined) {
    elements = [];
    rare.internalPrivateElements = elements;
  }
  elements.push(element);
  return "none";
}

/** PrivateFieldAdd with the Stage 3 nonextensible-applies-to-private step
 * (tested by pinned Test262 under that feature flag; not yet in ES2025):
 * ? IsExtensible(O) precedes the duplicate check, so proxy isExtensible traps
 * observe (and may abort) every addition. Existing private elements remain
 * readable and writable after extensions are prevented. */
export function addPrivateField<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  name: PrivateName,
  value: Value,
  acceptsValue?: (value: Value) => boolean,
): "none" | "type" {
  if (!isExtensible<Key, Value>(object)) return "type";
  return addPrivateElement<Key, Value>(object, {
    name,
    kind: "field",
    value,
    acceptsValue,
  });
}

/** PrivateMethodOrAccessorAdd checks only duplicates; InitializeInstanceElements
 * performs the single extensibility check before a class's method batch. */
export function addPrivateMethod<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  name: PrivateName,
  value: Value,
): "none" | "type" {
  return addPrivateElement<Key, Value>(object, { name, kind: "method", value });
}

/** Class evaluation pairs accessor halves before installing the element. */
export function addPrivateAccessor<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  name: PrivateName,
  get: Value | undefined,
  set: Value | undefined,
): "none" | "type" {
  return addPrivateElement<Key, Value>(object, {
    name,
    kind: "accessor",
    get,
    set,
  });
}

export function getPrivateElement<Key, Value>(
  receiver: Receiver<Key, Value>,
  name: PrivateName,
  hooks: ObjectHooks<Value>,
): { readonly error: "none" | "type"; readonly value: Value } {
  const object = receiver.object;
  const element =
    object === undefined
      ? undefined
      : findPrivateElement<Key, Value>(object, name);
  if (element === undefined)
    return { error: "type", value: hooks.undefinedValue };
  if (element.kind !== "accessor")
    return { error: "none", value: element.value };
  const getter = element.get;
  if (getter === undefined)
    return { error: "type", value: hooks.undefinedValue };
  return { error: "none", value: hooks.call(getter, receiver.value, []) };
}

export function setPrivateElement<Key, Value>(
  receiver: Receiver<Key, Value>,
  name: PrivateName,
  value: Value,
  hooks: ObjectHooks<Value>,
): "none" | "type" {
  const object = receiver.object;
  const element =
    object === undefined
      ? undefined
      : findPrivateElement<Key, Value>(object, name);
  if (element === undefined || element.kind === "method") return "type";
  if (element.kind === "field") {
    const accepts = element.acceptsValue;
    if (accepts !== undefined && !accepts(value)) return "type";
    element.value = value;
    return "none";
  }
  const setter = element.set;
  if (setter === undefined) return "type";
  hooks.call(setter, receiver.value, [value]);
  return "none";
}
