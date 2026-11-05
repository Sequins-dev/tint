import { scriptRuntimeTypeArguments } from "./runtime-imports.ts";
import type {
  BlockStatement,
  CatchClause,
  Expression,
  Span,
  Statement,
  SwitchClause,
  TypeNode,
} from "@tint/typescript/syntax";

interface LabelTarget {
  readonly name: string;
  readonly exit: Expression;
  readonly head: Expression | undefined;
}

interface CompletionTargets {
  readonly exit: Expression | undefined;
  readonly head: Expression | undefined;
  readonly returned?: Expression;
  readonly labels: readonly LabelTarget[];
}

/** Split a lowered body into native closures. Each closure retains the
 * preceding segment's live lexical cells through ordinary closure conversion.
 * Structured paths join through stack-bounded transfers. Protected segments
 * route exceptions before transferring outside their catch scope. */
export function generatorContinuation(
  body: BlockStatement,
  resumeName: string,
  kindName: string,
  inputName: string,
  iteratorResult: (value: Expression) => Expression,
  delegate: (value: Expression, following: Expression) => Expression,
  unsupported: (node: Span) => never,
  asyncGenerator: boolean = false,
): Expression {
  const span: Span = { start: body.start, end: body.end };
  let serial: number = 0;
  function id(name: string): Expression {
    return { ...span, kind: "identifier", name };
  }
  function named(name: string): TypeNode {
    return { ...span, kind: "named", name };
  }
  function instantiation(name: string): readonly TypeNode[] {
    return scriptRuntimeTypeArguments(name).map((argument) => named(argument));
  }
  function text(value: string): Expression {
    return { ...span, kind: "string", value };
  }
  function outcome(kind: string, key: string, value: Expression): Expression {
    return {
      ...span,
      kind: "object",
      properties: [
        { ...span, name: "kind", value: text(kind), shorthand: false },
        { ...span, name: key, value, shorthand: false },
      ],
    };
  }
  function returned(value: Expression): Statement {
    return {
      ...span,
      kind: "return",
      expression: outcome("return", "value", value),
    };
  }
  function invoke(
    continuation: Expression,
    inputKind: string = "next",
    value: Expression = id("undefined"),
  ): Statement {
    return {
      ...span,
      kind: "return",
      expression: transfer(continuation, inputKind, value),
    };
  }
  function transfer(
    continuation: Expression,
    inputKind: string = "next",
    value: Expression = id("undefined"),
  ): Expression {
    return {
      ...span,
      kind: "object",
      properties: [
        { ...span, name: "kind", value: text("transfer"), shorthand: false },
        { ...span, name: "next", value: continuation, shorthand: false },
        {
          ...span,
          name: "inputKind",
          value: text(inputKind),
          shorthand: false,
        },
        { ...span, name: "value", value, shorthand: false },
      ],
    };
  }
  function stepType(): TypeNode {
    return {
      ...span,
      kind: "named",
      name: asyncGenerator ? "AsyncGeneratorStep" : "GeneratorStep",
      arguments: instantiation(
        asyncGenerator ? "AsyncGeneratorStep" : "GeneratorStep",
      ),
    };
  }
  function bind(
    name: string,
    type: TypeNode,
    initializer: Expression,
  ): Statement {
    return {
      ...span,
      kind: "variable",
      mode: "const",
      exported: false,
      declarations: [{ ...span, name, type, initializer }],
    };
  }
  function bindStep(name: string, initializer: Expression): Statement {
    return bind(name, stepType(), initializer);
  }
  function finishReturn(
    value: Expression,
    targets: CompletionTargets,
  ): Statement {
    const destination = targets.returned;
    return destination === undefined
      ? returned(value)
      : invoke(destination, "return", value);
  }
  function statementsOf(node: Statement | undefined): readonly Statement[] {
    if (node === undefined) return [];
    return node.kind === "block" ? node.statements : [node];
  }
  function statementsSuspend(nodes: readonly Statement[]): boolean {
    for (const node of nodes) {
      if (node === undefined) throw "GENERATOR_STATEMENT_INVARIANT";
      if (suspends(node)) return true;
    }
    return false;
  }
  function suspends(node: Statement): boolean {
    switch (node.kind) {
      case "expression":
        return (
          node.expression.kind === "yield" || node.expression.kind === "await"
        );
      case "block":
        return statementsSuspend(node.statements);
      case "if":
        return (
          suspends(node.consequent) ||
          (node.alternate !== undefined && suspends(node.alternate))
        );
      case "while":
      case "do-while":
      case "for":
      case "for-in":
      case "for-of":
      case "for-in-assignment":
      case "for-of-assignment":
      case "label":
        return suspends(node.body);
      case "try":
        return (
          suspends(node.body) ||
          (node.handler !== undefined && suspends(node.handler.body)) ||
          (node.finalizer !== undefined && suspends(node.finalizer))
        );
      case "switch":
        for (const clause of node.clauses) {
          if (clause === undefined) throw "GENERATOR_CLAUSE_INVARIANT";
          if (statementsSuspend(clause.statements)) return true;
        }
        return false;
      default:
        return false;
    }
  }
  function labelledTargets(
    targets: CompletionTargets,
    names: readonly string[],
    exit: Expression,
    head: Expression | undefined,
  ): CompletionTargets {
    const labels = targets.labels.slice();
    for (const name of names) {
      if (name === undefined) throw "GENERATOR_LABEL_INVARIANT";
      labels.push({ name, exit, head });
    }
    return { ...targets, labels };
  }
  function namedTarget(
    targets: CompletionTargets,
    name: string,
    continuing: boolean,
  ): Expression | undefined {
    for (let index = targets.labels.length - 1; index >= 0; index--) {
      const label = targets.labels[index];
      if (label === undefined) throw "GENERATOR_LABEL_INVARIANT";
      if (label.name === name) return continuing ? label.head : label.exit;
    }
    return undefined;
  }
  function block(
    node: BlockStatement,
    targets: CompletionTargets,
  ): BlockStatement {
    return {
      ...node,
      statements: node.statements.map((child) => statement(child, targets)),
    };
  }
  function statement(node: Statement, targets: CompletionTargets): Statement {
    switch (node.kind) {
      case "break": {
        const destination =
          node.label === undefined
            ? targets.exit
            : namedTarget(targets, node.label, false);
        return destination !== undefined ? invoke(destination) : node;
      }
      case "continue": {
        const destination =
          node.label === undefined
            ? targets.head
            : namedTarget(targets, node.label, true);
        return destination !== undefined ? invoke(destination) : node;
      }
      case "return":
        return finishReturn(node.expression ?? id("undefined"), targets);
      case "expression":
        if (
          node.expression.kind === "yield" ||
          node.expression.kind === "await"
        )
          unsupported(node);
        return node;
      case "block":
        return block(node, targets);
      case "if":
        return {
          ...node,
          consequent: statement(node.consequent, targets),
          alternate:
            node.alternate === undefined
              ? undefined
              : statement(node.alternate, targets),
        };
      case "while":
      case "do-while":
      case "for":
      case "for-in":
      case "for-of":
      case "for-in-assignment":
      case "for-of-assignment":
        return {
          ...node,
          body: statement(node.body, {
            ...targets,
            exit: undefined,
            head: undefined,
          }),
        };
      case "label":
        return { ...node, body: statement(node.body, targets) };
      case "try":
        return {
          ...node,
          body: block(node.body, targets),
          handler:
            node.handler === undefined
              ? undefined
              : { ...node.handler, body: block(node.handler.body, targets) },
          finalizer:
            node.finalizer === undefined
              ? undefined
              : block(node.finalizer, targets),
        };
      case "switch":
        return {
          ...node,
          clauses: node.clauses.map((clause) => ({
            ...clause,
            statements: clause.statements.map((child) =>
              statement(child, { ...targets, exit: undefined }),
            ),
          })),
        };
      default:
        return node;
    }
  }
  function completionTest(kind: string, consequent: Statement): Statement {
    return {
      ...span,
      kind: "if",
      test: {
        ...span,
        kind: "binary",
        operator: "===",
        left: id(kindName),
        right: text(kind),
      },
      consequent,
      alternate: undefined,
    };
  }
  function segment(
    nodes: readonly Statement[],
    initial: boolean,
    following: Expression | undefined,
    targets: CompletionTargets,
    catcher: Expression | undefined,
  ): Expression {
    const statements: Statement[] = [];
    let transferred = false;
    if (!initial) {
      statements.push(
        completionTest("throw", {
          ...span,
          kind: "throw",
          expression: id(inputName),
        }),
      );
      statements.push(
        completionTest("return", finishReturn(id(inputName), targets)),
      );
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node === undefined) throw "GENERATOR_SEGMENT_INVARIANT";
      const labels: string[] = [];
      let unlabelled: Statement = node;
      while (unlabelled.kind === "label") {
        labels.push(unlabelled.name);
        unlabelled = unlabelled.body;
      }
      const yieldNode =
        node.kind === "expression" ? node.expression : undefined;
      if (
        yieldNode !== undefined &&
        (yieldNode.kind === "yield" || yieldNode.kind === "await")
      ) {
        const delegatedYield = yieldNode.kind === "yield" && yieldNode.delegate;
        const next = segment(
          nodes.slice(i + 1),
          false,
          following,
          targets,
          catcher,
        );
        const value = yieldNode.expression ?? id("undefined");
        let continuation: Expression = delegatedYield
          ? delegate(value, next)
          : next;
        if (
          delegatedYield &&
          (catcher !== undefined || targets.returned !== undefined)
        ) {
          const delegateName = resumeName + "$delegate" + serial++;
          const resultName = resumeName + "$result" + serial++;
          statements.push(bindStep(delegateName, continuation));
          const delegated: Statement[] = [
            bind(
              resultName,
              {
                ...span,
                kind: "named",
                name: asyncGenerator
                  ? "AsyncGeneratorStepOutcome"
                  : "GeneratorStepOutcome",
                arguments: instantiation(
                  asyncGenerator
                    ? "AsyncGeneratorStepOutcome"
                    : "GeneratorStepOutcome",
                ),
              },
              {
                ...span,
                kind: "call",
                callee: id(delegateName),
                arguments: [id(kindName), id(inputName)],
              },
            ),
          ];
          if (targets.returned !== undefined)
            delegated.push({
              ...span,
              kind: "if",
              test: {
                ...span,
                kind: "binary",
                operator: "===",
                left: {
                  ...span,
                  kind: "member",
                  object: id(resultName),
                  property: "kind",
                },
                right: text("return"),
              },
              consequent: finishReturn(
                {
                  ...span,
                  kind: "member",
                  object: id(resultName),
                  property: "value",
                },
                targets,
              ),
              alternate: undefined,
            });
          delegated.push({
            ...span,
            kind: "return",
            expression: id(resultName),
          });
          continuation = step(delegated, catcher);
        }
        statements.push({
          start: node.start,
          end: node.end,
          kind: "expression",
          expression: {
            ...span,
            kind: "assignment",
            target: id(resumeName),
            value: continuation,
          },
        });
        statements.push({
          start: node.start,
          end: node.end,
          kind: "return",
          expression: delegatedYield
            ? transfer(id(resumeName))
            : yieldNode.kind === "await"
              ? outcome("await", "value", value)
              : asyncGenerator
                ? outcome("yield", "value", value)
                : outcome("yield", "result", iteratorResult(value)),
        });
        transferred = true;
        break;
      }
      const finalizer = node.kind === "try" ? node.finalizer : undefined;
      if (node.kind === "try" && finalizer !== undefined && suspends(node)) {
        const afterName = resumeName + "$after" + serial++;
        const cleanupName = resumeName + "$cleanup" + serial++;
        const pendingName = resumeName + "$pending" + serial++;
        const returnName = resumeName + "$return" + serial++;
        const throwName = resumeName + "$throw" + serial++;
        statements.push(
          bindStep(
            afterName,
            segment(nodes.slice(i + 1), true, following, targets, catcher),
          ),
        );
        // This factory is only called inside compiled code. A named local
        // declaration lets the managed direct-call proof establish that fact.
        const cleanupReturn: Statement = {
          ...span,
          kind: "return",
          expression: segment(
            finalizer.statements,
            true,
            id(pendingName),
            targets,
            catcher,
          ),
        };
        const cleanupBody: BlockStatement = {
          ...span,
          kind: "block",
          statements: [cleanupReturn],
        };
        statements.push({
          ...span,
          kind: "function",
          name: cleanupName,
          exported: false,
          parameters: [{ ...span, name: pendingName, type: stepType() }],
          returnType: stepType(),
          body: cleanupBody,
        });
        statements.push(
          bindStep(
            returnName,
            cleanupRoute(cleanupName, undefined, targets, catcher, "return"),
          ),
        );
        statements.push(
          bindStep(
            throwName,
            cleanupRoute(cleanupName, undefined, targets, catcher, "throw"),
          ),
        );
        const cleanupLabels: LabelTarget[] = [];
        for (const label of targets.labels) {
          if (label === undefined) throw "GENERATOR_LABEL_INVARIANT";
          cleanupLabels.push({
            name: label.name,
            exit: cleanupRoute(
              cleanupName,
              label.exit,
              targets,
              catcher,
              "next",
            ),
            head:
              label.head === undefined
                ? undefined
                : cleanupRoute(
                    cleanupName,
                    label.head,
                    targets,
                    catcher,
                    "next",
                  ),
          });
        }
        const innerTargets: CompletionTargets = {
          labels: cleanupLabels,
          exit:
            targets.exit === undefined
              ? undefined
              : cleanupRoute(
                  cleanupName,
                  targets.exit,
                  targets,
                  catcher,
                  "next",
                ),
          head:
            targets.head === undefined
              ? undefined
              : cleanupRoute(
                  cleanupName,
                  targets.head,
                  targets,
                  catcher,
                  "next",
                ),
          returned: id(returnName),
        };
        const protectedNodes: Statement[] = [];
        if (node.handler !== undefined)
          protectedNodes.push({ ...node, finalizer: undefined });
        else
          for (const child of node.body.statements) {
            if (child === undefined) throw "GENERATOR_FINALLY_INVARIANT";
            protectedNodes.push(child);
          }
        const normal = cleanupRoute(
          cleanupName,
          id(afterName),
          targets,
          catcher,
          "next",
        );
        statements.push(
          invoke(
            segment(protectedNodes, true, normal, innerTargets, id(throwName)),
          ),
        );
        transferred = true;
        break;
      }
      const handler = node.kind === "try" ? node.handler : undefined;
      if (
        node.kind === "try" &&
        node.finalizer === undefined &&
        handler !== undefined &&
        suspends(node)
      ) {
        const afterName = resumeName + "$after" + serial++;
        const handlerName = resumeName + "$handler" + serial++;
        statements.push(
          bindStep(
            afterName,
            segment(nodes.slice(i + 1), true, following, targets, catcher),
          ),
        );
        const handlerNodes: Statement[] = [];
        const binding = handler.binding;
        if (binding !== undefined) {
          if (
            binding.kind === "object-binding" ||
            binding.kind === "array-binding"
          )
            throw "GENERATOR_CATCH_BINDING_INVARIANT";
          handlerNodes.push({
            ...span,
            kind: "variable",
            mode: "const",
            exported: false,
            declarations: [
              {
                ...span,
                name: binding.name,
                type: named("unknown"),
                initializer: id(inputName),
              },
            ],
          });
        }
        for (const child of handler.body.statements) {
          if (child === undefined) throw "GENERATOR_HANDLER_INVARIANT";
          handlerNodes.push(child);
        }
        statements.push(
          bindStep(
            handlerName,
            segment(handlerNodes, true, id(afterName), targets, catcher),
          ),
        );
        statements.push(
          invoke(
            segment(
              node.body.statements,
              true,
              id(afterName),
              targets,
              id(handlerName),
            ),
          ),
        );
        transferred = true;
        break;
      }
      if (node.kind === "switch" && suspends(node)) {
        const afterName = resumeName + "$after" + serial++;
        statements.push(
          bindStep(
            afterName,
            segment(nodes.slice(i + 1), true, following, targets, catcher),
          ),
        );
        const names: string[] = [];
        for (
          let clauseIndex = 0;
          clauseIndex < node.clauses.length;
          clauseIndex++
        )
          names.push(resumeName + "$clause" + serial++);
        let next: Expression = id(afterName);
        const clauseTargets: CompletionTargets = {
          ...targets,
          exit: id(afterName),
        };
        // Define fallthrough destinations before the clauses that reference them.
        for (
          let clauseIndex = node.clauses.length - 1;
          clauseIndex >= 0;
          clauseIndex--
        ) {
          const clause = node.clauses[clauseIndex];
          const name = names[clauseIndex];
          if (clause === undefined || name === undefined)
            throw "GENERATOR_SWITCH_INVARIANT";
          statements.push(
            bindStep(
              name,
              segment(clause.statements, true, next, clauseTargets, catcher),
            ),
          );
          next = id(name);
        }
        const clauses: SwitchClause[] = [];
        for (
          let clauseIndex = 0;
          clauseIndex < node.clauses.length;
          clauseIndex++
        ) {
          const clause = node.clauses[clauseIndex];
          const name = names[clauseIndex];
          if (clause === undefined || name === undefined)
            throw "GENERATOR_SWITCH_INVARIANT";
          clauses.push({ ...clause, statements: [invoke(id(name))] });
        }
        statements.push({ ...node, clauses });
        statements.push(invoke(id(afterName)));
        transferred = true;
        break;
      }
      if (unlabelled.kind === "while" && suspends(unlabelled)) {
        const afterName = resumeName + "$exit" + serial++;
        const headName = resumeName + "$head" + serial++;
        const after = segment(
          nodes.slice(i + 1),
          true,
          following,
          targets,
          catcher,
        );
        statements.push(bindStep(afterName, after));
        const loopBody = segment(
          statementsOf(unlabelled.body),
          true,
          id(headName),
          labelledTargets(
            { ...targets, exit: id(afterName), head: id(headName) },
            labels,
            id(afterName),
            id(headName),
          ),
          catcher,
        );
        const head = step(
          [
            {
              ...span,
              kind: "if",
              test: {
                ...span,
                kind: "unary",
                operator: "!",
                operand: unlabelled.test,
              },
              consequent: invoke(id(afterName)),
              alternate: undefined,
            },
            invoke(loopBody),
          ],
          catcher,
        );
        statements.push({
          ...span,
          kind: "variable",
          mode: "let",
          exported: false,
          declarations: [
            {
              ...span,
              name: headName,
              type: stepType(),
              initializer: head,
            },
          ],
        });
        statements.push(invoke(id(headName)));
        transferred = true;
        break;
      }
      if (node.kind === "label" && suspends(node)) {
        const afterName = resumeName + "$after" + serial++;
        statements.push(
          bindStep(
            afterName,
            segment(nodes.slice(i + 1), true, following, targets, catcher),
          ),
        );
        const labelTargets = labelledTargets(
          targets,
          labels,
          id(afterName),
          undefined,
        );
        statements.push(
          invoke(
            segment(
              statementsOf(unlabelled),
              true,
              id(afterName),
              labelTargets,
              catcher,
            ),
          ),
        );
        transferred = true;
        break;
      }
      if ((node.kind === "block" || node.kind === "if") && suspends(node)) {
        const afterName = resumeName + "$after" + serial++;
        const after = segment(
          nodes.slice(i + 1),
          true,
          following,
          targets,
          catcher,
        );
        statements.push(bindStep(afterName, after));
        if (node.kind === "block") {
          statements.push(
            invoke(
              segment(node.statements, true, id(afterName), targets, catcher),
            ),
          );
        } else {
          const consequent = segment(
            statementsOf(node.consequent),
            true,
            id(afterName),
            targets,
            catcher,
          );
          const alternate = segment(
            statementsOf(node.alternate),
            true,
            id(afterName),
            targets,
            catcher,
          );
          statements.push({
            ...node,
            consequent: invoke(consequent),
            alternate: invoke(alternate),
          });
        }
        transferred = true;
        break;
      }
      statements.push(statement(node, targets));
    }
    if (!transferred) {
      // A terminal scope may have no remaining statements (for example the
      // continuation after a final try/finally). It still completes the generator.
      statements.push(
        following === undefined ? returned(id("undefined")) : invoke(following),
      );
    }
    return step(statements, catcher);
  }
  /** Capture the pending completion before entering cleanup. The finalizer's
   * own abrupt completions use the enclosing targets and replace this one. */
  function cleanupRoute(
    cleanupName: string,
    destination: Expression | undefined,
    targets: CompletionTargets,
    catcher: Expression | undefined,
    kind: "next" | "return" | "throw",
  ): Expression {
    const valueName = resumeName + "$pendingValue" + serial++;
    let completion: Statement;
    if (kind === "return") completion = finishReturn(id(valueName), targets);
    else if (kind === "throw")
      completion = { ...span, kind: "throw", expression: id(valueName) };
    else {
      if (destination === undefined) throw "GENERATOR_CLEANUP_TARGET_INVARIANT";
      completion = invoke(destination);
    }
    return step(
      [
        bind(valueName, named("unknown"), id(inputName)),
        invoke({
          ...span,
          kind: "call",
          callee: id(cleanupName),
          arguments: [step([completion], catcher)],
        }),
      ],
      catcher,
    );
  }
  function step(
    nodes: Statement[],
    catcher: Expression | undefined,
  ): Expression {
    let statements: Statement[] = nodes;
    if (catcher !== undefined) {
      const caught = resumeName + "$caught" + serial++;
      const body: BlockStatement = {
        ...span,
        kind: "block",
        statements: nodes,
      };
      const handler: CatchClause = {
        ...span,
        binding: {
          ...span,
          name: caught,
          type: named("unknown"),
          initializer: undefined,
        },
        body: {
          ...span,
          kind: "block",
          statements: [invoke(catcher, "throw", id(caught))],
        },
      };
      statements = [
        { ...span, kind: "try", body, handler, finalizer: undefined },
      ];
    }
    return {
      ...span,
      kind: "arrow",
      parameters: [
        { ...span, name: kindName, type: named("GeneratorResumeKind") },
        { ...span, name: inputName, type: named("unknown") },
      ],
      returnType: {
        ...span,
        kind: "named",
        name: asyncGenerator
          ? "AsyncGeneratorStepOutcome"
          : "GeneratorStepOutcome",
        arguments: instantiation(
          asyncGenerator ? "AsyncGeneratorStepOutcome" : "GeneratorStepOutcome",
        ),
      },
      body: { ...span, kind: "block", statements },
    };
  }
  return segment(
    body.statements,
    true,
    undefined,
    {
      exit: undefined,
      head: undefined,
      labels: [],
    },
    undefined,
  );
}
