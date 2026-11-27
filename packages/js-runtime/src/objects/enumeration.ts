import {
  getPrototype,
  getOwnProperty,
  ownKeys,
  objectFlagDictionary,
  objectFlagUsedAsPrototype,
  propertyEnumerable,
  propertyEpoch,
  type OrdinaryObject,
} from "./operations.ts";

/** Internal enumeration state, not a user-visible iterator. The classifier uses
 * ownKeys' contract: array index, -1 for other strings, -2 for symbols. */
export interface PropertyEnumeration<Key, Value> {
  object: OrdinaryObject<Key, Value> | undefined;
  visited: Set<Key> | undefined;
  keys: Key[];
  position: number;
  started: boolean;
  fastSnapshot: boolean;
  snapshotEpoch: number;
  snapshotGlobalEpoch: number;
  readonly keyOrder: (key: Key) => number;
}

let cachedNoEnumProto: unknown = undefined;
let cachedNoEnumProtoEpoch = -1;
let cachedNoEnumGlobalEpoch = -1;

/** True when `proto` and every object in its prototype chain are ordinary
 * objects with zero enumerable string properties. */
function prototypeChainHasNoEnumerableKeys<Key, Value>(
  proto: OrdinaryObject<Key, Value> | undefined,
): boolean {
  if (proto === undefined) return true;
  const globalEpoch = propertyEpoch.value;
  if (
    proto === cachedNoEnumProto &&
    proto.internalPropertyEpoch === cachedNoEnumProtoEpoch &&
    globalEpoch === cachedNoEnumGlobalEpoch &&
    (proto.internalFlags & objectFlagUsedAsPrototype) !== 0
  )
    return true;
  let cursor: OrdinaryObject<Key, Value> | undefined = proto;
  while (cursor !== undefined) {
    if (
      cursor.internalMethods !== undefined ||
      cursor.internalArrayElements !== undefined ||
      cursor.internalRareSlots?.internalContractedElements !== undefined
    )
      return false;
    if ((cursor.internalFlags & objectFlagDictionary) === 0) {
      const shape = cursor.internalShape;
      if (shape !== undefined) {
        const keys = shape.keys,
          kinds = shape.kinds;
        for (let i = 0; i < keys.length; i++) {
          if (
            typeof keys[i] === "string" &&
            ((kinds[i] ?? 0) & propertyEnumerable) !== 0
          )
            return false;
        }
      }
    } else {
      const props = cursor.internalRareSlots?.properties;
      if (props !== undefined) {
        for (const [k, desc] of props) {
          if (typeof k === "string" && desc.enumerable) return false;
        }
      }
    }
    cursor = cursor.prototype;
  }
  if ((proto.internalFlags & objectFlagUsedAsPrototype) !== 0) {
    cachedNoEnumProto = proto;
    cachedNoEnumProtoEpoch = proto.internalPropertyEpoch;
    cachedNoEnumGlobalEpoch = globalEpoch;
  }
  return true;
}

export function stringPropertyKeyOrder(key: string): number {
  // Array indices are canonical unsigned decimal strings, not arbitrary
  // numeric text. Avoid allocating numeric-conversion scratch for every key.
  if (key.length === 0 || key.length > 10) return -1;
  if (key.length > 1 && key.charCodeAt(0) === 48) return -1;
  let index = 0;
  for (let position = 0; position < key.length; position++) {
    const digit = key.charCodeAt(position) - 48;
    if (digit < 0 || digit > 9) return -1;
    index = index * 10 + digit;
  }
  return index < 4294967295 ? index : -1;
}

export function createPropertyEnumeration<Key, Value>(
  object: OrdinaryObject<Key, Value> | undefined,
  keyOrder: (key: Key) => number,
): PropertyEnumeration<Key, Value> {
  const keys: Key[] = [];
  return {
    object,
    visited: undefined,
    keys,
    position: 0,
    started: false,
    fastSnapshot: false,
    snapshotEpoch: -1,
    snapshotGlobalEpoch: -1,
    keyOrder,
  };
}

function ensureVisited<Key, Value>(
  iterator: PropertyEnumeration<Key, Value>,
): Set<Key> {
  const existing = iterator.visited;
  if (existing !== undefined) return existing;
  const created = new Set<Key>();
  iterator.visited = created;
  return created;
}

/** Snapshot each object's keys once, but inspect its descriptor when visiting.
 * A deleted key does not shadow a prototype key; a non-enumerable own key does.
 * Values and getters are never read. Undefined denotes exhaustion, not a key. */
export function nextEnumerableProperty<Key, Value>(
  iterator: PropertyEnumeration<Key, Value>,
): Key | undefined {
  while (true) {
    const object = iterator.object;
    if (object === undefined) return undefined;
    if (iterator.fastSnapshot) {
      if (
        object.internalPropertyEpoch === iterator.snapshotEpoch &&
        propertyEpoch.value === iterator.snapshotGlobalEpoch
      ) {
        if (iterator.position < iterator.keys.length) {
          const key = iterator.keys[iterator.position++];
          if (key === undefined) throw "ENUMERATION_KEY_INVARIANT";
          return key;
        }
        iterator.object = undefined;
        iterator.fastSnapshot = false;
        return undefined;
      }
      // Object or prototype chain mutated mid-iteration: transition seamlessly
      // to live descriptor inspection, preserving every already-yielded key.
      const visited = ensureVisited<Key, Value>(iterator);
      for (let i = 0; i < iterator.position; i++) {
        const seen = iterator.keys[i];
        if (seen !== undefined) visited.add(seen);
      }
      iterator.fastSnapshot = false;
    }
    if (!iterator.started) {
      if (
        iterator.visited === undefined &&
        object.internalMethods === undefined &&
        object.internalArrayElements === undefined &&
        object.internalRareSlots?.internalContractedElements === undefined &&
        prototypeChainHasNoEnumerableKeys<Key, Value>(object.prototype)
      ) {
        if ((object.internalFlags & objectFlagDictionary) === 0) {
          const shape = object.internalShape;
          if (shape === undefined) {
            iterator.object = undefined;
            return undefined;
          }
          const shapeKeys = shape.keys,
            kinds = shape.kinds;
          let fast = true;
          for (let i = 0; i < shapeKeys.length; i++) {
            const k = shapeKeys[i];
            if (typeof k !== "string") {
              fast = false;
              break;
            }
            if (((kinds[i] ?? 0) & propertyEnumerable) === 0) {
              fast = false;
              break;
            }
            const c = k.charCodeAt(0);
            if (c >= 48 && c <= 57 && iterator.keyOrder(k) >= 0) {
              fast = false;
              break;
            }
          }
          if (fast) {
            const keys: Key[] = [];
            for (let i = 0; i < shapeKeys.length; i++) {
              const k = shapeKeys[i];
              if (k === undefined) throw "ENUMERATION_KEY_INVARIANT";
              keys.push(k);
            }
            iterator.keys = keys;
            iterator.position = 0;
            iterator.started = true;
            iterator.fastSnapshot = true;
            iterator.snapshotEpoch = object.internalPropertyEpoch;
            iterator.snapshotGlobalEpoch = propertyEpoch.value;
            continue;
          }
        } else {
          const props = object.internalRareSlots?.properties;
          if (props === undefined || props.size === 0) {
            iterator.object = undefined;
            return undefined;
          }
          let fast = true;
          const keys: Key[] = [];
          for (const [k, desc] of props) {
            if (typeof k !== "string" || !desc.enumerable) {
              fast = false;
              break;
            }
            const c = k.charCodeAt(0);
            if (c >= 48 && c <= 57 && iterator.keyOrder(k) >= 0) {
              fast = false;
              break;
            }
            keys.push(k);
          }
          if (fast) {
            iterator.keys = keys;
            iterator.position = 0;
            iterator.started = true;
            iterator.fastSnapshot = true;
            iterator.snapshotEpoch = object.internalPropertyEpoch;
            iterator.snapshotGlobalEpoch = propertyEpoch.value;
            continue;
          }
        }
      }
      iterator.keys = ownKeys<Key, Value>(object, iterator.keyOrder);
      iterator.position = 0;
      iterator.started = true;
    }
    const visited = ensureVisited<Key, Value>(iterator);
    while (iterator.position < iterator.keys.length) {
      const key = iterator.keys[iterator.position++];
      if (key === undefined) throw "ENUMERATION_KEY_INVARIANT";
      if (iterator.keyOrder(key) === -2 || visited.has(key)) continue;
      const descriptor = getOwnProperty<Key, Value>(object, key);
      if (descriptor === undefined) continue;
      visited.add(key);
      if (descriptor.enumerable) return key;
    }
    const nextProto = getPrototype<Key, Value>(object);
    if (prototypeChainHasNoEnumerableKeys<Key, Value>(nextProto)) {
      iterator.object = undefined;
      return undefined;
    }
    iterator.object = nextProto;
    iterator.started = false;
  }
}
