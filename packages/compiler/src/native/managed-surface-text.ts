import { createSourceTextView } from "@tint/source/text";
import {
  typeParameterCount,
  parseModule,
  rewriteModule,
  type Statement,
  type TypeNode,
} from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { printReifiedTypes } from "@tint/typescript/reify";
import type {
  ManagedSurfaceTypeDescription,
  ManagedSurfaceTypes,
} from "./managed-surfaces.ts";
/** Plain typed loader data. This carries declarations, never pointer authority,
 * layouts, module state or permission to execute the described helpers. */
export interface SerializedManagedSurfaceTypes {
  readonly version: number;
  readonly declarations: string;
  readonly table: string;
  readonly types: readonly { readonly name: string; readonly type: string }[];
  readonly entries: readonly {
    readonly name: string;
    readonly local: string;
    readonly type: string;
  }[];
}
export type ManagedSurfaceSerialization =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: SerializedManagedSurfaceTypes };
function text(value: string): boolean {
  return value.length > 0 && !value.includes("\0");
}
/** Restoration is a pure function of its serialized value. One owner (a
 * directory read or creation) may reuse an earlier result for an exactly equal
 * value instead of reparsing and rechecking the same declaration graph. */
export interface ManagedSurfaceRestorations {
  readonly restore: (
    serialized: SerializedManagedSurfaceTypes,
  ) => ManagedSurfaceTypes;
}
function sameSerializedSurface(
  left: SerializedManagedSurfaceTypes,
  right: SerializedManagedSurfaceTypes,
): boolean {
  if (
    left.version !== right.version ||
    left.declarations !== right.declarations ||
    left.table !== right.table ||
    left.entries.length !== right.entries.length ||
    left.types.length !== right.types.length
  )
    return false;
  for (let index = 0; index < left.entries.length; index++) {
    const a = left.entries[index],
      b = right.entries[index];
    if (
      a === undefined ||
      b === undefined ||
      a.name !== b.name ||
      a.local !== b.local ||
      a.type !== b.type
    )
      return false;
  }
  for (let index = 0; index < left.types.length; index++) {
    const a = left.types[index],
      b = right.types[index];
    if (
      a === undefined ||
      b === undefined ||
      a.name !== b.name ||
      a.type !== b.type
    )
      return false;
  }
  return true;
}
/** Owner-scoped and short-lived; never a process-global table of surfaces. */
export function createManagedSurfaceRestorations(): ManagedSurfaceRestorations {
  const known: {
    readonly serialized: SerializedManagedSurfaceTypes;
    readonly result: ManagedSurfaceTypes;
  }[] = [];
  function restore(
    serialized: SerializedManagedSurfaceTypes,
  ): ManagedSurfaceTypes {
    for (const entry of known) {
      if (entry === undefined) throw "surface restoration invariant";
      if (sameSerializedSurface(entry.serialized, serialized))
        return entry.result;
    }
    const result = restoreManagedSurfaceTypes(serialized);
    known.push({ serialized, result });
    return result;
  }
  return { restore };
}
/** Reparse and check a closed declaration graph. Never evaluate declarations or
 * infer native authorization from their shapes. Physical linking validates the
 * separately issued contracts and metadata windows. */
export function restoreManagedSurfaceTypes(
  serialized: SerializedManagedSurfaceTypes,
): ManagedSurfaceTypes {
  const reject = (error: string): ManagedSurfaceTypes => ({ ok: false, error });
  if (serialized.version !== 1)
    return reject("unsupported managed surface type version");
  const parsed = parseModule(createSourceTextView(serialized.declarations));
  if (!parsed.ok) return reject(parsed.error.message);
  if (parsed.value.imports.length !== 0)
    return reject("managed surface declarations cannot import modules");
  const canonical = printReifiedTypes(parsed.value.statements);
  if (!canonical.ok) return reject(canonical.error);
  const checked = checkClosureModule(parsed.value);
  if (!checked.ok) return reject(checked.error.message);
  const graph = checked.value;
  const aliases = new Set<string>();
  for (const declaration of parsed.value.statements) {
    if (declaration === undefined || declaration.kind !== "type-alias")
      return reject("managed surface requires type aliases");
    aliases.add(declaration.name);
  }
  const tableId = graph.typeNames.get(serialized.table);
  const table = tableId === undefined ? undefined : graph.types[tableId];
  if (!aliases.has(serialized.table) || table?.kind !== "object")
    return reject("managed surface table requires a declared record alias");
  if (
    table.properties.length !== serialized.entries.length ||
    table.call !== undefined ||
    table.construct !== undefined
  )
    return reject("managed surface table fields must match its helper list");
  const entries: { name: string; local: string; type: TypeNode }[] = [],
    types: { name: string; type: TypeNode }[] = [];
  const valueNames = new Set<string>(),
    typeNames = new Set<string>();
  let index = 0;
  for (const entry of serialized.entries) {
    if (
      entry === undefined ||
      !text(entry.name) ||
      !text(entry.local) ||
      valueNames.has(entry.name)
    )
      return reject("invalid or duplicate serialized helper name");
    const id = graph.typeNames.get(entry.type);
    if (
      !aliases.has(entry.type) ||
      id === undefined ||
      graph.types[id]?.kind !== "function"
    )
      return reject("managed helper requires a declared function alias");
    const property = table.properties[index];
    if (
      property === undefined ||
      property.name !== entry.name ||
      property.type !== id ||
      property.optional
    )
      return reject("managed surface helper does not match its table field");
    index++;
    valueNames.add(entry.name);
    entries.push({
      name: entry.name,
      local: entry.local,
      type: { start: 0, end: 0, kind: "named", name: entry.type },
    });
  }
  for (const entry of serialized.types) {
    if (
      entry === undefined ||
      !text(entry.name) ||
      typeNames.has(entry.name) ||
      !aliases.has(entry.type) ||
      !graph.typeNames.has(entry.type)
    )
      return reject("invalid or duplicate serialized type export");
    typeNames.add(entry.name);
    types.push({
      name: entry.name,
      type: { start: 0, end: 0, kind: "named", name: entry.type },
    });
  }
  return {
    ok: true,
    value: {
      declarations: parsed.value.statements,
      table: { start: 0, end: 0, kind: "named", name: serialized.table },
      entries,
      types,
    },
  };
}
/** Preserve names/order as part of the surface description. The canonical text
 * can be stored without retaining the host's AST or transient checked type IDs. */
export function serializeManagedSurfaceTypes(
  surface: ManagedSurfaceTypeDescription,
  restorations?: ManagedSurfaceRestorations,
): ManagedSurfaceSerialization {
  const reject = (error: string): ManagedSurfaceSerialization => ({
    ok: false,
    error,
  });
  const printed = printReifiedTypes(surface.declarations);
  if (!printed.ok) return reject(printed.error);
  const table = surface.table;
  if (table.kind !== "named" || (table.arguments?.length ?? 0) !== 0)
    return reject("managed surface table requires a concrete alias");
  const entries: { name: string; local: string; type: string }[] = [],
    types: { name: string; type: string }[] = [];
  for (const entry of surface.entries) {
    if (entry === undefined) return reject("missing managed surface helper");
    const type = entry.type;
    if (type.kind !== "named" || (type.arguments?.length ?? 0) !== 0)
      return reject("managed helper requires a concrete alias");
    entries.push({ name: entry.name, local: entry.local, type: type.name });
  }
  for (const entry of surface.types) {
    if (entry === undefined)
      return reject("missing managed surface type export");
    const type = entry.type;
    if (type.kind !== "named" || (type.arguments?.length ?? 0) !== 0)
      return reject("managed type export requires a concrete alias");
    types.push({ name: entry.name, type: type.name });
  }
  const value: SerializedManagedSurfaceTypes = {
    version: 1,
    declarations: printed.value,
    table: table.name,
    entries,
    types,
  };
  const restored =
    restorations === undefined
      ? restoreManagedSurfaceTypes(value)
      : restorations.restore(value);
  if (!restored.ok) return reject(restored.error);
  return { ok: true, value };
}

/** Canonical metadata only: helper locals become symbolic labels, not executable
 * bindings. First-discovery order starts at the table, helpers, then type exports;
 * an iterative queue handles recursive graphs without recursive alias traversal. */
export function canonicalizeManagedSurfaceTypes(
  surface: ManagedSurfaceTypeDescription,
  restorations: ManagedSurfaceRestorations = createManagedSurfaceRestorations(),
): ManagedSurfaceTypes {
  // Serialization already restored this exact value to validate it.
  const serialized = serializeManagedSurfaceTypes(surface, restorations);
  if (!serialized.ok) return serialized;
  const restored = restorations.restore(serialized.value);
  if (!restored.ok) return restored;
  const source = restored.value,
    aliases = new Map<string, Statement>(),
    names = new Map<string, string>(),
    pending: string[] = [],
    declarations: Statement[] = [];
  for (const declaration of source.declarations) {
    if (
      declaration === undefined ||
      declaration.kind !== "type-alias" ||
      typeParameterCount(declaration.typeParameters) !== 0
    )
      return {
        ok: false,
        error: "canonical surfaces require concrete reified aliases",
      };
    aliases.set(declaration.name, declaration);
  }
  function rewrite(type: TypeNode): TypeNode {
    const wrapper = rewriteModule(
      {
        start: 0,
        end: 0,
        imports: [],
        statements: [
          {
            start: 0,
            end: 0,
            kind: "type-alias",
            name: "$root",
            type,
            exported: false,
          },
        ],
      },
      {
        type: (mapped, _original) => {
          if (mapped.kind !== "named" || !aliases.has(mapped.name))
            return mapped;
          let name = names.get(mapped.name);
          if (name === undefined) {
            name = "$T" + String(names.size);
            names.set(mapped.name, name);
            pending.push(mapped.name);
          }
          return { ...mapped, name };
        },
      },
    );
    const declaration = wrapper.statements[0];
    if (declaration === undefined || declaration.kind !== "type-alias")
      throw "canonical root invariant";
    return declaration.type;
  }
  try {
    const table = rewrite(source.table),
      entries: { name: string; local: string; type: TypeNode }[] = [],
      types: { name: string; type: TypeNode }[] = [];
    for (const entry of source.entries) {
      if (entry === undefined) throw "canonical entry invariant";
      entries.push({
        name: entry.name,
        local: "$helper" + String(entries.length),
        type: rewrite(entry.type),
      });
    }
    for (const entry of source.types) {
      if (entry === undefined) throw "canonical type export invariant";
      types.push({ name: entry.name, type: rewrite(entry.type) });
    }
    for (let index = 0; index < pending.length; index++) {
      const original = pending[index];
      if (original === undefined) throw "canonical alias invariant";
      const declaration = aliases.get(original),
        name = names.get(original);
      if (
        declaration === undefined ||
        declaration.kind !== "type-alias" ||
        name === undefined
      )
        throw "canonical declaration invariant";
      declarations.push({
        ...declaration,
        name,
        type: rewrite(declaration.type),
      });
    }
    return { ok: true, value: { declarations, table, entries, types } };
  } catch (error) {
    return {
      ok: false,
      error:
        typeof error === "string"
          ? "canonical surface: " + error
          : "canonical surface rewriting failed",
    };
  }
}
