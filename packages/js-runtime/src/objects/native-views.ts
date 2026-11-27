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

/** Native references lack the identity field on realm objects. Cache their
 * projections with ephemerons keyed by the actual native value. A returned
 * view can keep its source alive without the cache keeping either alive. */
export interface NativeViewCache {
  readonly storage: WeakStorageService;
  readonly cells: unknown[];
}

export function createNativeViewCache(
  storage: WeakStorageService,
): NativeViewCache {
  return { storage, cells: [] };
}

export function cachedNativeView(
  cache: NativeViewCache,
  native: unknown,
): unknown {
  const cells = cache.cells,
    storage = cache.storage;
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i];
    const key = storage.key(cell);
    if (key === native) {
      const view = storage.value(cell);
      const last = cells.length - 1;
      if (i !== last) {
        cells[i] = cells[last];
        cells[last] = cell;
      }
      return view;
    }
    if (key === undefined) {
      const last = cells.pop();
      if (i < cells.length && last !== undefined) cells[i] = last;
    }
  }
  return undefined;
}

export function cacheNativeView(
  cache: NativeViewCache,
  native: unknown,
  view: unknown,
): void {
  cache.cells.push(cache.storage.create(native, view, true));
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
