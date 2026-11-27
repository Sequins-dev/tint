import { gcEpoch, referenceHash } from "@tint/foundation/collections/key-index";
import {
  createExoticObject,
  ordinaryDefineOwnProperty,
  ordinaryDeleteProperty,
  ordinaryGetOwnProperty,
  ordinaryOwnKeys,
  type ObjectCall,
  type ObjectConstruct,
  type ObjectHooks,
  type OrdinaryObject,
  type PropertyDefinitionResult,
  objectFlagArrayData,
} from "./operations.ts";
import { functionMetadata } from "./intrinsics.ts";
import type { ErrorRealm } from "./errors.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";
import type { WeakStorageService } from "./weak-storage.ts";
import {
  configurableField,
  enumerableField,
  getField,
  setField,
  valueField,
  writableField,
  type Descriptor,
  type DescriptorUpdate,
} from "../descriptors/index.ts";

const initialViewSlots = 16;
const removedViewHash = 0xffffffff;
const deletedViewSlot = 0xffffffff;
const maxViewSlots = 0x40000000;

function mixViewHash(native: unknown): number {
  const h = Math.imul(referenceHash(native), 0x9e3779b1);
  const mixed = (h ^ (h >>> 16)) >>> 0;
  return mixed === removedViewHash ? 0 : mixed;
}

/** Native references lack the identity field on realm objects. Cache their
 * projections with ephemerons keyed by the actual native value in an
 * open-addressed hash table keyed by epoch-scoped `referenceHash(native)`.
 * A returned view can keep its source alive without the cache keeping either
 * alive, and moving GC triggers an in-place rehash + dead-ephemeron sweep. */
export interface NativeViewCache {
  readonly storage: WeakStorageService;
  cells: unknown[];
  hashes: Uint32Array | undefined;
  slots: Uint32Array | undefined;
  length: number;
  size: number;
  used: number;
  hashEpoch: number;
}

export function createNativeViewCache(
  storage: WeakStorageService,
): NativeViewCache {
  return {
    storage,
    cells: [],
    hashes: undefined,
    slots: undefined,
    length: 0,
    size: 0,
    used: 0,
    hashEpoch: gcEpoch(),
  };
}

/** Recompute address hashes and probe slots in place after a moving GC cycle,
 * evicting cleared ephemerons at the same time. */
function rehashViewCacheInPlace(cache: NativeViewCache): void {
  const slots = cache.slots,
    hashes = cache.hashes,
    cells = cache.cells,
    storage = cache.storage,
    length = cache.length;
  const epoch = gcEpoch();
  if (slots === undefined || hashes === undefined || length === 0) {
    cache.hashEpoch = epoch;
    return;
  }
  const capacity = slots.length;
  if (capacity < 1 || capacity > maxViewSlots)
    throw "NATIVE_VIEW_CACHE_INVARIANT";
  slots.fill(0);
  const mask = capacity - 1;
  let live = 0;
  for (let entry = 0; entry < length; entry++) {
    if (hashes[entry] === removedViewHash) continue;
    const cell = cells[entry];
    const key = cell === undefined ? undefined : storage.key(cell);
    if (key === undefined) {
      hashes[entry] = removedViewHash;
      cells[entry] = undefined;
      continue;
    }
    const mixed = mixViewHash(key);
    hashes[entry] = mixed;
    let at = mixed & mask;
    while (slots[at] !== 0) at = (at + 1) & mask;
    slots[at] = entry + 1;
    live++;
  }
  cache.size = live;
  cache.used = live;
  cache.hashEpoch = epoch;
}

/** Compact live ephemerons into a fresh table of `capacity` slots. */
function rebuildViewCache(cache: NativeViewCache, capacity: number): void {
  if (capacity > maxViewSlots) throw "NATIVE_VIEW_CACHE_LIMIT";
  const oldCells = cache.cells,
    oldHashes = cache.hashes,
    storage = cache.storage,
    length = cache.length,
    nextCap = capacity >>> 1,
    nextHashes = new Uint32Array(nextCap),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1,
    nextCells: unknown[] = [];
  const epoch = gcEpoch();
  let write = 0;
  if (oldHashes !== undefined) {
    for (let entry = 0; entry < length; entry++) {
      if (oldHashes[entry] === removedViewHash) continue;
      const cell = oldCells[entry];
      const key = cell === undefined ? undefined : storage.key(cell);
      if (key === undefined) continue;
      const mixed = mixViewHash(key);
      let at = mixed & mask;
      while (nextSlots[at] !== 0) at = (at + 1) & mask;
      nextCells.push(cell);
      nextHashes[write] = mixed;
      write++;
      nextSlots[at] = write;
    }
  }
  cache.cells = nextCells;
  cache.hashes = nextHashes;
  cache.slots = nextSlots;
  cache.length = write;
  cache.size = write;
  cache.used = write;
  cache.hashEpoch = epoch;
}

export function cachedNativeView(
  cache: NativeViewCache,
  native: unknown,
): unknown {
  if (cache.length === 0) return undefined;
  if (cache.hashEpoch !== gcEpoch()) rehashViewCacheInPlace(cache);
  const slots = cache.slots,
    hashes = cache.hashes,
    cells = cache.cells,
    storage = cache.storage;
  if (slots === undefined || hashes === undefined) return undefined;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maxViewSlots) return undefined;
  const mixed = mixViewHash(native),
    mask = capacity - 1;
  let at = mixed & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return undefined;
    if (probe !== deletedViewSlot) {
      const entry = probe - 1;
      if (hashes[entry] === mixed) {
        const cell = cells[entry];
        const key = cell === undefined ? undefined : storage.key(cell);
        if (key === native) return storage.value(cell);
        if (key === undefined) {
          slots[at] = deletedViewSlot;
          hashes[entry] = removedViewHash;
          cells[entry] = undefined;
          if (cache.size > 0) cache.size--;
        }
      }
    }
    at = (at + 1) & mask;
  }
}

export function cacheNativeView(
  cache: NativeViewCache,
  native: unknown,
  view: unknown,
): void {
  const cell = cache.storage.create(native, view, true);
  if (cache.slots === undefined || cache.hashes === undefined) {
    cache.cells = [];
    cache.hashes = new Uint32Array(initialViewSlots >>> 1);
    cache.slots = new Uint32Array(initialViewSlots);
    cache.length = 0;
    cache.size = 0;
    cache.used = 0;
    cache.hashEpoch = gcEpoch();
  } else if (cache.hashEpoch !== gcEpoch()) {
    rehashViewCacheInPlace(cache);
  }
  const currentSlots = cache.slots,
    currentHashes = cache.hashes;
  if (currentSlots === undefined || currentHashes === undefined)
    throw "NATIVE_VIEW_CACHE_INVARIANT";
  if (
    (cache.used + 1) * 2 > currentSlots.length ||
    cache.length >= currentHashes.length
  ) {
    const nextCapacity =
      cache.size * 4 >= currentSlots.length
        ? currentSlots.length * 2
        : currentSlots.length;
    rebuildViewCache(cache, nextCapacity);
  }
  if (cache.hashEpoch !== gcEpoch()) rehashViewCacheInPlace(cache);
  const slots = cache.slots,
    hashes = cache.hashes;
  if (slots === undefined || hashes === undefined)
    throw "NATIVE_VIEW_CACHE_INVARIANT";
  const capacity = slots.length;
  if (capacity < 1 || capacity > maxViewSlots)
    throw "NATIVE_VIEW_CACHE_INVARIANT";
  const mixed = mixViewHash(native),
    mask = capacity - 1;
  let at = mixed & mask;
  let target = -1;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) {
      if (target < 0) target = at;
      break;
    }
    if (probe === deletedViewSlot && target < 0) target = at;
    at = (at + 1) & mask;
  }
  const entry = cache.length;
  if (slots[target] === 0) cache.used++;
  cache.cells.push(cell);
  hashes[entry] = mixed;
  slots[target] = entry + 1;
  cache.length = entry + 1;
  cache.size++;
  if (cache.hashEpoch !== gcEpoch()) rehashViewCacheInPlace(cache);
}

export function createNativeCallableView(
  native: unknown,
  invoke: ObjectCall<unknown>,
  construct: ObjectConstruct<unknown> | undefined,
  name: string,
  length: number,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const view = createExoticObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    { typedRecord: (): unknown => native },
    invoke,
    construct,
    realm.executionContext,
  );
  functionMetadata(view, name, length, hooks);
  return view;
}

export interface NativeListAccess {
  readonly length: () => number;
  readonly resize: (length: number) => void;
  readonly has: (index: number) => boolean;
  readonly read: (index: number) => unknown;
  readonly write: (index: number, value: unknown) => void;
  readonly remove: (index: number) => boolean;
}

function listDescriptor(value: unknown, element: boolean): Descriptor<unknown> {
  return {
    accessor: false,
    value,
    writable: true,
    get: undefined,
    set: undefined,
    enumerable: element,
    configurable: element,
  };
}

/** Indexed data properties and length live in the source list. Expandos
 * belong to the realm object. The native storage has fixed data descriptors. */
export function createNativeListView(
  native: unknown,
  access: NativeListAccess,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const array = realm.arrayHooks;
  const view = createExoticObject<ScriptPropertyKey, unknown>(
    realm.arrayPrototype,
    {
      typedRecord: (): unknown => native,
      nativeListAccess: access,
      getOwnProperty: (object, key): Descriptor<unknown> | undefined => {
        if (key === "length") return listDescriptor(access.length(), false);
        const index = array.index(key);
        if (index < 0)
          return ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(
            object,
            key,
          );
        return access.has(index)
          ? listDescriptor(access.read(index), true)
          : undefined;
      },
      defineOwnProperty: (
        object,
        key,
        update: DescriptorUpdate<unknown>,
        hooks,
      ): PropertyDefinitionResult => {
        const length = key === "length";
        const index = array.index(key);
        if (!length && index < 0)
          return ordinaryDefineOwnProperty<ScriptPropertyKey, unknown>(
            object,
            key,
            update,
            hooks,
          );
        const fields = update.fields;
        if ((fields & (getField | setField)) !== 0) return "rejected";
        if ((fields & writableField) !== 0 && !update.writable)
          return "rejected";
        if ((fields & enumerableField) !== 0 && update.enumerable === length)
          return "rejected";
        if (
          (fields & configurableField) !== 0 &&
          update.configurable === length
        )
          return "rejected";
        if (length) {
          if ((fields & valueField) !== 0) {
            const size = array.toNumber(update.value) >>> 0;
            if (size !== array.toNumber(update.value)) throw array.rangeError();
            access.resize(size);
          }
        } else {
          const present = access.has(index);
          const attributes =
            enumerableField | configurableField | writableField;
          if (!present && (fields & attributes) !== attributes)
            return "rejected";
          if ((fields & valueField) !== 0 || !present)
            access.write(index, update.value);
        }
        return "accepted";
      },
      deleteProperty: (object, key): boolean => {
        if (key === "length") return false;
        const index = array.index(key);
        return index < 0
          ? ordinaryDeleteProperty<ScriptPropertyKey, unknown>(object, key)
          : access.remove(index);
      },
      ownKeys: (object): ScriptPropertyKey[] => {
        const keys: ScriptPropertyKey[] = [];
        const length = access.length();
        for (let index = 0; index < length; index++)
          if (access.has(index)) keys.push(String(index));
        keys.push("length");
        for (const key of ordinaryOwnKeys<ScriptPropertyKey, unknown>(
          object,
          scriptPropertyKeyOrder,
        )) {
          if (key === undefined) throw "NATIVE_LIST_KEY_INVARIANT";
          keys.push(key);
        }
        return keys;
      },
      preventExtensions: (_object): boolean => false,
    },
    undefined,
    undefined,
    realm.executionContext,
  );
  view.internalFlags |= objectFlagArrayData;
  return view;
}
