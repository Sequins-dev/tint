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
export interface ClassInitialization {
  readonly error: ClassInitializationError | undefined;
  /** Required instance fields some code may observe before their first
   * assignment, each with the first such read or exposure of `this`. */
  readonly unproven: ReadonlyMap<string, Span>;
}
/** Definite initialization only. Value types and executable bodies are checked separately.
 * Reference sets come from binding identities, including lexical receiver captures.
 *
 * A call of one of the class's own instance methods on `this` during
 * construction (`methods`, whose receiver references are in `receivers`) is
 * analyzed in place: the fields it definitely assigns count as assigned
 * after it. That holds while the call reaches the method the class defined,
 * so callers pass no methods when a prototype may be written.
 *
 * A required instance field read before its assignment, or not yet assigned
 * where `this` escapes (to a closure, another function, a call the analysis
 * does not follow), is unproven: JavaScript reads `undefined` there, so its
 * storage and reads must admit `undefined`. A static field read early, and a
 * required field still unassigned when construction completes, are errors.
 * Reading or writing one of the class's `accessors` (static ones prefixed
 * "static ") on `this` runs a getter or setter the analysis does not
 * follow, so it exposes `this`. */
export function checkClassInitialization(
  definition: ClassDefinition,
  requiredFields: ReadonlySet<ClassElement>,
  receivers: ReadonlySet<Expression>,
  constructors: ReadonlySet<Expression>,
  methods: ReadonlyMap<string, ClassElement> = new Map<string, ClassElement>(),
  accessors: ReadonlySet<string> = new Set<string>(),
): ClassInitialization {
  let ready = new Set<string>(),
    required = new Set<string>(),
    staticMode = false,
    depth = 0;
  // Methods being analyzed in place (recursion escapes), names assigned on
  // the instance (an own override shadows the method), and the assigned
  // fields at each `return` of the innermost analyzed method.
  const inlining = new Set<string>(),
    shadowed = new Set<string>();
  let exits: Set<string>[] | undefined;
  let error: ClassInitializationError | undefined;
  const unproven = new Map<string, Span>();
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
  /** `this` escapes: the fields not yet assigned may be observed. */
  function expose(node: Span): void {
    if (staticMode) {
      requireComplete(node);
      return;
    }
    for (const name of required)
      if (!ready.has(name) && !unproven.has(name)) unproven.set(name, node);
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
  function accessor(name: string): boolean {
    return accessors.has((staticMode ? "static " : "") + name);
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
        expose(node);
        return;
      }
      const name = field(node);
      if (name !== undefined) {
        if (accessor(name)) {
          expose(node);
          return;
        }
        if (required.has(name) && !ready.has(name)) {
          if (staticMode)
            fail(
              node,
              "UNINITIALIZED",
              "class field read before initialization: " + name,
            );
          if (!unproven.has(name)) unproven.set(name, node);
        }
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
          expose(node);
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
          if (property !== undefined && accessor(property)) expose(node);
          else if (property !== undefined) {
            ready.add(property);
            if (methods.has(property)) shadowed.add(property);
          }
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
          const method =
            node.kind === "call" && !staticMode && callee.kind === "member"
              ? ownMethod(callee)
              : undefined;
          if (method !== undefined) {
            const before = copy(ready);
            for (const argument of node.arguments) {
              if (argument === undefined) throw "argument invariant";
              expression(argument);
            }
            if (conditional(node)) ready = before;
            else invoke(method, callee);
            return;
          }
          if (
            (callee.kind === "member" || callee.kind === "index") &&
            receiver(callee.object)
          )
            expose(callee);
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
            expose(node);
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
  /** The class's own instance method a `this.name(...)` call reaches. */
  function ownMethod(
    callee: Expression & { readonly kind: "member" },
  ): ClassElement | undefined {
    if (!receiver(callee.object) || callee.optional === true) return undefined;
    const name = callee.property;
    if (shadowed.has(name) || inlining.has(name)) return undefined;
    return methods.get(name);
  }
  /** Analyze a method body in place, in the current assigned state. */
  function invoke(method: ClassElement, site: Span): void {
    if (method.kind !== "method") throw "class method invariant";
    const name = literalPropertyName(method.key);
    if (name === undefined) throw "class method name invariant";
    if (++depth > 256)
      fail(site, "LIMIT", "class initialization nesting limit exceeded");
    const outer = exits,
      returns: Set<string>[] = [];
    inlining.add(name);
    exits = returns;
    try {
      for (const parameter of method.parameters) {
        if (parameter === undefined) throw "parameter invariant";
        const initializer = parameter.initializer;
        if (initializer !== undefined) {
          const before = copy(ready);
          expression(initializer);
          ready = before;
        }
      }
      const normal = statement(method.body);
      let after: Set<string> | undefined = normal ? ready : undefined;
      for (const exit of returns) {
        if (exit === undefined) throw "method exit invariant";
        after = after === undefined ? exit : intersect(after, exit);
      }
      // A method that never completes leaves the state of the call.
      if (after !== undefined) ready = after;
    } finally {
      inlining.delete(name);
      exits = outer;
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
        case "return": {
          if (node.expression !== undefined) expression(node.expression);
          const returns = exits;
          if (returns === undefined) requireComplete(node);
          else returns.push(copy(ready));
          return false;
        }
        case "function":
          if (staticMode && captured(node, constructors)) expose(node);
          return true;
        // Loops may run no iteration and a jump may leave early: fields
        // assigned inside them, or in a switch or try, do not count after
        // it. A do-while body runs at least once.
        case "while": {
          expression(node.test);
          const before = copy(ready);
          statement(node.body);
          ready = before;
          return true;
        }
        case "do-while": {
          const normal = statement(node.body);
          if (normal) expression(node.test);
          return true;
        }
        case "for": {
          const initializer = node.initializer;
          if (initializer !== undefined && !statement(initializer))
            return false;
          const test = node.test;
          if (test !== undefined) expression(test);
          const before = copy(ready);
          statement(node.body);
          const update = node.update;
          if (update !== undefined) expression(update);
          ready = before;
          return true;
        }
        case "for-of":
        case "for-in": {
          expression(node.iterable);
          const before = copy(ready);
          statement(node.body);
          ready = before;
          return true;
        }
        case "label": {
          // A break rejoins after the label.
          const before = copy(ready);
          statement(node.body);
          ready = before;
          return true;
        }
        case "break":
        case "continue":
          return false;
        case "switch": {
          expression(node.expression);
          const before = copy(ready);
          for (const clause of node.clauses) {
            if (clause === undefined) throw "switch clause invariant";
            const test = clause.test;
            if (test !== undefined) expression(test);
            for (const child of clause.statements) {
              if (child === undefined) throw "statement invariant";
              if (!statement(child)) break;
            }
          }
          ready = before;
          return true;
        }
        case "try": {
          const before = copy(ready);
          statement(node.body);
          ready = copy(before);
          const handler = node.handler;
          if (handler !== undefined) statement(handler.body);
          ready = copy(before);
          const finalizer = node.finalizer;
          if (finalizer !== undefined) {
            const normal = statement(finalizer);
            if (!normal) return false;
          }
          return true;
        }
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
  return { error, unproven };
}
