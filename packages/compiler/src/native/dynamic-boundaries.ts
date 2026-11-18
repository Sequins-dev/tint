import { resolveInterfaceTypes } from "@tint/typescript/checker";
import type { SourceModule } from "@tint/typescript/modules/model";
import { printReifiedTypes } from "@tint/typescript/reify";
import type { Module, Statement, TypeNode } from "@tint/typescript/syntax";

export interface DynamicBoundaryType {
  readonly name: string;
  readonly declarations: string;
}
interface TypeDeclaration {
  readonly module: SourceModule;
  readonly node: Statement;
}
function findType(
  sources: ReadonlyMap<string, SourceModule>,
  module: SourceModule,
  name: string,
  depth: number,
): TypeDeclaration | undefined {
  if (depth > 32) return undefined;
  for (const node of module.module.statements) {
    if (node === undefined) continue;
    if (
      (node.kind === "interface" || node.kind === "type-alias") &&
      node.name === name
    )
      return { module, node };
  }
  for (const entry of module.module.imports) {
    if (entry === undefined) continue;
    for (const binding of entry.bindings) {
      if (binding === undefined || binding.namespace || binding.local !== name)
        continue;
      const id = module.dependencies.get(entry.specifier);
      const source = id === undefined ? undefined : sources.get(id);
      return source === undefined
        ? undefined
        : findType(sources, source, binding.imported, depth + 1);
    }
  }
  return undefined;
}

/** Resolve the reachable type declarations from the producer's type namespace.
 * The synthetic host checks a fresh copy of the same annotation at entry. */
export function describeDynamicBoundary(
  sources: ReadonlyMap<string, SourceModule>,
  module: SourceModule,
  input: TypeNode | undefined,
  prefix: string,
): DynamicBoundaryType | undefined {
  const annotation = input;
  if (annotation === undefined) return undefined;
  const declarations: Statement[] = [];
  const aliases = new Map<string, string>();
  const abort = {};
  let indexed = false;
  function named(name: string): TypeNode {
    return { kind: "named", name, start: 0, end: 0 };
  }
  function declare(name: string, type: TypeNode): void {
    declarations.push({
      kind: "type-alias",
      name,
      type,
      exported: false,
      start: 0,
      end: 0,
    });
  }
  function map(source: SourceModule, node: TypeNode, depth: number): TypeNode {
    if (depth > 64) throw abort;
    switch (node.kind) {
      case "literal":
        return node;
      case "group":
        return map(source, node.type, depth + 1);
      case "tuple":
        return { ...node, elements: node.elements.map((part) => map(source, part, depth + 1)) };
      case "array":
        return { ...node, element: map(source, node.element, depth + 1) };
      case "indexed-access":
        return {
          ...node,
          object: map(source, node.object, depth + 1),
          index: map(source, node.index, depth + 1),
        };
      case "union":
      case "intersection":
        return {
          ...node,
          members: node.members.map((member) => map(source, member, depth + 1)),
        };
      case "object": {
        const index = node.indexSignature;
        if (index !== undefined) indexed = true;
        if (node.call !== undefined || node.construct !== undefined)
          throw abort;
        return {
          ...node,
          properties: node.properties.map((p) => ({
            ...p,
            type: map(source, p.type, depth + 1),
          })),
          ...(index === undefined
            ? {}
            : {
                indexSignature: {
                  ...index,
                  keyType: map(source, index.keyType, depth + 1),
                  valueType: map(source, index.valueType, depth + 1),
                },
              }),
        };
      }
      case "named": {
        const found = findType(sources, source, node.name, 0);
        const args = node.arguments ?? [];
        if (found === undefined) {
          if (node.name === "Record" && args.length === 2) {
            indexed = true;
            return {
              ...node,
              arguments: args.map((arg) => map(source, arg, depth + 1)),
            };
          }
          if (
            args.length !== 0 ||
            ![
              "number",
              "string",
              "boolean",
              "null",
              "undefined",
              "unknown",
              "bigint",
              "never",
            ].includes(node.name)
          )
            throw abort;
          return node;
        }
        if (args.length !== 0) throw abort;
        const definition = found.node;
        if (
          (definition.kind !== "interface" &&
            definition.kind !== "type-alias") ||
          (definition.typeParameters?.length ?? 0) !== 0
        )
          throw abort;
        const key = found.module.id + "\u0000" + definition.name;
        const previous = aliases.get(key);
        if (previous !== undefined) return named(previous);
        const name = prefix + "_" + String(aliases.size);
        aliases.set(key, name);
        if (definition.kind === "type-alias") {
          declare(name, map(found.module, definition.type, depth + 1));
        } else {
          const object: TypeNode = {
            kind: "object",
            properties: definition.properties,
            ...(definition.indexSignature === undefined
              ? {}
              : { indexSignature: definition.indexSignature }),
            ...(definition.call === undefined ? {} : { call: definition.call }),
            ...(definition.construct === undefined
              ? {}
              : { construct: definition.construct }),
            start: 0,
            end: 0,
          };
          const bases = definition.bases ?? [];
          const own = map(found.module, object, depth + 1);
          if (bases.length === 0) declare(name, own);
          else {
            const members = bases.map((base) =>
              map(found.module, base, depth + 1),
            );
            members.push(own);
            declare(name, { kind: "intersection", members, start: 0, end: 0 });
          }
        }
        return named(name);
      }
      default:
        throw abort;
    }
  }
  let type: TypeNode;
  try {
    type = map(module, annotation, 0);
  } catch (error) {
    if (error === abort) return undefined;
    throw error;
  }
  if (!indexed) return undefined;
  declare(prefix, type);
  const root = named(prefix);
  const graph: Module = {
    statements: declarations,
    imports: [],
    start: 0,
    end: 0,
  };
  const checked = resolveInterfaceTypes(graph, [root]);
  if (!checked.ok) return undefined;
  const types = checked.value.types;
  const id = checked.value.annotations.get(root);
  const declared = id === undefined ? undefined : types[id];
  let dynamic =
    declared?.kind === "object" && declared.stringIndex !== undefined;
  if (declared?.kind === "union") {
    for (const member of declared.members) {
      if (member === undefined) throw "boundary type member invariant";
      const part = types[member];
      if (part?.kind === "undefined") continue;
      if (dynamic || part?.kind !== "object" || part.stringIndex === undefined)
        return undefined;
      dynamic = true;
    }
  }
  if (!dynamic) return undefined;
  const printed = printReifiedTypes(declarations);
  return printed.ok ? { name: prefix, declarations: printed.value } : undefined;
}
