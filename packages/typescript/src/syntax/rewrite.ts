import type {
  Span,
  Module,
  ImportDeclaration,
  Expression,
  Statement,
  BlockStatement,
  Parameter,
  Binding,
  VariableBinding,
  TypeNode,
  TypeParameter,
  ClassDefinition,
  ClassElement,
} from "./model.ts";
/** Hashes may collide; copied syntax must never be identified by source span alone. */
export function syntaxHash(node: Span): number {
  // Traversal ordinals repeat across modules; retain source-range entropy when
  // nodes from independent rewrites share a checker or lowering index.
  let hash = Math.imul((node.nodeHash ?? 0) ^ node.start, 0x9e3779b1);
  hash = Math.imul(hash ^ node.end, 0x85ebca6b);
  return (hash ^ (hash >>> 16)) >>> 0;
}
export interface SyntaxRewrite {
  /** Assign fresh per-traversal hashes without changing source locations or input nodes. */
  readonly hashes?: boolean;
  /** False skips children but still invokes the postorder statement callback. */
  readonly descend?: (node: Statement) => boolean;
  readonly type?: (mapped: TypeNode, original: TypeNode) => TypeNode;
  readonly expression?: (
    mapped: Expression,
    original: Expression,
  ) => Expression;
  readonly statement?: (mapped: Statement, original: Statement) => Statement;
}
/** Postorder immutable value-syntax rewriting. Type syntax is retained unless a type callback is supplied; spans are retained. */
export function rewriteModule(module: Module, rewrite: SyntaxRewrite): Module {
  let depth = 0,
    nextHash = 0;
  function enter(): void {
    if (++depth > 256) throw "syntax rewrite nesting limit exceeded";
  }
  function type(node: TypeNode): TypeNode {
    if (rewrite.type === undefined && !rewrite.hashes) return node;
    enter();
    try {
      let mapped = node;
      switch (node.kind) {
        case "named":
          mapped = {
            ...node,
            ...(node.arguments === undefined
              ? {}
              : { arguments: node.arguments.map(type) }),
          };
          break;
        case "literal":
          break;
        case "group":
          mapped = { ...node, type: type(node.type) };
          break;
        case "indexed-access":
          mapped = {
            ...node,
            object: type(node.object),
            index: type(node.index),
          };
          break;
        case "array":
          mapped = { ...node, element: type(node.element) };
          break;
        case "union":
        case "intersection":
          mapped = { ...node, members: node.members.map(type) };
          break;
        case "object":
          mapped = {
            ...node,
            ...(node.call === undefined ? {} : { call: type(node.call) }),
            ...(node.construct === undefined
              ? {}
              : { construct: type(node.construct) }),
            properties: node.properties.map((p) => ({
              ...p,
              type: type(p.type),
            })),
          };
          break;
        case "function":
          mapped = {
            ...node,
            ...generics(node),
            parameters: node.parameters.map(parameter),
            returnType: type(node.returnType),
            ...(node.receiver === undefined
              ? {}
              : { receiver: type(node.receiver) }),
          };
          break;
      }
      const callback = rewrite.type;
      const result = callback?.(mapped, node) ?? mapped;
      return rewrite.hashes ? { ...result, nodeHash: nextHash++ } : result;
    } finally {
      depth--;
    }
  }
  function typeParameters(
    values: readonly TypeParameter[],
  ): readonly TypeParameter[] {
    if (rewrite.type === undefined && !rewrite.hashes) return values;
    return values.map((value) => ({
      ...value,
      constraint:
        value.constraint === undefined ? undefined : type(value.constraint),
      defaultType:
        value.defaultType === undefined ? undefined : type(value.defaultType),
    }));
  }
  function generics(node: {
    readonly typeParameters?: readonly TypeParameter[] | undefined;
  }): {
    typeParameters?: readonly TypeParameter[];
  } {
    const values = node.typeParameters;
    return values === undefined
      ? {}
      : { typeParameters: typeParameters(values) };
  }
  function parameter(p: Parameter): Parameter {
    if (p.kind === "pattern-parameter") {
      const pattern = variableBinding(p.pattern);
      if (pattern.kind !== "object-binding" && pattern.kind !== "array-binding")
        throw "parameter rewrite invariant";
      const mapped = {
        ...p,
        pattern,
        type: p.type === undefined ? undefined : type(p.type),
        initializer:
          p.initializer === undefined ? undefined : expression(p.initializer),
      };
      return rewrite.hashes ? { ...mapped, nodeHash: nextHash++ } : mapped;
    }
    const mapped = {
      ...p,
      type: p.type === undefined ? undefined : type(p.type),
      initializer:
        p.initializer === undefined ? undefined : expression(p.initializer),
    };
    return rewrite.hashes ? { ...mapped, nodeHash: nextHash++ } : mapped;
  }
  function binding(b: Binding): Binding {
    const mapped = {
      ...b,
      type: b.type === undefined ? undefined : type(b.type),
      initializer:
        b.initializer === undefined ? undefined : expression(b.initializer),
    };
    return rewrite.hashes ? { ...mapped, nodeHash: nextHash++ } : mapped;
  }
  function variableBinding(b: VariableBinding): VariableBinding {
    if (b.kind === "array-binding") {
      const mapped: VariableBinding = {
        ...b,
        type: b.type === undefined ? undefined : type(b.type),
        initializer:
          b.initializer === undefined ? undefined : expression(b.initializer),
        elements: b.elements.map((element) =>
          element === undefined ? undefined : variableBinding(element),
        ),
        ...(b.rest === undefined ? {} : { rest: variableBinding(b.rest) }),
      };
      return rewrite.hashes ? { ...mapped, nodeHash: nextHash++ } : mapped;
    }
    if (b.kind !== "object-binding") return binding(b);
    const mapped = {
      ...b,
      type: b.type === undefined ? undefined : type(b.type),
      initializer:
        b.initializer === undefined ? undefined : expression(b.initializer),
      properties: b.properties.map((property) => ({
        ...property,
        ...(property.keyExpression === undefined
          ? {}
          : { keyExpression: expression(property.keyExpression) }),
        binding: variableBinding(property.binding),
      })),
      rest: b.rest === undefined ? undefined : binding(b.rest),
    };
    return rewrite.hashes ? { ...mapped, nodeHash: nextHash++ } : mapped;
  }
  function block(node: BlockStatement): BlockStatement {
    const result = statement(node);
    if (result.kind !== "block")
      throw "syntax rewrite must preserve block shape";
    return result;
  }
  function classDefinition(node: ClassDefinition): ClassDefinition {
    return {
      ...node,
      typeParameters: typeParameters(node.typeParameters),
      decorators: node.decorators?.map(expression),
      heritage:
        node.heritage === undefined ? undefined : expression(node.heritage),
      elements: node.elements.map((element): ClassElement => {
        if (element.kind === "static-block")
          return { ...element, body: block(element.body) };
        const key = expression(element.key);
        return element.kind !== "field"
          ? {
              ...element,
              decorators: element.decorators?.map(expression),
              key,
              ...generics(element),
              parameters: element.parameters.map(parameter),
              returnType:
                element.returnType === undefined
                  ? undefined
                  : type(element.returnType),
              body: block(element.body),
            }
          : {
              ...element,
              decorators: element.decorators?.map(expression),
              key,
              type: element.type === undefined ? undefined : type(element.type),
              initializer:
                element.initializer === undefined
                  ? undefined
                  : expression(element.initializer),
            };
      }),
    };
  }
  function expression(node: Expression): Expression {
    enter();
    try {
      let mapped: Expression = node;
      switch (node.kind) {
        case "class-expression":
          mapped = { ...node, definition: classDefinition(node.definition) };
          break;
        case "identifier":
        case "bigint":
        case "regexp":
        case "number":
        case "string":
        case "boolean":
        case "elision":
          break;
        case "private-in":
          mapped = { ...node, object: expression(node.object) };
          break;
        case "new-target":
        case "import-meta":
        case "super":
        case "this":
        case "null":
          break;
        case "import-call":
          mapped = {
            ...node,
            specifier: expression(node.specifier),
            options:
              node.options === undefined ? undefined : expression(node.options),
          };
          break;
        case "await":
          mapped = { ...node, expression: expression(node.expression) };
          break;
        case "yield":
          mapped = {
            ...node,
            expression:
              node.expression === undefined
                ? undefined
                : expression(node.expression),
          };
          break;
        case "spread":
          mapped = { ...node, value: expression(node.value) };
          break;
        case "template-expression":
          mapped = {
            ...node,
            substitutions: node.substitutions.map(expression),
          };
          break;
        case "tagged-template":
          mapped = {
            ...node,
            tag: expression(node.tag),
            template: {
              ...node.template,
              substitutions: node.template.substitutions.map(expression),
            },
          };
          break;
        case "array":
          mapped = { ...node, elements: node.elements.map(expression) };
          break;
        case "object":
          mapped = {
            ...node,
            properties: node.properties.map((p) =>
              p.kind === "spread"
                ? { ...p, value: expression(p.value) }
                : {
                    ...p,
                    shorthand: false,
                    ...(p.keyExpression === undefined
                      ? {}
                      : { keyExpression: expression(p.keyExpression) }),
                    value: expression(p.value),
                  },
            ),
          };
          break;
        case "function-expression":
        case "arrow": {
          const parameters = node.parameters.map(parameter);
          const returnType =
            node.returnType === undefined ? undefined : type(node.returnType);
          if (node.kind === "function-expression") {
            mapped = {
              ...node,
              ...generics(node),
              parameters,
              returnType,
              ...(node.receiver === undefined
                ? {}
                : { receiver: type(node.receiver) }),
              body: block(node.body),
            };
          } else {
            const body = node.body;
            mapped = {
              ...node,
              ...generics(node),
              parameters,
              returnType,
              body: body.kind === "block" ? block(body) : expression(body),
            };
          }
          break;
        }
        case "satisfies":
          mapped = {
            ...node,
            expression: expression(node.expression),
            type: type(node.type),
          };
          break;
        case "group":
          mapped = { ...node, expression: expression(node.expression) };
          break;
        case "unary":
          mapped = { ...node, operand: expression(node.operand) };
          break;
        case "binary":
          mapped = {
            ...node,
            left: expression(node.left),
            right: expression(node.right),
          };
          break;
        case "assignment":
        case "compound":
          mapped = {
            ...node,
            target: expression(node.target),
            value: expression(node.value),
          };
          break;
        case "update":
          mapped = { ...node, target: expression(node.target) };
          break;
        case "conditional":
          mapped = {
            ...node,
            test: expression(node.test),
            consequent: expression(node.consequent),
            alternate: expression(node.alternate),
          };
          break;
        case "call":
        case "new": {
          const typeArguments = node.typeArguments;
          mapped = {
            ...node,
            ...(typeArguments === undefined
              ? {}
              : { typeArguments: typeArguments.map(type) }),
            callee: expression(node.callee),
            arguments: node.arguments.map(expression),
          };
          break;
        }
        case "member":
          mapped = { ...node, object: expression(node.object) };
          break;
        case "index":
          mapped = {
            ...node,
            object: expression(node.object),
            index: expression(node.index),
          };
          break;
      }
      const callback = rewrite.expression;
      const result = callback?.(mapped, node) ?? mapped;
      return rewrite.hashes ? { ...result, nodeHash: nextHash++ } : result;
    } finally {
      depth--;
    }
  }
  function statement(node: Statement): Statement {
    enter();
    try {
      const descend = rewrite.descend;
      if (descend !== undefined && !descend(node)) {
        const callback = rewrite.statement;
        const result = callback?.(node, node) ?? node;
        return rewrite.hashes ? { ...result, nodeHash: nextHash++ } : result;
      }
      let mapped: Statement = node;
      switch (node.kind) {
        case "class":
          mapped = { ...node, definition: classDefinition(node.definition) };
          break;
        case "try": {
          const handler = node.handler;
          const finalizer = node.finalizer;
          const catchBinding =
            handler === undefined ? undefined : handler.binding;
          mapped = {
            ...node,
            body: block(node.body),
            handler:
              handler === undefined
                ? undefined
                : {
                    ...handler,
                    binding:
                      catchBinding === undefined
                        ? undefined
                        : variableBinding(catchBinding),
                    body: block(handler.body),
                  },
            finalizer: finalizer === undefined ? undefined : block(finalizer),
          };
          break;
        }
        case "block":
          mapped = { ...node, statements: node.statements.map(statement) };
          break;
        case "variable":
          mapped = {
            ...node,
            declarations: node.declarations.map(variableBinding),
          };
          break;
        case "export-default":
          mapped = { ...node, value: expression(node.value) };
          break;
        case "function":
          mapped = {
            ...node,
            ...generics(node),
            parameters: node.parameters.map(parameter),
            returnType:
              node.returnType === undefined ? undefined : type(node.returnType),
            ...(node.receiver === undefined
              ? {}
              : { receiver: type(node.receiver) }),
            body: statement(node.body),
          };
          break;
        case "if":
          mapped = {
            ...node,
            test: expression(node.test),
            consequent: statement(node.consequent),
            alternate:
              node.alternate === undefined
                ? undefined
                : statement(node.alternate),
          };
          break;
        case "label":
          mapped = { ...node, body: statement(node.body) };
          break;
        case "with":
          mapped = {
            ...node,
            object: expression(node.object),
            body: statement(node.body),
          };
          break;
        case "do-while":
        case "while":
          mapped = {
            ...node,
            test: expression(node.test),
            body: statement(node.body),
          };
          break;
        case "for-of-assignment":
        case "for-in-assignment":
          mapped = {
            ...node,
            target: expression(node.target),
            iterable: expression(node.iterable),
            body: statement(node.body),
          };
          break;
        case "for-in":
        case "for-of": {
          const loopBinding = node.binding;
          mapped = {
            ...node,
            binding: variableBinding(loopBinding),
            iterable: expression(node.iterable),
            body: statement(node.body),
          };
          break;
        }
        case "for":
          mapped = {
            ...node,
            initializer:
              node.initializer === undefined
                ? undefined
                : statement(node.initializer),
            test: node.test === undefined ? undefined : expression(node.test),
            update:
              node.update === undefined ? undefined : expression(node.update),
            body: statement(node.body),
          };
          break;
        case "switch":
          mapped = {
            ...node,
            expression: expression(node.expression),
            clauses: node.clauses.map((c) => ({
              ...c,
              test: c.test === undefined ? undefined : expression(c.test),
              statements: c.statements.map(statement),
            })),
          };
          break;
        case "return":
          mapped = {
            ...node,
            expression:
              node.expression === undefined
                ? undefined
                : expression(node.expression),
          };
          break;
        case "throw":
        case "expression":
          mapped = { ...node, expression: expression(node.expression) };
          break;
        case "interface":
          if (rewrite.type !== undefined || rewrite.hashes)
            mapped = {
              ...node,
              ...generics(node),
              ...(node.call === undefined ? {} : { call: type(node.call) }),
              ...(node.construct === undefined
                ? {}
                : { construct: type(node.construct) }),
              properties: node.properties.map((p) => ({
                ...p,
                type: type(p.type),
              })),
              ...(node.bases === undefined
                ? {}
                : { bases: node.bases.map(type) }),
            };
          break;
        case "type-alias":
          if (rewrite.type !== undefined || rewrite.hashes)
            mapped = { ...node, ...generics(node), type: type(node.type) };
          break;
        case "export":
        case "import":
        case "break":
        case "continue":
        case "debugger":
        case "empty":
          break;
      }
      const callback = rewrite.statement;
      const result = callback?.(mapped, node) ?? mapped;
      return rewrite.hashes ? { ...result, nodeHash: nextHash++ } : result;
    } finally {
      depth--;
    }
  }
  const statements = module.statements.map(statement);
  const imports: ImportDeclaration[] = [];
  for (const s of statements) {
    if (s === undefined) throw "missing rewritten statement";
    if (s.kind === "import") imports.push(s.declaration);
    else if (s.kind === "export") {
      const source = s.declaration.source;
      if (source !== undefined) imports.push(source);
    }
  }
  return { ...module, statements, imports };
}
