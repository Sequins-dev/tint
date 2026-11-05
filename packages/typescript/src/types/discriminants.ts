import {
  createKeyIndex,
  hashString,
  type KeyIndex,
} from "@tint/foundation/collections/key-index";
import type { Type } from "./index.ts";
interface IndexedUnion {
  readonly property: string;
  readonly buckets: KeyIndex<string, number[]> | undefined;
}
/** Conservative candidate filtering over an immutable, append-only type graph.
 * Only a required string-literal property shared by every target variant is
 * indexed. undefined means the general relation solver must consider all
 * members; an empty array proves no variant can match this discriminant.
 * Candidate arrays preserve union order and are immutable to callers. */
export function createDiscriminantIndex(types: readonly Type[]): {
  readonly candidates: (
    actual: number,
    union: number,
  ) => readonly number[] | undefined;
} {
  const cached: (IndexedUnion | undefined)[] = [],
    empty: readonly number[] = [];
  const unindexed: IndexedUnion = { property: "", buckets: undefined };
  function literal(object: number, name: string): string | undefined {
    const type = types[object];
    if (type === undefined || type.kind !== "object") return undefined;
    for (const property of type.properties) {
      if (property === undefined) throw "discriminant property invariant";
      if (property.name !== name) continue;
      if (property.optional === true) return undefined;
      const value = types[property.type];
      if (value !== undefined && value.kind === "literal") {
        const tag = value.value;
        if (typeof tag === "string") return tag;
      }
      return undefined;
    }
    return undefined;
  }
  function build(id: number): IndexedUnion {
    const union = types[id];
    if (union === undefined || union.kind !== "union") return unindexed;
    const firstId = union.members[0],
      first = firstId === undefined ? undefined : types[firstId];
    if (first === undefined || first.kind !== "object") return unindexed;
    for (const property of first.properties) {
      if (property === undefined) throw "discriminant property invariant";
      let complete = true;
      for (const member of union.members) {
        if (member === undefined) throw "discriminant member invariant";
        if (literal(member, property.name) === undefined) {
          complete = false;
          break;
        }
      }
      if (!complete) continue;
      const buckets = createKeyIndex<string, number[]>((key: string): number =>
        hashString(key),
      );
      for (const member of union.members) {
        if (member === undefined) throw "discriminant member invariant";
        const value = literal(member, property.name);
        if (value === undefined) throw "proved discriminant invariant";
        let bucket = buckets.get(value);
        if (bucket === undefined) {
          bucket = [];
          buckets.set(value, bucket);
        }
        bucket.push(member);
      }
      return { property: property.name, buckets };
    }
    return unindexed;
  }
  return {
    candidates: (actual, union) => {
      const source = types[actual],
        target = types[union];
      if (
        source === undefined ||
        source.kind !== "object" ||
        target === undefined ||
        target.kind !== "union"
      )
        return undefined;
      let entry = cached[union];
      if (entry === undefined) {
        entry = build(union);
        cached[union] = entry;
      }
      const buckets = entry.buckets;
      if (buckets === undefined) return undefined;
      const key = literal(actual, entry.property);
      if (key === undefined) return undefined;
      return buckets.get(key) ?? empty;
    },
  };
}
