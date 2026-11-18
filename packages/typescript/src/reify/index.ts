import { createTypeSystem, type Type } from "../types/index.ts";
import type {
  TypeNode,
  Statement,
  PropertySignature,
  IndexSignature,
  Parameter,
} from "../syntax/index.ts";
export type ReifiedTypes =
  | {
      readonly ok: true;
      readonly value: {
        readonly declarations: readonly Statement[];
        readonly roots: readonly TypeNode[];
        readonly names: ReadonlyMap<number, string>;
      };
    }
  | { readonly ok: false; readonly error: string };
/** Emit named aliases for the reachable finite graph. The caller owns the name prefix. */
export function reifyTypes(
  types: readonly Type[],
  roots: readonly number[],
  prefix: string,
): ReifiedTypes {
  if (prefix.length === 0)
    return { ok: false, error: "type name prefix must not be empty" };
  // Reified syntax has no source span; distinct node hashes keep these nodes
  // apart in the checker's syntax-keyed indexes (syntax keys ignore them).
  let nextNodeHash = 1;
  const valid = createTypeSystem(types);
  if (!valid.ok)
    return { ok: false, error: "invalid type graph: " + valid.error };
  for (const root of roots) {
    if (
      root === undefined ||
      !Number.isInteger(root) ||
      root < 0 ||
      root >= types.length
    )
      return { ok: false, error: "invalid type root" };
  }
  function acceptsUndefined(id: number, seen: Set<number>): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const type = types[id];
    if (type === undefined) return false;
    if (type.kind === "undefined" || type.kind === "unknown") return true;
    if (type.kind !== "union") return false;
    for (const member of type.members) {
      if (member === undefined) throw "validated union invariant";
      if (acceptsUndefined(member, seen)) return true;
    }
    return false;
  }
  const names = new Map<number, string>();
  const pending: number[] = [];
  function reference(id: number): TypeNode {
    let name = names.get(id);
    if (name === undefined) {
      name = prefix + String(id);
      names.set(id, name);
      pending.push(id);
    }
    return { kind: "named", name, start: 0, end: 0, nodeHash: nextNodeHash++ };
  }
  const outputRoots: TypeNode[] = [];
  for (const root of roots) {
    if (root === undefined) throw "validated root invariant";
    outputRoots.push(reference(root));
  }
  const declarations: Statement[] = [];
  function signature(type: number, readonly: boolean): IndexSignature {
    const keyType: TypeNode = {
      kind: "named",
      name: "string",
      start: 0,
      end: 0,
      nodeHash: nextNodeHash++,
    };
    return {
      name: "key",
      keyType,
      valueType: reference(type),
      readonly,
      start: 0,
      end: 0,
      nodeHash: nextNodeHash++,
    };
  }
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (id === undefined) throw "pending type invariant";
    const type = types[id],
      name = names.get(id);
    if (type === undefined || name === undefined)
      throw "validated type invariant";
    let syntax: TypeNode;
    switch (type.kind) {
      case "literal":
        syntax = {
          kind: "literal",
          value: type.value,
          start: 0,
          end: 0,
          nodeHash: nextNodeHash++,
        };
        break;
      case "array": {
        const tuple = type.tupleElements;
        if (tuple !== undefined) {
          syntax = {
            kind: "tuple",
            elements: tuple.map(reference),
            readonly: type.readonly,
            start: 0,
            end: 0,
            nodeHash: nextNodeHash++,
          };
          break;
        }
        syntax = {
          kind: "array",
          element: reference(type.element),
          readonly: type.readonly,
          start: 0,
          end: 0,
          nodeHash: nextNodeHash++,
        };
        break;
      }
      case "set":
        syntax = {
          kind: "named",
          name: type.readonly ? "ReadonlySet" : "Set",
          arguments: [reference(type.element)],
          start: 0,
          end: 0,
          nodeHash: nextNodeHash++,
        };
        break;
      case "map":
        syntax = {
          kind: "named",
          name: type.readonly ? "ReadonlyMap" : "Map",
          arguments: [reference(type.key), reference(type.value)],
          start: 0,
          end: 0,
          nodeHash: nextNodeHash++,
        };
        break;
      case "union": {
        const members: TypeNode[] = [];
        for (const member of type.members) {
          if (member === undefined) throw "validated union invariant";
          members.push(reference(member));
        }
        syntax = {
          kind: "union",
          members,
          start: 0,
          end: 0,
          nodeHash: nextNodeHash++,
        };
        break;
      }
      case "object": {
        const index = type.stringIndex;
        if (
          index?.origin === "record" &&
          type.properties.length === 0 &&
          !index.readonly &&
          type.call === undefined &&
          type.construct === undefined
        ) {
          const key: TypeNode = {
            kind: "named",
            name: "string",
            start: 0,
            end: 0,
            nodeHash: nextNodeHash++,
          };
          syntax = {
            kind: "named",
            name: "Record",
            arguments: [key, reference(index.type)],
            start: 0,
            end: 0,
            nodeHash: nextNodeHash++,
          };
          break;
        }
        const properties: PropertySignature[] = [];
        for (const property of type.properties) {
          if (property === undefined) throw "validated property invariant";
          properties.push({
            name: property.name,
            type: reference(property.type),
            readonly: property.readonly,
            ...(property.optional === undefined
              ? {}
              : { optional: property.optional }),
            start: 0,
            end: 0,
            nodeHash: nextNodeHash++,
          });
        }
        syntax = {
          kind: "object",
          properties,
          ...(index === undefined
            ? {}
            : { indexSignature: signature(index.type, index.readonly) }),
          ...(type.call === undefined ? {} : { call: reference(type.call) }),
          ...(type.construct === undefined
            ? {}
            : { construct: reference(type.construct) }),
          start: 0,
          end: 0,
          nodeHash: nextNodeHash++,
        };
        break;
      }
      case "function": {
        const parameters: Parameter[] = [];
        const minimum = type.minimumArguments ?? type.parameters.length;
        for (let i = 0; i < type.parameters.length; i++) {
          const parameter = type.parameters[i];
          if (parameter === undefined) throw "validated parameter invariant";
          if (i >= minimum && !acceptsUndefined(parameter, new Set<number>()))
            return {
              ok: false,
              error: "optional parameter excludes undefined",
            };
          parameters.push({
            name: "p" + String(i),
            type: reference(parameter),
            optional: i >= minimum,
            initializer: undefined,
            start: 0,
            end: 0,
            nodeHash: nextNodeHash++,
          });
        }
        syntax = {
          kind: "function",
          parameters,
          returnType: reference(type.result),
          ...(type.receiver === undefined
            ? {}
            : { receiver: reference(type.receiver) }),
          start: 0,
          end: 0,
          nodeHash: nextNodeHash++,
        };
        break;
      }
      default:
        syntax = {
          kind: "named",
          name: type.kind,
          start: 0,
          end: 0,
          nodeHash: nextNodeHash++,
        };
        break;
    }
    declarations.push({
      kind: "type-alias",
      name,
      exported: false,
      type: syntax,
      start: 0,
      end: 0,
      nodeHash: nextNodeHash++,
    });
  }
  return { ok: true, value: { declarations, roots: outputRoots, names } };
}
export { printReifiedTypes, type PrintedReifiedTypes } from "./print.ts";
