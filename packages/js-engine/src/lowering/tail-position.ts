import type {
  BlockStatement,
  Expression,
  Statement,
} from "@tint/typescript/syntax";

/** Collect source call nodes whose result can replace a strict ordinary body's
 * return. Nested functions are separate owners. The caller supplies the body's
 * effective strictness and suspension kind, including inherited strictness. */
export function collectTailCalls(
  body: BlockStatement | Expression,
  options: {
    readonly strict: boolean;
    readonly async?: boolean;
    readonly generator?: boolean;
  },
): ReadonlySet<Expression> {
  const calls = new Set<Expression>();
  if (!options.strict || options.async || options.generator) return calls;

  function expression(node: Expression): void {
    switch (node.kind) {
      case "call":
        // SuperCall has construction work after the call, unlike super.method().
        if (node.callee.kind !== "super") calls.add(node);
        return;
      case "tagged-template":
        calls.add(node);
        return;
      case "group":
        expression(node.expression);
        return;
      case "conditional":
        expression(node.consequent);
        expression(node.alternate);
        return;
      case "binary":
        if (
          node.operator === "," ||
          node.operator === "&&" ||
          node.operator === "||" ||
          node.operator === "??"
        )
          expression(node.right);
        return;
      default:
        return;
    }
  }

  /** A resource declared in this list remains live for its later statements.
   * A nested block disposes its own resources before the outer list continues. */
  function list(
    nodes: readonly Statement[],
    disposal: boolean = false,
  ): boolean {
    for (const node of nodes) {
      if (node === undefined) throw "TAIL_POSITION_STATEMENT_INVARIANT";
      if (!disposal) statement(node);
      if (node.kind === "variable" && node.disposal !== undefined)
        disposal = true;
    }
    return disposal;
  }

  function statement(node: Statement): void {
    switch (node.kind) {
      case "block":
        list(node.statements);
        return;
      case "return":
        if (node.expression !== undefined) expression(node.expression);
        return;
      case "if":
        statement(node.consequent);
        if (node.alternate !== undefined) statement(node.alternate);
        return;
      case "while":
      case "do-while":
      case "for-in":
      case "for-in-assignment":
      case "with":
      case "label":
        statement(node.body);
        return;
      case "for": {
        const initializer = node.initializer;
        if (
          initializer !== undefined &&
          initializer.kind === "variable" &&
          initializer.disposal !== undefined
        )
          return;
        statement(node.body);
        return;
      }
      case "try":
        // A try body must still route errors through its catch/finally. Only
        // the finalizer, or a catch with no finalizer, can finish this body.
        if (node.finalizer !== undefined) statement(node.finalizer);
        else if (node.handler !== undefined) statement(node.handler.body);
        return;
      case "switch": {
        // Case clauses share one disposal scope, including fallthrough paths.
        let disposal = false;
        for (const clause of node.clauses) {
          if (clause === undefined) throw "TAIL_POSITION_CLAUSE_INVARIANT";
          disposal = list(clause.statements, disposal);
        }
        return;
      }
      default:
        // For-of closes its iterator after return; declarations and nested
        // functions do not contribute calls to this body's tail positions.
        return;
    }
  }

  if (body.kind === "block") statement(body);
  else expression(body);
  return calls;
}
