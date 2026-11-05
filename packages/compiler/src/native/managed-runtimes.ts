import {
  createRuntimeEntryStubs,
  type RuntimeEntryABI,
  type RuntimeEntryPlan,
  type RuntimeEntryStub,
} from "./managed-runtime-entries.ts";
import type { ScalarType, ReturnType } from "@tint/ir/scalar";
import { managedIdentityByteLength } from "./managed-imports.ts";
import {
  type RuntimeBindingContext,
  listOperations,
  setOperations,
  mapOperations,
  primitiveOperations,
  numberTextOperations,
} from "@tint/ts-native/runtime";
import { generatedIdentifier } from "./managed-surfaces.ts";
import type { Statement, TypeNode } from "@tint/typescript/syntax";
import type { CheckedClosures } from "@tint/typescript/checker";
import type { ManagedSurfaceTypeDescription } from "./managed-surfaces.ts";

export interface ManagedRuntimeTypeSource {
  readonly surface: ManagedSurfaceTypeDescription;
  readonly checked: CheckedClosures;
}
export interface ManagedRuntimeProviderKey {
  readonly kind: "list" | "set" | "map" | "primitive" | "number-text";
  readonly element: string;
  readonly value: string;
  readonly operations: readonly string[];
}
export interface ManagedSurfaceRuntimeKey extends ManagedRuntimeProviderKey {
  readonly kind: "list" | "set" | "map";
}
export interface ManagedSurfaceRuntimeCensus {
  readonly collections: readonly ManagedSurfaceRuntimeKey[];
  readonly anchors: readonly {
    readonly alias: string;
    readonly provider: number;
  }[];
}
function ungroup(node: TypeNode): TypeNode {
  while (node.kind === "group") node = node.type;
  return node;
}
function alias(node: TypeNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  const value = ungroup(node);
  return value.kind === "named" && (value.arguments?.length ?? 0) === 0
    ? value.name
    : undefined;
}
/** Canonical aliases define public keys. Mutual assignability may share an AOT
 * instance, but neither that grouping nor checker IDs enter the directory. */
export function planManagedSurfaceRuntimes(
  contracts: ManagedRuntimeTypeSource,
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedSurfaceRuntimeCensus } {
  const collections: ManagedSurfaceRuntimeKey[] = [],
    anchors: { alias: string; provider: number }[] = [];
  const keys = new Map<string, number>(),
    aliases = new Set<string>();
  for (const declaration of contracts.surface.declarations) {
    if (declaration === undefined || declaration.kind !== "type-alias")
      return {
        ok: false,
        error: "surface runtime: canonical aliases required",
      };
    aliases.add(declaration.name);
  }
  for (const declaration of contracts.surface.declarations) {
    if (declaration === undefined || declaration.kind !== "type-alias")
      throw "surface runtime alias invariant";
    const id = contracts.checked.typeNames.get(declaration.name),
      type = id === undefined ? undefined : contracts.checked.types[id];
    if (type === undefined)
      return {
        ok: false,
        error: "surface runtime: missing checked alias " + declaration.name,
      };
    if (type.kind !== "array" && type.kind !== "set" && type.kind !== "map")
      continue;
    const syntax = ungroup(declaration.type);
    const kind: "list" | "set" | "map" =
      type.kind === "array" ? "list" : type.kind;
    const element =
      syntax.kind === "array"
        ? alias(syntax.element)
        : syntax.kind === "named"
          ? alias(syntax.arguments?.[0])
          : undefined;
    const value =
      kind === "map" && syntax.kind === "named"
        ? alias(syntax.arguments?.[1])
        : "";
    if (
      element === undefined ||
      !aliases.has(element) ||
      value === undefined ||
      (kind === "map" && !aliases.has(value))
    )
      return {
        ok: false,
        error:
          "surface runtime: unsupported element syntax " + declaration.name,
      };
    const key = kind + "/" + element + "/" + value;
    let provider = keys.get(key);
    if (provider === undefined) {
      provider = collections.length;
      keys.set(key, provider);
      collections.push({
        kind,
        element,
        value,
        operations:
          kind === "list"
            ? listOperations
            : kind === "set"
              ? setOperations
              : mapOperations,
      });
    }
    anchors.push({ alias: declaration.name, provider });
  }
  return { ok: true, value: { collections, anchors } };
}

export interface ManagedRuntimeAnchorPlan {
  readonly declarations: readonly Statement[];
  readonly anchors: readonly {
    readonly name: string;
    readonly alias: string;
    readonly provider: number;
  }[];
}
function collectionAnchor(
  name: string,
  type: string,
  property: string,
): Statement & { readonly kind: "function" } {
  return {
    start: 0,
    end: 0,
    kind: "function",
    name,
    exported: true,
    parameters: [
      {
        start: 0,
        end: 0,
        name: "value",
        type: { start: 0, end: 0, kind: "named", name: type },
      },
    ],
    returnType: { start: 0, end: 0, kind: "named", name: "number" },
    body: {
      start: 0,
      end: 0,
      kind: "block",
      statements: [
        {
          start: 0,
          end: 0,
          kind: "return",
          expression: {
            start: 0,
            end: 0,
            kind: "member",
            object: { start: 0, end: 0, kind: "identifier", name: "value" },
            property,
          },
        },
      ],
    },
  };
}
/** Inert demands run through the same runtime selection as application code.
 * Keep these declarations across transform retries and retain them by name. */
export function createManagedRuntimeAnchors(
  census: ManagedSurfaceRuntimeCensus,
  prefix: string,
  typeName?: (alias: string) => string,
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedRuntimeAnchorPlan } {
  if (!generatedIdentifier(prefix))
    return {
      ok: false,
      error: "surface runtime: anchor prefix must be a generated identifier",
    };
  const declarations: Statement[] = [],
    anchors: { name: string; alias: string; provider: number }[] = [];
  for (let index = 0; index < census.anchors.length; index++) {
    const anchor = census.anchors[index];
    if (anchor === undefined) throw "runtime anchor invariant";
    const provider = census.collections[anchor.provider];
    if (provider === undefined)
      return { ok: false, error: "surface runtime: missing anchor provider" };
    const name = prefix + "_collection_" + index;
    declarations.push(
      collectionAnchor(
        name,
        typeName === undefined ? anchor.alias : typeName(anchor.alias),
        provider.kind === "list" ? "length" : "size",
      ),
    );
    anchors.push({ name, alias: anchor.alias, provider: anchor.provider });
  }
  return { ok: true, value: { declarations, anchors } };
}

export interface ManagedRuntimeNamePlan {
  readonly providers: readonly {
    readonly key: ManagedRuntimeProviderKey;
    readonly targets: readonly string[];
  }[];
  readonly targets: readonly string[];
}
/** Ask every subject on every pass. Type IDs and predicted names never survive a
 * runtime-transform retry; the context rechecks these answers against selection. */
export function resolveManagedCollectionNames(
  context: RuntimeBindingContext,
  census: ManagedSurfaceRuntimeCensus,
  anchors: ManagedRuntimeAnchorPlan,
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedRuntimeNamePlan } {
  const failure = (
    error: string,
  ): { readonly ok: false; readonly error: string } => ({
    ok: false,
    error: "surface runtime: " + error,
  });
  if (anchors.anchors.length !== census.anchors.length)
    return failure("anchor count differs");
  const selected = new Map<number, readonly string[]>(),
    targets: string[] = [],
    seen = new Set<string>();
  for (let index = 0; index < anchors.anchors.length; index++) {
    const anchor = anchors.anchors[index],
      expected = census.anchors[index];
    if (anchor === undefined || expected === undefined)
      throw "runtime name anchor invariant";
    if (
      anchor.alias !== expected.alias ||
      anchor.provider !== expected.provider
    )
      return failure("anchor identity differs");
    const key = census.collections[anchor.provider];
    if (key === undefined) return failure("missing anchor provider");
    const result = context.collection({ function: anchor.name, parameter: 0 });
    if (!result.ok) return result;
    if (
      result.value.kind !== key.kind ||
      result.value.operations.size !== key.operations.length
    )
      return failure("operation vocabulary differs: " + anchor.alias);
    const names: string[] = [];
    for (const operation of key.operations) {
      if (operation === undefined) throw "runtime operation invariant";
      const name = result.value.operations.get(operation);
      if (name === undefined) return failure("operation missing: " + operation);
      names.push(name);
    }
    const prior = selected.get(anchor.provider);
    if (prior !== undefined) {
      if (
        prior.length !== names.length ||
        prior.some((name, index) => name !== names[index])
      )
        return failure(
          "runtime key resolves to two instances: " + anchor.alias,
        );
    } else selected.set(anchor.provider, names);
  }
  const providers: {
    key: ManagedSurfaceRuntimeKey;
    targets: readonly string[];
  }[] = [];
  for (let index = 0; index < census.collections.length; index++) {
    const key = census.collections[index],
      names = selected.get(index);
    if (key === undefined || names === undefined)
      return failure("provider has no anchor");
    providers.push({ key, targets: names });
    for (const name of names) {
      if (name === undefined) throw "runtime name invariant";
      if (!seen.has(name)) {
        seen.add(name);
        targets.push(name);
      }
    }
  }
  return { ok: true, value: { providers, targets } };
}

/** Numeric and primitive providers follow collection keys in canonical order.
 * Their availability is explicit; absent host-linked helpers are never copied. */
export function resolveManagedRuntimeNames(
  context: RuntimeBindingContext,
  census: ManagedSurfaceRuntimeCensus,
  anchors: ManagedRuntimeAnchorPlan,
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedRuntimeNamePlan } {
  const collections = resolveManagedCollectionNames(context, census, anchors);
  if (!collections.ok) return collections;
  const providers = collections.value.providers.slice(),
    targets = collections.value.targets.slice(),
    seen = new Set<string>();
  for (const name of targets) {
    if (name === undefined) throw "runtime target invariant";
    seen.add(name);
  }
  const primitives = context.primitives();
  if (primitives !== undefined) {
    if (primitives.size !== primitiveOperations.length)
      return {
        ok: false,
        error: "surface runtime: primitive operation vocabulary differs",
      };
    const names: string[] = [];
    for (const operation of primitiveOperations) {
      if (operation === undefined) throw "primitive operation invariant";
      const name = primitives.get(operation);
      if (name === undefined)
        return {
          ok: false,
          error: "surface runtime: primitive operation missing: " + operation,
        };
      names.push(name);
    }
    providers.push({
      key: {
        kind: "primitive",
        element: "",
        value: "",
        operations: primitiveOperations,
      },
      targets: names,
    });
  }
  const numberText = context.numberText();
  if (numberText !== undefined)
    providers.push({
      key: {
        kind: "number-text",
        element: "",
        value: "",
        operations: numberTextOperations,
      },
      targets: [numberText.toString, numberText.fromString],
    });
  for (const provider of providers) {
    if (provider === undefined) throw "runtime provider invariant";
    for (const name of provider.targets) {
      if (name === undefined) throw "runtime target invariant";
      if (!seen.has(name)) {
        seen.add(name);
        targets.push(name);
      }
    }
  }
  return { ok: true, value: { providers, targets } };
}

export interface ManagedRuntimeOperationABI {
  readonly operation: string;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ReturnType;
}
export interface ManagedRuntimeProvider {
  readonly kind: "list" | "set" | "map" | "primitive" | "number-text";
  readonly element: string;
  readonly value: string;
  readonly operations: readonly ManagedRuntimeOperationABI[];
}
/** Layout and application lowering supply ABIs independently. This conversion
 * preserves canonical slot order without retaining graph IDs or symbol names. */
export function materializeManagedRuntimeProviders(
  plan: ManagedRuntimeNamePlan,
  lookup: (name: string) =>
    | {
        readonly parameters: readonly ScalarType[];
        readonly returnType: ReturnType;
      }
    | undefined,
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: readonly ManagedRuntimeProvider[] } {
  const providers: ManagedRuntimeProvider[] = [];
  for (const provider of plan.providers) {
    if (provider === undefined) throw "runtime provider invariant";
    if (provider.key.operations.length !== provider.targets.length)
      return {
        ok: false,
        error: "surface layout: runtime operation count differs",
      };
    const operations: ManagedRuntimeOperationABI[] = [];
    for (let index = 0; index < provider.targets.length; index++) {
      const name = provider.targets[index],
        operation = provider.key.operations[index];
      if (name === undefined || operation === undefined)
        throw "runtime slot invariant";
      const abi = lookup(name);
      if (abi === undefined)
        return {
          ok: false,
          error: "surface layout: missing runtime ABI " + name,
        };
      if (
        managedIdentityByteLength({
          role: "signature",
          parameters: abi.parameters,
          returnType: abi.returnType,
        }) === undefined
      )
        return {
          ok: false,
          error: "surface layout: invalid runtime ABI " + name,
        };
      operations.push({
        operation,
        parameters: abi.parameters.slice(),
        returnType: abi.returnType,
      });
    }
    providers.push({
      kind: provider.key.kind,
      element: provider.key.element,
      value: provider.key.value,
      operations,
    });
  }
  return { ok: true, value: providers };
}

export interface ManagedRuntimeEntrySlots {
  readonly stubs: RuntimeEntryPlan;
  readonly slots: readonly RuntimeEntryStub[];
}
function sameABI(left: RuntimeEntryABI, right: RuntimeEntryABI): boolean {
  return (
    left.returnType === right.returnType &&
    left.parameters.length === right.parameters.length &&
    left.parameters.every((type, index) => type === right.parameters[index])
  );
}
/** Select stubs from directory contracts, not inferred ABI equality. Reusing an
 * entry for two slots is valid only when both slots require the same ABI. */
export function prepareManagedRuntimeEntries(
  names: ManagedRuntimeNamePlan,
  providers: readonly ManagedRuntimeProvider[],
  prefix: string,
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedRuntimeEntrySlots } {
  const failure = (
    message: string,
  ): { readonly ok: false; readonly error: string } => ({
    ok: false,
    error: "surface runtime: " + message,
  });
  if (providers.length !== names.providers.length)
    return failure("provider count differs from directory");
  const abis = new Map<string, RuntimeEntryABI>(),
    slots: string[] = [];
  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index],
      named = names.providers[index];
    if (provider === undefined || named === undefined)
      throw "runtime entry provider invariant";
    if (
      provider.kind !== named.key.kind ||
      provider.element !== named.key.element ||
      provider.value !== named.key.value ||
      provider.operations.length !== named.targets.length ||
      provider.operations.length !== named.key.operations.length
    )
      return failure(
        "provider differs from directory: " +
          provider.kind +
          "<" +
          provider.element +
          "," +
          provider.value +
          ">",
      );
    for (let position = 0; position < provider.operations.length; position++) {
      const operation = provider.operations[position],
        name = named.targets[position];
      if (operation === undefined || name === undefined)
        throw "runtime entry operation invariant";
      if (operation.operation !== named.key.operations[position])
        return failure(
          "provider operation differs from directory: " + operation.operation,
        );
      const prior = abis.get(name);
      if (prior !== undefined && !sameABI(prior, operation))
        return failure("target ABI differs across slots: " + name);
      abis.set(name, {
        parameters: operation.parameters,
        returnType: operation.returnType,
      });
      slots.push(name);
    }
  }
  const parameters: RuntimeEntryABI[] = [];
  for (const name of names.targets) {
    if (name === undefined) throw "runtime entry name invariant";
    const abi = abis.get(name);
    if (abi === undefined) return failure("target ABI is missing: " + name);
    parameters.push(abi);
  }
  const stubs = createRuntimeEntryStubs(names.targets, prefix, parameters);
  if (!stubs.ok) return stubs;
  const entries = new Map<string, RuntimeEntryStub>();
  for (const entry of stubs.value.entries) {
    if (entry === undefined) throw "runtime entry stub invariant";
    entries.set(entry.target, entry);
  }
  const result: RuntimeEntryStub[] = [];
  for (const name of slots) {
    if (name === undefined) throw "runtime slot invariant";
    const entry = entries.get(name);
    if (entry === undefined)
      return failure("runtime entry is missing: " + name);
    result.push(entry);
  }
  return { ok: true, value: { stubs: stubs.value, slots: result } };
}

/** Rebuild the canonical vocabulary from restored aliases. Optional primitive
 * services are explicit providers; collection providers are always required. */
export function validateManagedRuntimeProviders(
  census: ManagedSurfaceRuntimeCensus,
  actual: readonly ManagedRuntimeProvider[],
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: readonly ManagedRuntimeProvider[] } {
  const keys: ManagedRuntimeProviderKey[] = [];
  for (const key of census.collections) {
    if (key === undefined) throw "surface runtime key invariant";
    keys.push({
      kind: key.kind,
      element: key.element,
      value: key.value,
      operations: key.operations,
    });
  }
  if (
    actual.some(
      (provider) => provider !== undefined && provider.kind === "primitive",
    )
  )
    keys.push({
      kind: "primitive",
      element: "",
      value: "",
      operations: primitiveOperations,
    });
  if (
    actual.some(
      (provider) => provider !== undefined && provider.kind === "number-text",
    )
  )
    keys.push({
      kind: "number-text",
      element: "",
      value: "",
      operations: numberTextOperations,
    });
  if (actual.length !== keys.length)
    return {
      ok: false,
      error:
        actual.length < keys.length
          ? "missing runtime fact"
          : "unexpected runtime fact",
    };
  const result: ManagedRuntimeProvider[] = [];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index],
      provider = actual[index];
    if (key === undefined || provider === undefined)
      return { ok: false, error: "missing runtime fact" };
    if (
      key.kind !== provider.kind ||
      key.element !== provider.element ||
      key.value !== provider.value ||
      key.operations.length !== provider.operations.length
    )
      return {
        ok: false,
        error:
          "runtime provider differs: " +
          key.kind +
          "<" +
          key.element +
          "," +
          key.value +
          ">",
      };
    const operations: ManagedRuntimeOperationABI[] = [];
    for (let position = 0; position < key.operations.length; position++) {
      const operation = provider.operations[position];
      if (
        operation === undefined ||
        operation.operation !== key.operations[position]
      )
        return { ok: false, error: "runtime operations differ: " + key.kind };
      if (
        managedIdentityByteLength({
          role: "signature",
          parameters: operation.parameters,
          returnType: operation.returnType,
        }) === undefined
      )
        return {
          ok: false,
          error: "invalid runtime ABI: " + operation.operation,
        };
      operations.push({
        operation: operation.operation,
        parameters: operation.parameters.slice(),
        returnType: operation.returnType,
      });
    }
    result.push({
      kind: key.kind,
      element: key.element,
      value: key.value,
      operations,
    });
  }
  return { ok: true, value: result };
}
