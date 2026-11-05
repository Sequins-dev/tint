import type { Expression } from "./model.ts";

/** Postfix links share short-circuiting; a parenthesized expression ends that chain. */
export function isOptionalChain(node: Expression): boolean {
  while (
    node.kind === "member" ||
    node.kind === "index" ||
    node.kind === "call"
  ) {
    if (node.optional === true) return true;
    node = node.kind === "call" ? node.callee : node.object;
  }
  return false;
}

/** Syntactic candidate; intrinsic identity is checked only after evaluating arguments. */
export function isDirectEvalCandidate(node: Expression): boolean {
  if (node.kind !== "call" || node.optional === true) return false;
  let callee = node.callee;
  while (callee.kind === "group") callee = callee.expression;
  return callee.kind === "identifier" && callee.name === "eval";
}
