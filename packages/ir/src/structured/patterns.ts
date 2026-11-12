import type { Graph, Op, Region } from "./model.ts";

/** What a pattern sees: the graph and the current definition of a value
 * (values replaced by earlier rewrites resolve to their replacements). */
export interface PatternContext {
  readonly graph: Graph;
  readonly resolve: (value: number) => number;
}
/** Replacement for one op: new ops spliced in its place, and the values that
 * stand for its results (same length and order). Higher-level replacements
 * are matched again, so specialization recurses until no pattern applies. */
export interface Rewrite {
  readonly ops: readonly Op[];
  readonly results: readonly number[];
}
/** A lowering or optimization rule for ops of one kind. Among the patterns
 * whose `match` holds, the driver applies the highest benefit (ties by
 * name), so specialized variants win over general fallbacks. */
export interface Pattern {
  readonly name: string;
  readonly root: string;
  readonly benefit: number;
  readonly match: (op: Op, context: PatternContext) => boolean;
  readonly rewrite: (op: Op, context: PatternContext) => Rewrite;
}
export interface PatternSet {
  readonly byRoot: Map<string, Pattern[]>;
}
export function createPatternSet(patterns: readonly Pattern[]): PatternSet {
  const byRoot = new Map<string, Pattern[]>();
  for (const pattern of patterns) {
    if (pattern === undefined) throw "STRUCTURED_PATTERN_INVARIANT";
    let list = byRoot.get(pattern.root);
    if (list === undefined) {
      list = [];
      byRoot.set(pattern.root, list);
    }
    list.push(pattern);
    list.sort((a, b) =>
      a.benefit !== b.benefit
        ? b.benefit - a.benefit
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
    );
  }
  return { byRoot };
}
export interface PatternApplication {
  /** Rewrites applied, in application order (pattern names). */
  readonly applied: readonly string[];
  readonly work: number;
  /** True when the budget ended the walk; the region is still valid IR. */
  readonly exhausted: boolean;
}
/** Applies patterns to every op of a region, outer ops first, then their
 * (possibly rewritten) regions. Replacement ops are visited again before the
 * walk advances. Operands are resolved through earlier replacements before
 * each op is matched. Deterministic; bounded by `budget` match attempts. */
export function applyPatterns(
  region: Region,
  graph: Graph,
  patterns: PatternSet,
  budget: number,
): PatternApplication {
  const forward: number[] = [],
    applied: string[] = [];
  let work = 0,
    exhausted = false;
  function resolve(value: number): number {
    let current = value;
    for (let hops = 0; hops < 1000000; hops++) {
      const next = forward[current];
      if (next === undefined || next === current) return current;
      current = next;
    }
    throw "STRUCTURED_FORWARDING_CYCLE";
  }
  const context: PatternContext = { graph, resolve };
  function visitRegion(target: Region): void {
    for (const block of target.blocks) {
      if (block === undefined) throw "STRUCTURED_BLOCK_INVARIANT";
      let index = 0;
      while (index < block.ops.length) {
        if (work >= budget) {
          exhausted = true;
          return;
        }
        work++;
        const op = block.ops[index];
        if (op === undefined) throw "STRUCTURED_OP_INVARIANT";
        for (let i = 0; i < op.operands.length; i++)
          op.operands[i] = resolve(op.operands[i] ?? 0);
        const candidates = patterns.byRoot.get(op.kind);
        let chosen: Pattern | undefined;
        if (candidates !== undefined)
          for (const pattern of candidates) {
            if (pattern === undefined) throw "STRUCTURED_PATTERN_INVARIANT";
            if (pattern.match(op, context)) {
              chosen = pattern;
              break;
            }
          }
        if (chosen === undefined) {
          for (const nested of op.regions) {
            if (nested === undefined) throw "STRUCTURED_REGION_INVARIANT";
            visitRegion(nested);
            if (exhausted) return;
          }
          index++;
          continue;
        }
        const rewrite = chosen.rewrite(op, context);
        if (rewrite.results.length !== op.results.length)
          throw "STRUCTURED_REWRITE_ARITY";
        for (let i = 0; i < op.results.length; i++) {
          const from = op.results[i],
            to = rewrite.results[i];
          if (from === undefined || to === undefined)
            throw "STRUCTURED_REWRITE_INVARIANT";
          if (from !== to) forward[from] = to;
        }
        const ops: Op[] = [];
        for (let i = 0; i < index; i++) {
          const kept = block.ops[i];
          if (kept === undefined) throw "STRUCTURED_OP_INVARIANT";
          ops.push(kept);
        }
        for (const replacement of rewrite.ops) {
          if (replacement === undefined) throw "STRUCTURED_REWRITE_INVARIANT";
          ops.push(replacement);
        }
        for (let i = index + 1; i < block.ops.length; i++) {
          const kept = block.ops[i];
          if (kept === undefined) throw "STRUCTURED_OP_INVARIANT";
          ops.push(kept);
        }
        block.ops = ops;
        applied.push(chosen.name);
      }
    }
  }
  visitRegion(region);
  // Final operand resolution, so uses after a rewrite see replacements.
  function resolveRegion(target: Region): void {
    for (const block of target.blocks) {
      if (block === undefined) throw "STRUCTURED_BLOCK_INVARIANT";
      for (const op of block.ops) {
        if (op === undefined) throw "STRUCTURED_OP_INVARIANT";
        for (let i = 0; i < op.operands.length; i++)
          op.operands[i] = resolve(op.operands[i] ?? 0);
        for (const nested of op.regions) {
          if (nested === undefined) throw "STRUCTURED_REGION_INVARIANT";
          resolveRegion(nested);
        }
      }
    }
  }
  resolveRegion(region);
  return { applied, work, exhausted };
}
