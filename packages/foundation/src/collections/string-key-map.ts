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
import { hashString } from "./key-index.ts";

// Map<string, V> operations with the key type fixed, so hashing never boxes the
// key through a generic type test. String keys use the shared string hash. Storage and
// semantics are linked-map's; the runtime selects this module by key type.
function hashKey(key: string): number {
  return hashString(key);
}
export function createMap<V>(): LinkedMap<string, V> {
  return createGenericMap<string, V>();
}
export function hasMap<V>(map: LinkedMap<string, V>, key: string): boolean {
  return hasMapHashed<string, V>(map, key, hashKey(key));
}
export function getMap<V>(
  map: LinkedMap<string, V>,
  key: string,
): V | undefined {
  return getMapHashed<string, V>(map, key, hashKey(key));
}
export function setMap<V>(
  map: LinkedMap<string, V>,
  key: string,
  value: V,
): boolean {
  return setMapHashed<string, V>(map, key, value, hashKey(key));
}
export function deleteMap<V>(map: LinkedMap<string, V>, key: string): boolean {
  return deleteMapHashed<string, V>(map, key, hashKey(key));
}
export function clearMap<V>(map: LinkedMap<string, V>): void {
  clearGenericMap<string, V>(map);
}
export function sizeMap<V>(map: LinkedMap<string, V>): number {
  return sizeGenericMap<string, V>(map);
}
export function createMapCursor<V>(
  map: LinkedMap<string, V>,
): MapCursor<string, V> {
  return createGenericCursor<string, V>(map);
}
export function advanceMapCursor<V>(cursor: MapCursor<string, V>): boolean {
  return advanceGenericCursor<string, V>(cursor);
}
export function readMapCursorKey<V>(cursor: MapCursor<string, V>): string {
  return readGenericKey<string, V>(cursor);
}
export function readMapCursorValue<V>(cursor: MapCursor<string, V>): V {
  return readGenericValue<string, V>(cursor);
}
