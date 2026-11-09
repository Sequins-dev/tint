import { syntaxHash, syntaxKey, syntaxKeyMatches } from "../syntax/index.ts";
import {
  createKeyIndex,
  hashString,
  type ReadonlyKeyIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
import type {
  Module,
  Statement,
  Span,
  TypeNode,
  PropertySignature,
  ClassDefinition,
  ClassElement,
  Parameter,
} from "../syntax/index.ts";
import {
  createTypeSystem,
  type Type,
  type TypeSystem,
  type Property,
} from "../types/index.ts";
export interface InterfaceTypes {
  readonly names: ReadonlyKeyIndex<string, number>;
  readonly types: readonly Type[];
  readonly system: TypeSystem;
  readonly annotations: ReadonlyKeyIndex<TypeNode, number>;
  readonly classes: readonly ClassContract[];
}
export interface ClassContract {
  readonly definition: ClassDefinition;
  readonly arguments: readonly number[];
  readonly instance: number;
  readonly constructor: number;
  readonly prototype: number;
  readonly members: readonly ClassMemberContract[];
}
export interface ClassMemberContract {
  readonly node: ClassElement;
  readonly type: number;
  readonly receiver: number;
}
type TypeDeclaration = Statement & {
  readonly kind: "interface" | "type-alias" | "class";
};
export interface InterfaceError extends Span {
  readonly code:
    | "UNSUPPORTED"
    | "UNKNOWN_TYPE"
    | "DUPLICATE_TYPE"
    | "INVALID_TYPE"
    | "LIMIT";
  readonly message: string;
}
export type InterfaceResult =
  | { readonly ok: true; readonly value: InterfaceTypes }
  | { readonly ok: false; readonly error: InterfaceError };
/** Phase-two state of one resolution: every non-generic declared type
 * resolved in registration order, before requested annotations,
 * canonicalization and the type system. A later module whose type
 * declarations have the same syntax key restores it instead of resolving
 * them again. Parallel arrays keep the snapshot plain data. */
interface InterfaceSnapshot {
  readonly key: string;
  readonly types: readonly Type[];
  readonly nameKeys: readonly string[];
  readonly nameValues: readonly number[];
  readonly instanceKeys: readonly string[];
  readonly instanceValues: readonly number[];
  readonly redirectIndexes: readonly number[];
  readonly redirectValues: readonly number[];
  readonly intersectionSteps: number;
}
/** Caller-owned reuse of declared-type resolution across modules that share
 * their type declarations (a compiler's eval entries share the image
 * surface). Two snapshots, most recent first: an unseeded preparation checks
 * the entry program before and after collection-helper specialization.
 * Modules with class declarations always resolve afresh. */
export interface InterfaceResolutionCache {
  first: InterfaceSnapshot | undefined;
  second: InterfaceSnapshot | undefined;
  hits: number;
  misses: number;
}
export function createInterfaceResolutionCache(): InterfaceResolutionCache {
  return { first: undefined, second: undefined, hits: 0, misses: 0 };
}
/** Resolves declaration contracts; executable bodies and initializers are not checked. */
export function resolveInterfaceTypes(
  module: Module,
  requested: readonly TypeNode[] = [],
  cache?: InterfaceResolutionCache,
): InterfaceResult {
  const annotations = createKeyIndex<TypeNode, number>(syntaxHash);
  const types: Type[] = [
    { kind: "number" },
    { kind: "boolean" },
    { kind: "undefined" },
    { kind: "string" },
    { kind: "Uint32Array" },
    { kind: "void" },
    { kind: "Uint8Array" },
    { kind: "Uint16Array" },
    { kind: "Float64Array" },
    { kind: "null" },
    { kind: "ArrayBuffer" },
    { kind: "TypeError" },
    { kind: "RangeError" },
  ];
  const literals = createKeyIndex<string | number | boolean, number>(
    (value) => {
      if (typeof value === "string") return hashString(value);
      if (typeof value === "number") return value >>> 0;
      return value ? 1 : 0;
    },
  );
  const primitiveCount = types.length;
  const names = createStringIndex<number>();
  for (let index = 0; index < types.length; index++) {
    const type = types[index];
    if (type === undefined) throw "primitive type invariant";
    names.set(type.kind, index);
  }
  const declarations = createStringIndex<number>(),
    classes: ClassContract[] = [],
    redirects: number[] = [],
    pending = new Set<number>(),
    heritage: { derived: number; base: number; node: Span }[] = [],
    abort = {};
  let error: InterfaceError | undefined,
    depth = 0;
  function fail(
    node: Span,
    code: InterfaceError["code"],
    message: string,
  ): never {
    error = { start: node.start, end: node.end, code, message };
    throw abort;
  }
  function add(t: Type, node: Span): number {
    const id = types.length;
    types.push(t);
    if (t.kind === "literal" && !literals.has(t.value))
      literals.set(t.value, id);
    return id;
  }
  // Map and Set references were interned by scanning the whole table per
  // reference. The index catches up with appended types (restores append
  // too) before each lookup and keeps the first id per key, the id the scan
  // returned; only placeholder objects are ever replaced in place.
  const collections = createStringIndex<number>();
  let collectionsIndexed = 0;
  function collectionKey(type: Type): string | undefined {
    if (type.kind === "map")
      return "m" + type.key + "," + type.value + (type.readonly ? "r" : "w");
    if (type.kind === "set")
      return "s" + type.element + (type.readonly ? "r" : "w");
    return undefined;
  }
  function knownCollection(key: string): number {
    while (collectionsIndexed < types.length) {
      const type = types[collectionsIndexed];
      if (type !== undefined) {
        const typeKey = collectionKey(type);
        if (typeKey !== undefined && !collections.has(typeKey))
          collections.set(typeKey, collectionsIndexed);
      }
      collectionsIndexed++;
    }
    return collections.get(key) ?? -1;
  }
  const instances = createStringIndex<number>();
  let parameters = createStringIndex<number>();
  function lookupDeclaration(name: string): TypeDeclaration | undefined {
    const index = declarations.get(name);
    if (index === undefined) return undefined;
    const node = module.statements[index];
    if (node === undefined) throw "type declaration invariant";
    if (
      node.kind === "interface" ||
      node.kind === "type-alias" ||
      node.kind === "class"
    )
      return node;
    throw "type declaration invariant";
  }
  function named(
    name: string,
    node: Span,
    args: readonly number[] = [],
  ): number {
    const parameter = parameters.get(name);
    if (parameter !== undefined) {
      if (parameter < 0)
        fail(
          node,
          "INVALID_TYPE",
          "static member cannot reference class type parameter: " + name,
        );
      if (args.length !== 0)
        fail(node, "INVALID_TYPE", "type parameter does not accept arguments");
      return parameter;
    }
    if ((name === "Map" || name === "ReadonlyMap") && !declarations.has(name)) {
      const key = args[0],
        value = args[1];
      if (args.length !== 2 || key === undefined || value === undefined)
        fail(node, "INVALID_TYPE", "Map requires key and value types");
      const readonly = name === "ReadonlyMap";
      const known = knownCollection(
        "m" + key + "," + value + (readonly ? "r" : "w"),
      );
      return known >= 0
        ? known
        : add({ kind: "map", key, value, readonly }, node);
    }
    if ((name === "Set" || name === "ReadonlySet") && !declarations.has(name)) {
      const element = args[0];
      if (args.length !== 1 || element === undefined)
        fail(node, "INVALID_TYPE", "Set requires one element type");
      const readonly = name === "ReadonlySet";
      const known = knownCollection("s" + element + (readonly ? "r" : "w"));
      return known >= 0 ? known : add({ kind: "set", element, readonly }, node);
    }
    const declaration = lookupDeclaration(name);
    // Linked classes have distinct outer and inner names, but one instance type.
    let formals: readonly string[] = [];
    if (declaration !== undefined) {
      if (declaration.kind === "class") {
        name = declaration.name;
        formals = declaration.definition.typeParameters;
      } else formals = declaration.typeParameters ?? [];
    }
    if (args.length !== formals.length)
      fail(node, "INVALID_TYPE", "incorrect type argument count for " + name);
    const generic = formals.length > 0;
    let key = name + ":";
    for (let index = 0; index < args.length; index++) {
      const argument = args[index];
      if (argument === undefined) throw "type argument invariant";
      if (index > 0) key += ",";
      key += String(argument);
    }
    const known = generic ? instances.get(key) : names.get(name);
    if (known !== undefined) return known;
    if ((name === "unknown" || name === "never") && declaration === undefined) {
      const id = add(
        name === "unknown" ? { kind: "unknown" } : { kind: "never" },
        node,
      );
      names.set(name, id);
      return id;
    }
    if (declaration === undefined)
      fail(node, "UNKNOWN_TYPE", "unknown type: " + name);
    const resolvedDeclaration = declaration;
    const reserved = add(
      { kind: "object", properties: [] },
      resolvedDeclaration,
    );
    if (generic) instances.set(key, reserved);
    else names.set(name, reserved);
    pending.add(reserved);
    const outer = parameters;
    parameters = createStringIndex<number>();
    for (let i = 0; i < formals.length; i++) {
      const formal = formals[i],
        argument = args[i];
      if (formal === undefined || argument === undefined)
        throw "type argument invariant";
      parameters.set(formal, argument);
    }
    let id: number;
    try {
      id =
        resolvedDeclaration.kind === "class"
          ? classType(resolvedDeclaration.definition, reserved, args)
          : resolvedDeclaration.kind === "type-alias"
            ? resolve(resolvedDeclaration.type)
            : object(
                resolvedDeclaration.properties,
                resolvedDeclaration,
                resolvedDeclaration.bases,
                resolvedDeclaration.call,
                resolvedDeclaration.construct,
              );
    } finally {
      parameters = outer;
    }
    if (id === reserved)
      fail(resolvedDeclaration, "INVALID_TYPE", "unproductive recursive alias");
    redirects[reserved] = id;
    pending.delete(reserved);
    if (generic) instances.set(key, id);
    else names.set(name, id);
    return id;
  }
  function classType(
    definition: ClassDefinition,
    instance: number,
    args: readonly number[],
  ): number {
    if (
      (definition.decorators?.length ?? 0) !== 0 ||
      definition.elements.some(
        (element) =>
          element.kind !== "static-block" &&
          (element.decorators?.length ?? 0) !== 0,
      )
    )
      fail(
        definition,
        "UNSUPPORTED",
        "typed decorators require dynamic class replacement contracts",
      );
    if (definition.heritage !== undefined)
      fail(
        definition,
        "UNSUPPORTED",
        "class inheritance contracts require heritage checking",
      );
    const constructor = add({ kind: "object", properties: [] }, definition);
    const prototype = add({ kind: "object", properties: [] }, definition);
    const constructorProperty: Property = {
      name: "constructor",
      type: constructor,
      readonly: false,
    };
    // An instance's structural contract must not acquire the class's static side
    // through constructor. The general inherited Function surface is separate.
    const fields: Property[] = [],
      prototypeFields: Property[] = [constructorProperty],
      statics: Property[] = [
        { name: "prototype", type: prototype, readonly: true },
      ],
      members: ClassMemberContract[] = [];
    let construct: number | undefined;
    for (const member of definition.elements) {
      if (member === undefined) throw "class member invariant";
      if (member.kind === "static-block")
        fail(
          member,
          "UNSUPPORTED",
          "typed class static blocks require initialization lowering",
        );
      if (member.private)
        fail(
          member,
          "UNSUPPORTED",
          "typed private class elements require private layouts",
        );
      const key = member.key;
      if (member.computed || (key.kind !== "string" && key.kind !== "number"))
        fail(
          member,
          "UNSUPPORTED",
          "computed class member contracts require key evaluation",
        );
      const name = key.kind === "string" ? key.value : String(key.value),
        isStatic = member.static;
      const receiver = isStatic ? constructor : instance;
      const properties = isStatic ? statics : fields;
      const outer = parameters;
      if (isStatic) {
        parameters = createStringIndex<number>();
        // Keep forbidden class parameters visible rather than falling through to
        // an unrelated outer declaration with the same name. Type IDs are nonnegative.
        for (const parameter of definition.typeParameters) {
          if (parameter === undefined) throw "class parameter invariant";
          parameters.set(parameter, -1);
        }
      }
      let type: number;
      if (member.kind === "field") {
        if (member.accessor)
          fail(
            member,
            "UNSUPPORTED",
            "typed auto-accessors require private storage and accessor lowering",
          );
        const annotation = member.type;
        if (annotation === undefined)
          fail(
            member,
            "UNSUPPORTED",
            "class field requires annotation until initializer inference is available",
          );
        type = resolve(annotation);
      } else if (member.kind === "method") {
        if (!isStatic && name === "constructor") {
          if (construct !== undefined)
            fail(member, "INVALID_TYPE", "duplicate class constructor");
          construct = signature(member.parameters, instance, undefined, member);
          members.push({ node: member, type: construct, receiver: instance });
          parameters = outer;
          continue;
        }
        const result = member.returnType;
        if (result === undefined)
          fail(
            member,
            "UNSUPPORTED",
            "class method return requires annotation until body inference is available",
          );
        type = signature(member.parameters, resolve(result), receiver, member);
      } else
        fail(
          member,
          "UNSUPPORTED",
          "class accessor contracts require separate read and write checking",
        );
      parameters = outer;
      if (properties.some((property) => property.name === name))
        fail(member, "INVALID_TYPE", "duplicate class property: " + name);
      const property: Property = { name, type, readonly: false };
      properties.push(property);
      if (!isStatic && member.kind === "method") prototypeFields.push(property);
      members.push({ node: member, type, receiver });
    }
    if (construct === undefined)
      construct = signature([], instance, undefined, definition);
    types[constructor] = { kind: "object", properties: statics, construct };
    types[prototype] = { kind: "object", properties: prototypeFields };
    classes.push({
      definition,
      arguments: args,
      instance,
      constructor,
      prototype,
      members,
    });
    return add({ kind: "object", properties: fields }, definition);
  }
  function signature(
    parameters: readonly Parameter[],
    result: number,
    receiver: number | undefined,
    node: Span,
  ): number {
    let minimumArguments = 0,
      seenOptional = false;
    const parameterTypes = parameters.map((p, i): number => {
      if (p.rest)
        fail(
          p,
          "UNSUPPORTED",
          "rest function type layouts are not implemented",
        );
      const annotation = p.type;
      if (annotation === undefined)
        return fail(
          p,
          "INVALID_TYPE",
          "function type parameter requires annotation",
        );
      const value = resolve(annotation);
      if (p.optional || p.initializer !== undefined) {
        if (p.optional) seenOptional = true;
        const absent = add({ kind: "undefined" }, p);
        return add({ kind: "union", members: [value, absent] }, p);
      }
      if (seenOptional)
        fail(
          p,
          "INVALID_TYPE",
          "required parameter cannot follow an optional parameter",
        );
      minimumArguments = i + 1;
      return value;
    });
    return add(
      {
        kind: "function",
        parameters: parameterTypes,
        minimumArguments,
        result,
        ...(receiver === undefined ? {} : { receiver }),
      },
      node,
    );
  }
  function object(
    properties: readonly PropertySignature[],
    node: Span,
    bases: readonly TypeNode[] = [],
    callSyntax: TypeNode | undefined = undefined,
    constructSyntax: TypeNode | undefined = undefined,
  ): number {
    const fields: Property[] = [],
      baseIds: number[] = [],
      own = new Set<string>();
    let callSignature: number | undefined,
      constructSignature: number | undefined;
    for (const base of bases) {
      if (base === undefined) throw "missing interface base";
      const id = canonical(resolve(base)),
        type = types[id];
      if (pending.has(id))
        fail(base, "INVALID_TYPE", "cyclic interface inheritance");
      if (type?.kind !== "object")
        fail(
          base,
          "INVALID_TYPE",
          "interface base requires an object contract",
        );
      baseIds.push(id);
      if (callSignature === undefined) callSignature = type.call;
      if (constructSignature === undefined) constructSignature = type.construct;
      for (const field of type.properties) {
        if (field === undefined) throw "missing inherited property";
        if (!fields.some((p) => p !== undefined && p.name === field.name))
          fields.push({ ...field });
      }
    }
    for (const p of properties) {
      if (p === undefined) throw "missing property signature";
      if (own.has(p.name))
        fail(p, "INVALID_TYPE", "duplicate property: " + p.name);
      own.add(p.name);
      const field: Property = {
          name: p.name,
          type: resolve(p.type),
          readonly: p.readonly,
          ...(p.optional ? { optional: true } : {}),
        },
        index = fields.findIndex((f) => f !== undefined && f.name === p.name);
      // Keep the exact write contract separate from the read union. The finite
      // type graph must contain a contract capable of representing absence.
      if (p.optional && field.type !== 2)
        add({ kind: "union", members: [field.type, 2] }, p);
      if (index < 0) fields.push(field);
      else fields[index] = field;
    }
    if (callSyntax !== undefined) callSignature = resolve(callSyntax);
    if (constructSyntax !== undefined)
      constructSignature = resolve(constructSyntax);
    const id = add(
      {
        kind: "object",
        properties: fields,
        ...(callSignature === undefined ? {} : { call: callSignature }),
        ...(constructSignature === undefined
          ? {}
          : { construct: constructSignature }),
      },
      node,
    );
    for (const base of baseIds) {
      if (base === undefined) throw "missing resolved base";
      heritage.push({ derived: id, base, node });
    }
    return id;
  }
  let intersectionSteps = 0;
  function intersect(
    left: number,
    right: number,
    node: Span,
    level: number = 0,
  ): number {
    if (level >= 64 || ++intersectionSteps > 4096)
      fail(node, "LIMIT", "intersection expansion limit exceeded");
    left = canonical(left);
    right = canonical(right);
    if (pending.has(left) || pending.has(right))
      fail(
        node,
        "UNSUPPORTED",
        "recursive intersection operand is not yet resolved",
      );
    if (left === right) return left;
    const a = types[left],
      b = types[right];
    if (a?.kind === "union" || b?.kind === "union") {
      const members: number[] = [];
      const aa = a?.kind === "union" ? a.members : [left],
        bb = b?.kind === "union" ? b.members : [right];
      for (const x of aa)
        for (const y of bb) {
          if (x === undefined || y === undefined)
            throw "missing intersection operand";
          if (members.length >= 4096)
            fail(node, "LIMIT", "intersection expansion limit exceeded");
          const id = intersect(x, y, node, level + 1);
          if (types[id]?.kind !== "never" && !members.includes(id))
            members.push(id);
        }
      if (members.length === 0) return add({ kind: "never" }, node);
      const first = members[0];
      if (members.length === 1 && first !== undefined) return first;
      return add({ kind: "union", members }, node);
    }
    if (a?.kind === "never" || b?.kind === "never")
      return add({ kind: "never" }, node);
    if (a?.kind === "literal" && b?.kind === "literal")
      return a.value === b.value ? left : add({ kind: "never" }, node);
    if (a?.kind === "literal" && b?.kind === typeof a.value) return left;
    if (b?.kind === "literal" && a?.kind === typeof b.value) return right;
    if (a?.kind !== "object" || b?.kind !== "object")
      fail(
        node,
        "UNSUPPORTED",
        "intersection requires structural object operands",
      );
    const properties: Property[] = [];
    for (const p of a.properties) {
      if (p === undefined) throw "missing intersection property";
      properties.push({ ...p });
    }
    for (const field of b.properties) {
      if (field === undefined) throw "missing intersection property";
      const index = properties.findIndex(
          (p) => p !== undefined && p.name === field.name,
        ),
        existing = properties[index];
      if (existing === undefined) properties.push({ ...field });
      else {
        const fieldType = intersect(existing.type, field.type, node, level + 1);
        const optional = existing.optional === true && field.optional === true;
        if (!optional && types[fieldType]?.kind === "never") return fieldType;
        properties[index] = {
          ...existing,
          type: fieldType,
          readonly: existing.readonly && field.readonly,
          optional,
        };
      }
    }
    const leftCall = a.call,
      rightCall = b.call,
      leftConstruct = a.construct,
      rightConstruct = b.construct;
    if (
      (leftCall !== undefined &&
        rightCall !== undefined &&
        canonical(leftCall) !== canonical(rightCall)) ||
      (leftConstruct !== undefined &&
        rightConstruct !== undefined &&
        canonical(leftConstruct) !== canonical(rightConstruct))
    )
      fail(
        node,
        "UNSUPPORTED",
        "intersections with multiple signatures require overload support",
      );
    const callSignature = leftCall ?? rightCall,
      constructSignature = leftConstruct ?? rightConstruct;
    return add(
      {
        kind: "object",
        properties,
        ...(callSignature === undefined ? {} : { call: callSignature }),
        ...(constructSignature === undefined
          ? {}
          : { construct: constructSignature }),
      },
      node,
    );
  }
  function indexed(
    objectId: number,
    indexId: number,
    node: Span,
    level: number = 0,
  ): number {
    if (level > 64)
      fail(node, "LIMIT", "indexed access nesting limit exceeded");
    objectId = canonical(objectId);
    indexId = canonical(indexId);
    if (pending.has(objectId) || pending.has(indexId))
      fail(
        node,
        "UNSUPPORTED",
        "recursive indexed access operand is not yet resolved",
      );
    const objectType = types[objectId],
      indexType = types[indexId];
    if (objectType?.kind === "union" || indexType?.kind === "union") {
      const members: number[] = [];
      const objects =
        objectType?.kind === "union" ? objectType.members : [objectId];
      const indices =
        indexType?.kind === "union" ? indexType.members : [indexId];
      for (const object of objects)
        for (const index of indices) {
          if (object === undefined || index === undefined)
            throw "missing indexed operand";
          const result = indexed(object, index, node, level + 1);
          if (!members.includes(result)) members.push(result);
        }
      const first = members[0];
      if (first === undefined)
        fail(node, "INVALID_TYPE", "empty indexed access union");
      return members.length === 1
        ? first
        : add({ kind: "union", members }, node);
    }
    if (
      objectType?.kind === "array" &&
      (indexType?.kind === "number" ||
        (indexType?.kind === "literal" && typeof indexType.value === "number"))
    )
      return objectType.element;
    if (
      objectType?.kind === "object" &&
      indexType?.kind === "literal" &&
      (typeof indexType.value === "string" ||
        typeof indexType.value === "number")
    ) {
      const key = indexType.value;
      const propertyName: string =
        typeof key === "number"
          ? String(key)
          : typeof key === "string"
            ? key
            : fail(node, "INVALID_TYPE", "invalid property key");
      const property = objectType.properties.find(
        (p) => p !== undefined && p.name === propertyName,
      );
      if (property === undefined)
        fail(
          node,
          "INVALID_TYPE",
          "indexed access property does not exist: " + propertyName,
        );
      return property.optional && canonical(property.type) !== 2
        ? add({ kind: "union", members: [property.type, 2] }, node)
        : property.type;
    }
    fail(
      node,
      "INVALID_TYPE",
      "indexed access requires a known object property or numeric array index",
    );
  }
  function resolve(node: TypeNode): number {
    if (++depth > 64)
      fail(node, "LIMIT", "type resolution nesting limit exceeded");
    try {
      switch (node.kind) {
        case "literal": {
          const value = node.value;
          const known = literals.get(value);
          return known !== undefined
            ? known
            : add({ kind: "literal", value: node.value }, node);
        }
        case "object":
          return object(node.properties, node, [], node.call, node.construct);
        case "named": {
          const args = node.arguments;
          return named(
            node.name,
            node,
            args === undefined ? undefined : args.map(resolve),
          );
        }
        case "group":
          return resolve(node.type);
        case "indexed-access":
          return indexed(resolve(node.object), resolve(node.index), node);
        case "array":
          return add(
            {
              kind: "array",
              element: resolve(node.element),
              readonly: node.readonly === true,
            },
            node,
          );
        case "intersection": {
          const first = node.members[0];
          if (first === undefined)
            fail(node, "INVALID_TYPE", "empty intersection");
          let id = resolve(first);
          for (let i = 1; i < node.members.length; i++) {
            const member = node.members[i];
            if (member === undefined) throw "intersection invariant";
            id = intersect(id, resolve(member), node);
          }
          return id;
        }
        case "union": {
          const unique = new Set<number>();
          for (const member of node.members) {
            if (member === undefined) throw "missing union member";
            unique.add(resolve(member));
          }
          const members = [...unique];
          const only = members[0];
          if (only === undefined)
            return fail(node, "INVALID_TYPE", "empty union");
          return members.length === 1
            ? only
            : add({ kind: "union", members }, node);
        }
        case "function":
          return signature(
            node.parameters,
            resolve(node.returnType),
            node.receiver === undefined ? undefined : resolve(node.receiver),
            node,
          );
      }
      throw "unhandled type syntax";
    } finally {
      depth--;
    }
  }
  function capture(key: string): InterfaceSnapshot {
    const nameKeys: string[] = [],
      nameValues: number[] = [],
      instanceKeys: string[] = [],
      instanceValues: number[] = [],
      redirectIndexes: number[] = [],
      redirectValues: number[] = [];
    names.forEach((value, name) => {
      nameKeys.push(name);
      nameValues.push(value);
    });
    instances.forEach((value, name) => {
      instanceKeys.push(name);
      instanceValues.push(value);
    });
    for (let index = 0; index < redirects.length; index++) {
      const target = redirects[index];
      if (target === undefined) continue;
      redirectIndexes.push(index);
      redirectValues.push(target);
    }
    return {
      key,
      types: types.slice(),
      nameKeys,
      nameValues,
      instanceKeys,
      instanceValues,
      redirectIndexes,
      redirectValues,
      intersectionSteps,
    };
  }
  /** Rebuild exactly the state phase two leaves: the same type table and
   * indexes, with literal ids re-derived in table order as add() records. */
  function restore(snapshot: InterfaceSnapshot): void {
    if (types.length !== primitiveCount || redirects.length !== 0)
      throw "interface snapshot invariant";
    for (let index = primitiveCount; index < snapshot.types.length; index++) {
      const type = snapshot.types[index];
      if (type === undefined) throw "interface snapshot invariant";
      types.push(type);
      if (type.kind === "literal" && !literals.has(type.value))
        literals.set(type.value, index);
    }
    for (let index = 0; index < snapshot.nameKeys.length; index++) {
      const name = snapshot.nameKeys[index],
        value = snapshot.nameValues[index];
      if (name === undefined || value === undefined)
        throw "interface snapshot invariant";
      names.set(name, value);
    }
    for (let index = 0; index < snapshot.instanceKeys.length; index++) {
      const name = snapshot.instanceKeys[index],
        value = snapshot.instanceValues[index];
      if (name === undefined || value === undefined)
        throw "interface snapshot invariant";
      instances.set(name, value);
    }
    for (let index = 0; index < snapshot.redirectIndexes.length; index++) {
      const at = snapshot.redirectIndexes[index],
        value = snapshot.redirectValues[index];
      if (at === undefined || value === undefined)
        throw "interface snapshot invariant";
      redirects[at] = value;
    }
    intersectionSteps = snapshot.intersectionSteps;
  }
  try {
    for (let index = 0; index < module.statements.length; index++) {
      const node = module.statements[index];
      if (node === undefined) throw "missing module statement";
      if (
        node.kind === "interface" ||
        node.kind === "type-alias" ||
        node.kind === "class"
      ) {
        if (names.has(node.name) || declarations.has(node.name))
          fail(
            node,
            "DUPLICATE_TYPE",
            "duplicate or reserved type name: " + node.name,
          );
        const seen = new Set<string>();
        for (const parameter of node.kind === "class"
          ? node.definition.typeParameters
          : (node.typeParameters ?? [])) {
          if (parameter === undefined) throw "missing type parameter";
          if (seen.has(parameter))
            fail(
              node,
              "DUPLICATE_TYPE",
              "duplicate type parameter: " + parameter,
            );
          seen.add(parameter);
        }
        declarations.set(node.name, index);
        if (node.kind === "class") {
          const inner = node.definition.name;
          if (inner !== undefined && inner !== node.name) {
            if (names.has(inner) || declarations.has(inner))
              fail(
                node,
                "DUPLICATE_TYPE",
                "duplicate inner class name: " + inner,
              );
            declarations.set(inner, index);
          }
        }
      }
    }
    // Bind the optional cache: the native subset narrows locals, not
    // parameters, before property access.
    const memo: InterfaceResolutionCache | undefined = cache;
    // Only type aliases and interfaces are keyed: class contracts hold
    // their definition nodes, so modules with classes resolve afresh.
    const typeStatements: Statement[] = [];
    let classes = false;
    for (const node of module.statements) {
      if (node === undefined) throw "missing module statement";
      if (node.kind === "class") classes = true;
      else if (node.kind === "interface" || node.kind === "type-alias")
        typeStatements.push(node);
    }
    const keyed: Module | undefined =
      memo === undefined || classes
        ? undefined
        : { ...module, imports: [], statements: typeStatements };
    const first = memo === undefined ? undefined : memo.first,
      second = memo === undefined ? undefined : memo.second;
    let snapshot: InterfaceSnapshot | undefined;
    if (keyed !== undefined && first !== undefined)
      if (syntaxKeyMatches(keyed, first.key)) snapshot = first;
    if (keyed !== undefined && snapshot === undefined && second !== undefined)
      if (syntaxKeyMatches(keyed, second.key)) snapshot = second;
    if (memo !== undefined && snapshot !== undefined) {
      restore(snapshot);
      if (snapshot === second) {
        memo.second = first;
        memo.first = second;
      }
      memo.hits = memo.hits + 1;
    } else {
      declarations.forEach((_index, name) => {
        const node = lookupDeclaration(name);
        if (node === undefined) throw "type declaration invariant";
        if (
          (node.kind === "class"
            ? node.definition.typeParameters.length
            : (node.typeParameters?.length ?? 0)) === 0
        )
          named(name, node);
      });
      if (memo !== undefined && keyed !== undefined && pending.size === 0) {
        memo.second = memo.first;
        memo.first = capture(syntaxKey(keyed));
        memo.misses = memo.misses + 1;
      }
    }
    for (const node of requested) {
      if (node === undefined) throw "missing requested type";
      annotations.set(node, resolve(node));
    }
  } catch (e) {
    if (e !== abort) throw e;
  }
  if (error !== undefined) return { ok: false, error };
  function canonical(id: number): number {
    let root = id,
      steps = 0,
      next = redirects[root];
    while (next !== undefined) {
      root = next;
      if (++steps > types.length) return -1;
      next = redirects[root];
    }
    // IDs are dense indexes. Compress successful paths without allocating a
    // visited set for every field, annotation and alias canonicalization.
    while (id !== root) {
      const previous = redirects[id];
      if (previous === undefined) throw "redirect invariant";
      redirects[id] = root;
      id = previous;
    }
    return root;
  }
  function canonicalMembers(members: readonly number[]): number[] {
    const unique = new Set<number>();
    for (const member of members) {
      if (member === undefined) throw "missing union member";
      unique.add(canonical(member));
    }
    return [...unique];
  }
  for (let i = 0; i < types.length; i++) {
    const id = canonical(i),
      t = types[id];
    if (t === undefined)
      return {
        ok: false,
        error: {
          start: module.start,
          end: module.end,
          code: "INVALID_TYPE",
          message: "unproductive recursive alias",
        },
      };
    types[i] =
      t.kind === "map"
        ? { ...t, key: canonical(t.key), value: canonical(t.value) }
        : t.kind === "array" || t.kind === "set"
          ? { ...t, element: canonical(t.element) }
          : t.kind === "object"
            ? {
                ...t,
                ...(t.call === undefined ? {} : { call: canonical(t.call) }),
                ...(t.construct === undefined
                  ? {}
                  : { construct: canonical(t.construct) }),
                properties: t.properties.map((p) => ({
                  ...p,
                  type: canonical(p.type),
                })),
              }
            : t.kind === "function"
              ? {
                  ...t,
                  parameters: t.parameters.map(canonical),
                  result: canonical(t.result),
                  ...(t.receiver === undefined
                    ? {}
                    : { receiver: canonical(t.receiver) }),
                }
              : t.kind === "union"
                ? { ...t, members: canonicalMembers(t.members) }
                : t;
  }
  names.forEach((id, name) => names.set(name, canonical(id)));
  annotations.forEach((id, node) => annotations.set(node, canonical(id)));
  const system = createTypeSystem(types);
  if (!system.ok)
    return {
      ok: false,
      error: {
        start: module.start,
        end: module.end,
        code: system.error === "LIMIT" ? "LIMIT" : "INVALID_TYPE",
        message: "invalid resolved type table",
      },
    };
  for (const h of heritage) {
    if (h === undefined) throw "missing heritage constraint";
    if (!system.value.assignable(canonical(h.derived), canonical(h.base)))
      return {
        ok: false,
        error: {
          start: h.node.start,
          end: h.node.end,
          code: "INVALID_TYPE",
          message: "incompatible inherited property contract",
        },
      };
  }
  return {
    ok: true,
    value: {
      names,
      types,
      system: system.value,
      annotations,
      classes: classes.map((contract) => ({
        ...contract,
        instance: canonical(contract.instance),
        constructor: canonical(contract.constructor),
        prototype: canonical(contract.prototype),
        arguments: contract.arguments.map(canonical),
        members: contract.members.map((member) => ({
          ...member,
          type: canonical(member.type),
          receiver: canonical(member.receiver),
        })),
      })),
    },
  };
}
