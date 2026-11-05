import { literalPropertyName } from "../syntax/index.ts";
import type {
  ClassDefinition,
  ClassElement,
  Expression,
  Statement,
  Span,
} from "../syntax/index.ts";

export interface ClassInitializationError extends Span {
  readonly code: "UNINITIALIZED" | "UNSUPPORTED" | "LIMIT";
  readonly message: string;
}
/** Definite initialization only. Value types and executable bodies are checked separately.
 * Reference sets come from binding identities, including lexical receiver captures. */
export function checkClassInitialization(
  definition: ClassDefinition,
  requiredFields: ReadonlySet<ClassElement>,
  receivers: ReadonlySet<Expression>,
  constructors: ReadonlySet<Expression>,
): ClassInitializationError | undefined {
  let ready = new Set<string>(),
    required = new Set<string>(),
    staticMode = false,
    depth = 0;
  let error: ClassInitializationError | undefined;
  const abort = {};
  function fail(
    node: Span,
    code: ClassInitializationError["code"],
    message: string,
  ): never {
    error = { start: node.start, end: node.end, code, message };
    throw abort;
  }
  function complete(): boolean {
    for (const name of required) if (!ready.has(name)) return false;
    return true;
  }
  function requireComplete(node: Span): void {
    if (!complete())
      fail(
        node,
        "UNINITIALIZED",
        "class fields must be initialized before exposing this or returning",
      );
  }
  function copy(source: ReadonlySet<string>): Set<string> {
    const result = new Set<string>();
    for (const name of source) result.add(name);
    return result;
  }
  function intersect(
    a: ReadonlySet<string>,
    b: ReadonlySet<string>,
  ): Set<string> {
    const result = new Set<string>();
    for (const name of a) if (b.has(name)) result.add(name);
    return result;
  }
  function ungroup(node: Expression): Expression {
    while (node.kind === "group" || node.kind === "satisfies")
      node = node.expression;
    return node;
  }
  function receiver(node: Expression): boolean {
    const value = ungroup(node);
    return receivers.has(value) || (staticMode && constructors.has(value));
  }
  function field(node: Expression): string | undefined {
    const value = ungroup(node);
    if (value.kind !== "member" && value.kind !== "index") return undefined;
    if (!receiver(value.object)) return undefined;
    const name =
      value.kind === "member"
        ? value.property
        : literalPropertyName(ungroup(value.index));
    if (name === undefined)
      fail(
        value,
        "UNSUPPORTED",
        "initialization requires a known receiver property",
      );
    return name;
  }
  function captured(node: Span, references: ReadonlySet<Expression>): boolean {
    for (const reference of references) {
      if (reference === undefined) throw "receiver reference invariant";
      if (reference.start >= node.start && reference.end <= node.end)
        return true;
    }
    return false;
  }
  function conditional(node: Expression): boolean {
    if (node.kind === "member" || node.kind === "index")
      return node.optional === true || conditional(node.object);
    if (node.kind === "call")
      return node.optional === true || conditional(node.callee);
    if (node.kind === "group" || node.kind === "satisfies")
      return conditional(node.expression);
    return false;
  }
  function expression(node: Expression): void {
    if (complete()) return;
    if (++depth > 256)
      fail(node, "LIMIT", "class initialization nesting limit exceeded");
    try {
      if (receiver(node)) {
        requireComplete(node);
        return;
      }
      const name = field(node);
      if (name !== undefined) {
        if (required.has(name) && !ready.has(name))
          fail(
            node,
            "UNINITIALIZED",
            "class field read before initialization: " + name,
          );
        return;
      }
      switch (node.kind) {
        case "number":
        case "string":
        case "boolean":
        case "null":
        case "identifier":
          return;
        case "private-in":
          expression(node.object);
          return;
        case "new-target":
        case "elision":
          return;
        case "super":
        case "this":
          requireComplete(node);
          return;
        case "group":
        case "satisfies":
          expression(node.expression);
          return;
        case "spread":
          expression(node.value);
          return;
        case "unary":
          expression(node.operand);
          return;
        case "member":
          expression(node.object);
          return;
        case "index": {
          expression(node.object);
          const before = copy(ready);
          expression(node.index);
          if (conditional(node)) ready = before;
          return;
        }
        case "assignment": {
          const property = field(node.target);
          if (property === undefined) expression(node.target);
          expression(node.value);
          if (property !== undefined) ready.add(property);
          return;
        }
        case "compound":
        case "update":
          expression(node.target);
          if (node.kind === "compound") {
            const before = copy(ready);
            expression(node.value);
            if (
              node.operator === "&&" ||
              node.operator === "||" ||
              node.operator === "??"
            )
              ready = before;
          }
          return;
        case "binary": {
          expression(node.left);
          const before = copy(ready);
          expression(node.right);
          if (
            node.operator === "&&" ||
            node.operator === "||" ||
            node.operator === "??"
          )
            ready = before;
          return;
        }
        case "conditional": {
          expression(node.test);
          const before = copy(ready);
          expression(node.consequent);
          const yes = ready;
          ready = before;
          expression(node.alternate);
          ready = intersect(yes, ready);
          return;
        }
        case "call":
        case "new": {
          const callee = ungroup(node.callee);
          if (
            (callee.kind === "member" || callee.kind === "index") &&
            receiver(callee.object)
          )
            requireComplete(callee);
          expression(node.callee);
          const before = copy(ready);
          for (const argument of node.arguments) {
            if (argument === undefined) throw "argument invariant";
            expression(argument);
          }
          if (conditional(node)) ready = before;
          return;
        }
        case "template-expression":
          for (const substitution of node.substitutions) {
            if (substitution === undefined)
              throw "TEMPLATE_SUBSTITUTION_INVARIANT";
            expression(substitution);
          }
          return;
        case "tagged-template":
          expression(node.tag);
          expression(node.template);
          return;
        case "array":
          for (const element of node.elements) {
            if (element === undefined) throw "array element invariant";
            expression(element);
          }
          return;
        case "object":
          for (const property of node.properties) {
            if (property === undefined) throw "object property invariant";
            expression(property.value);
          }
          return;
        case "arrow":
        case "function-expression":
          if (
            captured(node, receivers) ||
            (staticMode && captured(node, constructors))
          )
            requireComplete(node);
          return;
        default:
          fail(
            node,
            "UNSUPPORTED",
            "expression requires class initialization analysis",
          );
      }
    } finally {
      depth--;
    }
  }
  function statement(node: Statement): boolean {
    if (complete()) return true;
    if (++depth > 256)
      fail(node, "LIMIT", "class initialization nesting limit exceeded");
    try {
      switch (node.kind) {
        case "debugger":
        case "empty":
          return true;
        case "block":
          for (const child of node.statements) {
            if (child === undefined) throw "statement invariant";
            if (!statement(child)) return false;
          }
          return true;
        case "expression":
          expression(node.expression);
          return true;
        case "variable":
          for (const binding of node.declarations) {
            if (binding === undefined) throw "declaration invariant";
            if (
              binding.kind === "object-binding" ||
              binding.kind === "array-binding"
            )
              fail(
                binding,
                "UNSUPPORTED",
                "typed binding patterns are not implemented",
              );
            if (binding.initializer !== undefined)
              expression(binding.initializer);
          }
          return true;
        case "if": {
          expression(node.test);
          const before = copy(ready);
          const yesNormal = statement(node.consequent),
            yes = ready;
          ready = before;
          const noNormal =
            node.alternate === undefined || statement(node.alternate);
          ready = !yesNormal ? ready : !noNormal ? yes : intersect(yes, ready);
          return yesNormal || noNormal;
        }
        case "throw":
          expression(node.expression);
          return false;
        case "return":
          if (node.expression !== undefined) expression(node.expression);
          requireComplete(node);
          return false;
        case "function":
          if (staticMode && captured(node, constructors)) requireComplete(node);
          return true;
        default:
          fail(
            node,
            "UNSUPPORTED",
            "control flow requires class initialization analysis",
          );
      }
    } finally {
      depth--;
    }
  }
  try {
    for (const mode of [false, true]) {
      if (mode === undefined) throw "initialization mode invariant";
      staticMode = mode;
      ready = new Set<string>();
      required = new Set<string>();
      for (const member of definition.elements) {
        if (member === undefined) throw "class member invariant";
        if (
          member.kind === "field" &&
          member.static === mode &&
          requiredFields.has(member)
        ) {
          const name = literalPropertyName(member.key);
          if (name === undefined)
            fail(
              member,
              "UNSUPPORTED",
              "initialization requires a known field name",
            );
          required.add(name);
        }
      }
      for (const member of definition.elements) {
        if (member === undefined) throw "class member invariant";
        if (member.kind !== "field" || member.static !== mode) continue;
        const initializer = member.initializer;
        if (initializer !== undefined) {
          expression(initializer);
          const name = literalPropertyName(member.key);
          if (name === undefined) throw "field name invariant";
          ready.add(name);
        } else {
          const name = literalPropertyName(member.key);
          if (name !== undefined) ready.delete(name);
        }
      }
      let normal = true;
      if (!mode) {
        for (const member of definition.elements) {
          if (member === undefined) throw "class member invariant";
          if (
            member.kind !== "method" ||
            member.static ||
            literalPropertyName(member.key) !== "constructor"
          )
            continue;
          for (const parameter of member.parameters) {
            if (parameter === undefined) throw "parameter invariant";
            const initializer = parameter.initializer;
            if (initializer !== undefined) {
              const before = copy(ready);
              expression(initializer);
              ready = before;
            }
          }
          normal = statement(member.body);
        }
      }
      if (normal) requireComplete(definition);
    }
  } catch (caught) {
    if (caught !== abort) throw caught;
  }
  return error;
}
