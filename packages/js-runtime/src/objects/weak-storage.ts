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
export interface WeakCollectionData {
  readonly kind: "map" | "set";
  readonly storage: WeakStorageService;
  readonly cells: unknown[];
}
export function canBeHeldWeakly(value: unknown, realm: ErrorRealm): boolean {
  const symbol = viewSymbolValue(value);
  if (symbol !== undefined)
    return registeredSymbolKey(realm.symbolRegistry, symbol) === undefined;
  return viewObjectValue(value, realm.objectPrototype) !== undefined;
}
/** Never materialize a strong key index alongside the weak cells. */
export function findWeakCell(data: WeakCollectionData, key: unknown): unknown {
  for (const cell of data.cells)
    if (data.storage.key(cell) === key) return cell;
  return undefined;
}
export function purgeWeakCells(data: WeakCollectionData): void {
  for (let index = data.cells.length - 1; index >= 0; index--) {
    const cell = data.cells[index];
    if (data.storage.key(cell) === undefined) {
      data.storage.clear(cell);
      data.cells.splice(index, 1);
    }
  }
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
