import type { Graph, Region } from "./model.ts";

/** The op kinds legal at one level, with optional per-kind checks. */
export interface Dialect {
  readonly name: string;
  readonly legal: (kind: string) => boolean;
}
export type StructuredVerification =
  { readonly ok: true } | { readonly ok: false; readonly message: string };
/** Every op kind is legal in the dialect, every value is defined once, and
 * every operand is defined before use: by an earlier op or argument of its
 * block, or anywhere an enclosing op's position dominates (outer blocks
 * before the op, and the arguments of enclosing blocks). Sibling blocks of a
 * region see only their own definitions and their enclosing scope's. */
export function verifyStructured(
  region: Region,
  graph: Graph,
  dialect: Dialect,
): StructuredVerification {
  const defined = new Uint8Array(graph.types.length),
    seen = new Uint8Array(graph.types.length);
  let failure: string | undefined;
  function define(value: number, scope: number[]): void {
    if (value < 0 || value >= graph.types.length) {
      failure = "value " + value + " has no type";
      return;
    }
    if (seen[value] === 1) {
      failure = "value " + value + " is defined twice";
      return;
    }
    seen[value] = 1;
    defined[value] = 1;
    scope.push(value);
  }
  function leave(scope: readonly number[]): void {
    for (const value of scope) if (value !== undefined) defined[value] = 0;
  }
  function visit(target: Region): void {
    for (const block of target.blocks) {
      if (block === undefined) throw "STRUCTURED_BLOCK_INVARIANT";
      const scope: number[] = [];
      for (const argument of block.arguments)
        if (argument !== undefined) define(argument, scope);
      for (const op of block.ops) {
        if (op === undefined) throw "STRUCTURED_OP_INVARIANT";
        if (failure !== undefined) return;
        if (!dialect.legal(op.kind)) {
          failure = op.kind + " is not legal in " + dialect.name;
          return;
        }
        for (const operand of op.operands)
          if (operand === undefined || defined[operand] !== 1) {
            failure = op.kind + " uses undefined value " + operand;
            return;
          }
        for (const nested of op.regions) {
          if (nested === undefined) throw "STRUCTURED_REGION_INVARIANT";
          visit(nested);
          if (failure !== undefined) return;
        }
        for (const result of op.results)
          if (result !== undefined) define(result, scope);
      }
      leave(scope);
    }
  }
  visit(region);
  return failure === undefined ? { ok: true } : { ok: false, message: failure };
}
