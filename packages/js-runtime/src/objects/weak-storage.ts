import {
  createKeyIndex,
  type KeyIndex,
} from "@tint/foundation/collections/key-index";
import { ensureExoticSlots, exoticSlots } from "./operations.ts";
import { viewObjectValue } from "./values.ts";
import { viewSymbolValue, registeredSymbolKey } from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";
/** Host capability implementing real weak reachability. Handles themselves are
 * strongly held; neither they nor this service may strongly retain a key.
 * Ephemeron values are retained only while the key is independently reachable. */
export interface WeakStorageService {
  create(key: unknown, value: unknown, ephemeron: boolean): unknown;
  key(cell: unknown): unknown;
  value(cell: unknown): unknown;
  setValue(cell: unknown, value: unknown): void;
  clear(cell: unknown): void;
}
/** Object-keyed cells are indexed by the key's agent-unique identity, a number,
 * so the index never strongly retains a key. Symbol keys carry no identity and
 * stay in a short list. Dead cells are purged when the identity log doubles. */
export interface WeakCollectionData {
  readonly kind: "map" | "set";
  readonly storage: WeakStorageService;
  readonly objects: KeyIndex<number, unknown>;
  /** Identities of inserted object keys in insertion order, possibly stale. */
  identities: number[];
  readonly symbols: unknown[];
  purgeAt: number;
}
export function createWeakCollectionData(
  kind: "map" | "set",
  storage: WeakStorageService,
): WeakCollectionData {
  return {
    kind,
    storage,
    objects: createKeyIndex<number, unknown>(
      (identity: number): number => identity >>> 0,
    ),
    identities: [],
    symbols: [],
    purgeAt: 64,
  };
}
export function canBeHeldWeakly(value: unknown, realm: ErrorRealm): boolean {
  const symbol = viewSymbolValue(value);
  if (symbol !== undefined)
    return registeredSymbolKey(realm.symbolRegistry, symbol) === undefined;
  return viewObjectValue(value, realm.objectPrototype) !== undefined;
}
/** The live cell for a key that can be held weakly; never assigns an identity. */
export function findWeakCell(
  data: WeakCollectionData,
  key: unknown,
  realm: ErrorRealm,
): unknown {
  const object = viewObjectValue(key, realm.objectPrototype);
  if (object !== undefined) {
    const identity = exoticSlots(object).internalIdentity;
    if (identity === 0) return undefined;
    const cell = data.objects.get(identity);
    return cell !== undefined && data.storage.key(cell) === key
      ? cell
      : undefined;
  }
  for (const cell of data.symbols)
    if (data.storage.key(cell) === key) return cell;
  return undefined;
}
/** Insert a cell for a key known to be absent. */
export function addWeakCell(
  data: WeakCollectionData,
  key: unknown,
  cell: unknown,
  realm: ErrorRealm,
): void {
  const object = viewObjectValue(key, realm.objectPrototype);
  if (object === undefined) {
    purgeSymbolCells(data);
    data.symbols.push(cell);
    return;
  }
  let identity = exoticSlots(object).internalIdentity;
  if (identity === 0) {
    identity = realm.agent.nextObjectIdentity;
    realm.agent.nextObjectIdentity = identity + 1;
    ensureExoticSlots(object).internalIdentity = identity;
  }
  data.objects.set(identity, cell);
  data.identities.push(identity);
  if (data.identities.length >= data.purgeAt) purgeWeakCells(data);
}
/** Remove the cell of a present key. */
export function deleteWeakCell(
  data: WeakCollectionData,
  key: unknown,
  cell: unknown,
  realm: ErrorRealm,
): void {
  data.storage.clear(cell);
  const object = viewObjectValue(key, realm.objectPrototype);
  if (object !== undefined)
    data.objects.delete(exoticSlots(object).internalIdentity);
  else purgeSymbolCells(data);
}
function purgeSymbolCells(data: WeakCollectionData): void {
  for (let index = data.symbols.length - 1; index >= 0; index--) {
    const cell = data.symbols[index];
    if (data.storage.key(cell) === undefined) {
      data.storage.clear(cell);
      data.symbols.splice(index, 1);
    }
  }
}
/** Drop cells whose keys died plus stale or repeated identities; runs when
 * the log doubles, so it is amortized O(1) per insertion. */
export function purgeWeakCells(data: WeakCollectionData): void {
  const live: number[] = [],
    // A key deleted and inserted again is logged twice; keep one entry.
    kept = createKeyIndex<number, boolean>(
      (identity: number): number => identity >>> 0,
    );
  const identities = data.identities;
  for (let index = 0; index < identities.length; index++) {
    const identity = identities[index];
    if (identity === undefined) throw "WEAK_IDENTITY_INVARIANT";
    const cell = data.objects.get(identity);
    if (cell === undefined || kept.has(identity)) continue;
    if (data.storage.key(cell) === undefined) {
      data.storage.clear(cell);
      data.objects.delete(identity);
    } else {
      live.push(identity);
      kept.set(identity, true);
    }
  }
  data.identities = live;
  data.purgeAt = live.length * 2 > 64 ? live.length * 2 : 64;
}

export interface WeakReferenceData {
  readonly kind: "ref";
  readonly storage: WeakStorageService;
  readonly cell: unknown;
}
export interface RegistryCell {
  readonly target: unknown;
  readonly held: unknown;
  readonly token: unknown;
}
export interface WeakRegistryData {
  readonly kind: "registry";
  readonly storage: WeakStorageService;
  readonly realm: ErrorRealm;
  readonly cleanup: unknown;
  readonly cells: RegistryCell[];
  scheduled: boolean;
}
export interface WeakRegistryEntry {
  readonly storage: WeakStorageService;
  readonly cell: unknown;
}
export type WeakData =
  WeakCollectionData | WeakReferenceData | WeakRegistryData;
