import {
  checkClosureModule,
  type CheckedClosures,
} from "@tint/typescript/checker";
import {
  specializeCheckedRoots,
  type CheckedSpecializationRoot,
} from "@tint/ts-native/modules";
import { reifyTypes } from "@tint/typescript/reify";
import type {
  Module,
  Statement,
  TypeNode,
  ObjectProperty,
  Parameter,
  PropertySignature,
  BlockStatement,
} from "@tint/typescript/syntax";
import type { Type, Property } from "@tint/typescript/types";

export interface ManagedSurfaceTypeEntry {
  readonly name: string;
  readonly local: string;
}
export interface ManagedSurfaceTypeDescription {
  readonly declarations: readonly Statement[];
  readonly table: TypeNode;
  readonly types: readonly { readonly name: string; readonly type: TypeNode }[];
  readonly entries: readonly {
    readonly name: string;
    readonly local: string;
    readonly type: TypeNode;
  }[];
}
export type ManagedSurfaceTypes =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedSurfaceTypeDescription };
export interface ManagedSurfaceTypeRequest extends ManagedSurfaceTypeEntry {
  /** Type IDs belong only to the supplied checked graph, never another image. */
  readonly typeArguments: readonly number[];
}
export interface ManagedSurfacePreparation {
  readonly checked: CheckedClosures;
  readonly surface: ManagedSurfaceTypeDescription;
}
export type PreparedManagedSurfaceTypes =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedSurfacePreparation };
export type ManagedSurfaceFactory =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: ManagedSurfacePreparation & { readonly factory: string };
    };
/** Configuration names are generated ASCII identifiers, not source-language names. */
export function generatedIdentifier(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (!(
      unit === 36 ||
      unit === 95 ||
      (unit >= 65 && unit <= 90) ||
      (unit >= 97 && unit <= 122) ||
      (index > 0 && unit >= 48 && unit <= 57)
    ))
      return false;
  }
  return true;
}
function tableFactory(
  name: string,
  table: TypeNode,
  properties: readonly ObjectProperty[],
): Statement & { readonly kind: "function" } {
  return {
    start: 0,
    end: 0,
    kind: "function",
    name,
    exported: true,
    parameters: [],
    returnType: table,
    body: {
      start: 0,
      end: 0,
      kind: "block",
      statements: [
        {
          start: 0,
          end: 0,
          kind: "return",
          expression: { start: 0, end: 0, kind: "object", properties },
        },
      ],
    },
  };
}
export type ManagedSurfaceFactoryDeclaration =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: Statement & { readonly kind: "function" };
    };
/** Pure syntax for composition inside a runtime transform. The caller's normal
 * check validates it alongside existing aliases and final-pass helper bindings. */
export function managedSurfaceFactoryDeclaration(
  surface: ManagedSurfaceTypeDescription,
  name: string,
): ManagedSurfaceFactoryDeclaration {
  if (!generatedIdentifier(name))
    return {
      ok: false,
      error: "surface factory name must be a generated identifier",
    };
  const properties: ObjectProperty[] = [],
    names = new Set<string>();
  for (const entry of surface.entries) {
    if (
      entry === undefined ||
      entry.name.length === 0 ||
      entry.name.includes("\0") ||
      names.has(entry.name)
    )
      return {
        ok: false,
        error: "surface factory entries must have unique nonempty names",
      };
    names.add(entry.name);
    properties.push({
      start: 0,
      end: 0,
      name: entry.name,
      shorthand: false,
      value: { start: 0, end: 0, kind: "identifier", name: entry.local },
    });
  }
  return { ok: true, value: tableFactory(name, surface.table, properties) };
}
/** Produce a normal AOT module factory. It captures existing helper bindings;
 * it does not copy their bodies or re-run module initializers for each table. */
export function createManagedSurfaceFactory(
  prepared: ManagedSurfacePreparation,
  name: string,
): ManagedSurfaceFactory {
  const reject = (error: string): ManagedSurfaceFactory => ({
    ok: false,
    error,
  });
  const declaration = managedSurfaceFactoryDeclaration(prepared.surface, name);
  if (!declaration.ok) return declaration;
  if (prepared.checked.module.imports.length !== 0)
    return reject("surface factories require a linked module");
  if (
    prepared.checked.bindings.bindings.some(
      (binding) => binding !== undefined && binding.name === name,
    ) ||
    prepared.checked.module.statements.some(
      (statement) =>
        statement !== undefined &&
        (statement.kind === "interface" ||
          statement.kind === "type-alias" ||
          statement.kind === "class") &&
        statement.name === name,
    )
  )
    return reject("surface factory name collides with an existing declaration");
  const statements: Statement[] = prepared.checked.module.statements.slice();
  for (const declaration of prepared.surface.declarations) {
    if (
      declaration === undefined ||
      (declaration.kind !== "type-alias" && declaration.kind !== "interface")
    )
      return reject("surface metadata must contain type declarations only");
    statements.push(declaration);
  }
  statements.push(declaration.value);
  const checked = checkClosureModule({
    ...prepared.checked.module,
    statements,
  });
  if (!checked.ok) return reject(checked.error.message);
  return {
    ok: true,
    value: { checked: checked.value, surface: prepared.surface, factory: name },
  };
}
/** A reified alias and its explicitly bindable metadata reflector. */
export interface ManagedSurfaceIdentityReflector {
  readonly name: string;
  readonly function: string;
}
export type ManagedSurfaceReflectors =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: {
        readonly checked: CheckedClosures;
        readonly tableDescriptor: string;
        readonly functionBrand: string | undefined;
        readonly signatures: readonly ManagedSurfaceIdentityReflector[];
        readonly recordDescriptors: readonly ManagedSurfaceIdentityReflector[];
        readonly recordIdentities: readonly ManagedSurfaceIdentityReflector[];
        readonly typeSignatures: readonly ManagedSurfaceIdentityReflector[];
      };
    };
/** Typed declarations only. The host must explicitly authorize their record and
 * callable-inspection operations; these stubs never grant pointer authority. */
export function createManagedSurfaceReflectors(
  surface: ManagedSurfaceTypeDescription,
  prefix: string,
): ManagedSurfaceReflectors {
  const reject = (error: string): ManagedSurfaceReflectors => ({
    ok: false,
    error,
  });
  if (!generatedIdentifier(prefix))
    return reject("surface reflector prefix must be a generated identifier");
  const statements: Statement[] = [];
  for (const declaration of surface.declarations) {
    if (
      declaration === undefined ||
      (declaration.kind !== "type-alias" && declaration.kind !== "interface")
    )
      return reject("surface metadata must contain type declarations only");
    statements.push(declaration);
  }
  function reflector(
    name: string,
    parameters: readonly Parameter[],
  ): Statement & { readonly kind: "function" } {
    return {
      start: 0,
      end: 0,
      kind: "function",
      name,
      exported: true,
      parameters: parameters.map((parameter) => ({ ...parameter })),
      returnType: { start: 0, end: 0, kind: "named", name: "number" },
      body: {
        start: 0,
        end: 0,
        kind: "block",
        statements: [
          {
            start: 0,
            end: 0,
            kind: "throw",
            expression: {
              start: 0,
              end: 0,
              kind: "string",
              value: "MANAGED_SURFACE_REFLECTOR_UNBOUND",
            },
          },
        ],
      },
    };
  }
  function recordReflector(
    name: string,
    type: TypeNode,
  ): Statement & { readonly kind: "function" } {
    return reflector(name, [
      {
        start: 0,
        end: 0,
        name: "value",
        type: { start: 0, end: 0, kind: "named", name: "unknown" },
        initializer: undefined,
      },
      {
        start: 0,
        end: 0,
        name: "witness",
        type,
        initializer: undefined,
      },
    ]);
  }
  // Classify the closed declarations through the checker, including alias chains.
  // Syntax shape alone cannot identify the record/function behind an alias.
  const declared = checkClosureModule({
    start: 0,
    end: 0,
    imports: [],
    statements,
  });
  if (!declared.ok) return reject(declared.error.message);
  const recordDescriptors: ManagedSurfaceIdentityReflector[] = [];
  const recordIdentities: ManagedSurfaceIdentityReflector[] = [];
  const typeSignatures: ManagedSurfaceIdentityReflector[] = [];
  const tableDescriptor = prefix + "_table";
  const table = surface.table;
  const descriptor = recordReflector(tableDescriptor, table);
  statements.push(descriptor);
  const recordDeclarations = [descriptor];
  const typeDeclarations: (Statement & { readonly kind: "function" })[] = [];
  for (const declaration of surface.declarations) {
    if (
      declaration === undefined ||
      (declaration.kind !== "type-alias" && declaration.kind !== "interface")
    )
      return reject("surface metadata must contain type declarations only");
    const id = declared.value.typeNames.get(declaration.name);
    const type = id === undefined ? undefined : declared.value.types[id];
    if (type?.kind !== "object" && type?.kind !== "function") continue;
    const witness: TypeNode = {
      start: 0,
      end: 0,
      kind: "named",
      name: declaration.name,
    };
    if (type.kind === "object") {
      const isTable = table.kind === "named" && table.name === declaration.name;
      const name = isTable
        ? tableDescriptor
        : prefix + "_record_" + String(recordDescriptors.length);
      if (!isTable) {
        const fn = recordReflector(name, witness);
        statements.push(fn);
        recordDeclarations.push(fn);
      }
      recordDescriptors.push({ name: declaration.name, function: name });
      const identity = prefix + "_identity_" + String(recordIdentities.length);
      statements.push(
        reflector(identity, [
          {
            start: 0,
            end: 0,
            name: "witness",
            type: {
              start: 0,
              end: 0,
              kind: "union",
              members: [
                witness,
                { start: 0, end: 0, kind: "named", name: "undefined" },
              ],
            },
            initializer: undefined,
          },
        ]),
      );
      recordIdentities.push({ name: declaration.name, function: identity });
    } else {
      const name = prefix + "_type_signature_" + String(typeSignatures.length);
      const fn = reflector(name, [
        {
          start: 0,
          end: 0,
          name: "value",
          type: witness,
          initializer: undefined,
        },
      ]);
      statements.push(fn);
      typeDeclarations.push(fn);
      typeSignatures.push({ name: declaration.name, function: name });
    }
  }
  const signatures: { name: string; function: string }[] = [];
  const declarations: (Statement & { readonly kind: "function" })[] = [];
  const names = new Set<string>();
  let functionBrand: string | undefined;
  for (let index = 0; index < surface.entries.length; index++) {
    const entry = surface.entries[index];
    if (
      entry === undefined ||
      entry.name.length === 0 ||
      entry.name.includes("\0") ||
      names.has(entry.name)
    )
      return reject(
        "surface reflector entries must have unique nonempty names",
      );
    names.add(entry.name);
    const parameters: Parameter[] = [
      {
        start: 0,
        end: 0,
        name: "value",
        type: entry.type,
        initializer: undefined,
      },
    ];
    if (index === 0) {
      functionBrand = prefix + "_brand";
      statements.push(reflector(functionBrand, parameters));
    }
    const name = prefix + "_signature_" + String(index);
    const declaration = reflector(name, parameters);
    statements.push(declaration);
    declarations.push(declaration);
    signatures.push({ name: entry.name, function: name });
  }
  const checked = checkClosureModule({
    start: 0,
    end: 0,
    imports: [],
    statements,
  });
  if (!checked.ok) return reject(checked.error.message);
  const verified = checked.value;
  function parameterType(
    declaration: Statement & { readonly kind: "function" },
    index: number,
  ): Type | undefined {
    const binding = verified.bindings.bindings.find(
      (binding) =>
        binding !== undefined &&
        binding.kind === "function" &&
        binding.node === declaration,
    );
    const type =
      binding === undefined ? undefined : verified.bindingTypes[binding.id];
    const signature = type === undefined ? undefined : verified.types[type];
    const parameter =
      signature?.kind === "function" ? signature.parameters[index] : undefined;
    return parameter === undefined ? undefined : verified.types[parameter];
  }
  for (const declaration of recordDeclarations) {
    if (
      declaration === undefined ||
      parameterType(declaration, 1)?.kind !== "object"
    )
      return reject("surface table reflector requires a record type");
  }
  for (const declaration of [...declarations, ...typeDeclarations]) {
    if (
      declaration === undefined ||
      parameterType(declaration, 0)?.kind !== "function"
    )
      return reject("surface signature reflector requires a function type");
  }
  return {
    ok: true,
    value: {
      checked: verified,
      tableDescriptor,
      functionBrand,
      signatures,
      recordDescriptors,
      recordIdentities,
      typeSignatures,
    },
  };
}
/** Demand concrete helpers through the same specialization/checking path used by
 * AOT collection runtimes. The caller supplies an import-free linked module and
 * its trusted type graph; returned declarations grant no executable authority. */
export function prepareManagedSurfaceTypes(
  module: Module,
  types: readonly Type[],
  requests: readonly ManagedSurfaceTypeRequest[],
  prefix: string,
  globals: readonly string[],
  maxSpecializations: number = 4096,
): PreparedManagedSurfaceTypes {
  const roots: CheckedSpecializationRoot[] = [];
  const rootIndexes: number[] = [];
  for (const request of requests) {
    if (request === undefined)
      return { ok: false, error: "missing managed surface request" };
    const declaration = module.statements.find(
      (statement) =>
        statement !== undefined &&
        statement.kind === "function" &&
        statement.name === request.local,
    );
    if (declaration === undefined || declaration.kind !== "function")
      return {
        ok: false,
        error: "missing managed surface helper: " + request.local,
      };
    if ((declaration.typeParameters?.length ?? 0) === 0) {
      if (request.typeArguments.length !== 0)
        return {
          ok: false,
          error: "non-generic managed helper cannot take type arguments",
        };
      rootIndexes.push(0);
    } else {
      roots.push({ name: request.local, arguments: request.typeArguments });
      rootIndexes.push(roots.length);
    }
  }
  const specialized = specializeCheckedRoots(
    module,
    types,
    roots,
    globals,
    maxSpecializations,
  );
  if (!specialized.ok) return { ok: false, error: specialized.error.message };
  const checked = checkClosureModule(specialized.value.module);
  if (!checked.ok) return { ok: false, error: checked.error.message };
  const entries: ManagedSurfaceTypeEntry[] = [];
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    const root = rootIndexes[index] ?? 0;
    const local =
      root === 0 ? request?.local : specialized.value.roots[root - 1];
    if (request === undefined || local === undefined)
      return {
        ok: false,
        error: "managed surface specialization root is missing",
      };
    entries.push({ name: request.name, local });
  }
  const surface = reifyManagedSurfaceTypes(checked.value, entries, prefix);
  if (!surface.ok) return surface;
  return {
    ok: true,
    value: { checked: checked.value, surface: surface.value },
  };
}
/** Describe concrete checked helpers without restating their semantic signatures.
 * This exports types only: layouts, loader authority and publication are separate
 * contracts. Reification follows recursive types and never mutates the checker. */
export function reifyManagedSurfaceTypes(
  checked: CheckedClosures,
  entries: readonly ManagedSurfaceTypeEntry[],
  prefix: string,
  typeExports: readonly ManagedSurfaceTypeEntry[] = [],
): ManagedSurfaceTypes {
  const reject = (error: string): ManagedSurfaceTypes => ({ ok: false, error });
  if (!generatedIdentifier(prefix))
    return reject("managed surface type prefix must be an identifier");
  const roots: number[] = [];
  const properties: Property[] = [];
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry === undefined) return reject("missing managed surface entry");
    if (
      entry.name.length === 0 ||
      entry.name.includes("\0") ||
      names.has(entry.name)
    )
      return reject("managed surface entry names must be nonempty and unique");
    names.add(entry.name);
    const candidates = checked.bindings.bindings.filter(
      (binding) =>
        binding !== undefined &&
        binding.owner === undefined &&
        binding.scope === 0 &&
        binding.name === entry.local,
    );
    const binding = candidates[0];
    if (
      candidates.length !== 1 ||
      binding === undefined ||
      binding.kind !== "function"
    )
      return reject(
        "managed surface entry is not a concrete function: " + entry.local,
      );
    const type = checked.bindingTypes[binding.id];
    if (type === undefined || checked.types[type]?.kind !== "function")
      return reject(
        "managed surface entry has no checked function type: " + entry.local,
      );
    roots.push(type);
    properties.push({ name: entry.name, type, readonly: true });
  }
  const typeNames = new Set<string>();
  for (const entry of typeExports) {
    if (
      entry === undefined ||
      entry.name.length === 0 ||
      entry.name.includes("\0") ||
      typeNames.has(entry.name)
    )
      return reject("managed surface type names must be nonempty and unique");
    typeNames.add(entry.name);
    const type = checked.typeNames.get(entry.local);
    if (type === undefined)
      return reject("managed surface named type is missing: " + entry.local);
    roots.push(type);
  }
  const types: Type[] = checked.types.slice();
  const tableId = types.length;
  types.push({ kind: "object", properties });
  roots.push(tableId);
  const reified = reifyTypes(types, roots, prefix);
  if (!reified.ok) return reject(reified.error);
  const table = reified.value.roots[entries.length + typeExports.length];
  if (table === undefined)
    return reject("managed surface table type is missing");
  const exported: { name: string; local: string; type: TypeNode }[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index],
      type = reified.value.roots[index];
    if (entry === undefined || type === undefined)
      return reject("managed surface entry type is missing");
    exported.push({ name: entry.name, local: entry.local, type });
  }
  const exportedTypes: { name: string; type: TypeNode }[] = [];
  for (let index = 0; index < typeExports.length; index++) {
    const entry = typeExports[index],
      type = reified.value.roots[entries.length + index];
    if (entry === undefined || type === undefined)
      return reject("managed surface exported type is missing");
    exportedTypes.push({ name: entry.name, type });
  }
  return {
    ok: true,
    value: {
      types: exportedTypes,
      declarations: reified.value.declarations,
      table,
      entries: exported,
    },
  };
}
export type ManagedSurfaceWitnessFactory =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: {
        readonly checked: CheckedClosures;
        readonly factory: string;
        readonly entries: readonly ManagedSurfaceIdentityReflector[];
      };
    };
/** Materialize metadata-only function values for abstract callback aliases.
 * Their exact declared signatures can be inspected without a real callback
 * instance. Bodies always throw; these are never helper implementations or an
 * authorization decision. Semantic grouping/physical directory issuance is separate. */
export function createManagedSurfaceWitnessFactory(
  surface: ManagedSurfaceTypeDescription,
  prefix: string,
): ManagedSurfaceWitnessFactory {
  const reject = (error: string): ManagedSurfaceWitnessFactory => ({
    ok: false,
    error,
  });
  if (!generatedIdentifier(prefix))
    return reject("surface witness prefix must be a generated identifier");
  const statements: Statement[] = surface.declarations.slice(),
    aliases = new Map<string, TypeNode>();
  for (const declaration of surface.declarations) {
    if (
      declaration === undefined ||
      declaration.kind !== "type-alias" ||
      (declaration.typeParameters?.length ?? 0) !== 0
    )
      return reject("surface witnesses require concrete reified aliases");
    aliases.set(declaration.name, declaration.type);
  }
  const declared = checkClosureModule({
    start: 0,
    end: 0,
    imports: [],
    statements,
  });
  if (!declared.ok) return reject(declared.error.message);
  const graph = declared.value;
  const properties: ObjectProperty[] = [],
    fields: PropertySignature[] = [],
    entries: ManagedSurfaceIdentityReflector[] = [];
  for (const declaration of surface.declarations) {
    if (declaration === undefined || declaration.kind !== "type-alias")
      return reject("surface witnesses require reified aliases");
    const id = graph.typeNames.get(declaration.name);
    if (id === undefined || graph.types[id]?.kind !== "function") continue;
    let type = declaration.type;
    const seen = new Set<string>();
    while (type.kind === "group" || type.kind === "named") {
      if (type.kind === "group") {
        type = type.type;
        continue;
      }
      if ((type.arguments?.length ?? 0) !== 0 || seen.has(type.name))
        return reject("invalid callback alias chain");
      seen.add(type.name);
      const next = aliases.get(type.name);
      if (next === undefined) return reject("missing callback alias");
      type = next;
    }
    if (type.kind !== "function" || type.async)
      return reject("surface witness requires a synchronous function type");
    const name = prefix + "_witness_" + String(entries.length);
    if (
      graph.bindings.bindings.some(
        (binding) => binding !== undefined && binding.name === name,
      ) ||
      aliases.has(name)
    )
      return reject(
        "surface witness name collides with an existing declaration",
      );
    const body: BlockStatement = {
      start: 0,
      end: 0,
      kind: "block",
      statements: [
        {
          start: 0,
          end: 0,
          kind: "throw",
          expression: {
            start: 0,
            end: 0,
            kind: "string",
            value: "MANAGED_SIGNATURE_WITNESS",
          },
        },
      ],
    };
    const fn: Statement & { readonly kind: "function" } = {
      start: 0,
      end: 0,
      kind: "function",
      name,
      exported: false,
      parameters: type.parameters.map((parameter) => ({ ...parameter })),
      returnType: type.returnType,
      body,
    };
    const receiver = type.receiver;
    statements.push(receiver === undefined ? fn : { ...fn, receiver });
    entries.push({ name: declaration.name, function: name });
    properties.push({
      start: 0,
      end: 0,
      name: declaration.name,
      shorthand: false,
      value: { start: 0, end: 0, kind: "identifier", name },
    });
    fields.push({
      start: 0,
      end: 0,
      name: declaration.name,
      readonly: true,
      type: { start: 0, end: 0, kind: "named", name: declaration.name },
    });
  }
  const factory = prefix + "_create";
  if (aliases.has(factory))
    return reject(
      "surface witness factory name collides with an existing declaration",
    );
  statements.push(
    tableFactory(
      factory,
      { start: 0, end: 0, kind: "object", properties: fields },
      properties,
    ),
  );
  const checked = checkClosureModule({
    start: 0,
    end: 0,
    imports: [],
    statements,
  });
  if (!checked.ok) return reject(checked.error.message);
  return { ok: true, value: { checked: checked.value, factory, entries } };
}
