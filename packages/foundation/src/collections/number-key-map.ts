import {
  createMap as createGenericMap,
  hasMapHashed,
  getMapHashed,
  setMapHashed,
  deleteMapHashed,
  clearMap as clearGenericMap,
  sizeMap as sizeGenericMap,
  createMapCursor as createGenericCursor,
  advanceMapCursor as advanceGenericCursor,
  readMapCursorKey as readGenericKey,
  readMapCursorValue as readGenericValue,
  type LinkedMap,
  type MapCursor,
} from "./linked-map.ts";

// Map<number, V> operations with the key type fixed, so hashing never boxes the
// key through a generic type test. Number keys hash as uint32 (SameValueZero folds -0 and NaN to bucket 0 like the generic map). Storage and
// semantics are linked-map's; the runtime selects this module by key type.
function hashKey(key: number): number {
  return key >>> 0;
}
export function createMap<V>(): LinkedMap<number, V> {
  return createGenericMap<number, V>();
}
export function hasMap<V>(map: LinkedMap<number, V>, key: number): boolean {
  return hasMapHashed<number, V>(map, key, hashKey(key));
}
export function getMap<V>(
  map: LinkedMap<number, V>,
  key: number,
): V | undefined {
  return getMapHashed<number, V>(map, key, hashKey(key));
}
export function setMap<V>(
  map: LinkedMap<number, V>,
  key: number,
  value: V,
): boolean {
  return setMapHashed<number, V>(map, key, value, hashKey(key));
}
export function deleteMap<V>(map: LinkedMap<number, V>, key: number): boolean {
  return deleteMapHashed<number, V>(map, key, hashKey(key));
}
export function clearMap<V>(map: LinkedMap<number, V>): void {
  clearGenericMap<number, V>(map);
}
export function sizeMap<V>(map: LinkedMap<number, V>): number {
  return sizeGenericMap<number, V>(map);
}
export function createMapCursor<V>(
  map: LinkedMap<number, V>,
): MapCursor<number, V> {
  return createGenericCursor<number, V>(map);
}
export function advanceMapCursor<V>(cursor: MapCursor<number, V>): boolean {
  return advanceGenericCursor<number, V>(cursor);
}
export function readMapCursorKey<V>(cursor: MapCursor<number, V>): number {
  return readGenericKey<number, V>(cursor);
}
export function readMapCursorValue<V>(cursor: MapCursor<number, V>): V {
  return readGenericValue<number, V>(cursor);
}
