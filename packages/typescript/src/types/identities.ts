import {
  createNumberIndex,
  hashString,
} from "@tint/foundation/collections/key-index";
import type { Type } from "./index.ts";

function mix(hash: number, value: number): number {
  return (hash * 31 + value) >>> 0;
}
function fingerprint(type: Type): number {
  let hash = hashString(type.kind);
  switch (type.kind) {
    case "literal": {
      const value = type.value;
      return mix(
        hash,
        typeof value === "string"
          ? hashString(value)
          : typeof value === "number"
            ? value >>> 0
            : value
              ? 1
              : 0,
      );
    }
    case "array":
    case "set":
      return mix(mix(hash, type.element), type.readonly ? 1 : 0);
    case "map":
      return mix(mix(mix(hash, type.key), type.value), type.readonly ? 1 : 0);
    case "union":
      for (const member of type.members) {
        if (member === undefined) throw "type identity member invariant";
        hash = mix(hash, member);
      }
      return hash;
    case "object":
      hash = mix(
        mix(hash, type.call === undefined ? 0 : type.call + 1),
        type.construct === undefined ? 0 : type.construct + 1,
      );
      for (const property of type.properties) {
        if (property === undefined) throw "type identity property invariant";
        hash = mix(
          mix(mix(hash, hashString(property.name)), property.type),
          (property.readonly ? 1 : 0) + (property.optional ? 2 : 0),
        );
      }
      return hash;
    case "function":
      hash = mix(hash, type.receiver === undefined ? 0 : type.receiver + 1);
      hash = mix(
        mix(hash, type.result),
        type.minimumArguments ?? type.parameters.length,
      );
      for (const parameter of type.parameters) {
        if (parameter === undefined) throw "type identity parameter invariant";
        hash = mix(hash, parameter);
      }
      return hash;
    case "Uint8Array": {
      const view = type.view;
      return view === undefined ? hash : mix(hash, hashString(view));
    }
    default:
      return hash;
  }
}
function same(left: Type, right: Type): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "literal":
      return right.kind === "literal" && left.value === right.value;
    case "array":
    case "set":
      return (
        (right.kind === "array" || right.kind === "set") &&
        left.element === right.element &&
        left.readonly === right.readonly
      );
    case "map":
      return (
        right.kind === "map" &&
        left.key === right.key &&
        left.value === right.value &&
        left.readonly === right.readonly
      );
    case "union":
      if (
        right.kind !== "union" ||
        left.members.length !== right.members.length
      )
        return false;
      for (let i = 0; i < left.members.length; i++)
        if (left.members[i] !== right.members[i]) return false;
      return true;
    case "object":
      if (
        right.kind !== "object" ||
        left.call !== right.call ||
        left.construct !== right.construct ||
        left.properties.length !== right.properties.length
      )
        return false;
      for (let i = 0; i < left.properties.length; i++) {
        const a = left.properties[i],
          b = right.properties[i];
        if (a === undefined || b === undefined)
          throw "type identity property invariant";
        if (
          a.name !== b.name ||
          a.type !== b.type ||
          a.readonly !== b.readonly ||
          (a.optional === true) !== (b.optional === true)
        )
          return false;
      }
      return true;
    case "function":
      if (
        right.kind !== "function" ||
        left.result !== right.result ||
        left.receiver !== right.receiver ||
        left.parameters.length !== right.parameters.length ||
        (left.minimumArguments ?? left.parameters.length) !==
          (right.minimumArguments ?? right.parameters.length)
      )
        return false;
      for (let i = 0; i < left.parameters.length; i++)
        if (left.parameters[i] !== right.parameters[i]) return false;
      return true;
    case "Uint8Array":
      return right.kind === "Uint8Array" && left.view === right.view;
    default:
      return true;
  }
}
/** Exact descriptions in a validated immutable graph. The caller may append types
 * and interns each new ID once, in order. Child IDs and member order remain exact:
 * this deliberately does not infer recursive structural equivalence. Hashes select
 * candidates only; full comparison establishes identity. No public IDs are changed. */
export function createTypeIdentityIndex(
  types: readonly Type[],
): (id: number) => number {
  const buckets = createNumberIndex(),
    heads: number[] = [],
    links: number[] = [];
  return (id) => {
    const type = types[id];
    if (type === undefined) throw "type identity invariant";
    const bucket = buckets.intern(fingerprint(type)),
      head = heads[bucket] ?? 0;
    let candidate = head;
    while (candidate !== 0) {
      const prior = types[candidate - 1];
      if (prior === undefined) throw "type identity candidate invariant";
      if (same(type, prior)) return candidate - 1;
      candidate = links[candidate - 1] ?? 0;
    }
    links[id] = head;
    heads[bucket] = id + 1;
    return id;
  };
}
