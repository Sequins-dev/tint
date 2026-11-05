import { createKeyIndex } from "@tint/foundation/collections/key-index";
import type { Type } from "../types/index.ts";

function fingerprint(members: readonly number[]): number {
  let hash = members.length;
  for (const member of members) {
    if (member === undefined) throw "union member invariant";
    hash = (hash + member * 31) >>> 0;
  }
  return hash;
}
/** Index an append-only type table. Queries contain distinct members. Hashes
 * select candidates only; exact membership preserves the first matching ID. */
export function createUnionIndex(types: readonly Type[]): {
  readonly find: (members: readonly number[]) => number | undefined;
} {
  const buckets = createKeyIndex<number, number[]>((key) => key);
  let indexed = 0;
  return {
    find: (members) => {
      while (indexed < types.length) {
        const id = indexed++,
          type = types[id];
        if (type === undefined) throw "union type invariant";
        if (type.kind !== "union") continue;
        const hash = fingerprint(type.members);
        let bucket = buckets.get(hash);
        if (bucket === undefined) {
          bucket = [];
          buckets.set(hash, bucket);
        }
        bucket.push(id);
      }
      const candidates = buckets.get(fingerprint(members));
      if (candidates === undefined) return undefined;
      for (const id of candidates) {
        if (id === undefined) throw "union candidate invariant";
        const type = types[id];
        if (type === undefined || type.kind !== "union")
          throw "union index invariant";
        if (type.members.length !== members.length) continue;
        let same = true;
        for (const member of members) {
          if (member === undefined) throw "union query invariant";
          if (!type.members.includes(member)) {
            same = false;
            break;
          }
        }
        if (same) return id;
      }
      return undefined;
    },
  };
}
