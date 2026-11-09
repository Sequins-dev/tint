import type {
  BlockStatement,
  CatchClause,
  ClassDefinition,
  Expression,
  Statement,
  SwitchClause,
  TemplateExpression,
  VariableBinding,
} from "@tint/typescript/syntax";

/** Forward single-use constant temporaries into their only consumer.
 *
 * Runtime-compiled entries name every intermediate result (`const $v = op()`)
 * and each name is a frame slot. Large straight-line entries therefore grew a
 * slot per operation, until frame offsets left the direct addressing range.
 * A temporary declared immediately before the statement that reads it, and
 * read exactly once in the whole entry, is substituted at its use when that
 * use is the first effectful evaluation of the statement: everything evaluated
 * before it is a literal or a binding no evaluation can change. Uses inside
 * nested functions, conditional operands or after any call stay named, as do
 * string-literal temporaries (shared entries abstract those) and temporaries
 * with a declared type other than `unknown`. Evaluation order and the set of
 * evaluations are unchanged. */
export function forwardSingleUseTemporaries(
  body: BlockStatement,
  temporary: (name: string) => boolean,
): BlockStatement {
  const reads = new Map<string, number>(),
    mutable = new Set<string>(),
    captured = new Set<string>();
  let functionDepth = 0;

  function read(name: string): void {
    reads.set(name, (reads.get(name) ?? 0) + 1);
    if (functionDepth > 0) captured.add(name);
  }
  function countBinding(binding: VariableBinding): void {
    if (binding.kind === "object-binding") {
      for (const property of binding.properties) {
        if (property === undefined) throw "FORWARD_BINDING_INVARIANT";
        if (property.keyExpression !== undefined)
          countExpression(property.keyExpression);
        countBinding(property.binding);
      }
      const rest = binding.rest;
      if (rest !== undefined) countBinding(rest);
    } else if (binding.kind === "array-binding") {
      for (const element of binding.elements)
        if (element !== undefined) countBinding(element);
      const rest = binding.rest;
      if (rest !== undefined) countBinding(rest);
    }
    const initializer = binding.initializer;
    if (initializer !== undefined) countExpression(initializer);
  }
  function countTemplate(template: TemplateExpression): void {
    for (const part of template.substitutions) {
      if (part === undefined) throw "FORWARD_TEMPLATE_INVARIANT";
      countExpression(part);
    }
  }
  function countClass(definition: ClassDefinition): void {
    functionDepth++;
    const heritage = definition.heritage;
    if (heritage !== undefined) countExpression(heritage);
    for (const decorator of definition.decorators ?? []) {
      if (decorator === undefined) throw "FORWARD_CLASS_INVARIANT";
      countExpression(decorator);
    }
    for (const element of definition.elements) {
      if (element === undefined) throw "FORWARD_CLASS_INVARIANT";
      if (element.kind === "static-block") {
        countStatement(element.body);
        continue;
      }
      countExpression(element.key);
      for (const decorator of element.decorators ?? []) {
        if (decorator === undefined) throw "FORWARD_CLASS_INVARIANT";
        countExpression(decorator);
      }
      if (element.kind === "field") {
        const initializer = element.initializer;
        if (initializer !== undefined) countExpression(initializer);
      } else {
        for (const parameter of element.parameters) {
          if (parameter === undefined) throw "FORWARD_CLASS_INVARIANT";
          const initializer = parameter.initializer;
          if (initializer !== undefined) countExpression(initializer);
          if (parameter.kind === "pattern-parameter")
            countBinding(parameter.pattern);
        }
        countStatement(element.body);
      }
    }
    functionDepth--;
  }
  function countExpression(node: Expression): void {
    switch (node.kind) {
      case "identifier":
        read(node.name);
        return;
      case "class-expression":
        countClass(node.definition);
        return;
      case "array":
        for (const element of node.elements) {
          if (element === undefined) throw "FORWARD_ARRAY_INVARIANT";
          countExpression(element);
        }
        return;
      case "spread":
        countExpression(node.value);
        return;
      case "new":
      case "call":
        countExpression(node.callee);
        for (const argument of node.arguments) {
          if (argument === undefined) throw "FORWARD_CALL_INVARIANT";
          countExpression(argument);
        }
        return;
      case "object":
        for (const property of node.properties) {
          if (property === undefined) throw "FORWARD_OBJECT_INVARIANT";
          if (
            property.kind !== "spread" &&
            property.keyExpression !== undefined
          )
            countExpression(property.keyExpression);
          countExpression(property.value);
        }
        return;
      case "arrow":
      case "function-expression": {
        functionDepth++;
        for (const parameter of node.parameters) {
          if (parameter === undefined) throw "FORWARD_PARAMETER_INVARIANT";
          const initializer = parameter.initializer;
          if (initializer !== undefined) countExpression(initializer);
          if (parameter.kind === "pattern-parameter")
            countBinding(parameter.pattern);
        }
        const functionBody = node.body;
        if (functionBody.kind === "block") countStatement(functionBody);
        else countExpression(functionBody);
        functionDepth--;
        return;
      }
      case "template-expression":
        countTemplate(node);
        return;
      case "tagged-template":
        countExpression(node.tag);
        countTemplate(node.template);
        return;
      case "import-call": {
        countExpression(node.specifier);
        const options = node.options;
        if (options !== undefined) countExpression(options);
        return;
      }
      case "private-in":
        countExpression(node.object);
        return;
      case "unary":
        countExpression(node.operand);
        return;
      case "binary":
        countExpression(node.left);
        countExpression(node.right);
        return;
      case "update": {
        const target = node.target;
        if (target.kind === "identifier") mutable.add(target.name);
        countExpression(target);
        return;
      }
      case "compound":
      case "assignment": {
        const target = node.target;
        if (target.kind === "identifier") mutable.add(target.name);
        countExpression(target);
        countExpression(node.value);
        return;
      }
      case "conditional":
        countExpression(node.test);
        countExpression(node.consequent);
        countExpression(node.alternate);
        return;
      case "member":
        countExpression(node.object);
        return;
      case "index":
        countExpression(node.object);
        countExpression(node.index);
        return;
      case "await":
      case "group":
      case "satisfies":
        countExpression(node.expression);
        return;
      case "yield": {
        const operand = node.expression;
        if (operand !== undefined) countExpression(operand);
        return;
      }
      default:
        return;
    }
  }
  function countClause(clause: SwitchClause): void {
    const test = clause.test;
    if (test !== undefined) countExpression(test);
    for (const statement of clause.statements) {
      if (statement === undefined) throw "FORWARD_SWITCH_INVARIANT";
      countStatement(statement);
    }
  }
  function countCatch(handler: CatchClause): void {
    const binding = handler.binding;
    if (binding !== undefined) countBinding(binding);
    countStatement(handler.body);
  }
  function countStatement(node: Statement): void {
    switch (node.kind) {
      case "class":
        countClass(node.definition);
        return;
      case "try": {
        countStatement(node.body);
        const handler = node.handler;
        if (handler !== undefined) countCatch(handler);
        const finalizer = node.finalizer;
        if (finalizer !== undefined) countStatement(finalizer);
        return;
      }
      case "switch":
        countExpression(node.expression);
        for (const clause of node.clauses) {
          if (clause === undefined) throw "FORWARD_SWITCH_INVARIANT";
          countClause(clause);
        }
        return;
      case "block":
        for (const statement of node.statements) {
          if (statement === undefined) throw "FORWARD_BLOCK_INVARIANT";
          countStatement(statement);
        }
        return;
      case "throw":
      case "expression":
        countExpression(node.expression);
        return;
      case "variable":
        for (const declaration of node.declarations) {
          if (declaration === undefined) throw "FORWARD_VARIABLE_INVARIANT";
          if (
            node.mode !== "const" &&
            declaration.kind !== "object-binding" &&
            declaration.kind !== "array-binding"
          )
            mutable.add(declaration.name);
          countBinding(declaration);
        }
        return;
      case "function": {
        functionDepth++;
        for (const parameter of node.parameters) {
          if (parameter === undefined) throw "FORWARD_PARAMETER_INVARIANT";
          const initializer = parameter.initializer;
          if (initializer !== undefined) countExpression(initializer);
          if (parameter.kind === "pattern-parameter")
            countBinding(parameter.pattern);
        }
        countStatement(node.body);
        functionDepth--;
        return;
      }
      case "if": {
        countExpression(node.test);
        countStatement(node.consequent);
        const alternate = node.alternate;
        if (alternate !== undefined) countStatement(alternate);
        return;
      }
      case "with":
        countExpression(node.object);
        countStatement(node.body);
        return;
      // Forwarding only moves a declaration into the adjacent statement of
      // the same list, so both always run in the same loop iteration.
      case "while":
      case "do-while":
        countExpression(node.test);
        countStatement(node.body);
        return;
      case "for-in-assignment":
      case "for-of-assignment":
        countExpression(node.target);
        countExpression(node.iterable);
        countStatement(node.body);
        return;
      case "for-of":
      case "for-in": {
        const binding = node.binding;
        if (
          node.mode !== "const" &&
          binding.kind !== "object-binding" &&
          binding.kind !== "array-binding"
        )
          mutable.add(binding.name);
        countBinding(binding);
        countExpression(node.iterable);
        countStatement(node.body);
        return;
      }
      case "for": {
        const initializer = node.initializer;
        if (initializer !== undefined) countStatement(initializer);
        const test = node.test;
        if (test !== undefined) countExpression(test);
        const update = node.update;
        if (update !== undefined) countExpression(update);
        countStatement(node.body);
        return;
      }
      case "return": {
        const operand = node.expression;
        if (operand !== undefined) countExpression(operand);
        return;
      }
      case "label":
        countStatement(node.body);
        return;
      case "export-default":
        countExpression(node.value);
        return;
      default:
        return;
    }
  }
  countStatement(body);

  // Pure: evaluating it neither has effects nor reads state an effect could
  // change, so moving a later evaluation before it is unobservable.
  function pure(node: Expression): boolean {
    switch (node.kind) {
      case "string":
      case "number":
      case "boolean":
      case "null":
      case "bigint":
        return true;
      case "identifier":
        return !mutable.has(node.name);
      case "group":
        return pure(node.expression);
      default:
        return false;
    }
  }
  function mentions(node: Expression, name: string): boolean {
    switch (node.kind) {
      case "identifier":
        return node.name === name;
      case "string":
      case "number":
      case "boolean":
      case "null":
      case "bigint":
        return false;
      case "group":
        return mentions(node.expression, name);
      case "member":
        return mentions(node.object, name);
      case "unary":
        return mentions(node.operand, name);
      case "binary":
        return mentions(node.left, name) || mentions(node.right, name);
      case "call":
      case "new": {
        if (mentions(node.callee, name)) return true;
        for (const argument of node.arguments) {
          if (argument === undefined) throw "FORWARD_CALL_INVARIANT";
          if (mentions(argument, name)) return true;
        }
        return false;
      }
      case "array":
        for (const element of node.elements) {
          if (element === undefined) throw "FORWARD_ARRAY_INVARIANT";
          if (mentions(element, name)) return true;
        }
        return false;
      case "object":
        for (const property of node.properties) {
          if (property === undefined) throw "FORWARD_OBJECT_INVARIANT";
          if (property.kind === "spread") {
            if (mentions(property.value, name)) return true;
            continue;
          }
          const key = property.keyExpression;
          if (key !== undefined && mentions(key, name)) return true;
          if (mentions(property.value, name)) return true;
        }
        return false;
      case "spread":
        return mentions(node.value, name);
      default:
        // Unknown shapes may contain it; callers treat true as "stop here".
        return true;
    }
  }
  // Replace the read of `name` in `node` by `value`, provided it is evaluated
  // first among effectful parts. Undefined means "not safely replaceable".
  function substitute(
    node: Expression,
    name: string,
    value: Expression,
  ): Expression | undefined {
    switch (node.kind) {
      case "identifier":
        return node.name === name ? value : undefined;
      case "group": {
        const inner = substitute(node.expression, name, value);
        return inner === undefined ? undefined : { ...node, expression: inner };
      }
      case "member": {
        const object = substitute(node.object, name, value);
        return object === undefined ? undefined : { ...node, object };
      }
      case "unary": {
        if (node.operator === "delete") return undefined;
        const operand = substitute(node.operand, name, value);
        return operand === undefined ? undefined : { ...node, operand };
      }
      case "binary": {
        if (mentions(node.left, name)) {
          const left = substitute(node.left, name, value);
          return left === undefined ? undefined : { ...node, left };
        }
        if (
          node.operator === "&&" ||
          node.operator === "||" ||
          node.operator === "??" ||
          !pure(node.left)
        )
          return undefined;
        const right = substitute(node.right, name, value);
        return right === undefined ? undefined : { ...node, right };
      }
      case "call":
      case "new": {
        if (node.kind === "call" && node.optional === true) return undefined;
        // The callee is read before the arguments: a binding or a property
        // of one (such as an argument list's push).
        const callee = node.callee;
        if (callee.kind === "member") {
          const object = callee.object;
          if (
            object.kind !== "identifier" ||
            !pure(object) ||
            object.name === name
          )
            return undefined;
        } else if (callee.kind !== "identifier" || callee.name === name)
          return undefined;
        const args: Expression[] = [];
        let replaced = false;
        for (const argument of node.arguments) {
          if (argument === undefined) throw "FORWARD_CALL_INVARIANT";
          if (replaced) {
            args.push(argument);
            continue;
          }
          if (argument.kind !== "spread" && mentions(argument, name)) {
            const next = substitute(argument, name, value);
            if (next === undefined) return undefined;
            args.push(next);
            replaced = true;
            continue;
          }
          if (!pure(argument)) return undefined;
          args.push(argument);
        }
        if (!replaced) return undefined;
        return node.kind === "call"
          ? { ...node, arguments: args }
          : { ...node, arguments: args };
      }
      case "assignment": {
        const target = node.target;
        if (target.kind !== "identifier" || target.name === name)
          return undefined;
        const assigned = substitute(node.value, name, value);
        return assigned === undefined
          ? undefined
          : { ...node, value: assigned };
      }
      default:
        return undefined;
    }
  }
  function forwardInto(
    statement: Statement,
    name: string,
    value: Expression,
  ): Statement | undefined {
    switch (statement.kind) {
      case "expression": {
        const next = substitute(statement.expression, name, value);
        return next === undefined
          ? undefined
          : { ...statement, expression: next };
      }
      case "throw": {
        const next = substitute(statement.expression, name, value);
        return next === undefined
          ? undefined
          : { ...statement, expression: next };
      }
      case "return": {
        const operand = statement.expression;
        if (operand === undefined) return undefined;
        const next = substitute(operand, name, value);
        return next === undefined
          ? undefined
          : { ...statement, expression: next };
      }
      case "if": {
        const next = substitute(statement.test, name, value);
        return next === undefined ? undefined : { ...statement, test: next };
      }
      case "variable": {
        if (statement.declarations.length !== 1) return undefined;
        const declaration = statement.declarations[0];
        if (
          declaration === undefined ||
          declaration.kind === "object-binding" ||
          declaration.kind === "array-binding"
        )
          return undefined;
        const initializer = declaration.initializer;
        if (initializer === undefined) return undefined;
        const next = substitute(initializer, name, value);
        return next === undefined
          ? undefined
          : {
              ...statement,
              declarations: [{ ...declaration, initializer: next }],
            };
      }
      default:
        return undefined;
    }
  }
  // The forwardable temporary a statement declares, if any.
  function candidate(
    statement: Statement,
  ): { readonly name: string; readonly value: Expression } | undefined {
    if (
      statement.kind !== "variable" ||
      statement.mode !== "const" ||
      statement.declarations.length !== 1
    )
      return undefined;
    const declaration = statement.declarations[0];
    if (
      declaration === undefined ||
      declaration.kind === "object-binding" ||
      declaration.kind === "array-binding"
    )
      return undefined;
    const initializer = declaration.initializer,
      type = declaration.type;
    if (
      initializer === undefined ||
      initializer.kind === "string" ||
      initializer.kind === "template-expression" ||
      (type !== undefined && (type.kind !== "named" || type.name !== "unknown"))
    )
      return undefined;
    const name = declaration.name;
    if (
      !temporary(name) ||
      reads.get(name) !== 1 ||
      captured.has(name) ||
      mutable.has(name)
    )
      return undefined;
    return { name, value: initializer };
  }
  function literalConstant(statement: Statement | undefined): boolean {
    if (
      statement === undefined ||
      statement.kind !== "variable" ||
      statement.mode !== "const" ||
      statement.declarations.length !== 1
    )
      return false;
    const declaration = statement.declarations[0];
    if (
      declaration === undefined ||
      declaration.kind === "object-binding" ||
      declaration.kind === "array-binding"
    )
      return false;
    const initializer = declaration.initializer;
    return initializer !== undefined && initializer.kind === "string";
  }
  function forwardList(statements: readonly Statement[]): Statement[] {
    const output: Statement[] = [];
    for (const original of statements) {
      if (original === undefined) throw "FORWARD_LIST_INVARIANT";
      let statement = forwardNested(original);
      while (output.length > 0) {
        // String-literal constants in between evaluate nothing observable.
        let index = output.length - 1;
        while (index > 0 && literalConstant(output[index])) index--;
        const previous = output[index];
        if (previous === undefined) throw "FORWARD_LIST_INVARIANT";
        const forwardable = candidate(previous);
        if (forwardable === undefined) break;
        const next = forwardInto(
          statement,
          forwardable.name,
          forwardable.value,
        );
        if (next === undefined) break;
        output.splice(index, 1);
        statement = next;
      }
      output.push(statement);
    }
    return output;
  }
  function forwardBlock(block: BlockStatement): BlockStatement {
    return { ...block, statements: forwardList(block.statements) };
  }
  // Nested statement lists are forwarded independently; expressions are not
  // entered (nested function bodies keep their temporaries).
  function forwardNested(statement: Statement): Statement {
    switch (statement.kind) {
      case "block":
        return { ...statement, statements: forwardList(statement.statements) };
      case "try": {
        const handler = statement.handler,
          finalizer = statement.finalizer;
        return {
          ...statement,
          body: forwardBlock(statement.body),
          handler:
            handler === undefined
              ? undefined
              : { ...handler, body: forwardBlock(handler.body) },
          finalizer:
            finalizer === undefined ? undefined : forwardBlock(finalizer),
        };
      }
      case "if": {
        const alternate = statement.alternate;
        return {
          ...statement,
          consequent: forwardNested(statement.consequent),
          alternate:
            alternate === undefined ? undefined : forwardNested(alternate),
        };
      }
      case "label":
        return { ...statement, body: forwardNested(statement.body) };
      default:
        return statement;
    }
  }
  return forwardBlock(body);
}
