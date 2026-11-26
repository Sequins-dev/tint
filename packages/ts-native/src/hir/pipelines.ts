/** HIR for iterator pipelines: chains of list `filter`/`map` stages ending in
 * a sink (`collect` into a list, `count` for `.length`, or a short-circuit
 * `some`/`every`/`find`/`findIndex`, or `forEach`). The chain is built as
 * structured ops whose attributes carry the facts fusion needs (callback
 * purity and arity, stage position); patterns rewrite it, and a chain they
 * fuse lowers to one loop with no intermediate lists. Unfused chains keep
 * the per-call lowering, which materializes every stage. */
import {
  applyPatterns,
  createBlock,
  createGraph,
  createOp,
  createPatternSet,
  createRegion,
  newValue,
  removeDeadOps,
  type Graph,
  type Op,
  type Pattern,
  type PatternContext,
  type Region,
  type Rewrite,
} from "@tint/ir/structured";
import type { Expression, Statement } from "@tint/typescript/syntax";

export type PipelineStageKind = "filter" | "map";
export type PipelineSinkKind =
  "collect" | "count" | "some" | "every" | "find" | "find-index" | "for-each";
export interface PipelineStage {
  readonly kind: PipelineStageKind;
  /** The `filter`/`map` call (its checker facts give the callback signature
   * and, for the last stage of a `collect`, the output list). */
  readonly call: Expression;
  readonly callback: Expression;
}
export interface PipelinePlan {
  readonly source: Expression;
  readonly stages: readonly PipelineStage[];
  readonly sink: {
    readonly kind: PipelineSinkKind;
    /** The call whose result the sink produces (for `collect`, the last
     * stage's call: its output list type). */
    readonly call: Expression;
    readonly callback: Expression | undefined;
  };
}
/** What the lowering knows about calls: checker builtins and the declared
 * parameter count of a call's callback. */
export interface PipelineFacts {
  readonly builtin: (node: Expression) => string | undefined;
  readonly callbackParameters: (call: Expression) => number;
  /** True for list receivers (typed arrays have their own representation). */
  readonly listSource: (node: Expression) => boolean;
}

function ungroup(node: Expression): Expression {
  let current = node;
  while (current.kind === "group") current = current.expression;
  return current;
}

const pureMath: readonly string[] = [
  "abs",
  "ceil",
  "floor",
  "round",
  "trunc",
  "sign",
  "sqrt",
  "min",
  "max",
  "imul",
  "clz32",
  "fround",
  "hypot",
  "log",
  "log2",
  "log10",
  "exp",
  "pow",
  "sin",
  "cos",
  "tan",
  "atan",
  "atan2",
];
/** An expression with no side effects that cannot throw in checked typed
 * code: reads, literals, arithmetic, comparisons, conditionals and pure
 * Math functions. Assignments, updates, other calls, `new`, `delete`,
 * `await`/`yield` and function expressions (which allocate observable
 * identities) are not. */
export function pureExpression(node: Expression): boolean {
  switch (node.kind) {
    case "identifier":
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "this":
      return true;
    case "group":
      return pureExpression(node.expression);
    case "member":
      return pureExpression(node.object);
    case "index":
      return pureExpression(node.object) && pureExpression(node.index);
    case "unary":
      return node.operator !== "delete" && pureExpression(node.operand);
    case "binary":
      return (
        node.operator !== "in" &&
        node.operator !== "instanceof" &&
        pureExpression(node.left) &&
        pureExpression(node.right)
      );
    case "conditional":
      return (
        pureExpression(node.test) &&
        pureExpression(node.consequent) &&
        pureExpression(node.alternate)
      );
    case "template-expression":
      for (const part of node.substitutions)
        if (part === undefined || !pureExpression(part)) return false;
      return true;
    case "call": {
      const callee = ungroup(node.callee);
      if (node.optional === true || callee.kind !== "member") return false;
      if (callee.optional === true || !pureMath.includes(callee.property))
        return false;
      const object = callee.object;
      if (object.kind !== "identifier" || object.name !== "Math") return false;
      for (const argument of node.arguments)
        if (argument === undefined || !pureExpression(argument)) return false;
      return true;
    }
    default:
      return false;
  }
}
/** A callback whose calls are pure: an arrow function whose body is a pure
 * expression (or a block that only returns one). */
export function pureCallback(node: Expression): boolean {
  const callback = ungroup(node);
  if (callback.kind !== "arrow" || callback.async === true) return false;
  const body = callback.body;
  if (body.kind !== "block") return pureExpression(body);
  if (body.statements.length !== 1) return false;
  const only = body.statements[0];
  return (
    only !== undefined &&
    only.kind === "return" &&
    only.expression !== undefined &&
    pureExpression(only.expression)
  );
}

function sinkBuiltin(builtin: string): PipelineSinkKind | undefined {
  switch (builtin) {
    case "indexed-some":
      return "some";
    case "indexed-every":
      return "every";
    case "indexed-find":
      return "find";
    case "indexed-find-index":
      return "find-index";
    case "indexed-for-each":
      return "for-each";
    default:
      return undefined;
  }
}
function stageKind(builtin: string | undefined): PipelineStageKind | undefined {
  return builtin === "list-filter"
    ? "filter"
    : builtin === "list-map"
      ? "map"
      : undefined;
}
function receiver(call: Expression): Expression | undefined {
  if (call.kind !== "call") return undefined;
  const callee = ungroup(call.callee);
  return callee.kind === "member" &&
    callee.optional !== true &&
    call.optional !== true
    ? callee.object
    : undefined;
}
function callback(call: Expression): Expression | undefined {
  return call.kind === "call" && call.arguments.length === 1
    ? call.arguments[0]
    : undefined;
}

/** Builds the HIR of the chain ending at `node` (a sink call, a stage call
 * whose result is collected, or `.length` of one). Returns undefined when
 * `node` is not the end of a chain of at least two operations. */
function buildChain(
  node: Expression,
  facts: PipelineFacts,
):
  | {
      readonly graph: Graph;
      readonly region: Region;
      readonly nodes: Expression[];
    }
  | undefined {
  const nodes: Expression[] = [];
  function remember(expression: Expression): number {
    nodes.push(expression);
    return nodes.length - 1;
  }
  let sinkKind: PipelineSinkKind | "length";
  let outer: Expression = ungroup(node);
  if (outer.kind === "member") {
    if (facts.builtin(outer) !== "list-length") return undefined;
    sinkKind = "length";
    outer = ungroup(outer.object);
    if (stageKind(facts.builtin(outer)) === undefined) return undefined;
  } else {
    const builtin = facts.builtin(outer);
    const sink = builtin === undefined ? undefined : sinkBuiltin(builtin);
    if (sink !== undefined) sinkKind = sink;
    else if (stageKind(builtin) !== undefined) sinkKind = "collect";
    else return undefined;
  }
  // Stages, outermost first.
  const calls: Expression[] = [];
  let cursor: Expression | undefined =
    sinkKind === "collect" || sinkKind === "length" ? outer : receiver(outer);
  if (sinkKind !== "collect" && sinkKind !== "length" && cursor !== undefined)
    cursor = ungroup(cursor);
  let sourceNode: Expression | undefined;
  for (let depth = 0; depth < 64; depth++) {
    const current = cursor;
    if (current === undefined) break;
    if (stageKind(facts.builtin(current)) === undefined) {
      sourceNode = current;
      break;
    }
    if (callback(current) === undefined) return undefined;
    calls.push(current);
    const next = receiver(current);
    cursor = next === undefined ? undefined : ungroup(next);
  }
  const operations = calls.length + (sinkKind === "collect" ? 0 : 1);
  if (sourceNode === undefined || operations < 2 || calls.length === 0)
    return undefined;
  if (!facts.listSource(sourceNode)) return undefined;
  const graph = createGraph();
  const ops: Op[] = [];
  const source = newValue(graph, "stream");
  const sourceOp = createOp("pipeline.source", { results: [source] });
  sourceOp.numbers.set("node", remember(sourceNode));
  ops.push(sourceOp);
  let stream = source;
  for (
    let index = calls.length - 1, position = 0;
    index >= 0;
    index--, position++
  ) {
    const call = calls[index];
    if (call === undefined) throw "pipeline stage invariant";
    const kind = stageKind(facts.builtin(call));
    const callbackNode = callback(call);
    if (kind === undefined || callbackNode === undefined)
      throw "pipeline stage invariant";
    const next = newValue(graph, "stream");
    const op = createOp("pipeline." + kind, {
      operands: [stream],
      results: [next],
    });
    op.numbers.set("call", remember(call));
    op.numbers.set("callback", remember(callbackNode));
    op.numbers.set("position", position);
    op.numbers.set("pure", pureCallback(callbackNode) ? 1 : 0);
    op.numbers.set("parameters", facts.callbackParameters(call));
    ops.push(op);
    stream = next;
  }
  const last = calls[0];
  if (last === undefined) throw "pipeline stage invariant";
  if (sinkKind === "collect" || sinkKind === "length") {
    const list = newValue(graph, "list");
    const collect = createOp("pipeline.collect", {
      operands: [stream],
      results: [list],
    });
    collect.numbers.set("call", remember(last));
    ops.push(collect);
    if (sinkKind === "length") {
      const length = newValue(graph, "number");
      const op = createOp("pipeline.length", {
        operands: [list],
        results: [length],
      });
      op.numbers.set("call", remember(ungroup(node)));
      ops.push(op);
    }
  } else {
    const callbackNode = callback(outer);
    if (callbackNode === undefined) return undefined;
    const result = newValue(graph, "value");
    const op = createOp("pipeline." + sinkKind, {
      operands: [stream],
      results: [result],
    });
    op.numbers.set("call", remember(outer));
    op.numbers.set("callback", remember(callbackNode));
    op.numbers.set("pure", pureCallback(callbackNode) ? 1 : 0);
    op.numbers.set("parameters", facts.callbackParameters(outer));
    ops.push(op);
  }
  // The chain's value: kept live through dead-op removal.
  ops[ops.length - 1]?.numbers.set("root", 1);
  return { graph, region: createRegion([createBlock([], ops)]), nodes };
}

const sinkKinds: readonly PipelineSinkKind[] = [
  "collect",
  "count",
  "some",
  "every",
  "find",
  "find-index",
  "for-each",
];

/** HIR patterns. `.length` of a collected stream counts it without building
 * the list. A sink whose stream comes from stages fuses into one
 * `pipeline.loop` when interleaving the stages' calls is unobservable:
 * every callback except the first stage's is pure (pure callbacks have no
 * effects and cannot throw, so they cannot observe or perturb the source or
 * each other), later stages take at most (item, index) because their
 * intermediate list no longer exists, and short-circuit sinks, which skip
 * the remaining elements, see only pure stages. */
function pipelinePatterns(definitions: Map<number, Op>): Pattern[] {
  const patterns: Pattern[] = [
    {
      name: "count-collected-stream",
      root: "pipeline.length",
      benefit: 10,
      match: (op: Op, context: PatternContext): boolean =>
        definitions.get(op.operands[0] ?? -1)?.kind === "pipeline.collect",
      rewrite: (op: Op, context: PatternContext): Rewrite => {
        const collect = definitions.get(op.operands[0] ?? -1);
        if (collect === undefined) throw "pipeline collect invariant";
        const count = createOp("pipeline.count", {
          operands: [collect.operands[0] ?? -1],
          results: [newValue(context.graph, "number")],
        });
        count.numbers.set("call", op.numbers.get("call") ?? -1);
        count.numbers.set("root", op.numbers.get("root") ?? 0);
        const result = count.results[0];
        if (result === undefined) throw "pipeline count invariant";
        definitions.set(result, count);
        return { ops: [count], results: [result] };
      },
    },
  ];
  for (const sink of sinkKinds) {
    if (sink === undefined) continue;
    patterns.push({
      name: "fuse-" + sink,
      root: "pipeline." + sink,
      benefit: 5,
      match: (op: Op, context: PatternContext): boolean => {
        if (op.numbers.get("fused") === 1) return false;
        // The sink's callback, like a later stage's, sees the fused stream.
        if ((op.numbers.get("parameters") ?? 0) > 2) return false;
        const shortCircuit =
          sink === "some" ||
          sink === "every" ||
          sink === "find" ||
          sink === "find-index";
        let stream = op.operands[0];
        while (stream !== undefined) {
          const stage = definitions.get(stream);
          if (stage === undefined) return false;
          if (stage.kind === "pipeline.source") return true;
          if (stage.kind !== "pipeline.filter" && stage.kind !== "pipeline.map")
            return false;
          const position = stage.numbers.get("position") ?? 0,
            pure = stage.numbers.get("pure") === 1;
          if (
            position > 0 &&
            (!pure || (stage.numbers.get("parameters") ?? 3) > 2)
          )
            return false;
          if (shortCircuit && !pure) return false;
          stream = stage.operands[0];
        }
        return false;
      },
      rewrite: (op: Op, context: PatternContext): Rewrite => {
        // The loop body holds copies of the chain (source first, sink last)
        // over fresh stream values, so the outer ops become dead.
        const chain: Op[] = [];
        let stream = op.operands[0];
        while (stream !== undefined) {
          const stage = definitions.get(stream);
          if (stage === undefined) throw "pipeline fusion invariant";
          chain.push(stage);
          if (stage.kind === "pipeline.source") break;
          stream = stage.operands[0];
        }
        const body: Op[] = [];
        let previous: number | undefined;
        for (let index = chain.length - 1; index >= 0; index--) {
          const original = chain[index];
          if (original === undefined) throw "pipeline fusion invariant";
          const next = newValue(context.graph, "stream");
          const copy = createOp(original.kind, {
            operands: previous === undefined ? [] : [previous],
            results: [next],
          });
          for (const [key, value] of original.numbers)
            copy.numbers.set(key, value);
          body.push(copy);
          previous = next;
        }
        const sinkCopy = createOp(op.kind, {
          operands: previous === undefined ? [] : [previous],
          results: [newValue(context.graph, "value")],
        });
        for (const [key, value] of op.numbers) sinkCopy.numbers.set(key, value);
        sinkCopy.numbers.set("fused", 1);
        body.push(sinkCopy);
        const result = newValue(
          context.graph,
          op.kind === "pipeline.count" ? "number" : "value",
        );
        const loop = createOp("pipeline.loop", {
          results: [result],
          regions: [createRegion([createBlock([], body)])],
        });
        loop.strings.set("sink", sink);
        return { ops: [loop], results: [result] };
      },
    });
  }
  return patterns;
}

/** The fused plan for the chain ending at `node`, or undefined when there is
 * no chain or it must stay unfused. `budget` bounds pattern work (runtime
 * compilation passes a small one). */
export function planPipeline(
  node: Expression,
  facts: PipelineFacts,
  budget: number = 1000,
): PipelinePlan | undefined {
  const chain = buildChain(node, facts);
  if (chain === undefined) return undefined;
  const definitions = new Map<number, Op>();
  const block = chain.region.blocks[0];
  if (block === undefined) throw "pipeline region invariant";
  for (const op of block.ops)
    if (op !== undefined)
      for (const result of op.results)
        if (result !== undefined) definitions.set(result, op);
  // Two phases: sink specialization (`.length` of a collected stream
  // becomes a count), then fusion of the specialized chain.
  const all = pipelinePatterns(definitions);
  const specialization: Pattern[] = [],
    fusion: Pattern[] = [];
  for (const pattern of all)
    if (pattern !== undefined)
      (pattern.name.startsWith("fuse-") ? fusion : specialization).push(
        pattern,
      );
  applyPatterns(
    chain.region,
    chain.graph,
    createPatternSet(specialization),
    budget,
  );
  // A fused sink yields its loop's result; everything else is pure HIR.
  const removable = (op: Op): boolean =>
    op.kind.startsWith("pipeline.") &&
    op.kind !== "pipeline.loop" &&
    op.numbers.get("fused") !== 1 &&
    op.numbers.get("root") !== 1;
  // Specialization can leave producers dead (a counted stream's list).
  removeDeadOps(chain.region, removable);
  applyPatterns(chain.region, chain.graph, createPatternSet(fusion), budget);
  removeDeadOps(chain.region, removable);
  const remaining = chain.region.blocks[0]?.ops ?? [];
  const loop = remaining[remaining.length - 1];
  if (
    remaining.length !== 1 ||
    loop === undefined ||
    loop.kind !== "pipeline.loop"
  )
    return undefined;
  const body = loop.regions[0]?.blocks[0]?.ops ?? [];
  const nodeAt = (op: Op, name: string): Expression => {
    const index = op.numbers.get(name);
    const found = index === undefined ? undefined : chain.nodes[index];
    if (found === undefined) throw "pipeline node invariant";
    return found;
  };
  let source: Expression | undefined;
  const stages: PipelineStage[] = [];
  let sink: PipelinePlan["sink"] | undefined;
  for (const op of body) {
    if (op === undefined) throw "pipeline body invariant";
    if (op.kind === "pipeline.source") source = nodeAt(op, "node");
    else if (op.kind === "pipeline.filter" || op.kind === "pipeline.map")
      stages.push({
        kind: op.kind === "pipeline.filter" ? "filter" : "map",
        call: nodeAt(op, "call"),
        callback: nodeAt(op, "callback"),
      });
    else {
      const kind = op.kind.slice("pipeline.".length);
      const sinkKind = sinkKinds.find((candidate) => candidate === kind);
      if (sinkKind === undefined) throw "pipeline sink invariant";
      sink = {
        kind: sinkKind,
        call: nodeAt(op, "call"),
        callback: op.numbers.has("callback")
          ? nodeAt(op, "callback")
          : undefined,
      };
    }
  }
  if (source === undefined || sink === undefined) return undefined;
  return { source, stages, sink };
}

/** Collects every identifier name referenced inside `node` (conservatively
 * returning false on unsupported expression forms). */
function collectExpressionNames(node: Expression, names: Set<string>): boolean {
  switch (node.kind) {
    case "identifier":
      names.add(node.name);
      return true;
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "this":
      return true;
    case "group":
      return collectExpressionNames(node.expression, names);
    case "member":
      return collectExpressionNames(node.object, names);
    case "index":
      return (
        collectExpressionNames(node.object, names) &&
        collectExpressionNames(node.index, names)
      );
    case "unary":
      return collectExpressionNames(node.operand, names);
    case "binary":
      return (
        collectExpressionNames(node.left, names) &&
        collectExpressionNames(node.right, names)
      );
    case "conditional":
      return (
        collectExpressionNames(node.test, names) &&
        collectExpressionNames(node.consequent, names) &&
        collectExpressionNames(node.alternate, names)
      );
    case "template-expression":
      for (const part of node.substitutions)
        if (part === undefined || !collectExpressionNames(part, names))
          return false;
      return true;
    case "call":
      if (!collectExpressionNames(node.callee, names)) return false;
      for (const arg of node.arguments)
        if (arg === undefined || !collectExpressionNames(arg, names))
          return false;
      return true;
    case "arrow": {
      const body = node.body;
      if (body.kind !== "block") return collectExpressionNames(body, names);
      if (body.statements.length !== 1) return false;
      const only = body.statements[0];
      return (
        only !== undefined &&
        only.kind === "return" &&
        only.expression !== undefined &&
        collectExpressionNames(only.expression, names)
      );
    }
    default:
      return false;
  }
}

function expressionSafeForForOfSink(
  node: Expression,
  forbidden: ReadonlySet<string>,
): boolean {
  switch (node.kind) {
    case "identifier":
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "this":
      return true;
    case "group":
      return expressionSafeForForOfSink(node.expression, forbidden);
    case "member":
      return expressionSafeForForOfSink(node.object, forbidden);
    case "index":
      return (
        expressionSafeForForOfSink(node.object, forbidden) &&
        expressionSafeForForOfSink(node.index, forbidden)
      );
    case "unary":
      return (
        node.operator !== "delete" &&
        expressionSafeForForOfSink(node.operand, forbidden)
      );
    case "binary":
      return (
        node.operator !== "in" &&
        node.operator !== "instanceof" &&
        expressionSafeForForOfSink(node.left, forbidden) &&
        expressionSafeForForOfSink(node.right, forbidden)
      );
    case "conditional":
      return (
        expressionSafeForForOfSink(node.test, forbidden) &&
        expressionSafeForForOfSink(node.consequent, forbidden) &&
        expressionSafeForForOfSink(node.alternate, forbidden)
      );
    case "assignment": {
      const target = ungroup(node.target);
      if (target.kind !== "identifier" || forbidden.has(target.name))
        return false;
      return expressionSafeForForOfSink(node.value, forbidden);
    }
    case "update": {
      const target = ungroup(node.target);
      return target.kind === "identifier" && !forbidden.has(target.name);
    }
    case "template-expression":
      for (const part of node.substitutions)
        if (part === undefined || !expressionSafeForForOfSink(part, forbidden))
          return false;
      return true;
    case "call": {
      const callee = ungroup(node.callee);
      if (node.optional === true || callee.kind !== "member") return false;
      if (callee.optional === true || !pureMath.includes(callee.property))
        return false;
      const object = callee.object;
      if (object.kind !== "identifier" || object.name !== "Math") return false;
      for (const arg of node.arguments)
        if (arg === undefined || !expressionSafeForForOfSink(arg, forbidden))
          return false;
      return true;
    }
    default:
      return false;
  }
}

function statementSafeForForOfSink(
  stmt: Statement,
  forbidden: ReadonlySet<string>,
): boolean {
  switch (stmt.kind) {
    case "empty":
    case "break":
    case "continue":
      return true;
    case "expression":
      return expressionSafeForForOfSink(stmt.expression, forbidden);
    case "block":
      for (const child of stmt.statements)
        if (child === undefined || !statementSafeForForOfSink(child, forbidden))
          return false;
      return true;
    case "if":
      return (
        expressionSafeForForOfSink(stmt.test, forbidden) &&
        statementSafeForForOfSink(stmt.consequent, forbidden) &&
        (stmt.alternate === undefined ||
          statementSafeForForOfSink(stmt.alternate, forbidden))
      );
    case "variable":
      for (const d of stmt.declarations) {
        if (
          d === undefined ||
          d.kind === "object-binding" ||
          d.kind === "array-binding"
        )
          return false;
        if (
          d.initializer !== undefined &&
          !expressionSafeForForOfSink(d.initializer, forbidden)
        )
          return false;
      }
      return true;
    case "return":
      return (
        stmt.expression === undefined ||
        expressionSafeForForOfSink(stmt.expression, forbidden)
      );
    case "throw":
      return expressionSafeForForOfSink(stmt.expression, forbidden);
    case "label":
      return statementSafeForForOfSink(stmt.body, forbidden);
    default:
      return false;
  }
}

/** True when a fused `collect` pipeline can stream directly into a `for-of`
 * body without materializing the output list: every stage callback is pure
 * (so early exit or throws in `body` cannot observe skipped evaluations) and
 * `body` does not mutate the source list or any binding read by the source or
 * stage callbacks. */
export function forOfPipelineCompatible(
  plan: PipelinePlan,
  body: Statement,
): boolean {
  if (plan.sink.kind !== "collect" || plan.stages.length === 0) return false;
  const forbidden = new Set<string>();
  if (!collectExpressionNames(plan.source, forbidden)) return false;
  for (const stage of plan.stages) {
    if (stage === undefined || !pureCallback(stage.callback)) return false;
    if (!collectExpressionNames(stage.callback, forbidden)) return false;
  }
  return statementSafeForForOfSink(body, forbidden);
}
