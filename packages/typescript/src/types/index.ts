import { createTypeIdentityIndex } from "./identities.ts";
import { growRelationStorage } from "./relation-storage.ts";
import { createDiscriminantIndex } from "./discriminants.ts";
import {
  createNumberIndex,
  hashString,
} from "@tint/foundation/collections/key-index";
export interface Property {
  readonly hasInstanceSymbol?: boolean;
  readonly optional?: boolean;
  readonly name: string;
  readonly type: number;
  readonly readonly: boolean;
}
export interface StringIndex {
  readonly type: number;
  readonly readonly: boolean;
  readonly origin: "signature" | "record";
}
/** Typed-array kinds with a native representation; the BigInt kinds are
 * realm objects (their elements need a BigInt representation). */
export type NativeTypedArrayKind =
  | "Uint8Array"
  | "Int8Array"
  | "Uint8ClampedArray"
  | "Uint16Array"
  | "Int16Array"
  | "Uint32Array"
  | "Int32Array"
  | "Float32Array"
  | "Float64Array";
export const nativeTypedArrayKinds: readonly NativeTypedArrayKind[] = [
  "Uint8Array",
  "Int8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
];
/** The native typed-array kind a type kind or constructor name denotes. */
export function nativeTypedArrayKind(
  kind: string | undefined,
): NativeTypedArrayKind | undefined {
  // Optional strings cannot be switched on natively.
  if (kind === undefined) return undefined;
  switch (kind) {
    case "Uint8Array":
      return "Uint8Array";
    case "Int8Array":
      return "Int8Array";
    case "Uint8ClampedArray":
      return "Uint8ClampedArray";
    case "Uint16Array":
      return "Uint16Array";
    case "Int16Array":
      return "Int16Array";
    case "Uint32Array":
      return "Uint32Array";
    case "Int32Array":
      return "Int32Array";
    case "Float32Array":
      return "Float32Array";
    case "Float64Array":
      return "Float64Array";
    default:
      return undefined;
  }
}
/** Whether a type kind or name is a native typed-array kind. */
export function isNativeTypedArrayKind(kind: string | undefined): boolean {
  return nativeTypedArrayKind(kind) !== undefined;
}
export type Type =
  | {
      readonly kind:
        | "number"
        | "boolean"
        | "undefined"
        | "null"
        | "string"
        | "bigint"
        | "TypeError"
        | "RangeError"
        | "Error"
        | "ArrayBuffer"
        | NativeTypedArrayKind
        | "void"
        | "unknown"
        | "realm-callable"
        | "dynamic-result"
        | "void-value"
        | "never";
      /** Uint8Array only: a C view (checker/c-views.ts) of the record or
       * fixed array with this key. Views are nominal: a view relates to
       * Uint8Array and to views of the same key, never the reverse. */
      readonly view?: string;
      /** A typed-array flow fact retains a general carrier. */
      readonly arrayFlow?: boolean;
    }
  | { readonly kind: "literal"; readonly value: string | number | boolean }
  | {
      readonly kind: "array" | "set";
      readonly element: number;
      readonly realmArray?: boolean;
      readonly tupleElements?: readonly number[];
      readonly readonly: boolean;
    }
  | {
      readonly kind: "map";
      readonly key: number;
      readonly value: number;
      readonly readonly: boolean;
    }
  | { readonly kind: "union"; readonly members: readonly number[] }
  | {
      readonly kind: "object";
      readonly properties: readonly Property[];
      readonly stringIndex?: StringIndex;
      readonly realmRecord?: boolean;
      readonly iteratorElement?: number | undefined;
      /** An interface without an index does not imply one from its fields. */
      readonly interfaceDeclaration?: boolean;
      /** Function-signature IDs for independent internal call/construct capabilities. */
      readonly call?: number;
      readonly construct?: number;
      readonly realmConstructor?: boolean;
      readonly realmLibrary?: string;
      readonly realmTypedArray?: string;
    }
  | {
      readonly kind: "function";
      readonly parameters: readonly number[];
      readonly minimumArguments?: number;
      /** The last parameter is the array collecting trailing call arguments. */
      readonly rest?: boolean;
      /** Required receiver type; absent means the function does not constrain its receiver. */
      readonly receiver?: number;
      readonly result: number;
      readonly instancePredicate?: number;
      /** Declared with method syntax (`m(): T`) in an interface or object
       * type: a member call passes its object as the receiver, so a function
       * requiring a receiver relates to it, and method properties relate
       * covariantly (TypeScript's method bivariance). */
      readonly method?: boolean;
    };
export type ErrorCode =
  | "INVALID_TYPE"
  | "LIMIT"
  | "TYPE_MISMATCH"
  | "ARITY"
  | "PROPERTY"
  | "IMMUTABLE";
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ErrorCode };
export interface Cell {
  readonly type: number;
  readonly mutable: boolean;
}
export type CellOperation =
  | { readonly kind: "read" }
  | { readonly kind: "initialize" | "write"; readonly value: number };
export interface CheckedCellOperation {
  readonly kind: "read" | "initialize" | "write";
  readonly type: number;
  readonly guard: "initialized" | "uninitialized";
  readonly publishInitialized: boolean;
}
export interface ObjectValue {
  readonly optional?: boolean;
  readonly name: string;
  readonly type: number;
}
export interface TypeSystem {
  /** Append a copied type referring only to existing IDs; failures preserve the graph. */
  readonly append: (type: Type) => Result<number>;
  readonly assignable: (actual: number, expected: number) => boolean;
  /** Whether any relation considered ignoring a physically returned result. */
  readonly usesVoidResultDiscard: () => boolean;
  /** Kind set of a type as a bit mask: assignable(a, b) implies that
   * kindMask(a) is a subset of kindMask(b). Unions hold their members' kinds,
   * literals their value's kind, never none, and unknown every kind; objects
   * and functions share one kind. */
  readonly kindMask: (id: number) => number;
  /** Depth-limited structural hash for the exact relation that mutable
   * properties, mutable element types and union members use: exactly
   * related types always share an exact shape, so differing shapes prove a
   * mutable property can never relate. Equal shapes prove nothing. */
  readonly exactShape: (id: number) => number;
  readonly call: (
    callee: number,
    arguments_: readonly number[],
    receiver?: number,
  ) => Result<number>;
  readonly construct: (
    callee: number,
    arguments_: readonly number[],
  ) => Result<number>;
  readonly object: (
    target: number,
    properties: readonly ObjectValue[],
  ) => Result<number>;
  readonly property: (object: number, name: string) => Result<number>;
  readonly writeProperty: (
    object: number,
    name: string,
    value: number,
  ) => Result<number>;
  readonly cell: (
    cell: Cell,
    operation: CellOperation,
  ) => Result<CheckedCellOperation>;
}
/** Finite structural type graphs; references may point forward or recurse through objects/functions. */
export function createTypeSystem(input: readonly Type[]): Result<TypeSystem> {
  const types: Type[] = [],
    edges: (readonly number[])[] = [],
    wideningCandidates: number[] = [];
  function rememberWideningCandidate(id: number, kind: string): void {
    if (
      kind === "number" ||
      kind === "boolean" ||
      kind === "string" ||
      kind === "union"
    )
      wideningCandidates.push(id);
  }
  for (let id = 0; id < input.length; id++) {
    const t = input[id];
    if (t === undefined) return { ok: false, error: "INVALID_TYPE" };
    const copied = copyType(t, input);
    if (!copied.ok) return copied;
    types.push(copied.value.type);
    rememberWideningCandidate(id, copied.value.type.kind);
    edges.push(copied.value.refs);
  }
  // Reject unproductive union cycles; object/function edges provide recursive structure.
  const unionActive = new Uint8Array(types.length),
    unionDone = new Uint8Array(types.length);
  function unionCycle(id: number): boolean {
    if (types[id]?.kind !== "union" || unionDone[id] === 1) return false;
    if (unionActive[id] === 1) return true;
    unionActive[id] = 1;
    for (const ref of edges[id] ?? [])
      if (ref === undefined || unionCycle(ref)) return true;
    unionActive[id] = 0;
    unionDone[id] = 1;
    return false;
  }
  // Bound recursion before traversing union components; cycles stop at active references.
  let depths = new Uint8Array(types.length);
  const active = new Uint8Array(types.length);
  function graphDepth(id: number, path: number): number {
    if (path > 64) return 65;
    if (active[id] === 1) return 0;
    const known = depths[id];
    if (known !== undefined && known !== 0) return known;
    active[id] = 1;
    let depth = 1;
    for (const ref of edges[id] ?? []) {
      if (ref === undefined) return 65;
      depth = Math.max(depth, 1 + graphDepth(ref, path + 1));
    }
    active[id] = 0;
    depths[id] = depth;
    return depth;
  }
  for (let id = 0; id < types.length; id++)
    if (graphDepth(id, 0) > 64) return { ok: false, error: "LIMIT" };
  for (let id = 0; id < types.length; id++)
    if (unionCycle(id)) return { ok: false, error: "INVALID_TYPE" };
  const identity = createTypeIdentityIndex(types);
  let canonicalIds = new Uint32Array(types.length);
  for (let id = 0; id < types.length; id++) {
    const canonical = identity(id),
      type = types[canonical];
    if (type === undefined) throw "canonical type invariant";
    canonicalIds[id] = canonical;
    types[id] = type;
  }
  function append(type: Type): Result<number> {
    const copied = copyType(type, types);
    if (!copied.ok) return copied;
    let depth = 1;
    for (const ref of copied.value.refs) {
      if (ref === undefined) return { ok: false, error: "INVALID_TYPE" };
      const prior = depths[ref];
      if (prior === undefined || prior === 0)
        return { ok: false, error: "INVALID_TYPE" };
      depth = Math.max(depth, prior + 1);
    }
    if (depth > 64) return { ok: false, error: "LIMIT" };
    const id = types.length;
    if (id >= depths.length) {
      const grown = new Uint8Array(Math.max(16, depths.length * 2));
      grown.set(depths);
      depths = grown;
      const canonical = new Uint32Array(grown.length);
      canonical.set(canonicalIds);
      canonicalIds = canonical;
    }
    growRelationCache(id + 1);
    types.push(copied.value.type);
    const canonical = identity(id),
      shared = types[canonical];
    if (shared === undefined) throw "canonical appended type invariant";
    canonicalIds[id] = canonical;
    types[id] = shared;
    rememberWideningCandidate(id, copied.value.type.kind);
    depths[id] = depth;
    return { ok: true, value: id };
  }
  function valid(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < types.length;
  }
  let relationCapacity = 16;
  while (relationCapacity < types.length * 4 && relationCapacity < 65536)
    relationCapacity *= 2;
  let relationActual = new Uint32Array(relationCapacity),
    relationExpected = new Uint32Array(relationCapacity),
    relationResults = new Uint8Array(relationCapacity),
    relationMask = relationCapacity - 1;
  function growRelationCache(typeCount: number): void {
    let capacity = relationCapacity;
    while (capacity < typeCount * 4 && capacity < 65536) capacity *= 2;
    if (capacity === relationCapacity) return;
    const actuals = new Uint32Array(capacity),
      expected = new Uint32Array(capacity),
      results = new Uint8Array(capacity),
      mask = capacity - 1;
    for (let old = 0; old < relationCapacity; old++) {
      const result = relationResults[old] ?? 0;
      if (result === 0) continue;
      const a = relationActual[old] ?? 0,
        b = relationExpected[old] ?? 0,
        index = ((a * 31) ^ b ^ (result >= 3 ? 40503 : 0)) & mask;
      actuals[index] = a;
      expected[index] = b;
      results[index] = result;
    }
    relationActual = actuals;
    relationExpected = expected;
    relationResults = results;
    relationMask = mask;
    relationCapacity = capacity;
  }
  // Only completed relations are cached. Existing type definitions never
  // change, so append cannot invalidate their answers. Collisions replace hints.
  function cacheRelation(
    cache: number,
    actual: number,
    expected: number,
    answer: boolean,
    exact: boolean = false,
  ): boolean {
    relationActual[cache] = actual;
    relationExpected[cache] = expected;
    relationResults[cache] = exact ? (answer ? 4 : 3) : answer ? 2 : 1;
    return answer;
  }
  const discriminants = createDiscriminantIndex(types);
  function errorStringMember(id: number, optional: boolean): boolean {
    const type = types[id];
    if (type?.kind === "union")
      return type.members.every((member) =>
        errorStringMember(member, optional),
      );
    return (
      type?.kind === "string" ||
      (type?.kind === "literal" && typeof type.value === "string") ||
      (optional && type?.kind === "undefined")
    );
  }
  function errorContract(source: Type): boolean {
    if (source.kind === "RangeError" || source.kind === "TypeError")
      return true;
    if (source.kind !== "object") return false;
    const name = source.properties.find(
      (field) => field !== undefined && field.name === "name",
    );
    const message = source.properties.find(
      (field) => field !== undefined && field.name === "message",
    );
    const stack = source.properties.find(
      (field) => field !== undefined && field.name === "stack",
    );
    return (
      name !== undefined &&
      !name.optional &&
      errorStringMember(name.type, false) &&
      message !== undefined &&
      !message.optional &&
      errorStringMember(message.type, false) &&
      (stack === undefined || errorStringMember(stack.type, true))
    );
  }
  function assignable(actual: number, expected: number): boolean {
    return valid(actual) && valid(expected) && relates(actual, expected);
  }
  /** A property declared with method syntax (see the function type's
   * `method`): it relates covariantly even when writable. */
  function methodProperty(type: number): boolean {
    const declared = types[canonicalIds[type] ?? type];
    return declared?.kind === "function" && declared.method === true;
  }
  // Private callers use validated IDs from the immutable graph or validate their
  // public arguments first. Recursive edges cannot introduce an invalid ID.
  function relates(actual: number, expected: number): boolean {
    actual = canonicalIds[actual] ?? actual;
    expected = canonicalIds[expected] ?? expected;
    if (actual === expected) return true;
    const cache = ((actual * 31) ^ expected) & relationMask,
      cached = relationResults[cache];
    if (
      cached !== undefined &&
      (cached === 1 || cached === 2) &&
      relationActual[cache] === actual &&
      relationExpected[cache] === expected
    )
      return cached === 2;
    const scalar = types[actual],
      targetType = types[expected];
    if (scalar === undefined || targetType === undefined)
      throw "relation type invariant";
    if (scalar.kind === "union") {
      let answer = true;
      for (const member of scalar.members) {
        if (member === undefined) throw "relation member invariant";
        if (!relates(member, expected)) {
          answer = false;
          break;
        }
      }
      return cacheRelation(cache, actual, expected, answer);
    }
    // Union-only cycles are rejected during validation. For a non-union
    // source, alternatives can therefore be queried independently and stop at
    // the first success, without creating a coinductive work graph for them.
    {
      if (
        (scalar.kind === "void-value" && targetType.kind === "void") ||
        (scalar.kind === "undefined" && targetType.kind === "void-value")
      )
        return cacheRelation(cache, actual, expected, true);
      if (targetType.kind === "Error" && scalar.kind !== "never")
        return cacheRelation(cache, actual, expected, errorContract(scalar));
      if (targetType.kind === "unknown" || targetType.kind === "dynamic-result")
        return cacheRelation(cache, actual, expected, scalar.kind !== "void");
      if (targetType.kind === "union") {
        let answer = false;
        const candidates =
          discriminants.candidates(actual, expected) ?? targetType.members;
        for (const member of candidates) {
          if (member === undefined) throw "relation member invariant";
          if (relates(actual, member)) {
            answer = true;
            break;
          }
        }
        return cacheRelation(cache, actual, expected, answer);
      }
      if (
        scalar.kind !== "never" &&
        scalar.kind !== "literal" &&
        scalar.kind !== targetType.kind &&
        !(
          (scalar.kind === "object" && targetType.kind === "function") ||
          (scalar.kind === "function" && targetType.kind === "object")
        )
      )
        return cacheRelation(cache, actual, expected, false);
    }
    if (
      scalar.kind !== "object" &&
      scalar.kind !== "function" &&
      scalar.kind !== "array" &&
      scalar.kind !== "set" &&
      scalar.kind !== "map"
    ) {
      let answer = false;
      if (scalar.kind === "never") answer = true;
      else if (scalar.kind === "literal") {
        answer =
          targetType.kind === "literal"
            ? scalar.value === targetType.value
            : typeof scalar.value === targetType.kind;
      } else answer = primitiveRelation(scalar, targetType, false);
      return cacheRelation(cache, actual, expected, answer);
    }
    const proof = objectRelation(scalar, targetType, false);
    return cacheRelation(
      cache,
      actual,
      expected,
      proof === undefined ? solveRelation(actual, expected) : proof,
    );
  }
  let scalarWork = 0;
  // A bounded, allocation-free proof for primitive fields and covariant unions.
  // Unknown results defer to the recursive structural relation solver.
  function scalarRelation(
    a: number,
    b: number,
    exact: boolean,
  ): boolean | undefined {
    a = canonicalIds[a] ?? a;
    b = canonicalIds[b] ?? b;
    scalarWork--;
    if (scalarWork < 0) return undefined;
    if (a === b) return true;
    const cache = ((a * 31) ^ b ^ (exact ? 40503 : 0)) & relationMask,
      cached = relationResults[cache] ?? 0;
    if (
      (exact ? cached === 3 || cached === 4 : cached === 1 || cached === 2) &&
      relationActual[cache] === a &&
      relationExpected[cache] === b
    )
      return cached === 2 || cached === 4;
    const answer = computeScalarRelation(a, b, exact);
    // Only a completed proof may enter the shared immutable-graph cache.
    // Budget exhaustion or an unresolved structural edge remains unknown.
    return answer === undefined
      ? undefined
      : cacheRelation(cache, a, b, answer, exact);
  }
  function computeScalarRelation(
    a: number,
    b: number,
    exact: boolean,
  ): boolean | undefined {
    const source = types[a],
      target = types[b];
    if (source === undefined || target === undefined) return undefined;
    if (!exact && source.kind === "never") return true;
    if (!exact && source.kind === "void-value" && target.kind === "void")
      return true;
    if (!exact && source.kind === "undefined" && target.kind === "void-value")
      return true;
    if (!exact && target.kind === "Error" && source.kind !== "union")
      return source.kind === "Error" || errorContract(source);
    if (
      !exact &&
      (target.kind === "unknown" || target.kind === "dynamic-result")
    )
      return source.kind !== "void";
    if (source.kind === "union") {
      if (exact) return undefined;
      let known = true;
      for (const member of source.members) {
        if (member === undefined) throw "union member invariant";
        const answer = scalarRelation(member, b, false);
        if (answer === false) return false;
        if (answer === undefined) known = false;
      }
      return known ? true : undefined;
    }
    if (target.kind === "union") {
      if (exact) return undefined;
      let known = true;
      for (const member of target.members) {
        if (member === undefined) throw "union member invariant";
        const answer = scalarRelation(a, member, false);
        if (answer === true) return true;
        if (answer === undefined) known = false;
      }
      return known ? false : undefined;
    }
    if (source.kind === "literal")
      return target.kind === "literal"
        ? source.value === target.value
        : !exact && typeof source.value === target.kind;
    if (
      source.kind === "object" ||
      source.kind === "function" ||
      source.kind === "array" ||
      source.kind === "set" ||
      source.kind === "map" ||
      target.kind === "object" ||
      target.kind === "function" ||
      target.kind === "array" ||
      target.kind === "set" ||
      target.kind === "map"
    )
      return undefined;
    return primitiveRelation(source, target, exact);
  }
  function objectRelation(
    source: Type,
    target: Type,
    exact: boolean,
  ): boolean | undefined {
    if (source.kind !== "object" || target.kind !== "object") return undefined;
    if ((source.realmRecord === true) !== (target.realmRecord === true))
      return false;
    const offered = source.iteratorElement,
      required = target.iteratorElement;
    if (
      (required !== undefined && offered === undefined) ||
      (exact && offered !== undefined && required === undefined)
    )
      return false;
    const sourceIndex = source.stringIndex,
      targetIndex = target.stringIndex,
      indexed = sourceIndex !== undefined || targetIndex !== undefined;
    if (exact && (sourceIndex === undefined) !== (targetIndex === undefined))
      return false;
    if (
      exact &&
      sourceIndex !== undefined &&
      targetIndex !== undefined &&
      sourceIndex.readonly !== targetIndex.readonly
    )
      return false;
    if (
      targetIndex !== undefined &&
      sourceIndex === undefined &&
      source.interfaceDeclaration === true
    )
      return false;
    if (exact && source.properties.length !== target.properties.length)
      return false;
    const calls = signaturePresence(source.call, target.call, exact),
      constructs = signaturePresence(source.construct, target.construct, exact);
    if (calls === false || constructs === false) return false;
    let known =
      calls === true &&
      constructs === true &&
      targetIndex === undefined &&
      required === undefined;
    for (const property of target.properties) {
      if (property === undefined) throw "property invariant";
      let matched = false;
      for (const candidate of source.properties) {
        if (candidate === undefined) throw "property invariant";
        if (candidate.name !== property.name) continue;
        if (
          (candidate.optional === true && property.optional !== true) ||
          ((exact || (!indexed && !property.readonly)) &&
            ((candidate.optional === true) !== (property.optional === true) ||
              candidate.readonly !== property.readonly))
        )
          return false;
        scalarWork = 256;
        const proof = scalarRelation(
          candidate.type,
          property.type,
          exact || (!indexed && !property.readonly),
        );
        if (proof === false) return false;
        if (proof === undefined) known = false;
        matched = true;
        break;
      }
      if (!matched && (exact || !indexed || property.optional !== true))
        return false;
    }
    return known ? true : undefined;
  }
  // Signature compatibility can recurse through the result's object type; leave
  // that proof to the coinductive solver after checking capability presence.
  function signaturePresence(
    actual: number | undefined,
    expected: number | undefined,
    exact: boolean,
  ): boolean | undefined {
    if (expected !== undefined && actual === undefined) return false;
    if (exact && (actual === undefined) !== (expected === undefined))
      return false;
    return expected === undefined ? true : undefined;
  }
  // Reused numeric scratch: queries are synchronous and do not reenter the solver.
  // Counts delimit valid prefixes, so a small query need not clear a large arena.
  const relationIds = createNumberIndex();
  let nodeActual: Float64Array = new Float64Array(0),
    nodeExpected: Float64Array = new Float64Array(0),
    nodeExact: Float64Array = new Float64Array(0),
    nodeValues: Float64Array = new Float64Array(0),
    nodeHeads: Float64Array = new Float64Array(0),
    clauseOwners: Float64Array = new Float64Array(0),
    clauseRemaining: Float64Array = new Float64Array(0),
    edgeClauses: Float64Array = new Float64Array(0),
    edgeNext: Float64Array = new Float64Array(0),
    pendingNodes: Float64Array = new Float64Array(0);
  let nodeCount = 0,
    clauseCount = 0,
    edgeCount = 0;
  function pair(a: number, b: number, exact: boolean): number {
    a = canonicalIds[a] ?? a;
    b = canonicalIds[b] ?? b;
    let id = nodeCount;
    if (types.length <= 67108864) {
      id = relationIds.intern((a * types.length + b) * 2 + (exact ? 1 : 0));
      if (id < nodeCount) return id;
    } else {
      for (let index = 0; index < nodeCount; index++)
        if (
          nodeActual[index] === a &&
          nodeExpected[index] === b &&
          nodeExact[index] === (exact ? 1 : 0)
        )
          return index;
    }
    if (id >= nodeActual.length) {
      nodeActual = growRelationStorage(nodeActual, id + 1);
      nodeExpected = growRelationStorage(nodeExpected, id + 1);
      nodeExact = growRelationStorage(nodeExact, id + 1);
      nodeValues = growRelationStorage(nodeValues, id + 1);
      nodeHeads = growRelationStorage(nodeHeads, id + 1);
      pendingNodes = growRelationStorage(pendingNodes, id + 1);
    }
    nodeActual[id] = a;
    nodeExpected[id] = b;
    nodeExact[id] = exact ? 1 : 0;
    nodeValues[id] = 1;
    nodeHeads[id] = -1;
    nodeCount++;
    return id;
  }
  function beginClause(owner: number): number {
    const id = clauseCount++;
    if (id >= clauseOwners.length) {
      clauseOwners = growRelationStorage(clauseOwners, id + 1);
      clauseRemaining = growRelationStorage(clauseRemaining, id + 1);
    }
    clauseOwners[id] = owner;
    clauseRemaining[id] = 0;
    return id;
  }
  function dependency(clause: number, child: number): void {
    const edge = edgeCount++;
    if (edge >= edgeClauses.length) {
      edgeClauses = growRelationStorage(edgeClauses, edge + 1);
      edgeNext = growRelationStorage(edgeNext, edge + 1);
    }
    edgeClauses[edge] = clause;
    edgeNext[edge] = nodeHeads[child] ?? -1;
    nodeHeads[child] = edge;
    clauseRemaining[clause] = (clauseRemaining[clause] ?? 0) + 1;
  }
  function endClause(clause: number): void {
    if (clauseRemaining[clause] === 0) {
      const owner = clauseOwners[clause];
      if (owner === undefined) throw "clause owner invariant";
      nodeValues[owner] = 0;
    }
  }
  let voidResultDiscard = false;
  function solveRelation(actual: number, expected: number): boolean {
    // AND-of-OR dependencies converge from true to the greatest fixed point.
    relationIds.clear();
    nodeCount = 0;
    clauseCount = 0;
    edgeCount = 0;
    const root = pair(actual, expected, false);
    for (let i = 0; i < nodeCount; i++) {
      const a = nodeActual[i],
        b = nodeExpected[i],
        exact = nodeExact[i] === 1;
      if (a === undefined || b === undefined) throw "relation node invariant";
      const source = types[a],
        target = types[b];
      if (source === undefined || target === undefined)
        throw "relation type invariant";
      if (a === b) continue;
      const cache = ((a * 31) ^ b ^ (exact ? 40503 : 0)) & relationMask;
      const answer = relationResults[cache];
      if (
        answer !== undefined &&
        (exact ? answer === 3 || answer === 4 : answer === 1 || answer === 2) &&
        relationActual[cache] === a &&
        relationExpected[cache] === b
      ) {
        nodeValues[i] = answer === 2 || answer === 4 ? 1 : 0;
        continue;
      }
      const proof = objectRelation(source, target, exact);
      if (proof !== undefined) {
        nodeValues[i] = proof ? 1 : 0;
        continue;
      }
      if (!exact && source.kind === "never") continue;
      else if (
        !exact &&
        ((source.kind === "void-value" && target.kind === "void") ||
          (source.kind === "undefined" && target.kind === "void-value"))
      )
        continue;
      else if (
        !exact &&
        (target.kind === "unknown" || target.kind === "dynamic-result")
      )
        nodeValues[i] = source.kind !== "void" ? 1 : 0;
      else if (!exact && source.kind === "union") {
        for (const member of source.members) {
          if (member === undefined) throw "union member invariant";
          dependency(beginClause(i), pair(member, b, false));
        }
      } else if (!exact && target.kind === "union") {
        const clause = beginClause(i);
        const candidates = discriminants.candidates(a, b) ?? target.members;
        for (const member of candidates) {
          if (member === undefined) throw "union member invariant";
          dependency(clause, pair(a, member, false));
        }
        endClause(clause);
      } else if (source.kind === "union" && target.kind === "union") {
        if (source.members.length !== target.members.length) {
          nodeValues[i] = 0;
          continue;
        }
        for (const m of source.members) {
          if (m === undefined) throw "union member invariant";
          if (target.members.includes(m)) continue;
          const clause = beginClause(i);
          const candidates = discriminants.candidates(m, b) ?? target.members;
          for (const t of candidates) {
            if (t === undefined) throw "union member invariant";
            dependency(clause, pair(m, t, true));
          }
          endClause(clause);
        }
        for (const t of target.members) {
          if (t === undefined) throw "union member invariant";
          if (source.members.includes(t)) continue;
          const clause = beginClause(i);
          const candidates = discriminants.candidates(t, a) ?? source.members;
          for (const m of candidates) {
            if (m === undefined) throw "union member invariant";
            dependency(clause, pair(m, t, true));
          }
          endClause(clause);
        }
      } else if (source.kind === "literal")
        nodeValues[i] = (
          target.kind === "literal"
            ? source.value === target.value
            : !exact && target.kind === typeof source.value
        )
          ? 1
          : 0;
      else if (
        (source.kind === "array" || source.kind === "set") &&
        target.kind === source.kind
      ) {
        if ((source.realmArray === true) !== (target.realmArray === true)) {
          nodeValues[i] = 0;
          continue;
        }
        const sourceTuple = source.tupleElements,
          targetTuple = target.tupleElements;
        if (targetTuple !== undefined) {
          if (
            sourceTuple === undefined ||
            sourceTuple.length !== targetTuple.length
          ) {
            nodeValues[i] = 0;
            continue;
          }
          for (let j = 0; j < targetTuple.length; j++) {
            const left = sourceTuple[j],
              right = targetTuple[j];
            if (left === undefined || right === undefined)
              throw "tuple position invariant";
            dependency(
              beginClause(i),
              pair(left, right, exact || !target.readonly),
            );
          }
        } else if (exact && sourceTuple !== undefined) {
          nodeValues[i] = 0;
          continue;
        }
        if (!(
          (!exact && !source.readonly) ||
          source.readonly === target.readonly
        )) {
          nodeValues[i] = 0;
          continue;
        }
        dependency(
          beginClause(i),
          pair(source.element, target.element, exact || !target.readonly),
        );
      } else if (source.kind === "map" && target.kind === "map") {
        if (!(
          (!exact && !source.readonly) ||
          source.readonly === target.readonly
        )) {
          nodeValues[i] = 0;
          continue;
        }
        dependency(
          beginClause(i),
          pair(source.key, target.key, exact || !target.readonly),
        );
        dependency(
          beginClause(i),
          pair(source.value, target.value, exact || !target.readonly),
        );
      } else if (source.kind === "object" && target.kind === "object") {
        const sourceCall = source.call,
          targetCall = target.call,
          sourceConstruct = source.construct,
          targetConstruct = target.construct,
          sourceIndex = source.stringIndex,
          targetIndex = target.stringIndex,
          indexed = sourceIndex !== undefined || targetIndex !== undefined;
        if (sourceCall !== undefined && targetCall !== undefined)
          dependency(beginClause(i), pair(sourceCall, targetCall, exact));
        if (sourceConstruct !== undefined && targetConstruct !== undefined)
          dependency(
            beginClause(i),
            pair(sourceConstruct, targetConstruct, exact),
          );
        const sourceIterator = source.iteratorElement,
          targetIterator = target.iteratorElement;
        if (sourceIterator !== undefined && targetIterator !== undefined)
          dependency(
            beginClause(i),
            pair(sourceIterator, targetIterator, exact),
          );
        if (targetIndex !== undefined) {
          if (sourceIndex !== undefined)
            dependency(
              beginClause(i),
              pair(sourceIndex.type, targetIndex.type, exact),
            );
          if (!exact)
            for (const p of source.properties) {
              if (p === undefined) throw "property invariant";
              dependency(beginClause(i), pair(p.type, targetIndex.type, false));
            }
        }
        for (const p of target.properties) {
          if (p === undefined) throw "property invariant";
          const q = findProperty(source.properties, p.name);
          if (q !== undefined)
            dependency(
              beginClause(i),
              pair(
                q.type,
                p.type,
                exact || (!indexed && !p.readonly && !methodProperty(p.type)),
              ),
            );
        }
      } else if (source.kind === "function" && target.kind === "object") {
        const targetCall = target.call;
        if (
          target.properties.length !== 0 ||
          target.stringIndex !== undefined ||
          target.construct !== undefined ||
          (exact && targetCall === undefined)
        )
          nodeValues[i] = 0;
        else if (targetCall !== undefined)
          dependency(beginClause(i), pair(a, targetCall, exact));
      } else if (source.kind === "object" && target.kind === "function") {
        const sourceCall = source.call;
        if (
          sourceCall === undefined ||
          (exact &&
            (source.properties.length !== 0 ||
              source.construct !== undefined ||
              source.stringIndex !== undefined))
        )
          nodeValues[i] = 0;
        else dependency(beginClause(i), pair(sourceCall, b, exact));
      } else if (source.kind === "function" && target.kind === "function") {
        const sourceMinimum =
            source.minimumArguments ??
            source.parameters.length - (source.rest === true ? 1 : 0),
          targetMinimum =
            target.minimumArguments ??
            target.parameters.length - (target.rest === true ? 1 : 0);
        if (
          (source.rest === true) !== (target.rest === true) ||
          source.parameters.length !== target.parameters.length ||
          !(exact
            ? sourceMinimum === targetMinimum
            : sourceMinimum <= targetMinimum)
        ) {
          nodeValues[i] = 0;
          continue;
        }
        const sourceReceiver = source.receiver,
          targetReceiver = target.receiver;
        if (sourceReceiver !== undefined && target.method === true) {
          // A member call supplies the object as the receiver.
        } else if (sourceReceiver !== undefined) {
          if (targetReceiver === undefined) {
            nodeValues[i] = 0;
            continue;
          }
          dependency(
            beginClause(i),
            pair(targetReceiver, sourceReceiver, exact),
          );
        } else if (exact && targetReceiver !== undefined) {
          nodeValues[i] = 0;
          continue;
        }
        for (let j = 0; j < source.parameters.length; j++) {
          const p = source.parameters[j],
            q = target.parameters[j];
          if (p === undefined || q === undefined)
            throw "function relation invariant";
          dependency(beginClause(i), pair(q, p, exact));
        }
        if (exact || types[target.result]?.kind !== "void")
          dependency(beginClause(i), pair(source.result, target.result, exact));
        else {
          const result = types[source.result]?.kind;
          if (result !== "void" && result !== "never") voidResultDiscard = true;
        }
      } else
        nodeValues[i] =
          source.kind !== "union" &&
          source.kind !== "object" &&
          source.kind !== "function" &&
          source.kind !== "array" &&
          primitiveRelation(source, target, exact)
            ? 1
            : 0;
    }
    let pendingCount = 0;
    for (let i = 0; i < nodeCount; i++)
      if (nodeValues[i] === 0) pendingNodes[pendingCount++] = i;
    for (let next = 0; next < pendingCount; next++) {
      const child = pendingNodes[next];
      if (child === undefined) throw "pending relation invariant";
      for (
        let edge = nodeHeads[child] ?? -1;
        edge >= 0;
        edge = edgeNext[edge] ?? -1
      ) {
        const clause = edgeClauses[edge];
        if (clause === undefined) throw "dependency invariant";
        const owner = clauseOwners[clause];
        if (owner === undefined) throw "clause owner invariant";
        if (nodeValues[owner] === 0) continue;
        const remaining = (clauseRemaining[clause] ?? 0) - 1;
        clauseRemaining[clause] = remaining;
        if (remaining === 0) {
          nodeValues[owner] = 0;
          pendingNodes[pendingCount++] = owner;
        }
      }
    }
    // Publish only converged answers; retain outer subproblems on collisions.
    for (let index = nodeCount - 1; index >= 0; index--) {
      const a = nodeActual[index],
        b = nodeExpected[index],
        exact = nodeExact[index] === 1;
      if (a === undefined || b === undefined)
        throw "completed relation invariant";
      cacheRelation(
        ((a * 31) ^ b ^ (exact ? 40503 : 0)) & relationMask,
        a,
        b,
        nodeValues[index] === 1,
        exact,
      );
    }
    return nodeValues[root] === 1;
  }
  const propertyCache: {
    name: string;
    version: number;
    value: number;
    fields: readonly number[];
    stable: boolean;
  }[][] = [];
  function property(object: number, name: string): Result<number> {
    if (!valid(object)) return { ok: false, error: "INVALID_TYPE" };
    let entries = propertyCache[object];
    if (entries !== undefined) {
      for (const entry of entries) {
        if (entry === undefined) throw "property cache invariant";
        if (entry.name !== name) continue;
        if (!entry.stable && entry.version !== types.length) {
          const best = widerProperty(entry.fields, entry.version, entry.value);
          if (best === undefined) throw "property refinement invariant";
          entry.value = best;
          entry.version = types.length;
        }
        return { ok: true, value: entry.value };
      }
    }
    const result = computeProperty(object, name);
    if (!result.ok) return result;
    if (entries === undefined) {
      entries = [];
      propertyCache[object] = entries;
    }
    entries.push({
      name,
      version: types.length,
      value: result.value.type,
      fields: result.value.fields,
      stable: result.value.stable,
    });
    return { ok: true, value: result.value.type };
  }
  function allAssignable(fields: readonly number[], expected: number): boolean {
    for (const field of fields) {
      if (field === undefined) throw "field type invariant";
      if (!relates(field, expected)) return false;
    }
    return true;
  }
  // Kind sets: a relation can only hold when the source's kinds are a subset
  // of the target's. A union holds its members' kinds, a literal the kind of
  // its value, never none, and unknown every kind (it accepts every non-void
  // source and only relates to unknown). Objects and functions relate to each
  // other and share a kind. Masks are cached per id: types never change.
  let kindMasks = new Uint32Array(Math.max(16, types.length));
  const knownKind = 0x80000,
    everyKind = 0x7ffff;
  function kindBit(kind: string): number {
    switch (kind) {
      case "number":
        return 1;
      case "boolean":
        return 2;
      case "undefined":
        return 4;
      case "null":
        return 8;
      case "string":
        return 16;
      case "Error":
        return 8288;
      case "TypeError":
        return 32;
      case "RangeError":
        return 64;
      case "ArrayBuffer":
        return 128;
      case "Uint8Array":
        return 256;
      case "Uint16Array":
        return 512;
      case "Uint32Array":
        return 1024;
      case "Float64Array":
        return 2048;
      case "void":
        return 4096;
      case "void-value":
        return 4096 | 4;
      case "object":
      case "function":
      case "realm-callable":
        return 8192;
      case "array":
        return 16384;
      case "set":
        return 32768;
      case "map":
        return 65536;
      case "bigint":
        return 262144;
      default:
        return 131072;
    }
  }
  function kindMask(id: number): number {
    if (id >= kindMasks.length) {
      const grown = new Uint32Array(Math.max(id + 1, kindMasks.length * 2));
      grown.set(kindMasks);
      kindMasks = grown;
    }
    const cached = kindMasks[id] ?? 0;
    if (cached !== 0) return cached & everyKind;
    const t = types[id];
    if (t === undefined) throw "kind mask invariant";
    let mask = 0;
    if (t.kind === "union")
      for (const member of t.members) {
        if (member === undefined) throw "kind mask member invariant";
        mask = mask | kindMask(member);
      }
    else if (t.kind === "literal") mask = kindBit(typeof t.value);
    else if (t.kind === "unknown" || t.kind === "dynamic-result")
      mask = everyKind;
    else if (t.kind !== "never") mask = kindBit(t.kind);
    kindMasks[id] = mask | knownKind;
    return mask;
  }
  // Exact shapes per (type, remaining depth); a known flag beside each hash.
  // Exactly related types have equal property counts, names and modifiers,
  // equal call/construct presence, unions of equal size whose members match
  // both ways (so the member set is compared, not the order), equal literal
  // values, equal readonly flags on collections, and otherwise equal kinds.
  // A function relates exactly to an object with only a call signature, so
  // both, and property-less objects, share one coarse shape.
  const exactDepth = 8;
  let exactShapes = new Uint32Array(0),
    exactKnown = new Uint8Array(0);
  function mixShape(hash: number, value: number): number {
    const mixed = Math.imul(hash ^ value, 0x9e3779b1);
    return (mixed ^ (mixed >>> 15)) >>> 0;
  }
  function exactShape(id: number, depth: number): number {
    id = canonicalIds[id] ?? id;
    const at = id * (exactDepth + 1) + depth;
    if (at >= exactKnown.length) {
      const capacity = Math.max(at + 1, exactKnown.length * 2),
        shapes = new Uint32Array(capacity),
        known = new Uint8Array(capacity);
      shapes.set(exactShapes);
      known.set(exactKnown);
      exactShapes = shapes;
      exactKnown = known;
    }
    if (exactKnown[at] === 1) return exactShapes[at] ?? 0;
    const t = types[id];
    if (t === undefined) throw "exact shape invariant";
    let shape = 0;
    if (
      t.kind === "function" ||
      (t.kind === "object" &&
        t.properties.length === 0 &&
        t.stringIndex === undefined &&
        t.construct === undefined)
    ) {
      const signature = t.kind === "function" ? t : types[t.call ?? -1];
      shape =
        signature?.kind === "function" && signature.rest === true
          ? 0x72657374
          : 0x63616c6c;
    } else if (t.kind === "object") {
      shape = mixShape(
        0x6f626a,
        t.properties.length * 4 +
          (t.call === undefined ? 0 : 1) +
          (t.construct === undefined ? 0 : 2),
      );
      const index = t.stringIndex;
      if (index !== undefined) {
        shape = mixShape(shape, index.readonly ? 2 : 1);
        if (depth > 0)
          shape = mixShape(shape, exactShape(index.type, depth - 1));
      }
      if (depth > 0) {
        let fields = 0;
        for (const property of t.properties) {
          if (property === undefined) throw "exact shape property invariant";
          const field = mixShape(
            mixShape(
              hashString(property.name),
              (property.optional === true ? 2 : 0) +
                (property.readonly ? 1 : 0),
            ),
            exactShape(property.type, depth - 1),
          );
          fields = (fields + field) >>> 0;
        }
        shape = mixShape(shape, fields);
      }
    } else if (t.kind === "union") {
      shape = mixShape(0x756e69, t.members.length);
      if (depth > 0) {
        const members: number[] = [];
        for (const member of t.members) {
          if (member === undefined) throw "exact shape member invariant";
          members.push(exactShape(member, depth - 1));
        }
        members.sort((a, b) => a - b);
        let previous = -1;
        for (const member of members) {
          if (member === undefined || member === previous) continue;
          previous = member;
          shape = mixShape(shape, member);
        }
      }
    } else if (t.kind === "literal") {
      // Literal equality is ===: equal numbers (0 and -0 included) give
      // equal fixed-point words; collisions merely weaken the filter.
      const value = t.value;
      shape =
        typeof value === "string"
          ? mixShape(0x737472, hashString(value))
          : typeof value === "number"
            ? mixShape(
                mixShape(0x6e756d, (value * 65536) | 0),
                Math.floor(value / 65536) | 0,
              )
            : mixShape(0x626f6f, value ? 1 : 0);
    } else if (t.kind === "array" || t.kind === "set") {
      shape = mixShape(hashString(t.kind), t.readonly ? 1 : 0);
      if (depth > 0) shape = mixShape(shape, exactShape(t.element, depth - 1));
    } else if (t.kind === "map") {
      shape = mixShape(0x6d6170, t.readonly ? 1 : 0);
      if (depth > 0)
        shape = mixShape(
          mixShape(shape, exactShape(t.key, depth - 1)),
          exactShape(t.value, depth - 1),
        );
    } else shape = hashString(t.kind);
    exactShapes[at] = shape;
    exactKnown[at] = 1;
    return shape;
  }
  // Each widening candidate's kind mask, by candidate position (plus the
  // known bit, so zero means not yet computed).
  let candidateMasks = new Uint32Array(16);
  function widerProperty(
    fields: readonly number[],
    start: number,
    prior: number | undefined,
  ): number | undefined {
    // A candidate that lacks a field's kind cannot accept that field, so it
    // fails allAssignable; skipping it leaves the result unchanged.
    let required = 0;
    for (const field of fields) {
      if (field === undefined) throw "field type invariant";
      required = required | kindMask(canonicalIds[field] ?? field);
    }
    let best = prior,
      low = 0,
      high = wideningCandidates.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2),
        id = wideningCandidates[middle];
      if (id === undefined) throw "widening candidate invariant";
      if (id < start) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < wideningCandidates.length; index++) {
      const id = wideningCandidates[index];
      if (id === undefined) throw "widening candidate invariant";
      if (index >= candidateMasks.length) {
        const grown = new Uint32Array(
          Math.max(index + 1, candidateMasks.length * 2),
        );
        grown.set(candidateMasks);
        candidateMasks = grown;
      }
      let mask = candidateMasks[index] ?? 0;
      if (mask === 0) {
        mask = kindMask(canonicalIds[id] ?? id) | knownKind;
        candidateMasks[index] = mask;
      }
      if ((required & ~mask) !== 0) continue;
      if (
        (best === undefined || relates(id, best)) &&
        allAssignable(fields, id)
      )
        best = id;
    }
    return best;
  }
  // The first undefined type never changes once present: types are only
  // appended, and an entry is only ever replaced by an identical canonical.
  let undefinedId = -1,
    undefinedScanned = 0;
  function firstUndefinedType(): number {
    while (undefinedId < 0 && undefinedScanned < types.length) {
      if (types[undefinedScanned]?.kind === "undefined")
        undefinedId = undefinedScanned;
      undefinedScanned++;
    }
    return undefinedId;
  }
  function computeProperty(
    object: number,
    name: string,
  ): Result<{
    readonly type: number;
    readonly fields: readonly number[];
    readonly stable: boolean;
  }> {
    const fields: number[] = [],
      visited = new Set<number>();
    function collect(id: number): boolean {
      if (visited.has(id)) return true;
      visited.add(id);
      const t = types[id];
      if (t?.kind === "union") return t.members.every(collect);
      if (t?.kind !== "object") return false;
      const field = findProperty(t.properties, name);
      const value = field?.type ?? t.stringIndex?.type;
      if (value === undefined) return false;
      fields.push(value);
      if (field === undefined || field.optional) {
        const undefinedType = firstUndefinedType();
        if (undefinedType < 0) return false;
        fields.push(undefinedType);
      }
      return true;
    }
    if (!collect(object)) return { ok: false, error: "PROPERTY" };
    // A matching declared field remains preferred after append. Otherwise the
    // ordered widening search can resume at the old table length: prior types
    // and relations are immutable, and new candidates only extend its suffix.
    for (const id of fields) {
      if (id === undefined) throw "field type invariant";
      if (allAssignable(fields, id))
        return { ok: true, value: { type: id, fields, stable: true } };
    }
    const best = widerProperty(fields, 0, undefined);
    return best === undefined
      ? { ok: false, error: "TYPE_MISMATCH" }
      : { ok: true, value: { type: best, fields, stable: false } };
  }

  /** Checks a write of `value` to `object.name` and returns the declared
   * field type (for a union receiver, the union's read type). A union
   * receiver stores into whichever member the object is at run time, and
   * each member's declared field type is a contract, so the write is checked
   * against every member: a readonly member makes it IMMUTABLE, and a value
   * outside any member's declared type is a TYPE_MISMATCH. TypeScript only
   * requires the union's read type there; callers that must accept what it
   * accepts tell the two apart. */
  function writeProperty(
    object: number,
    name: string,
    value: number,
  ): Result<number> {
    const result = property(object, name);
    if (!result.ok) return result;
    if (!valid(value)) return { ok: false, error: "INVALID_TYPE" };
    let error: ErrorCode | undefined, declared: number | undefined;
    const pending: number[] = [object],
      visited = new Set<number>();
    while (pending.length > 0) {
      const id = pending.pop();
      if (id === undefined) throw "union write member invariant";
      if (visited.has(id)) continue;
      visited.add(id);
      const t = types[id];
      if (t?.kind === "union") {
        for (const member of t.members) {
          if (member === undefined) throw "union write member invariant";
          pending.push(member);
        }
        continue;
      }
      if (t?.kind !== "object") {
        if (error === undefined) error = "TYPE_MISMATCH";
        continue;
      }
      const p = findProperty(t.properties, name) ?? t.stringIndex;
      if (p === undefined) throw "property invariant";
      declared = p.type;
      if (p.readonly) error = "IMMUTABLE";
      else if (error === undefined && !relates(value, p.type))
        error = "TYPE_MISMATCH";
    }
    if (error !== undefined) return { ok: false, error };
    if (declared === undefined) throw "property invariant";
    return {
      ok: true,
      value: types[object]?.kind === "union" ? result.value : declared,
    };
  }
  function object(
    target: number,
    properties: readonly ObjectValue[],
  ): Result<number> {
    if (!valid(target)) return { ok: false, error: "INVALID_TYPE" };
    const t = types[target];
    if (t?.kind !== "object") return { ok: false, error: "TYPE_MISMATCH" };
    if (t.call !== undefined || t.construct !== undefined)
      return { ok: false, error: "TYPE_MISMATCH" };
    const names = new Set<string>();
    for (const p of properties) {
      if (p === undefined) throw "object property invariant";
      if (names.has(p.name)) return { ok: false, error: "PROPERTY" };
      names.add(p.name);
      if (!valid(p.type)) return { ok: false, error: "INVALID_TYPE" };
      const field = findProperty(t.properties, p.name);
      const type = field?.type ?? t.stringIndex?.type;
      if (type === undefined) return { ok: false, error: "PROPERTY" };
      if (field !== undefined && p.optional === true && field.optional !== true)
        return { ok: false, error: "PROPERTY" };
      if (!relates(p.type, type)) return { ok: false, error: "TYPE_MISMATCH" };
    }
    return t.properties.every((p) => p.optional || names.has(p.name))
      ? { ok: true, value: target }
      : { ok: false, error: "PROPERTY" };
  }
  function call(
    callee: number,
    arguments_: readonly number[],
    receiver?: number,
  ): Result<number> {
    if (
      !valid(callee) ||
      (receiver !== undefined && !valid(receiver)) ||
      arguments_.some((a) => !valid(a))
    )
      return { ok: false, error: "INVALID_TYPE" };
    const target = types[callee];
    return invoke(
      target?.kind === "object" ? target.call : callee,
      arguments_,
      receiver,
    );
  }
  function construct(
    callee: number,
    arguments_: readonly number[],
  ): Result<number> {
    if (!valid(callee) || arguments_.some((a) => !valid(a)))
      return { ok: false, error: "INVALID_TYPE" };
    const target = types[callee];
    return invoke(
      target?.kind === "object" ? target.construct : undefined,
      arguments_,
    );
  }
  function invoke(
    signature: number | undefined,
    arguments_: readonly number[],
    receiver?: number,
  ): Result<number> {
    const t = signature === undefined ? undefined : types[signature];
    if (t?.kind !== "function") return { ok: false, error: "TYPE_MISMATCH" };
    // Callers with a receiver contract must supply its type, including undefined
    // for an unbound call. Omission is not a proof of receiver compatibility.
    if (
      t.receiver !== undefined &&
      (receiver === undefined || !relates(receiver, t.receiver))
    )
      return { ok: false, error: "TYPE_MISMATCH" };
    if (
      (t.rest !== true && arguments_.length > t.parameters.length) ||
      arguments_.length <
        (t.minimumArguments ?? t.parameters.length - (t.rest === true ? 1 : 0))
    )
      return { ok: false, error: "ARITY" };
    const restStart = t.parameters.length - 1;
    const rest = types[t.parameters[restStart] ?? -1];
    for (let i = 0; i < arguments_.length; i++) {
      const p =
          t.rest === true && i >= restStart && rest?.kind === "array"
            ? rest.element
            : t.parameters[i],
        a = arguments_[i];
      if (p === undefined || a === undefined) throw "call arity invariant";
      if (!relates(a, p)) return { ok: false, error: "TYPE_MISMATCH" };
    }
    return { ok: true, value: t.result };
  }
  function cell(
    c: Cell,
    operation: CellOperation,
  ): Result<CheckedCellOperation> {
    if (
      !valid(c.type) ||
      types[c.type]?.kind === "void" ||
      (operation.kind !== "read" && !valid(operation.value))
    )
      return { ok: false, error: "INVALID_TYPE" };
    if (operation.kind === "write" && !c.mutable)
      return { ok: false, error: "IMMUTABLE" };
    if (operation.kind !== "read" && !relates(operation.value, c.type))
      return { ok: false, error: "TYPE_MISMATCH" };
    return {
      ok: true,
      value: {
        kind: operation.kind,
        type: c.type,
        guard:
          operation.kind === "initialize" ? "uninitialized" : "initialized",
        publishInitialized: operation.kind === "initialize",
      },
    };
  }
  return {
    ok: true,
    value: {
      append,
      assignable,
      usesVoidResultDiscard: () => voidResultDiscard,
      kindMask: (id: number): number =>
        valid(id) ? kindMask(canonicalIds[id] ?? id) : 0x3ffff,
      exactShape: (id: number): number =>
        valid(id) ? exactShape(id, exactDepth) : 0,
      property,
      writeProperty,
      object,
      call,
      construct,
      cell,
    },
  };
}

function findProperty(
  properties: readonly Property[],
  name: string,
): Property | undefined {
  for (const property of properties) {
    if (property !== undefined && property.name === name) return property;
  }
  return undefined;
}
/** Whether primitive `source` relates to primitive `target` of any kind:
 * equal kinds, where a C view relates to plain Uint8Array (not exactly) and
 * to views of its own key only. */
function primitiveRelation(
  source: Type,
  target: Type,
  exact: boolean,
): boolean {
  if (source.kind !== target.kind) return false;
  if (source.kind !== "Uint8Array" || target.kind !== "Uint8Array") return true;
  const from = source.view,
    to = target.view;
  return from === to || (!exact && to === undefined);
}
function copyType(
  t: Type,
  input: readonly Type[],
): Result<{
  readonly type: Type;
  readonly refs: readonly number[];
}> {
  let refs: readonly number[] = [],
    copy: Type;
  switch (t.kind) {
    case "literal":
      if (typeof t.value === "number" && !Number.isFinite(t.value))
        return { ok: false, error: "INVALID_TYPE" };
      copy = { kind: "literal", value: t.value };
      break;
    case "map":
      refs = [t.key, t.value];
      copy = {
        kind: t.kind,
        key: t.key,
        value: t.value,
        readonly: t.readonly,
      };
      break;
    case "set":
    case "array": {
      const arrayRefs = [t.element];
      const tuple = t.tupleElements;
      if (tuple !== undefined) {
        if (t.kind !== "array" || t.realmArray !== true)
          return { ok: false, error: "INVALID_TYPE" };
        for (const member of tuple) {
          if (member === undefined) return { ok: false, error: "INVALID_TYPE" };
          arrayRefs.push(member);
        }
      }
      refs = arrayRefs;
      copy = {
        kind: t.kind,
        element: t.element,
        readonly: t.readonly,
        ...(t.realmArray === true ? { realmArray: true } : {}),
        ...(tuple === undefined ? {} : { tupleElements: tuple.slice() }),
      };
      break;
    }
    case "object": {
      // Duplicate names: pairwise for ordinary objects (a Set promotes to a
      // hashed index past eight members, on every appended object type).
      const properties = t.properties,
        pairwise = properties.length <= 32,
        names = new Set<string>();
      for (let index = 0; index < properties.length; index++) {
        const p = properties[index];
        if (p === undefined) return { ok: false, error: "INVALID_TYPE" };
        if (p.optional !== undefined && typeof p.optional !== "boolean")
          return { ok: false, error: "INVALID_TYPE" };
        if (pairwise) {
          for (let prior = 0; prior < index; prior++)
            if (properties[prior]?.name === p.name)
              return { ok: false, error: "INVALID_TYPE" };
        } else if (names.has(p.name))
          return { ok: false, error: "INVALID_TYPE" };
        else names.add(p.name);
      }
      const objectRefs = t.properties.map((p) => p.type);
      if (t.iteratorElement !== undefined) objectRefs.push(t.iteratorElement);
      const index = t.stringIndex;
      if (index !== undefined) objectRefs.push(index.type);
      for (const signature of [t.call, t.construct]) {
        if (signature === undefined) continue;
        if (input[signature]?.kind !== "function")
          return { ok: false, error: "INVALID_TYPE" };
        objectRefs.push(signature);
      }
      if (t.construct !== undefined) {
        const signature = input[t.construct];
        if (signature?.kind !== "function" || signature.receiver !== undefined)
          return { ok: false, error: "INVALID_TYPE" };
      }
      refs = objectRefs;
      copy = {
        kind: t.kind,
        ...(t.realmRecord === true ? { realmRecord: true } : {}),
        iteratorElement: t.iteratorElement,
        ...(t.interfaceDeclaration === true
          ? { interfaceDeclaration: true }
          : {}),
        ...(index === undefined
          ? {}
          : {
              stringIndex: {
                type: index.type,
                readonly: index.readonly,
                origin: index.origin,
              },
            }),
        ...(t.call === undefined ? {} : { call: t.call }),
        ...(t.construct === undefined ? {} : { construct: t.construct }),
        ...(t.realmConstructor === true ? { realmConstructor: true } : {}),
        ...(t.realmLibrary === undefined
          ? {}
          : { realmLibrary: t.realmLibrary }),
        ...(t.realmTypedArray === undefined
          ? {}
          : { realmTypedArray: t.realmTypedArray }),
        properties: t.properties.map((p) => ({
          name: p.name,
          ...(p.hasInstanceSymbol === true ? { hasInstanceSymbol: true } : {}),
          type: p.type,
          readonly: p.readonly,
          ...(p.optional ? { optional: true } : {}),
        })),
      };
      break;
    }
    case "function": {
      if (
        t.minimumArguments !== undefined &&
        (!Number.isInteger(t.minimumArguments) ||
          t.minimumArguments < 0 ||
          t.minimumArguments > t.parameters.length - (t.rest === true ? 1 : 0))
      )
        return { ok: false, error: "INVALID_TYPE" };
      if (
        t.rest === true &&
        input[t.parameters[t.parameters.length - 1] ?? -1]?.kind !== "array"
      )
        return { ok: false, error: "INVALID_TYPE" };
      const parameters: number[] = [],
        functionRefs: number[] = [];
      for (const parameter of t.parameters) {
        if (parameter === undefined)
          return { ok: false, error: "INVALID_TYPE" };
        parameters.push(parameter);
        functionRefs.push(parameter);
      }
      if (t.receiver !== undefined) functionRefs.push(t.receiver);
      functionRefs.push(t.result);
      if (t.instancePredicate !== undefined)
        functionRefs.push(t.instancePredicate);
      refs = functionRefs;
      copy = {
        kind: t.kind,
        parameters,
        ...(t.minimumArguments === undefined
          ? {}
          : { minimumArguments: t.minimumArguments }),
        ...(t.receiver === undefined ? {} : { receiver: t.receiver }),
        ...(t.rest === true ? { rest: true } : {}),
        result: t.result,
        ...(t.instancePredicate === undefined
          ? {}
          : { instancePredicate: t.instancePredicate }),
        ...(t.method === true ? { method: true } : {}),
      };
      break;
    }
    case "union": {
      if (
        t.members.length === 0 ||
        new Set(t.members).size !== t.members.length
      )
        return { ok: false, error: "INVALID_TYPE" };
      const members: number[] = [];
      for (const member of t.members) {
        if (member === undefined) return { ok: false, error: "INVALID_TYPE" };
        members.push(member);
      }
      refs = members;
      copy = { kind: t.kind, members };
      break;
    }
    default: {
      const view = t.view;
      if (view !== undefined && (t.kind !== "Uint8Array" || view.length === 0))
        return { ok: false, error: "INVALID_TYPE" };
      copy =
        view === undefined
          ? {
              kind: t.kind,
              ...(t.arrayFlow === true ? { arrayFlow: true } : {}),
            }
          : { kind: t.kind, view };
      break;
    }
  }
  const values = t.kind === "function" ? t.parameters : refs;
  if (values.some((ref) => input[ref]?.kind === "void"))
    return { ok: false, error: "INVALID_TYPE" };
  for (const ref of refs)
    if (
      ref === undefined ||
      !Number.isInteger(ref) ||
      ref < 0 ||
      ref >= input.length
    )
      return { ok: false, error: "INVALID_TYPE" };
  return { ok: true, value: { type: copy, refs } };
}

/** C1 uses the general value's existing payload representation. Native
 * aggregate references require a live view or realm-backed allocation. */
export interface DynamicPayloadRejection {
  readonly capability:
    "native-callable-view" | "realm-aggregate-view" | "realm-payload-layout";
  readonly message: string;
}
export function unsupportedDynamicPayload(
  types: readonly Type[],
  id: number,
): DynamicPayloadRejection | undefined {
  const type = types[id];
  if (type === undefined) throw "dynamic property type invariant";
  switch (type.kind) {
    case "number":
    case "string":
    case "boolean":
    case "bigint":
    case "null":
    case "undefined":
    case "unknown":
    case "never":
    case "literal":
      return undefined;
    case "array":
      if (type.realmArray === true) return undefined;
      break;
    case "object":
      if (type.stringIndex !== undefined || type.realmRecord === true)
        return undefined;
      break;
    case "union":
      for (const member of type.members) {
        if (member === undefined) throw "dynamic property member invariant";
        const unsupported = unsupportedDynamicPayload(types, member);
        if (unsupported !== undefined) return unsupported;
      }
      return undefined;
  }
  const name =
    type.kind === "object"
      ? "native record"
      : type.kind === "array"
        ? "native list"
        : type.kind;
  const message =
    "UNSUPPORTED: " +
    name +
    " values in dynamic-key objects need slice 2b list/record views";
  if (
    type.kind === "function" ||
    (type.kind === "object" &&
      (type.call !== undefined || type.construct !== undefined))
  )
    return { capability: "native-callable-view", message };
  if (type.kind === "object" || type.kind === "array")
    return { capability: "realm-aggregate-view", message };
  return { capability: "realm-payload-layout", message };
}

/** Declared indexed values may describe realm arrays and data records, even
 * though the same annotation outside indexed storage still uses native layout. */
export function unsupportedDynamicContract(
  types: readonly Type[],
  id: number,
  seen: Set<number> = new Set<number>(),
): DynamicPayloadRejection | undefined {
  if (seen.has(id)) return undefined;
  seen.add(id);
  const type = types[id];
  if (type?.kind === "array") {
    return unsupportedDynamicContract(types, type.element, seen);
  }
  if (
    type?.kind === "object" &&
    type.call === undefined &&
    type.construct === undefined
  ) {
    for (const field of type.properties) {
      if (field === undefined) throw "dynamic contract field invariant";
      const unsupported = unsupportedDynamicContract(types, field.type, seen);
      if (unsupported !== undefined) return unsupported;
    }
    const index = type.stringIndex;
    return index === undefined
      ? undefined
      : unsupportedDynamicContract(types, index.type, seen);
  }
  if (type?.kind === "union") {
    for (const member of type.members) {
      if (member === undefined) throw "dynamic contract union invariant";
      const unsupported = unsupportedDynamicContract(types, member, seen);
      if (unsupported !== undefined) return unsupported;
    }
    return undefined;
  }
  return unsupportedDynamicPayload(types, id);
}
