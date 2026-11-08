import type { LocalSignatureBinding } from "@tint/codegen/aarch64/scalar";
import {
  checkClosureModule,
  type CheckedClosures,
} from "@tint/typescript/checker";
import { canonicalizeManagedSurfaceTypes } from "./managed-surface-text.ts";
import type { ManagedSurfaceTypeDescription } from "./managed-surfaces.ts";
import { createTypeSystem, type Type } from "@tint/typescript/types";
export type ManagedTypeContractComparison =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly error: string };
export interface ManagedTypeContractIndex {
  /** Graph-local IDs are valid only for this compiler-owned immutable graph. */
  readonly sourceTypes: readonly Type[];
  readonly maxWork: number;
  /** Variance diagnostics only; exact matches remain the admission authority. */
  readonly assignable: (actual: number, expected: number) => boolean;
  /** Exact ordered contract equality, not TypeScript assignability/variance.
   * The caller keeps the validated graph immutable for the index's lifetime. */
  readonly matches: (
    left: number,
    right: number,
  ) => ManagedTypeContractComparison;
  /** Diagnostic-only comparison. Never grants membership or pointer authority. */
  readonly matchesIgnoringReadonly: (
    left: number,
    right: number,
  ) => ManagedTypeContractComparison;
}
export type ManagedTypeContracts =
  | { readonly ok: true; readonly value: ManagedTypeContractIndex }
  | { readonly ok: false; readonly error: string };
export interface ManagedTypeContractCache {
  readonly get: (
    types: readonly Type[],
    maxWork?: number,
  ) => ManagedTypeContracts;
}
/** One surface/compiler owner, one retained graph. Checked graphs must remain
 * immutable for the cache's lifetime, as for an individual contract index.
 * Distinct evaluations may issue different graph-local IDs; identity and the
 * comparison budget are both keys. Do not use a process-global map of graphs. */
export function createManagedTypeContractCache(): ManagedTypeContractCache {
  let previousTypes: readonly Type[] | undefined,
    previousWork = 0,
    previous: ManagedTypeContracts | undefined;
  function get(
    types: readonly Type[],
    maxWork: number = 100000,
  ): ManagedTypeContracts {
    if (
      types === previousTypes &&
      maxWork === previousWork &&
      previous !== undefined
    )
      return previous;
    const result = createManagedTypeContractIndex(types, maxWork);
    previousTypes = types;
    previousWork = maxWork;
    previous = result;
    return result;
  }
  return { get };
}
/** A compiler-owned check before assigning semantic signature identities. Record
 * order/mutability, optionality, receivers and arity remain observable contract
 * facts even when both graphs lower to the same machine encoding. Independent
 * recursive aliases compare coinductively; no transient type ID is an authority. */
export function createManagedTypeContractIndex(
  types: readonly Type[],
  maxWork: number = 100000,
): ManagedTypeContracts {
  if (!Number.isSafeInteger(maxWork) || maxWork <= 0)
    return { ok: false, error: "invalid managed contract comparison budget" };
  const validated = createTypeSystem(types);
  if (!validated.ok)
    return {
      ok: false,
      error: "invalid managed contract type graph: " + validated.error,
    };
  const cache = new Map<string, boolean>();
  function key(left: number, right: number): string {
    return left < right
      ? String(left) + ":" + String(right)
      : String(right) + ":" + String(left);
  }
  function valid(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < types.length;
  }
  function compare(
    left: number,
    right: number,
    ignoreReadonly: boolean,
  ): ManagedTypeContractComparison {
    if (!valid(left) || !valid(right))
      return { ok: false, error: "invalid managed contract root" };
    if (left === right) return { ok: true, value: true };
    const root = (ignoreReadonly ? "readonly:" : "") + key(left, right),
      known = cache.get(root);
    if (known !== undefined) return { ok: true, value: known };
    const pending: number[] = [left, right],
      seen = new Set<string>();
    let work = 0,
      exhausted = false;
    function result(value: boolean): ManagedTypeContractComparison {
      if (exhausted)
        return {
          ok: false,
          error: "managed contract comparison budget exceeded",
        };
      cache.set(root, value);
      return { ok: true, value };
    }
    function edge(a: number | undefined, b: number | undefined): boolean {
      if (++work > maxWork) {
        exhausted = true;
        return false;
      }
      if (a === undefined || b === undefined) return a === b;
      if (a !== b) pending.push(a, b);
      return true;
    }
    for (let index = 0; index < pending.length; index += 2) {
      if (++work > maxWork)
        return {
          ok: false,
          error: "managed contract comparison budget exceeded",
        };
      const aId = pending[index],
        bId = pending[index + 1];
      if (aId === undefined || bId === undefined || !valid(aId) || !valid(bId))
        return { ok: false, error: "invalid managed contract edge" };
      if (aId === bId) continue;
      const pair = key(aId, bId);
      if (seen.has(pair)) continue;
      seen.add(pair);
      const a = types[aId],
        b = types[bId];
      if (a === undefined || b === undefined)
        return { ok: false, error: "missing managed contract type" };
      if (a.kind !== b.kind) return result(false);
      switch (a.kind) {
        case "literal":
          if (b.kind !== "literal" || a.value !== b.value) return result(false);
          break;
        case "array":
        case "set":
          if (
            (b.kind !== "array" && b.kind !== "set") ||
            (!ignoreReadonly && a.readonly !== b.readonly) ||
            !edge(a.element, b.element)
          )
            return result(false);
          break;
        case "map":
          if (
            b.kind !== "map" ||
            (!ignoreReadonly && a.readonly !== b.readonly) ||
            !edge(a.key, b.key) ||
            !edge(a.value, b.value)
          )
            return result(false);
          break;
        case "union":
          if (b.kind !== "union" || a.members.length !== b.members.length)
            return result(false);
          for (let i = 0; i < a.members.length; i++)
            if (!edge(a.members[i], b.members[i])) return result(false);
          break;
        case "object":
          if (
            b.kind !== "object" ||
            a.properties.length !== b.properties.length ||
            !edge(a.call, b.call) ||
            !edge(a.construct, b.construct)
          )
            return result(false);
          for (let i = 0; i < a.properties.length; i++) {
            if (++work > maxWork)
              return {
                ok: false,
                error: "managed contract comparison budget exceeded",
              };
            const x = a.properties[i],
              y = b.properties[i];
            if (x === undefined || y === undefined)
              return { ok: false, error: "missing managed contract property" };
            if (
              x.name !== y.name ||
              (!ignoreReadonly && x.readonly !== y.readonly) ||
              (x.optional === true) !== (y.optional === true) ||
              !edge(x.type, y.type)
            )
              return result(false);
          }
          break;
        case "function":
          if (
            b.kind !== "function" ||
            a.parameters.length !== b.parameters.length ||
            (a.minimumArguments ?? a.parameters.length) !==
              (b.minimumArguments ?? b.parameters.length) ||
            !edge(a.receiver, b.receiver) ||
            !edge(a.result, b.result)
          )
            return result(false);
          for (let i = 0; i < a.parameters.length; i++)
            if (!edge(a.parameters[i], b.parameters[i])) return result(false);
          break;
        default:
          break;
      }
    }
    cache.set(root, true);
    return { ok: true, value: true };
  }
  function matches(left: number, right: number): ManagedTypeContractComparison {
    return compare(left, right, false);
  }
  function matchesIgnoringReadonly(
    left: number,
    right: number,
  ): ManagedTypeContractComparison {
    return compare(left, right, true);
  }
  return {
    ok: true,
    value: {
      sourceTypes: types,
      maxWork,
      assignable: validated.value.assignable,
      matches,
      matchesIgnoringReadonly,
    },
  };
}
/** Resolve declaration and expression functions by binder/AST identity. IDs are
 * local to this checked graph; a machine signature is never a substitute. */
export function managedFunctionType(
  checked: CheckedClosures,
  id: number,
): number | undefined {
  if (
    !Number.isInteger(id) ||
    id < 0 ||
    id >= checked.bindings.functions.length
  )
    return undefined;
  const fn = checked.bindings.functions[id];
  if (fn === undefined) return undefined;
  const binding = checked.bindings.bindings.find(
    (binding) =>
      binding !== undefined &&
      binding.kind === "function" &&
      binding.node === fn.node,
  );
  let type =
    binding === undefined ? undefined : checked.bindingTypes[binding.id];
  if (type === undefined)
    checked.expressions.forEach((candidate, expression) => {
      if (expression === fn.node) type = candidate;
    });
  return type !== undefined && checked.types[type]?.kind === "function"
    ? type
    : undefined;
}
export interface ManagedSignatureGroupRequest {
  readonly name: string;
  readonly contract: string;
  /** Checked source type IDs, never identities from another graph/image. */
  readonly type: number;
  readonly aliases?: readonly number[];
  readonly functions: readonly number[];
}
export interface CheckedManagedSignatureGroup {
  readonly name: string;
  readonly contract: string;
  readonly sourceFunctions: readonly number[];
  readonly sourceTypes: readonly number[];
}
export type ManagedSignatureGroupPlan =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: readonly CheckedManagedSignatureGroup[];
    };
/** Establish exact semantic membership before lowering. Function/type IDs in the
 * result belong solely to this checked graph and still require remapping through
 * lowering/pruning and backend physical-ABI validation. This does not discover
 * function flows or authorize broader variance-compatible assignments. */
export function planManagedSignatureGroups(
  checked: CheckedClosures,
  requests: readonly ManagedSignatureGroupRequest[],
  maxWork: number = 100000,
  typeContracts?: ManagedTypeContractCache,
): ManagedSignatureGroupPlan {
  const reject = (error: string): ManagedSignatureGroupPlan => ({
    ok: false,
    error,
  });
  if (requests.length === 0) return { ok: true, value: [] };
  const compared =
    typeContracts?.get(checked.types, maxWork) ??
    createManagedTypeContractIndex(checked.types, maxWork);
  if (!compared.ok) return reject(compared.error);
  const index = compared.value,
    names = new Set<string>(),
    contracts = new Set<string>();
  const functionOwners = new Uint32Array(checked.bindings.functions.length),
    typeOwners = new Uint32Array(checked.types.length),
    functionTypes = new Uint32Array(checked.bindings.functions.length);
  function functionType(id: number): number | undefined {
    const cached = functionTypes[id] ?? 0;
    if (cached !== 0) return cached - 1;
    const type = managedFunctionType(checked, id);
    if (type !== undefined) functionTypes[id] = type + 1;
    return type;
  }

  const groups: CheckedManagedSignatureGroup[] = [];
  for (const request of requests) {
    if (
      request === undefined ||
      request.name.length === 0 ||
      request.name.includes("\0") ||
      request.contract.length === 0 ||
      request.contract.includes("\0") ||
      names.has(request.name) ||
      contracts.has(request.contract) ||
      request.functions.length === 0 ||
      !Number.isInteger(request.type) ||
      request.type < 0 ||
      checked.types[request.type]?.kind !== "function"
    )
      return reject("invalid or duplicate managed signature group");
    for (const previous of groups) {
      if (previous === undefined)
        return reject("missing managed signature group");
      const root = previous.sourceTypes[0];
      if (root === undefined)
        return reject("missing managed signature contract type");
      const same = index.matches(request.type, root);
      if (!same.ok) return reject(same.error);
      if (same.value)
        return reject(
          "equivalent managed signature types require one canonical group",
        );
    }
    names.add(request.name);
    contracts.add(request.contract);
    const sourceFunctions: number[] = [],
      sourceTypes: number[] = [],
      aliases: number[] = [request.type];
    for (const alias of request.aliases ?? []) {
      if (alias === undefined)
        return reject("missing managed signature type alias");
      if (!aliases.includes(alias)) aliases.push(alias);
    }
    for (const type of aliases) {
      if (
        type === undefined ||
        !Number.isInteger(type) ||
        type < 0 ||
        checked.types[type]?.kind !== "function"
      )
        return reject("managed signature aliases require function types");
      if (typeOwners[type] !== 0)
        return reject("managed signature type belongs to multiple groups");
      const same = index.matches(request.type, type);
      if (!same.ok) return reject(same.error);
      if (!same.value)
        return reject("managed signature alias contract mismatch");
      typeOwners[type] = groups.length + 1;
      sourceTypes.push(type);
    }
    for (const id of request.functions) {
      if (id === undefined) return reject("missing managed signature member");
      const type = functionType(id);
      if (type === undefined)
        return reject("managed signature member is not a checked function");
      if (functionOwners[id] !== 0)
        return reject("managed signature function belongs to multiple groups");
      const same = index.matches(request.type, type);
      if (!same.ok) return reject(same.error);
      if (!same.value)
        return reject("managed signature member contract mismatch");
      if (!sourceTypes.includes(type)) {
        if (typeOwners[type] !== 0)
          return reject(
            "managed signature member type belongs to multiple groups",
          );
        typeOwners[type] = groups.length + 1;
        sourceTypes.push(type);
      }
      functionOwners[id] = groups.length + 1;
      sourceFunctions.push(id);
    }
    groups.push({
      name: request.name,
      contract: request.contract,
      sourceFunctions,
      sourceTypes,
    });
  }
  return { ok: true, value: groups };
}
export type LoweredManagedSignatureGroups =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: readonly LocalSignatureBinding[] };
/** Lowering lists native-index -> source-function-ID. Pruning maps instead use
 * old-index -> new-index+1 (zero removed). Keep those conventions explicit;
 * callback witnesses are already native IDs encoded plus one by source type. */
export function lowerManagedSignatureGroups(
  groups: readonly CheckedManagedSignatureGroup[],
  entries: readonly number[],
  signatureTypes: Uint32Array | undefined,
  pruning: readonly Uint32Array[] = [],
): LoweredManagedSignatureGroups {
  const reject = (error: string): LoweredManagedSignatureGroups => ({
    ok: false,
    error,
  });
  if (groups.length !== 0 && signatureTypes === undefined)
    return reject("managed signature groups require semantic witness lowering");
  function retained(id: number): number | undefined {
    let current = id;
    for (const map of pruning) {
      if (map === undefined) return undefined;
      const next = map[current] ?? 0;
      if (next === 0) return undefined;
      current = next - 1;
    }
    return current;
  }
  const value: LocalSignatureBinding[] = [],
    owners = new Set<number>();
  for (const group of groups) {
    if (group === undefined)
      return reject("missing checked managed signature group");
    const functions: number[] = [],
      seen = new Set<number>();
    function add(id: number): boolean {
      const final = retained(id);
      if (final === undefined || seen.has(final)) return true;
      if (owners.has(final)) return false;
      seen.add(final);
      functions.push(final);
      return true;
    }
    for (const source of group.sourceFunctions) {
      if (source === undefined)
        return reject("missing managed signature source function");
      const native = entries.indexOf(source);
      if (native < 0)
        return reject("managed signature member is absent from lowering");
      if (!add(native))
        return reject(
          "lowered managed signature member belongs to multiple groups",
        );
    }
    for (const type of group.sourceTypes) {
      if (
        type === undefined ||
        !Number.isInteger(type) ||
        type < 0 ||
        signatureTypes === undefined ||
        type >= signatureTypes.length
      )
        return reject("invalid managed signature source type");
      const witness = signatureTypes[type] ?? 0;
      if (witness !== 0 && !add(witness - 1))
        return reject(
          "lowered managed signature witness belongs to multiple groups",
        );
    }
    if (functions.length === 0) continue;
    for (const id of functions) {
      if (id === undefined)
        return reject("missing lowered managed signature member");
      owners.add(id);
    }
    value.push({ name: group.name, contract: group.contract, functions });
  }
  return { ok: true, value };
}

export interface ManagedSurfaceContractClass {
  readonly alias: string;
  /** Other aliases exactly equivalent to the representative; excludes alias. */
  readonly aliases: readonly string[];
  /** Identity in this plan's immutable checked graph, never a loader authority. */
  readonly type: number;
}
export interface ManagedSurfaceContractPlan {
  readonly surface: ManagedSurfaceTypeDescription;
  readonly checked: CheckedClosures;
  readonly signatures: readonly ManagedSurfaceContractClass[];
  readonly records: readonly ManagedSurfaceContractClass[];
}
export type ManagedSurfaceContracts =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedSurfaceContractPlan };
/** Partition canonical recursive contracts by exact semantic equality. Physical
 * descriptor interning remains independent and may share addresses across classes. */
export function planManagedSurfaceContracts(
  surface: ManagedSurfaceTypeDescription,
): ManagedSurfaceContracts {
  const canonical = canonicalizeManagedSurfaceTypes(surface);
  if (!canonical.ok) return canonical;
  const checked = checkClosureModule({
    start: 0,
    end: 0,
    imports: [],
    statements: canonical.value.declarations,
  });
  if (!checked.ok) return { ok: false, error: checked.error.message };
  const graph = checked.value,
    index = createManagedTypeContractIndex(graph.types);
  if (!index.ok) return index;
  const signatures: { alias: string; aliases: string[]; type: number }[] = [],
    records: { alias: string; aliases: string[]; type: number }[] = [];
  for (const declaration of canonical.value.declarations) {
    if (declaration === undefined || declaration.kind !== "type-alias")
      return { ok: false, error: "surface contracts require reified aliases" };
    const id = graph.typeNames.get(declaration.name),
      type = id === undefined ? undefined : graph.types[id];
    if (id === undefined || type === undefined)
      return {
        ok: false,
        error: "missing checked surface alias: " + declaration.name,
      };
    if (type.kind !== "function" && type.kind !== "object") continue;
    const groups = type.kind === "function" ? signatures : records;
    let found = false;
    for (const group of groups) {
      if (group === undefined) throw "surface contract group invariant";
      const same = index.value.matches(group.type, id);
      if (!same.ok) return same;
      if (same.value) {
        group.aliases.push(declaration.name);
        found = true;
        break;
      }
    }
    if (!found) groups.push({ alias: declaration.name, aliases: [], type: id });
  }
  return {
    ok: true,
    value: { surface: canonical.value, checked: graph, signatures, records },
  };
}
