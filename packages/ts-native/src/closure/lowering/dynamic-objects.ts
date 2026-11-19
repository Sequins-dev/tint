import {
  rewriteModule,
  type Binding,
  type BlockStatement,
  type Expression,
  type Module,
  type Parameter,
  type TypeNode,
  type Span,
  type Statement,
} from "@tint/typescript/syntax";
import type { CheckedClosures } from "@tint/typescript/checker";

export interface DynamicObjectRuntime {
  readonly create: number;
  readonly createArray: number;
  readonly invoke: number;
  readonly finish: number;
  readonly enroll: number;
  readonly convertKey: number;
  readonly define: number;
  readonly setPrototype: number;
  readonly read: number;
  readonly project: number;
  readonly write: number;
  readonly has: number;
  readonly remove: number;
  readonly spread: number;
  readonly enumerate: number;
  readonly advance: number;
  readonly objectConstructor: number;
  readonly invokeEnumeration: number;
}

export function dynamicObjectRuntime(
  resolve: (name: string) => number,
): DynamicObjectRuntime {
  return {
    create: resolve("create"),
    createArray: resolve("createArray"),
    invoke: resolve("invoke"),
    finish: resolve("finish"),
    enroll: resolve("enroll"),
    convertKey: resolve("convertKey"),
    define: resolve("define"),
    setPrototype: resolve("setPrototype"),
    read: resolve("read"),
    project: resolve("project"),
    write: resolve("write"),
    has: resolve("has"),
    remove: resolve("remove"),
    spread: resolve("spread"),
    enumerate: resolve("enumerate"),
    advance: resolve("advance"),
    objectConstructor: resolve("objectConstructor"),
    invokeEnumeration: resolve("invokeEnumeration"),
  };
}

export function hasDynamicObject(
  checked: CheckedClosures,
  id: number,
): boolean {
  const type = checked.types[id];
  if (type?.kind === "object")
    return type.stringIndex !== undefined || type.realmRecord === true;
  if (type?.kind === "array") return type.realmArray === true;
  return (
    type?.kind === "union" &&
    type.members.some(
      (member) => member !== undefined && hasDynamicObject(checked, member),
    )
  );
}

/** Type-only declarations cannot require an executable realm. */
export function usesDynamicObjectRuntime(checked: CheckedClosures): boolean {
  if (
    !checked.types.some(
      (type) =>
        (type?.kind === "object" &&
          (type.stringIndex !== undefined || type.realmRecord === true)) ||
        (type?.kind === "array" && type.realmArray === true),
    )
  )
    return false;
  if (
    checked.bindingTypes.some(
      (id) => id !== undefined && hasDynamicObject(checked, id),
    )
  )
    return true;
  for (const [id, body] of checked.bodies)
    if (hasDynamicObject(checked, body.result)) return true;
  let used = false;
  checked.intrinsics.forEach((intrinsic, _node) => {
    if (intrinsic.startsWith("dynamic-object-")) used = true;
  });
  return used;
}

/** Encode the reachable immutable graph, registering a type before its edges
 * so recursive indexed interfaces use backreferences. The runtime interns the
 * compact string and only decodes a particular contract on its first use. */
export function encodeDynamicContract(
  checked: CheckedClosures,
  root: number,
): string {
  const ids = new Map<number, number>();
  const pending: number[] = [];
  const parts: string[] = [];
  function emit(token: string): void {
    parts.push(String(token.length) + ":" + token);
  }
  function reference(id: number): string {
    const seen = ids.get(id);
    if (seen !== undefined) return String(seen);
    const index = pending.length;
    pending.push(id);
    ids.set(id, index);
    return String(index);
  }
  reference(root);
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i];
    if (id === undefined) throw "dynamic contract reference invariant";
    const type = checked.types[id];
    if (type === undefined) throw "dynamic contract type invariant";
    switch (type.kind) {
      case "number":
      case "string":
      case "boolean":
      case "undefined":
      case "null":
      case "bigint":
      case "unknown":
      case "never":
        emit(type.kind);
        break;
      case "realm-callable":
      case "dynamic-result":
        emit("unknown");
        break;
      case "literal": {
        const value = type.value;
        emit(typeof value + "-literal");
        if (typeof value === "string") emit(value);
        else if (typeof value === "number") emit(String(value));
        else emit(value ? "true" : "false");
        break;
      }
      case "union":
        emit("union");
        emit(String(type.members.length));
        for (const member of type.members) {
          if (member === undefined) throw "dynamic contract member invariant";
          emit(reference(member));
        }
        break;
      case "array":
        if (type.tupleElements !== undefined) emit("array");
        else {
          emit("array-elements");
          emit(reference(type.element));
          emit(type.readonly ? "1" : "0");
        }
        break;
      case "object": {
        const index = type.stringIndex;
        emit("object");
        emit(index === undefined ? "-1" : reference(index.type));
        emit(index?.readonly === true ? "1" : "0");
        emit(String(type.properties.length));
        for (const field of type.properties) {
          if (field === undefined) throw "dynamic contract field invariant";
          emit(field.name);
          emit(reference(field.type));
          emit(field.optional ? "0" : "1");
          emit(field.readonly ? "1" : "0");
        }
        break;
      }
      default:
        throw "unsupported dynamic-key object property contract";
    }
  }
  const length = String(pending.length);
  return String(length.length) + ":" + length + parts.join("");
}

/** The program realm and its helper closures belong to the module instance.
 * Explicit source reads of the helper functions keep their lexical captures
 * visible to ordinary closure planning before the scalar operations call them. */
export const dynamicRuntimeAliasPrefix: string = "$tint$dynamic$";

export function insertDynamicObjectRuntime(
  module: Module,
  checked: CheckedClosures,
  helpers: ReadonlyMap<string, string>,
): Module {
  const uses: Span[] = [];
  checked.intrinsics.forEach((intrinsic, node) => {
    if (intrinsic.startsWith("dynamic-object-")) uses.push(node);
  });
  rewriteModule(module, {
    statement: (node, original) => {
      if (original.kind === "for-in" || original.kind === "for-in-assignment")
        uses.push(original);
      return node;
    },
  });
  checked.dynamicEnrollments?.forEach((_type, node) => {
    uses.push(node);
  });
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) continue;
    const type = checked.bindingTypes[binding.id];
    if (type !== undefined && hasDynamicObject(checked, type))
      uses.push(binding.node);
  }
  for (const [id, body] of checked.bodies)
    if (body.explicitResult === true && hasDynamicObject(checked, body.result))
      uses.push(body.node);
  if (uses.length === 0) return module;
  function usesRuntime(node: Span): boolean {
    return uses.some(
      (use) =>
        use !== undefined && use.start >= node.start && use.end <= node.end,
    );
  }
  function isDynamicAnnotation(node: TypeNode): boolean {
    switch (node.kind) {
      case "object":
        return node.indexSignature !== undefined;
      case "group":
        return isDynamicAnnotation(node.type);
      case "intersection":
      case "union":
        return node.members.some(
          (member) => member !== undefined && isDynamicAnnotation(member),
        );
      case "named": {
        const name = checked.typeNames.get(node.name);
        if (name !== undefined) {
          const type = checked.types[name];
          return type?.kind !== "object"
            ? hasDynamicObject(checked, name)
            : type.stringIndex !== undefined;
        }
        const key = node.arguments?.[0];
        return (
          node.name === "Record" &&
          key?.kind === "named" &&
          key.name === "string"
        );
      }
      default:
        return false;
    }
  }
  function aliasesAt(scope: Span): Statement {
    const declarations: Binding[] = [];
    dynamicObjectRuntime((name) => {
      const linked = helpers.get("dynamic-object:" + name);
      if (linked === undefined) throw "dynamic object helper invariant";
      declarations.push({
        name: dynamicRuntimeAliasPrefix + name,
        type: undefined,
        initializer: {
          kind: "identifier",
          name: linked,
          start: scope.start,
          end: scope.start,
        },
        start: scope.start,
        end: scope.start,
      });
      return 0;
    });
    return {
      kind: "variable",
      mode: "const",
      exported: false,
      declarations,
      start: scope.start,
      end: scope.start,
    };
  }
  function bodyWithRuntime(
    body: Statement,
    parameters: readonly Parameter[],
  ): BlockStatement {
    const statements: Statement[] = [aliasesAt(body)];
    for (const parameter of parameters) {
      if (parameter === undefined || parameter.kind === "pattern-parameter")
        continue;
      const type = parameter.type;
      if (type === undefined || !isDynamicAnnotation(type)) continue;
      const begin = parameter.start,
        end = parameter.end;
      const absent: TypeNode = {
        kind: "named",
        name: "undefined",
        start: begin,
        end,
      };
      const target: TypeNode =
        parameter.optional === true
          ? { kind: "union", members: [type, absent], start: begin, end }
          : type;
      statements.push({
        kind: "expression",
        expression: {
          kind: "satisfies",
          assertion: "as",
          type: target,
          expression: {
            kind: "identifier",
            name: parameter.name,
            start: begin,
            end,
          },
          start: begin,
          end,
        },
        start: begin,
        end,
      });
    }
    if (body.kind === "block") {
      for (const statement of body.statements) {
        if (statement === undefined) throw "dynamic object statement invariant";
        statements.push(statement);
      }
    } else statements.push(body);
    return { kind: "block", statements, start: body.start, end: body.end };
  }
  const rewritten = rewriteModule(module, {
    statement: (node, original) =>
      node.kind === "function" && usesRuntime(original)
        ? { ...node, body: bodyWithRuntime(node.body, node.parameters) }
        : node,
    expression: (node, original) => {
      if (
        (node.kind !== "arrow" && node.kind !== "function-expression") ||
        !usesRuntime(original)
      )
        return node;
      const body = node.body;
      if (body.kind === "block")
        return { ...node, body: bodyWithRuntime(body, node.parameters) };
      const returned: Statement = {
        kind: "return",
        expression: body,
        start: body.start,
        end: body.end,
      };
      return { ...node, body: bodyWithRuntime(returned, node.parameters) };
    },
  });
  const first = module.statements.findIndex(
    (statement) =>
      statement !== undefined &&
      statement.kind === "variable" &&
      usesRuntime(statement),
  );
  if (first >= 0) {
    const statements: Statement[] = [];
    for (let index = 0; index < rewritten.statements.length; index++) {
      const item = rewritten.statements[index];
      if (item === undefined) throw "dynamic module statement invariant";
      if (index === first) statements.push(aliasesAt(item));
      statements.push(item);
    }
    return { ...rewritten, statements };
  }
  return rewritten;
}
