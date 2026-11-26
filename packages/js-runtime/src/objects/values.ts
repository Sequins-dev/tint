import { primitiveContractBit } from "@tint/foundation/values/primitive-contract";
import { viewSymbolValue } from "./symbols.ts";
import {
  viewBigIntValue,
  bigIntToBoolean,
  compareBigIntValues,
} from "./bigints.ts";
import { sameValue } from "./operators.ts";
import { scriptPropertyKeyOrder } from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { Descriptor } from "../descriptors/index.ts";
import {
  createObject,
  createDataProperty,
  ordinaryGetOwnProperty,
  findOrdinaryProperty,
  isOrdinaryPrototypeChain,
  propertyEpoch,
  ensureExoticSlots,
  getProperty,
  setProperty,
  deleteProperty,
  setPrototype,
  markPrototype,
  lookupCachedScriptProperty,
  lookupCachedStringPrimitiveProperty,
  cachedScriptPropertyValue,
  storeCachedScriptProperty,
  type ConstructSite,
  type PropertySpill,
  type ScriptPropertyCache,
  type ObjectHooks,
  type ObjectScriptCall,
  type OrdinaryObject,
  objectFlagArrayData,
  objectFlagDictionary,
  objectFlagExtensible,
  objectFlagUsedAsPrototype,
} from "./operations.ts";
import { callObject, constructObject } from "./call.ts";
import { toObjectValue } from "./boxing.ts";
import {
  createRuntimeError,
  throwIfRuntimeError,
  type ErrorRealm,
} from "./errors.ts";
import {
  createPropertyEnumeration,
  type PropertyEnumeration,
} from "./enumeration.ts";

export function checkPrimitiveContract(
  realm: ErrorRealm,
  value: unknown,
  allowed: number,
): unknown {
  if (!acceptsPrimitiveContract(value, allowed))
    throw createRuntimeError(realm, "type");
  return value;
}

export function acceptsPrimitiveContract(
  value: unknown,
  allowed: number,
): boolean {
  let kind = value === null ? "null" : typeof value;
  if (kind === "object") {
    if (
      (allowed & primitiveContractBit("bigint")) !== 0 &&
      viewBigIntValue(value) !== undefined
    )
      kind = "bigint";
    else if (
      (allowed & primitiveContractBit("symbol")) !== 0 &&
      viewSymbolValue(value) !== undefined
    )
      kind = "symbol";
  }
  return (allowed & primitiveContractBit(kind)) !== 0;
}

export function primitiveContractPredicate(
  allowed: number,
): ((value: unknown) => boolean) | undefined {
  if (allowed === 0) return undefined;
  return (value: unknown): boolean => acceptsPrimitiveContract(value, allowed);
}

export function checkPrimitiveRestArguments(
  realm: ErrorRealm,
  args: readonly unknown[],
  offset: number,
  allowed: number,
): void {
  for (let i = offset; i < args.length; i++)
    checkPrimitiveContract(realm, args[i], allowed);
}

/** Literal prototype setters bypass named properties and ignore primitive values. */
export function setObjectLiteralPrototype(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
): void {
  if (value === null) {
    if (!setPrototype<ScriptPropertyKey, unknown>(object, undefined))
      throw "LITERAL_PROTOTYPE_INVARIANT";
    return;
  }
  const prototype = viewObjectValue(value, object);
  if (
    prototype !== undefined &&
    !setPrototype<ScriptPropertyKey, unknown>(object, prototype)
  )
    throw "LITERAL_PROTOTYPE_INVARIANT";
}

/** Nullish for-in sources are empty; other values use prototype-aware ToObject. */
export function enumerateObjectValue(
  value: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "unsupported";
  readonly value: PropertyEnumeration<ScriptPropertyKey, unknown>;
} {
  let object: OrdinaryObject<ScriptPropertyKey, unknown> | undefined =
    undefined;
  if (value !== null && value !== undefined)
    object = toObjectValue(value, realm, hooks);
  const iterator = createPropertyEnumeration<ScriptPropertyKey, unknown>(
    object,
    (key): number => scriptPropertyKeyOrder(key),
  );
  return {
    error: "none",
    value: iterator,
  };
}

/** OrdinaryCreateFromConstructor(newTarget, "%Object.prototype%") for a
 * native entry's construction in its own realm, given the value of the
 * target's "prototype": an ordinary object with that prototype, or with the
 * realm's Object.prototype when the value is not an object. Constructs the
 * fast-mode object directly without generic createObject indirection. */
export function createSourceInstance(
  prototype: unknown,
  realm: ErrorRealm,
): unknown {
  const proto =
    viewObjectValue(prototype, realm.objectPrototype) ?? realm.objectPrototype;
  if ((proto.internalFlags & objectFlagUsedAsPrototype) === 0)
    markPrototype<ScriptPropertyKey, unknown>(proto);
  const instance: OrdinaryObject<ScriptPropertyKey, unknown> = {
    internalShape: proto.internalChildShape,
    prototype: proto,
    internalFlags: objectFlagExtensible,
    properties: undefined,
    internalPropertyEpoch: 0,
    internalChildShape: undefined,
    internalValues: undefined,
    internalCall: undefined,
    internalRegisterCall: undefined,
    internalConstruct: undefined,
    internalArrayElements: undefined,
    internalMethods: undefined,
    internalRareSlots: undefined,
    internalExoticSlots: undefined,
    internalValue0: undefined,
    internalValue1: undefined,
    internalValue2: undefined,
    internalValue3: undefined,
    internalValue4: undefined,
    internalValue5: undefined,
    internalValue6: undefined,
    internalValue7: undefined,
  };
  return instance;
}

/** Side-effect-free ordinary own/inherited data property lookup on an object
 * with an entirely ordinary prototype chain. Marks every visited object as
 * used-as-prototype so any future mutation advances `propertyEpoch`. */
function readOrdinaryDataAndMark(
  start: OrdinaryObject<ScriptPropertyKey, unknown>,
  key: ScriptPropertyKey,
): { readonly ok: boolean; readonly value: unknown } {
  let cursor: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = start;
  while (cursor !== undefined) {
    if (cursor.internalMethods !== undefined)
      return { ok: false, value: undefined };
    if ((cursor.internalFlags & objectFlagUsedAsPrototype) === 0)
      markPrototype<ScriptPropertyKey, unknown>(cursor);
    const desc = ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(
      cursor,
      key,
    );
    if (desc !== undefined) {
      if (desc.accessor) return { ok: false, value: undefined };
      return { ok: true, value: desc.value };
    }
    cursor = cursor.prototype;
  }
  return { ok: false, value: undefined };
}

/** Verify and cache a constructor call site (direct or Prototype.js
 * `this.initialize.apply(this, arguments)` forwarding). Marks the constructor,
 * prototype chain, and (for forwarding) `initialize` / `Function.prototype`
 * chain with `markPrototype` so any mutation to `target.prototype`,
 * `proto.initialize`, `init.apply`, `Function.prototype.apply`, or any key in
 * `site.keys` on `proto`'s chain advances `propertyEpoch` and invalidates the
 * site. Returns true iff the site is warmed and safe for direct final-shape
 * allocation. Never invokes user code or mutates observable JS state. */
export function warmConstructSite(
  targetValue: unknown,
  expectedInit: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  isForwarding: boolean,
  realm: ErrorRealm,
  site: ConstructSite,
): boolean {
  if (expectedInit === undefined) return false;
  const target = viewObjectValue(targetValue, realm.objectPrototype);
  if (target === undefined || target.internalMethods !== undefined)
    return false;
  if (isForwarding) {
    const reg = target.internalRegisterCall;
    if (reg === undefined || reg.forwardingTag !== 1) return false;
  } else if (target !== expectedInit) {
    return false;
  }
  const protoRead = readOrdinaryDataAndMark(target, "prototype");
  if (!protoRead.ok) return false;
  const proto = viewObjectValue(protoRead.value, realm.objectPrototype);
  if (proto === undefined) return false;
  if (isForwarding) {
    const initRead = readOrdinaryDataAndMark(proto, "initialize");
    if (!initRead.ok || initRead.value !== expectedInit) return false;
    const fnApply = realm.functionApply;
    if (fnApply === undefined) return false;
    const applyRead = readOrdinaryDataAndMark(expectedInit, "apply");
    if (!applyRead.ok || applyRead.value !== fnApply) return false;
  }
  const keys = site.constructKeys;
  if (keys.length === 0 || keys.length > 8) return false;
  let cursor: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = proto;
  while (cursor !== undefined) {
    if (cursor.internalMethods !== undefined) return false;
    if ((cursor.internalFlags & objectFlagUsedAsPrototype) === 0)
      markPrototype<ScriptPropertyKey, unknown>(cursor);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (key === undefined) throw "CONSTRUCT_SITE_INVARIANT";
      const desc = ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(
        cursor,
        key,
      );
      if (desc !== undefined && (desc.accessor || !desc.writable)) return false;
    }
    cursor = cursor.prototype;
  }
  const probe = createObject<ScriptPropertyKey, unknown>(proto);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key === undefined) throw "CONSTRUCT_SITE_INVARIANT";
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        probe,
        key,
        undefined,
        realm.objectHooks,
      )
    )
      return false;
  }
  const reached = probe.internalShape;
  if (
    (probe.internalFlags & objectFlagDictionary) !== 0 ||
    reached === undefined ||
    !reached.shared ||
    reached.keys.length !== keys.length
  )
    return false;
  site.constructCtor = target;
  site.constructProto = proto;
  site.constructRoot = proto.internalChildShape;
  site.constructShape = reached;
  site.constructEpoch = propertyEpoch.value;
  return true;
}

/** Direct fixed-arity final-shape constructor allocators (1..8 own fields).
 * Callers guard with `warmConstructSite` (or its inline epoch/ctor fast check)
 * before evaluating constructor field values; these helpers check the cached
 * shape/epoch one final time and allocate directly in the final shape. */
export function createConstructedObject1(
  site: ConstructSite,
  v0: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const proto = site.constructProto;
  const shape = site.constructShape;
  const root = site.constructRoot;
  if (
    proto !== undefined &&
    shape !== undefined &&
    root !== undefined &&
    proto.internalChildShape === root &&
    site.constructEpoch === site.constructEpochRef.value
  )
    return {
      internalShape: shape,
      prototype: proto,
      internalFlags: objectFlagExtensible,
      properties: undefined,
      internalPropertyEpoch: 1,
      internalChildShape: undefined,
      internalValues: undefined,
      internalCall: undefined,
      internalRegisterCall: undefined,
      internalConstruct: undefined,
      internalArrayElements: undefined,
      internalMethods: undefined,
      internalRareSlots: undefined,
      internalExoticSlots: undefined,
      internalValue0: v0,
      internalValue1: undefined,
      internalValue2: undefined,
      internalValue3: undefined,
      internalValue4: undefined,
      internalValue5: undefined,
      internalValue6: undefined,
      internalValue7: undefined,
    };
  return undefined;
}
export function createConstructedObject2(
  site: ConstructSite,
  v0: unknown,
  v1: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const proto = site.constructProto;
  const shape = site.constructShape;
  const root = site.constructRoot;
  if (
    proto !== undefined &&
    shape !== undefined &&
    root !== undefined &&
    proto.internalChildShape === root &&
    site.constructEpoch === site.constructEpochRef.value
  )
    return {
      internalShape: shape,
      prototype: proto,
      internalFlags: objectFlagExtensible,
      properties: undefined,
      internalPropertyEpoch: 2,
      internalChildShape: undefined,
      internalValues: undefined,
      internalCall: undefined,
      internalRegisterCall: undefined,
      internalConstruct: undefined,
      internalArrayElements: undefined,
      internalMethods: undefined,
      internalRareSlots: undefined,
      internalExoticSlots: undefined,
      internalValue0: v0,
      internalValue1: v1,
      internalValue2: undefined,
      internalValue3: undefined,
      internalValue4: undefined,
      internalValue5: undefined,
      internalValue6: undefined,
      internalValue7: undefined,
    };
  return undefined;
}
export function createConstructedObject3(
  site: ConstructSite,
  v0: unknown,
  v1: unknown,
  v2: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const proto = site.constructProto;
  const shape = site.constructShape;
  const root = site.constructRoot;
  if (
    proto !== undefined &&
    shape !== undefined &&
    root !== undefined &&
    proto.internalChildShape === root &&
    site.constructEpoch === site.constructEpochRef.value
  )
    return {
      internalShape: shape,
      prototype: proto,
      internalFlags: objectFlagExtensible,
      properties: undefined,
      internalPropertyEpoch: 3,
      internalChildShape: undefined,
      internalValues: undefined,
      internalCall: undefined,
      internalRegisterCall: undefined,
      internalConstruct: undefined,
      internalArrayElements: undefined,
      internalMethods: undefined,
      internalRareSlots: undefined,
      internalExoticSlots: undefined,
      internalValue0: v0,
      internalValue1: v1,
      internalValue2: v2,
      internalValue3: undefined,
      internalValue4: undefined,
      internalValue5: undefined,
      internalValue6: undefined,
      internalValue7: undefined,
    };
  return undefined;
}
export function createConstructedObject4(
  site: ConstructSite,
  v0: unknown,
  v1: unknown,
  v2: unknown,
  v3: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const proto = site.constructProto;
  const shape = site.constructShape;
  const root = site.constructRoot;
  if (
    proto !== undefined &&
    shape !== undefined &&
    root !== undefined &&
    proto.internalChildShape === root &&
    site.constructEpoch === site.constructEpochRef.value
  )
    return {
      internalShape: shape,
      prototype: proto,
      internalFlags: objectFlagExtensible,
      properties: undefined,
      internalPropertyEpoch: 4,
      internalChildShape: undefined,
      internalValues: undefined,
      internalCall: undefined,
      internalRegisterCall: undefined,
      internalConstruct: undefined,
      internalArrayElements: undefined,
      internalMethods: undefined,
      internalRareSlots: undefined,
      internalExoticSlots: undefined,
      internalValue0: v0,
      internalValue1: v1,
      internalValue2: v2,
      internalValue3: v3,
      internalValue4: undefined,
      internalValue5: undefined,
      internalValue6: undefined,
      internalValue7: undefined,
    };
  return undefined;
}
export function createConstructedObject5(
  site: ConstructSite,
  v0: unknown,
  v1: unknown,
  v2: unknown,
  v3: unknown,
  v4: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const proto = site.constructProto;
  const shape = site.constructShape;
  const root = site.constructRoot;
  if (
    proto !== undefined &&
    shape !== undefined &&
    root !== undefined &&
    proto.internalChildShape === root &&
    site.constructEpoch === site.constructEpochRef.value
  )
    return {
      internalShape: shape,
      prototype: proto,
      internalFlags: objectFlagExtensible,
      properties: undefined,
      internalPropertyEpoch: 5,
      internalChildShape: undefined,
      internalValues: undefined,
      internalCall: undefined,
      internalRegisterCall: undefined,
      internalConstruct: undefined,
      internalArrayElements: undefined,
      internalMethods: undefined,
      internalRareSlots: undefined,
      internalExoticSlots: undefined,
      internalValue0: v0,
      internalValue1: v1,
      internalValue2: v2,
      internalValue3: v3,
      internalValue4: v4,
      internalValue5: undefined,
      internalValue6: undefined,
      internalValue7: undefined,
    };
  return undefined;
}
export function createConstructedObject6(
  site: ConstructSite,
  v0: unknown,
  v1: unknown,
  v2: unknown,
  v3: unknown,
  v4: unknown,
  v5: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const proto = site.constructProto;
  const shape = site.constructShape;
  const root = site.constructRoot;
  if (
    proto !== undefined &&
    shape !== undefined &&
    root !== undefined &&
    proto.internalChildShape === root &&
    site.constructEpoch === site.constructEpochRef.value
  )
    return {
      internalShape: shape,
      prototype: proto,
      internalFlags: objectFlagExtensible,
      properties: undefined,
      internalPropertyEpoch: 6,
      internalChildShape: undefined,
      internalValues: undefined,
      internalCall: undefined,
      internalRegisterCall: undefined,
      internalConstruct: undefined,
      internalArrayElements: undefined,
      internalMethods: undefined,
      internalRareSlots: undefined,
      internalExoticSlots: undefined,
      internalValue0: v0,
      internalValue1: v1,
      internalValue2: v2,
      internalValue3: v3,
      internalValue4: v4,
      internalValue5: v5,
      internalValue6: undefined,
      internalValue7: undefined,
    };
  return undefined;
}
export function createConstructedObject7(
  site: ConstructSite,
  v0: unknown,
  v1: unknown,
  v2: unknown,
  v3: unknown,
  v4: unknown,
  v5: unknown,
  v6: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const proto = site.constructProto;
  const shape = site.constructShape;
  const root = site.constructRoot;
  if (
    proto !== undefined &&
    shape !== undefined &&
    root !== undefined &&
    proto.internalChildShape === root &&
    site.constructEpoch === site.constructEpochRef.value
  )
    return {
      internalShape: shape,
      prototype: proto,
      internalFlags: objectFlagExtensible,
      properties: undefined,
      internalPropertyEpoch: 7,
      internalChildShape: undefined,
      internalValues: undefined,
      internalCall: undefined,
      internalRegisterCall: undefined,
      internalConstruct: undefined,
      internalArrayElements: undefined,
      internalMethods: undefined,
      internalRareSlots: undefined,
      internalExoticSlots: undefined,
      internalValue0: v0,
      internalValue1: v1,
      internalValue2: v2,
      internalValue3: v3,
      internalValue4: v4,
      internalValue5: v5,
      internalValue6: v6,
      internalValue7: undefined,
    };
  return undefined;
}
export function createConstructedObject8(
  site: ConstructSite,
  v0: unknown,
  v1: unknown,
  v2: unknown,
  v3: unknown,
  v4: unknown,
  v5: unknown,
  v6: unknown,
  v7: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  const proto = site.constructProto;
  const shape = site.constructShape;
  const root = site.constructRoot;
  if (
    proto !== undefined &&
    shape !== undefined &&
    root !== undefined &&
    proto.internalChildShape === root &&
    site.constructEpoch === site.constructEpochRef.value
  )
    return {
      internalShape: shape,
      prototype: proto,
      internalFlags: objectFlagExtensible,
      properties: undefined,
      internalPropertyEpoch: 8,
      internalChildShape: undefined,
      internalValues: undefined,
      internalCall: undefined,
      internalRegisterCall: undefined,
      internalConstruct: undefined,
      internalArrayElements: undefined,
      internalMethods: undefined,
      internalRareSlots: undefined,
      internalExoticSlots: undefined,
      internalValue0: v0,
      internalValue1: v1,
      internalValue2: v2,
      internalValue3: v3,
      internalValue4: v4,
      internalValue5: v5,
      internalValue6: v6,
      internalValue7: v7,
    };
  return undefined;
}

/** Side-effect-free cache warmer for an ordinary data property lookup on an
 * object with an ordinary prototype chain. Returns `cache` (absentPropertyValue)
 * without invoking any getter or exotic trap when the lookup cannot be cached
 * purely as an ordinary data read. */
export function warmOrdinaryDataProperty(
  value: unknown,
  key: string,
  realm: ErrorRealm,
  cache: ScriptPropertyCache,
): unknown {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (
    object === undefined ||
    !isOrdinaryPrototypeChain<ScriptPropertyKey, unknown>(object)
  )
    return cache;
  const descriptor = findOrdinaryProperty<ScriptPropertyKey, unknown>(
    object,
    key,
  );
  if (descriptor === undefined || descriptor.accessor) return cache;
  return readCachedObjectValueProperty(
    value,
    key,
    realm.objectHooks,
    realm,
    cache,
  );
}

/** Native-only checked view, explicitly bound by the embedding build request.
 * The Script surface uses shared property keys and general unknown values. */
export function viewObjectValue(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  throw "UNBOUND_OBJECT_VIEW";
}

/** True when `value` is an OrdinaryObject (ECMAScript Object/Function/Proxy).
 * Native code binds this to IR general-record-is (`operation: "test"`). */
export function isOrdinaryObject(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): boolean {
  return viewObjectValue(value, witness) !== undefined;
}

/** Resolve a callee's native script entry closure for a direct call in
 * `realm`'s active execution context, or undefined when the call must take the
 * general path. Native code binds this to IR script-entry. */
export function resolveScriptCallEntry(
  callee: unknown,
  realm: ErrorRealm,
): ObjectScriptCall<unknown> | undefined {
  const object = viewTypeofObject(callee);
  const slot = object === undefined ? undefined : object.internalRegisterCall;
  if (slot === undefined) return undefined;
  const entry = slot.scriptInvoke;
  if (entry === undefined) return undefined;
  const context = slot.context;
  const active = realm.agent.activeContext;
  if (
    context !== active &&
    (active === undefined ||
      context.realm !== active.realm ||
      context.scriptOrModule !== active.scriptOrModule)
  )
    return undefined;
  return entry;
}

/** As resolveScriptCallEntry, requiring an ordinary constructor. */
export function resolveScriptConstructEntry(
  callee: unknown,
  realm: ErrorRealm,
): ObjectScriptCall<unknown> | undefined {
  const object = viewTypeofObject(callee);
  const slot = object === undefined ? undefined : object.internalRegisterCall;
  if (slot === undefined || !slot.constructible) return undefined;
  const entry = slot.scriptInvoke;
  if (entry === undefined) return undefined;
  const context = slot.context;
  const active = realm.agent.activeContext;
  if (
    context !== active &&
    (active === undefined ||
      context.realm !== active.realm ||
      context.scriptOrModule !== active.scriptOrModule)
  )
    return undefined;
  return entry;
}

/** In-place (`0..7`) or spilled (`>= 8`) value `index` of a fast-mode Script
 * object, as the portable bodies of the generated caches' functions read it. */
export function readPropertyValueSlot(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  index: number,
): unknown {
  if (index >= 8) {
    const offset = index - 8;
    let chunkIndex = offset >>> 4;
    let chunk: PropertySpill<unknown> | undefined = object.internalValues;
    while (chunkIndex > 0 && chunk !== undefined) {
      chunk = chunk.next;
      chunkIndex--;
    }
    if (chunk === undefined) return undefined;
    switch (offset & 15) {
      case 0:
        return chunk.v0;
      case 1:
        return chunk.v1;
      case 2:
        return chunk.v2;
      case 3:
        return chunk.v3;
      case 4:
        return chunk.v4;
      case 5:
        return chunk.v5;
      case 6:
        return chunk.v6;
      case 7:
        return chunk.v7;
      case 8:
        return chunk.v8;
      case 9:
        return chunk.v9;
      case 10:
        return chunk.v10;
      case 11:
        return chunk.v11;
      case 12:
        return chunk.v12;
      case 13:
        return chunk.v13;
      case 14:
        return chunk.v14;
      case 15:
        return chunk.v15;
    }
    throw "PROPERTY_SLOT_INVARIANT";
  }
  switch (index) {
    case 0:
      return object.internalValue0;
    case 1:
      return object.internalValue1;
    case 2:
      return object.internalValue2;
    case 3:
      return object.internalValue3;
    case 4:
      return object.internalValue4;
    case 5:
      return object.internalValue5;
    case 6:
      return object.internalValue6;
    case 7:
      return object.internalValue7;
  }
  throw "PROPERTY_SLOT_INVARIANT";
}
/** Store in-place value `index` of a fast-mode Script object. */
export function writePropertyValueSlot(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  index: number,
  value: unknown,
): void {
  switch (index) {
    case 0:
      object.internalValue0 = value;
      return;
    case 1:
      object.internalValue1 = value;
      return;
    case 2:
      object.internalValue2 = value;
      return;
    case 3:
      object.internalValue3 = value;
      return;
    case 4:
      object.internalValue4 = value;
      return;
    case 5:
      object.internalValue5 = value;
      return;
    case 6:
      object.internalValue6 = value;
      return;
    case 7:
      object.internalValue7 = value;
      return;
  }
  throw "PROPERTY_SLOT_INVARIANT";
}

/** The word index of internalValue0 in an ordinary object record. Native
 * code binds this to the layout's constant (field-word); unbound, value
 * words start at 2 so slot 0 stays reserved for directly cached inherited
 * values. */
export function propertySlotWord(
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): number {
  return 2;
}

/** The value of `value`'s own data property cached at `site`: its shape is
 * one of the site's own entry shapes, which proves the property and its
 * slot. Otherwise the site itself, which absentPropertyValue recognizes and
 * no property holds. Native code binds this to IR property-load, whose miss
 * is a dedicated non-value. */
export function cachedOwnPropertyValue(
  value: unknown,
  site: ScriptPropertyCache,
): unknown {
  const object = viewTypeofObject(value);
  if (object === undefined) return site;
  // The entries in order, as generated code tests them (a retained
  // declaration reads the site's fields directly).
  const shape = object.internalShape;
  let slot = 0;
  if (shape === site.ownShape) slot = site.ownSlot;
  else if (shape === site.ownShape1) slot = site.ownSlot1;
  else if (shape === site.ownShape2) slot = site.ownSlot2;
  else if (shape === site.ownShape3) slot = site.ownSlot3;
  else return site;
  if (slot < 0) {
    const raw = -slot / Number.MIN_VALUE;
    return readPropertyValueSlot(
      object,
      8 + ((raw >>> 16) << 4) + (((raw & 0xffff) - 2) >>> 1),
    );
  }
  return readPropertyValueSlot(object, (slot / Number.MIN_VALUE - 2) / 2);
}

/** As cachedOwnPropertyValue, for a method site: a directly cached inherited
 * value (slot === 0, valid across any prototype depth, spilled slots,
 * dictionary-mode prototypes, and String primitives while the epoch holds),
 * or a data property of the receiver itself when slot !== 0. */
export function cachedInheritedPropertyValue(
  value: unknown,
  site: ScriptPropertyCache,
): unknown {
  const object = viewTypeofObject(value);
  const shape =
    object !== undefined
      ? object.internalShape
      : typeof value === "string"
        ? site.stringShape
        : undefined;
  if (shape === undefined || site.inheritedEpochs.value !== site.inheritedEpoch)
    return site;
  let slot = 0,
    direct: unknown = undefined;
  if (shape === site.inheritedShape) {
    slot = site.inheritedSlot;
    direct = site.inheritedValue;
  } else if (shape === site.inheritedShape1) {
    slot = site.inheritedSlot1;
    direct = site.inheritedValue1;
  } else if (shape === site.inheritedShape2) {
    slot = site.inheritedSlot2;
    direct = site.inheritedValue2;
  } else if (shape === site.inheritedShape3) {
    slot = site.inheritedSlot3;
    direct = site.inheritedValue3;
  } else if (shape === site.inheritedShape4) {
    slot = site.inheritedSlot4;
    direct = site.inheritedValue4;
  } else if (shape === site.inheritedShape5) {
    slot = site.inheritedSlot5;
    direct = site.inheritedValue5;
  } else if (shape === site.inheritedShape6) {
    slot = site.inheritedSlot6;
    direct = site.inheritedValue6;
  } else if (shape === site.inheritedShape7) {
    slot = site.inheritedSlot7;
    direct = site.inheritedValue7;
  } else return site;
  if (slot === 0) return direct;
  if (object === undefined) return site;
  if (slot < 0) {
    const raw = -slot / Number.MIN_VALUE;
    return readPropertyValueSlot(
      object,
      8 + ((raw >>> 16) << 4) + (((raw & 0xffff) - 2) >>> 1),
    );
  }
  return readPropertyValueSlot(object, (slot / Number.MIN_VALUE - 2) / 2);
}

/** Whether a cached read missed. Native code binds it to the miss test of
 * IR property-load. */
export function absentPropertyValue(
  value: unknown,
  site: ScriptPropertyCache,
): boolean {
  return value === site;
}

/** Store `value` through the site's store cache: to the cached writable own
 * data property, or by the cached transition that adds one (valid while no
 * prototype changed shape since: see propertyEpoch). False when the cache
 * does not apply. Native code binds this to IR property-store. */
export function cachedPropertyStore(
  target: unknown,
  value: unknown,
  site: ScriptPropertyCache,
): boolean {
  const object = viewTypeofObject(target);
  if (object === undefined) return false;
  const shape = object.internalShape;
  let slot = 0;
  let transition = site.storeTransition;
  let epoch = 0;
  if (shape === site.storeShape) {
    slot = site.storeSlot;
    transition = site.storeTransition;
    epoch = site.storeEpoch;
  } else if (shape === site.storeShape1) {
    slot = site.storeSlot1;
    transition = site.storeTransition1;
    epoch = site.storeEpoch1;
  } else if (shape === site.storeShape2) {
    slot = site.storeSlot2;
    transition = site.storeTransition2;
    epoch = site.storeEpoch2;
  } else if (shape === site.storeShape3) {
    slot = site.storeSlot3;
    transition = site.storeTransition3;
    epoch = site.storeEpoch3;
  } else return false;
  if (transition !== undefined) {
    if (site.epoch.value !== epoch) return false;
    object.internalShape = transition;
  }
  writePropertyValueSlot(object, (slot / Number.MIN_VALUE - 2) / 2, value);
  return true;
}

/** Concrete host-authorized object view for weak-directory lookup. Unlike the
 * generic embedding API it needs no witness value, which could accidentally
 * retain an otherwise unreachable registry's realm through that directory. */
export function viewWeakRegistryOwner(
  value: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  throw "UNBOUND_WEAK_REGISTRY_VIEW";
}

/** IsArray follows proxy targets without invoking handler traps. */
export function isArrayValue(value: unknown, realm: ErrorRealm): boolean {
  let object = viewObjectValue(value, realm.objectPrototype);
  while (object !== undefined) {
    const exotic = object.internalExoticSlots;
    const proxy = exotic === undefined ? undefined : exotic.internalProxyData;
    if (proxy === undefined)
      return (object.internalFlags & objectFlagArrayData) !== 0;
    if (proxy.target === undefined) throw createRuntimeError(realm, "type");
    object = proxy.target;
  }
  return false;
}

/** The classifier needs only a descriptor, even before a realm is created. */
export function viewTypeofObject(
  value: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  throw "UNBOUND_TYPEOF_OBJECT_VIEW";
}

export function objectTypeof(
  value: unknown,
  object: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
): string {
  if (viewSymbolValue(value) !== undefined) return "symbol";
  if (viewBigIntValue(value) !== undefined) return "bigint";
  // Retained typeof helpers reach this classifier, and retained code may
  // not call into other modules, so it reads the exotic slot directly
  // instead of through exoticSlots.
  const exotic = object === undefined ? undefined : object.internalExoticSlots;
  if (exotic !== undefined && exotic.internalIsHTMLDDA) return "undefined";
  if (object !== undefined && object.internalCall !== undefined)
    return "function";
  // Runtime internals use raw typeof. In particular this fallback recognizes
  // primitives and native closures without recursing through this classifier.
  return typeof value;
}

export function objectValueTypeof(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): string {
  return objectTypeof(value, viewObjectValue(value, witness));
}

export function generalValueTypeof(value: unknown): string {
  return objectTypeof(value, viewTypeofObject(value));
}

export function scriptIsHTMLDDA(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): boolean {
  const object = viewObjectValue(value, witness);
  const exotic = object === undefined ? undefined : object.internalExoticSlots;
  return exotic !== undefined && exotic.internalIsHTMLDDA;
}

/** Annex B.3.6 [[IsHTMLDDA]] objects are host-defined. Code lowered for a
 * host that creates none omits their checks and excludes them when its
 * module initializes; a host marks each object through
 * markHTMLDDAObject. Either step after the other is an image configuration
 * error, never a silent change of `==` semantics. */
let htmlDDAObjects: "unknown" | "present" | "excluded" = "unknown";

export function markHTMLDDAObject(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
): void {
  if (htmlDDAObjects === "excluded")
    throw "IsHTMLDDA objects were excluded by code lowered without them";
  htmlDDAObjects = "present";
  ensureExoticSlots(object).internalIsHTMLDDA = true;
}

export function excludeHTMLDDAObjects(): void {
  if (htmlDDAObjects === "present")
    throw "code lowered without IsHTMLDDA objects runs beside one";
  htmlDDAObjects = "excluded";
}

export function scriptBoolean(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): boolean {
  const object = viewObjectValue(value, witness);
  const exotic = object === undefined ? undefined : object.internalExoticSlots;
  if (exotic !== undefined && exotic.internalIsHTMLDDA) return false;
  const bigint = viewBigIntValue(value);
  return bigint === undefined ? !!value : bigIntToBoolean(bigint);
}
export function scriptStrictEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  const a = viewBigIntValue(left),
    b = viewBigIntValue(right);
  return a !== undefined && b !== undefined && compareBigIntValues(a, b) === 0;
}
export function scriptSameValue(left: unknown, right: unknown): boolean {
  if (sameValue(left, right)) return true;
  const a = viewBigIntValue(left),
    b = viewBigIntValue(right);
  return a !== undefined && b !== undefined && compareBigIntValues(a, b) === 0;
}

export function callObjectValue(
  value: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): { readonly error: "none" | "type"; readonly value: unknown } {
  return callObject<ScriptPropertyKey, unknown>(
    viewObjectValue(value, witness),
    receiver,
    arguments_,
    undefined,
  );
}

/** Positional call sites have evaluated every operand before dispatch. The
 * generic path handles foreign realms, proxies, bound functions and hosts. */
export function callRegisterObjectValue(
  realm: ErrorRealm,
  count: number,
  value: unknown,
  receiver: unknown,
  first: unknown,
  second: unknown,
): unknown {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const entry = object.internalRegisterCall;
  const invoke = entry?.invoke;
  const active = realm.agent.activeContext;
  if (
    entry !== undefined &&
    invoke !== undefined &&
    (object.internalRareSlots?.internalExecutionContext === undefined ||
      (active !== undefined &&
        active.realm === entry.context.realm &&
        active.scriptOrModule === entry.context.scriptOrModule))
  )
    return invoke(value, receiver, undefined, count, first, second);
  const args: readonly unknown[] =
    count === 0 ? [] : count === 1 ? [first] : [first, second];
  const result = callObject<ScriptPropertyKey, unknown>(
    object,
    receiver,
    args,
    undefined,
  );
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}

/** Same-Script calls to wide positional bodies keep all actual operands
 * outside the managed heap. Other callees receive exactly the supplied list. */
export function callWideRegisterObjectValue(
  realm: ErrorRealm,
  count: number,
  value: unknown,
  receiver: unknown,
  first: unknown,
  second: unknown,
  third: unknown,
  fourth: unknown,
  fifth: unknown,
  sixth: unknown,
): unknown {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const entry = object.internalRegisterCall;
  const active = realm.agent.activeContext;
  if (
    entry !== undefined &&
    active !== undefined &&
    active.realm === entry.context.realm &&
    active.scriptOrModule === entry.context.scriptOrModule
  ) {
    const invoke = entry.invokeWide;
    if (invoke !== undefined)
      return invoke(
        value,
        receiver,
        undefined,
        count,
        first,
        second,
        third,
        fourth,
        fifth,
        sixth,
      );
  }
  const args: readonly unknown[] =
    count === 3
      ? [first, second, third]
      : count === 4
        ? [first, second, third, fourth]
        : count === 5
          ? [first, second, third, fourth, fifth]
          : [first, second, third, fourth, fifth, sixth];
  const result = callObject<ScriptPropertyKey, unknown>(
    object,
    receiver,
    args,
    undefined,
  );
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}

/** Calls from typed source already carry a receiver and an evaluated list. */
export function callGeneralValue(
  value: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
): unknown {
  const object = viewTypeofObject(value);
  if (object === undefined)
    throw new TypeError("Called value is not a function");
  const result = callObjectValue(value, receiver, arguments_, object);
  if (result.error !== "none")
    throw new TypeError("Called value is not a function");
  return result.value;
}

export function constructGeneralValue(
  value: unknown,
  arguments_: readonly unknown[],
): unknown {
  const object = viewTypeofObject(value);
  if (object === undefined)
    throw new TypeError("Called value is not a constructor");
  const result = constructObject<ScriptPropertyKey, unknown>(
    object,
    arguments_,
    { value, object },
    undefined,
  );
  if (result.error !== "none")
    throw new TypeError("Called value is not a constructor");
  return result.value;
}

/** Box the lookup base, preserving the original receiver for accessors. */
export function getObjectValueProperty(
  value: unknown,
  key: ScriptPropertyKey,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: unknown;
} {
  return getObjectValuePropertyWithReceiver(value, key, value, hooks, realm);
}

/** Lookup base and accessor receiver are distinct for super references. */
export function getObjectValuePropertyWithReceiver(
  base: unknown,
  key: ScriptPropertyKey,
  receiver: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: unknown;
} {
  if (base === null || base === undefined)
    return { error: "type", value: undefined };
  return {
    error: "none",
    value: propertyValueOf(base, key, receiver, hooks, realm),
  };
}

/** [[Get]] on ToObject(base) for a non-nullish base. */
export function propertyValueOf(
  base: unknown,
  key: ScriptPropertyKey,
  receiver: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  // An object base is its own ToObject result: read it before the primitive
  // checks, which object bases would all fail.
  const object = viewObjectValue(base, realm.objectPrototype);
  if (object !== undefined)
    return getProperty<ScriptPropertyKey, unknown>(
      object,
      key,
      receiver,
      hooks,
    );
  const prototype = primitivePrototype(base, realm);
  if (prototype !== undefined) {
    // A wrapper's only own properties are a String's length and in-range
    // canonical indices, so reading through the prototype is [[Get]] on
    // ToObject(base) without allocating the wrapper.
    if (typeof base === "string" && typeof key === "string") {
      if (key === "length") return base.length;
      const index = scriptPropertyKeyOrder(key);
      if (index >= 0 && index < base.length)
        return base.slice(index, index + 1);
    }
    return getProperty<ScriptPropertyKey, unknown>(
      prototype,
      key,
      receiver,
      hooks,
    );
  }
  return getProperty<ScriptPropertyKey, unknown>(
    toObjectValue(base, realm, hooks),
    key,
    receiver,
    hooks,
  );
}

/** GetValue of a property reference without a result record: the base's
 * RequireObjectCoercible TypeError is thrown in the realm, as a lowered result
 * check would; the receiver is the original base value. */
export function readObjectValueProperty(
  base: unknown,
  key: ScriptPropertyKey,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): unknown {
  if (base === null || base === undefined)
    throw createRuntimeError(realm, "type");
  return propertyValueOf(base, key, base, hooks, realm);
}

export function readCachedObjectValueProperty(
  base: unknown,
  key: string,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
  cache: ScriptPropertyCache,
): unknown {
  const object = viewObjectValue(base, realm.objectPrototype);
  if (
    object === undefined &&
    typeof base === "string" &&
    cache.method &&
    key !== "length" &&
    scriptPropertyKeyOrder(key) < 0 &&
    lookupCachedStringPrimitiveProperty(realm.stringPrototype, key, cache)
  )
    return cache.foundValue;
  // A String's own properties are its length and indices, and Number and
  // Boolean wrappers have none, so other keys of those primitives are the
  // keys of their prototype, which the site caches like a receiver's own.
  const receiver =
    object !== undefined
      ? object
      : typeof base === "string" &&
          (key === "length" || scriptPropertyKeyOrder(key) >= 0)
        ? undefined
        : primitivePrototype(base, realm);
  if (receiver !== undefined) {
    const holder = lookupCachedScriptProperty(
      receiver,
      key,
      cache,
      false,
      realm.agent.propertyStubCache,
      propertySlotWord(realm.objectPrototype),
    );
    if (holder !== undefined) return cachedScriptPropertyValue(holder, cache);
  }
  return readObjectValueProperty(base, key, hooks, realm);
}

export function writeCachedObjectValueProperty(
  base: unknown,
  key: string,
  value: unknown,
  strict: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
  cache: ScriptPropertyCache,
): void {
  const object = viewObjectValue(base, realm.objectPrototype);
  if (
    object !== undefined &&
    storeCachedScriptProperty(
      object,
      key,
      value,
      cache,
      propertySlotWord(realm.objectPrototype),
    )
  )
    return;
  throwIfRuntimeError(
    realm,
    setObjectValueProperty(base, key, value, strict, hooks, realm),
  );
}

/** The realm prototype ToObject would give a String, Number or Boolean
 * primitive, or undefined for every other value. Number and Boolean wrappers
 * have no own properties. Symbol and BigInt reads stay on the boxing path so
 * object reads pay only these typeof checks. */
function primitivePrototype(
  value: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> | undefined {
  if (typeof value === "string") return realm.stringPrototype;
  if (typeof value === "number") return realm.numberPrototype;
  if (typeof value === "boolean") return realm.booleanPrototype;
  return undefined;
}

/** PutValue after RHS evaluation; failed writes throw only for strict references. */
export function setObjectValueProperty(
  base: unknown,
  key: ScriptPropertyKey,
  value: unknown,
  strict: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): "none" | "type" | "unsupported" {
  return setObjectValuePropertyWithReceiver(
    base,
    key,
    value,
    base,
    strict,
    hooks,
    realm,
  );
}

/** Data writes target the receiver, while inherited setter lookup starts at base. */
export function setObjectValuePropertyWithReceiver(
  base: unknown,
  key: ScriptPropertyKey,
  value: unknown,
  receiver: unknown,
  strict: boolean,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): "none" | "type" | "unsupported" {
  if (base === null || base === undefined) return "type";
  const receiverObject = viewObjectValue(receiver, realm.objectPrototype);
  const object = toObjectValue(base, realm, hooks);
  return setProperty<ScriptPropertyKey, unknown>(
    object,
    key,
    value,
    // A primitive receiver permits inherited setters but cannot receive data
    // properties on the temporary wrapper, even when that wrapper is extensible.
    { value: receiver, object: receiverObject },
    hooks,
  )
    ? "none"
    : strict
      ? "type"
      : "none";
}

/** OrdinaryCallBindThis uses the callee realm's global and wrapper prototypes. */
export function sloppyCallReceiver(
  value: unknown,
  globalThis: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): { readonly error: "none" | "unsupported"; readonly value: unknown } {
  if (value === null || value === undefined)
    return { error: "none", value: globalThis };
  return { error: "none", value: toObjectValue(value, realm, hooks) };
}

/** Delete never reads the property or invokes a getter. Primitive wrappers cannot
 * escape this operation, so their own-property checks need no allocation. */
export function deleteObjectValueProperty(
  base: unknown,
  key: ScriptPropertyKey,
  strict: boolean,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): {
  readonly error: "none" | "type" | "unsupported";
  readonly value: boolean;
} {
  if (base === null || base === undefined)
    return { error: "type", value: false };
  if (typeof base === "object" && viewSymbolValue(base) !== undefined)
    return { error: "none", value: true };
  let accepted = true;
  if (typeof base === "string") {
    if (typeof key !== "string") return { error: "none", value: true };
    const index = Number(key);
    accepted = !(
      key === "length" ||
      (index >= 0 &&
        index < base.length &&
        Math.floor(index) === index &&
        String(index) === key)
    );
  } else if (typeof base !== "number" && typeof base !== "boolean") {
    const object = viewObjectValue(base, witness);
    if (object === undefined) return { error: "unsupported", value: false };
    accepted = deleteProperty<ScriptPropertyKey, unknown>(object, key);
  }
  return { error: !accepted && strict ? "type" : "none", value: accepted };
}
