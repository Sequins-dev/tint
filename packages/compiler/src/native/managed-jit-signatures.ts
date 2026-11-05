import {
  checkManagedFunctionFlows,
  type ManagedFunctionClass,
} from "./managed-jit-function-flows.ts";
import type {
  ManagedIdentityImport,
  ManagedSignatureBinding,
} from "@tint/codegen/aarch64/scalar";
import type { ScalarType, ReturnType } from "@tint/ir/scalar";
import { createTypeSystem } from "@tint/typescript/types";
import type { ManagedJitRecordTypes } from "./managed-jit-records.ts";
import type { LoweredManagedJitProgram } from "./managed-jit-program.ts";
import {
  createManagedTypeContractIndex,
  managedFunctionType,
  planManagedSignatureGroups,
  lowerManagedSignatureGroups,
  type ManagedSignatureGroupRequest,
} from "./managed-contracts.ts";
import { managedSurfaceContract } from "./managed-directory-reader.ts";
export interface ManagedJitSignatureSurface {
  readonly name: string;
  readonly digest: string;
  readonly signatures: readonly {
    readonly alias: string;
    readonly aliases: readonly string[];
    readonly parameters: readonly ScalarType[];
    readonly returnType: ReturnType;
  }[];
}
export interface ManagedJitSignatures {
  readonly brand: ManagedIdentityImport | undefined;
  readonly signatures: readonly ManagedSignatureBinding[];
  readonly privateWitnesses: readonly number[];
}
export type ManagedJitSignatureBindings =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedJitSignatures };
/** Semantic membership precedes descriptor selection. Machine ABI agreement is
 * checked by emission; it never authorizes a callback or merges two classes. */
export function bindManagedJitSignatures(
  program: ManagedJitRecordTypes,
  lowered: LoweredManagedJitProgram,
  surface: ManagedJitSignatureSurface,
  direct: readonly number[],
): ManagedJitSignatureBindings {
  const reject = (error: string): ManagedJitSignatureBindings => ({
    ok: false,
    error: "profile: " + error,
  });
  const graph = program.checked,
    compared = createManagedTypeContractIndex(graph.types);
  if (!compared.ok) return reject(compared.error);
  const comparison = compared.value;
  const classes: number[][] = [],
    classified = new Map<number, number>();
  for (const signature of surface.signatures) {
    if (signature === undefined)
      return reject("missing surface signature class");
    const types: number[] = [];
    for (const alias of [signature.alias, ...signature.aliases]) {
      if (alias === undefined) return reject("missing surface signature alias");
      const type = program.aliasTypes.get(alias);
      if (type === undefined)
        return reject("surface signature alias is missing: " + alias);
      if (graph.types[type]?.kind !== "function")
        return reject("surface signature alias is not callable: " + alias);
      if (!types.includes(type)) types.push(type);
    }
    classes.push(types);
  }
  function classOf(type: number): ManagedFunctionClass {
    const cached = classified.get(type);
    if (cached !== undefined)
      return { ok: true, value: cached === 0 ? undefined : cached - 1 };
    let found: number | undefined = undefined;
    for (let index = 0; index < classes.length; index++) {
      const types = classes[index];
      if (types === undefined)
        return { ok: false, error: "missing signature class" };
      let matched = false;
      for (const candidate of types) {
        if (candidate === undefined)
          return { ok: false, error: "missing class type" };
        const match = comparison.matches(type, candidate);
        if (!match.ok) return match;
        if (match.value) {
          matched = true;
          break;
        }
      }
      if (matched) {
        if (found !== undefined)
          return {
            ok: false,
            error: "callback type matches several surface classes",
          };
        found = index;
      }
    }
    classified.set(type, found === undefined ? 0 : found + 1);
    return { ok: true, value: found };
  }
  function retained(id: number): number | undefined {
    let current = id;
    for (const map of lowered.functionMaps) {
      if (map === undefined) return undefined;
      const next = map[current] ?? 0;
      if (next === 0) return undefined;
      current = next - 1;
    }
    return current;
  }
  const witnessTypes = new Map<number, number>(),
    signatureTypes = lowered.signatureTypes;
  if (signatureTypes === undefined)
    return reject("semantic witness identities are missing");
  for (let type = 0; type < signatureTypes.length; type++) {
    const encoded = signatureTypes[type] ?? 0;
    if (encoded === 0) continue;
    const witness = retained(encoded - 1);
    if (witness === undefined) continue;
    if (
      graph.types[type]?.kind !== "function" ||
      lowered.module.functions[witness] === undefined ||
      lowered.module.functions[witness]?.import
    )
      return reject("invalid semantic witness");
    const previous = witnessTypes.get(witness);
    if (previous !== undefined) {
      const match = comparison.matches(previous, type);
      if (!match.ok) return reject(match.error);
      if (!match.value)
        return reject("semantic witness serves different types");
    } else witnessTypes.set(witness, type);
  }
  const targets = new Set<number>();
  for (const fn of lowered.module.functions) {
    if (fn === undefined) return reject("missing JIT function");
    for (const block of fn.blocks) {
      if (block === undefined) return reject("missing JIT block");
      for (const op of block.instructions) {
        if (op === undefined) return reject("missing JIT instruction");
        if (op.kind === "call-indirect" && !witnessTypes.has(op.target))
          return reject("call-indirect without a semantic witness");
        if (op.kind === "function-new") {
          if (witnessTypes.has(op.target))
            return reject("witness used as a closure");
          targets.add(op.target);
        }
      }
    }
  }
  const candidates: number[][] = [],
    members: number[][] = [],
    witnesses: number[][] = [];
  for (let index = 0; index < classes.length; index++) {
    candidates.push([]);
    members.push([]);
    witnesses.push([]);
  }
  const proof = new Set(direct),
    targetClasses = new Map<number, number>(),
    targetTypes = new Map<number, number>();
  for (const target of targets) {
    const source = lowered.sources[target];
    if (source === undefined)
      return reject("JIT closure has no source identity");
    const type = managedFunctionType(graph, source);
    if (type === undefined)
      return reject("JIT closure has no checked function type");
    targetTypes.set(target, type);
    const selected = classOf(type);
    if (!selected.ok) return reject(selected.error);
    const group = selected.value;
    if (group === undefined) {
      if (!proof.has(source))
        return reject("JIT closure without an exact surface callback class");
      continue;
    }
    targetClasses.set(target, group);
    const sources = candidates[group];
    if (sources === undefined) return reject("missing callback class");
    if (!sources.includes(source)) sources.push(source);
  }
  const requests: ManagedSignatureGroupRequest[] = [],
    requestClasses = new Map<string, number>();
  for (let index = 0; index < classes.length; index++) {
    const sources = candidates[index],
      types = classes[index],
      type = types?.[0];
    if (sources === undefined || types === undefined || type === undefined)
      return reject("missing callback class types");
    if (sources.length === 0) continue;
    const name = "$signature" + String(index);
    requestClasses.set(name, index);
    requests.push({
      name,
      contract: managedSurfaceContract(
        surface.name,
        surface.digest,
        "fn",
        index,
      ),
      type,
      aliases: types.slice(1),
      functions: sources,
    });
  }
  const planned = planManagedSignatureGroups(graph, requests);
  if (!planned.ok) return reject(planned.error);
  const loweredGroups = lowerManagedSignatureGroups(
    planned.value,
    lowered.entries,
    signatureTypes,
    lowered.functionMaps,
  );
  if (!loweredGroups.ok) return reject(loweredGroups.error);
  const assigned = new Set<number>();
  for (const group of loweredGroups.value) {
    if (group === undefined) return reject("missing lowered signature group");
    const index = requestClasses.get(group.name);
    if (index === undefined)
      return reject("unexpected lowered signature group");
    const local = members[index],
      owned = witnesses[index];
    if (local === undefined || owned === undefined)
      return reject("missing lowered callback class");
    for (const fn of group.functions) {
      if (fn === undefined) return reject("missing lowered signature function");
      const type = witnessTypes.get(fn);
      if (type !== undefined) {
        const selected = classOf(type);
        if (!selected.ok) return reject(selected.error);
        if (selected.value !== index)
          return reject("witness class differs from member class");
        owned.push(fn);
        assigned.add(fn);
      } else {
        if (!targets.has(fn) || targetClasses.get(fn) !== index)
          return reject("unexpected lowered signature member");
        local.push(fn);
      }
    }
  }
  const privateWitnesses: number[] = [];
  for (const [witness, type] of witnessTypes) {
    if (assigned.has(witness)) continue;
    const selected = classOf(type);
    if (!selected.ok) return reject(selected.error);
    const index = selected.value;
    if (index === undefined) privateWitnesses.push(witness);
    else {
      const owned = witnesses[index];
      if (owned === undefined) return reject("missing witness class");
      owned.push(witness);
    }
  }
  const typeSystem = createTypeSystem(graph.types);
  if (!typeSystem.ok) return reject(typeSystem.error);
  for (const target of targets) {
    const source = lowered.sources[target];
    if (source === undefined)
      return reject("JIT closure has no source identity");
    if (proof.has(source)) continue;
    const type = targetTypes.get(target),
      index = targetClasses.get(target);
    if (type === undefined || index === undefined)
      return reject("JIT closure without an exact surface callback class");
    for (const [witness, witnessType] of witnessTypes) {
      const selected = classOf(witnessType);
      if (!selected.ok) return reject(selected.error);
      if (
        selected.value !== index &&
        typeSystem.value.assignable(type, witnessType)
      )
        return reject("callback variance crosses surface classes");
    }
  }
  const flows = checkManagedFunctionFlows(
    graph,
    classOf,
    typeSystem.value.assignable,
  );
  if (!flows.ok) return reject(flows.error);
  const bindings: ManagedSignatureBinding[] = [];
  for (let index = 0; index < classes.length; index++) {
    const local = members[index],
      owned = witnesses[index],
      signature = surface.signatures[index];
    if (local === undefined || owned === undefined || signature === undefined)
      return reject("missing emitted signature class");
    local.sort((a, b) => a - b);
    owned.sort((a, b) => a - b);
    const contract = managedSurfaceContract(
        surface.name,
        surface.digest,
        "fn",
        index,
      ),
      name = "$signature" + String(index);
    if (owned.length === 0) {
      if (local.length !== 0)
        bindings.push({
          name,
          contract,
          localFunctions: local,
          parameters: signature.parameters,
          returnType: signature.returnType,
        });
      continue;
    }
    for (let ordinal = 0; ordinal < owned.length; ordinal++) {
      const witness = owned[ordinal];
      if (witness === undefined) return reject("missing emitted witness");
      bindings.push({
        name: ordinal === 0 ? name : name + "$" + String(ordinal),
        contract,
        witness,
        ...(ordinal === 0 && local.length !== 0
          ? { localFunctions: local }
          : {}),
        parameters: signature.parameters,
        returnType: signature.returnType,
      });
    }
  }
  privateWitnesses.sort((a, b) => a - b);
  return {
    ok: true,
    value: {
      brand:
        bindings.length === 0
          ? undefined
          : { name: "tint.function.v1", contract: "tint.function.v1" },
      signatures: bindings,
      privateWitnesses,
    },
  };
}
