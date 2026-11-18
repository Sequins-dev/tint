import {
  managedTypeContracts,
  type ManagedTypeContractCache,
} from "./managed-contracts.ts";
import type { CheckedClosures } from "@tint/typescript/checker";
import type { CollectionElement } from "@tint/ts-native/scalar";
import { visitRuntimeFunctions } from "@tint/ts-native/runtime";
import type { ModuleEntryOptions } from "@tint/ts-native/closure/lowering";
import type { ManagedSurfaceContractPlan } from "./managed-contracts.ts";
import { planManagedSurfaceRuntimes } from "./managed-runtimes.ts";
import type { ManagedFunctionEntryBinding } from "@tint/codegen/aarch64/scalar";
import type { ScalarType, ReturnType, ModuleIR } from "@tint/ir/scalar";
import type { SerializedManagedSurfaceDirectory } from "./managed-directory-data.ts";
import { managedSurfaceContract } from "./managed-directory-reader.ts";

export interface ManagedRuntimeKey {
  readonly kind:
    "list" | "set" | "map" | "primitive" | "number-text" | "bigint";
  readonly element: string;
  readonly value: string;
}
export interface ManagedRuntimeSlot {
  readonly slot: number;
  readonly contract: string;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ReturnType;
}
/** Internal linking step over a canonical directory issued by its reader. The
 * caller must derive the key from exact surface types; ABI equality cannot
 * identify a provider, an operation or an authorized native entry. */
export function selectManagedRuntimeSlot(
  directory: SerializedManagedSurfaceDirectory,
  key: ManagedRuntimeKey,
  operation: string,
):
  | { readonly ok: true; readonly value: ManagedRuntimeSlot }
  | { readonly ok: false; readonly error: string } {
  let offset = 0;
  for (const provider of directory.runtimes) {
    if (provider === undefined) throw "runtime selection provider invariant";
    if (
      provider.kind === key.kind &&
      provider.element === key.element &&
      provider.value === key.value
    ) {
      for (let index = 0; index < provider.operations.length; index++) {
        const candidate = provider.operations[index];
        if (candidate === undefined)
          throw "runtime selection operation invariant";
        if (candidate.operation === operation) {
          const slot = offset + index;
          return {
            ok: true,
            value: {
              slot,
              contract: managedSurfaceContract(
                directory.name,
                directory.digest,
                "runtime",
                slot,
              ),
              parameters: candidate.parameters.slice(),
              returnType: candidate.returnType,
            },
          };
        }
      }
      break;
    }
    offset += provider.operations.length;
  }
  return {
    ok: false,
    error:
      "profile: " +
      key.kind +
      "<" +
      key.element +
      (key.value.length === 0 ? "" : "," + key.value) +
      ">." +
      operation +
      " is not provided by the surface",
  };
}

export interface ManagedRuntimeUse {
  readonly key: ManagedRuntimeKey;
  readonly operation: string;
}
/** Compose the existing plus-one pruning maps. Synthetic signature witnesses
 * have no checked source identity and remain absent rather than aliasing zero. */
export function finalFunctionSources(
  entries: readonly number[],
  prunings: readonly Uint32Array[],
  count: number,
): readonly (number | undefined)[] {
  const result: (number | undefined)[] = [];
  for (let index = 0; index < count; index++) result.push(undefined);
  for (let original = 0; original < entries.length; original++) {
    const source = entries[original];
    if (source === undefined) continue;
    let index = original;
    for (const ids of prunings) {
      if (ids === undefined) throw "runtime pruning map invariant";
      const next = ids[index] ?? 0;
      if (next === 0) {
        index = -1;
        break;
      }
      index = next - 1;
    }
    if (index >= 0 && index < count) result[index] = source;
  }
  return result;
}

/** Produce codegen contracts without inspecting executable addresses. All uses
 * of a shared imported function must choose the same semantic operation slot. */
export function bindManagedRuntimeImports(
  directory: SerializedManagedSurfaceDirectory,
  module: ModuleIR,
  sources: readonly (number | undefined)[],
  uses: ReadonlyMap<number, readonly ManagedRuntimeUse[]>,
):
  | {
      readonly ok: true;
      readonly value: readonly ManagedFunctionEntryBinding[];
    }
  | { readonly ok: false; readonly error: string } {
  const result: ManagedFunctionEntryBinding[] = [];
  for (let index = 0; index < module.functions.length; index++) {
    const fn = module.functions[index];
    if (fn === undefined) throw "runtime import function invariant";
    if (fn.import !== true) continue;
    const source = sources[index],
      references = source === undefined ? undefined : uses.get(source);
    if (references === undefined || references.length === 0)
      return {
        ok: false,
        error: "profile: runtime import has no surface use: " + fn.name,
      };
    let selected: ManagedRuntimeSlot | undefined;
    let label = "";
    for (const use of references) {
      if (use === undefined) throw "runtime import use invariant";
      const candidate = selectManagedRuntimeSlot(
        directory,
        use.key,
        use.operation,
      );
      if (!candidate.ok) return candidate;
      if (selected !== undefined && selected.slot !== candidate.value.slot)
        return {
          ok: false,
          error: "profile: runtime import selects two surface slots",
        };
      selected = candidate.value;
      label =
        use.key.kind +
        "<" +
        use.key.element +
        (use.key.value.length === 0 ? "" : "," + use.key.value) +
        ">." +
        use.operation;
    }
    if (selected === undefined) throw "runtime import slot invariant";
    let same =
      fn.returnType === selected.returnType &&
      fn.parameters.length === selected.parameters.length;
    for (let position = 0; position < fn.parameters.length; position++) {
      const slot = fn.parameters[position];
      if (
        slot === undefined ||
        fn.slots[slot] !== selected.parameters[position]
      )
        same = false;
    }
    if (!same)
      return { ok: false, error: "profile: runtime ABI skew " + label };
    result.push({
      function: index,
      name: "$runtime" + index,
      contract: selected.contract,
      parameters: selected.parameters,
      returnType: selected.returnType,
    });
  }
  return { ok: true, value: result };
}

/** Resolve an explicitly named, restored surface type without admitting a
 * private JIT type or substituting an assignable element representation. */
export function managedRuntimeKeyForSurfaceType(
  contracts: ManagedSurfaceContractPlan,
  exportName: string,
):
  | { readonly ok: true; readonly value: ManagedRuntimeKey }
  | { readonly ok: false; readonly error: string } {
  const exported = contracts.surface.types.find(
    (type) => type !== undefined && type.name === exportName,
  );
  if (exported === undefined)
    return {
      ok: false,
      error: "profile: surface type export is missing: " + exportName,
    };
  const type = exported.type;
  if (type.kind !== "named" || (type.arguments?.length ?? 0) !== 0)
    return {
      ok: false,
      error: "profile: surface type export is missing: " + exportName,
    };
  const name = type.name;
  const census = planManagedSurfaceRuntimes(contracts);
  if (!census.ok) return census;
  const anchor = census.value.anchors.find(
    (entry) => entry !== undefined && entry.alias === name,
  );
  const key =
    anchor === undefined
      ? undefined
      : census.value.collections[anchor.provider];
  if (key === undefined)
    return {
      ok: false,
      error: "profile: surface type is not a runtime collection: " + exportName,
    };
  return {
    ok: true,
    value: { kind: key.kind, element: key.element, value: key.value },
  };
}

export interface ManagedRuntimeKeys {
  readonly lists: readonly (ManagedRuntimeKey | undefined)[];
  readonly sets: readonly (ManagedRuntimeKey | undefined)[];
  readonly maps: readonly (ManagedRuntimeKey | undefined)[];
}
/** A shared function can implement several operation uses. Preserve all of them
 * so binding rejects conflicting authority instead of choosing by ABI. */
export function describeManagedRuntimeUses(
  options: ModuleEntryOptions,
  keys: ManagedRuntimeKeys,
):
  | {
      readonly ok: true;
      readonly value: ReadonlyMap<number, readonly ManagedRuntimeUse[]>;
    }
  | { readonly ok: false; readonly error: string } {
  if (
    keys.lists.length !== (options.lists?.length ?? 0) ||
    keys.sets.length !== (options.sets?.length ?? 0) ||
    keys.maps.length !== (options.maps?.length ?? 0)
  )
    return { ok: false, error: "profile: runtime key count differs" };
  const uses = new Map<number, readonly ManagedRuntimeUse[]>();
  let error = "";
  visitRuntimeFunctions(options, (id, kind, binding, operation) => {
    const key: ManagedRuntimeKey | undefined =
      kind === "list"
        ? keys.lists[binding]
        : kind === "set"
          ? keys.sets[binding]
          : kind === "map"
            ? keys.maps[binding]
            : { kind, element: "", value: "" };
    if (key === undefined) return;
    if (key.kind !== kind) {
      error = "profile: runtime key kind differs";
      return;
    }
    const prior = uses.get(id),
      values: ManagedRuntimeUse[] = [];
    if (prior !== undefined)
      for (const value of prior) {
        if (value === undefined) throw "runtime prior use invariant";
        values.push(value);
      }
    values.push({
      key: { kind: key.kind, element: key.element, value: key.value },
      operation,
    });
    uses.set(id, values);
  });
  return error.length === 0 ? { ok: true, value: uses } : { ok: false, error };
}

/** Associate prepared runtime requirements with canonical surface element types.
 * Exact recursive equality chooses authority; ABI equality and assignability do
 * not. A private element type stays unprovided until a surviving import rejects it. */
export function managedRuntimeKeysForOptions(
  directory: SerializedManagedSurfaceDirectory,
  checked: CheckedClosures,
  aliasTypes: ReadonlyMap<string, number>,
  options: ModuleEntryOptions,
  typeContracts?: ManagedTypeContractCache,
):
  | { readonly ok: true; readonly value: ManagedRuntimeKeys }
  | { readonly ok: false; readonly error: string } {
  const compared = managedTypeContracts(checked, typeContracts);
  if (!compared.ok) return compared;
  const contracts = compared.value;
  let error: string | undefined;
  function element(value: CollectionElement): number | undefined {
    if (typeof value === "number") {
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        checked.types[value] === undefined
      ) {
        error = "profile: invalid runtime element type";
        return undefined;
      }
      return value;
    }
    const keyword: string = value;
    const id = checked.types.findIndex(
      (type) => type !== undefined && type.kind === keyword,
    );
    if (id < 0) {
      error = "profile: runtime keyword type is missing: " + keyword;
      return undefined;
    }
    return id;
  }
  function matches(source: number, alias: string): boolean {
    const target = aliasTypes.get(alias);
    if (target === undefined) {
      error = "profile: surface alias missing from JIT graph " + alias;
      return false;
    }
    const matched = contracts.matches(source, target);
    if (!matched.ok) {
      error = matched.error;
      return false;
    }
    return matched.value;
  }
  function select(
    kind: "list" | "set" | "map",
    first: number,
    second: number | undefined,
  ): ManagedRuntimeKey | undefined {
    for (const provider of directory.runtimes) {
      if (provider === undefined) throw "runtime provider matching invariant";
      if (provider.kind !== kind) continue;
      if (!matches(first, provider.element)) {
        if (error !== undefined) return undefined;
        continue;
      }
      if (kind === "map") {
        if (second === undefined) throw "runtime map value invariant";
        if (!matches(second, provider.value)) {
          if (error !== undefined) return undefined;
          continue;
        }
      }
      return {
        kind: provider.kind,
        element: provider.element,
        value: provider.value,
      };
    }
    return undefined;
  }
  const lists: (ManagedRuntimeKey | undefined)[] = [],
    sets: (ManagedRuntimeKey | undefined)[] = [],
    maps: (ManagedRuntimeKey | undefined)[] = [];
  for (const binding of options.lists ?? []) {
    if (binding === undefined) throw "runtime list requirement invariant";
    const id = element(binding.element);
    lists.push(id === undefined ? undefined : select("list", id, undefined));
  }
  for (const binding of options.sets ?? []) {
    if (binding === undefined) throw "runtime set requirement invariant";
    const id = element(binding.element);
    sets.push(id === undefined ? undefined : select("set", id, undefined));
  }
  for (const binding of options.maps ?? []) {
    if (binding === undefined) throw "runtime map requirement invariant";
    const key = element(binding.key),
      value = element(binding.value);
    maps.push(
      key === undefined || value === undefined
        ? undefined
        : select("map", key, value),
    );
  }
  return error === undefined
    ? { ok: true, value: { lists, sets, maps } }
    : { ok: false, error };
}
