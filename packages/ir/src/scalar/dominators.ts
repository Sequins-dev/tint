import type { Block, FunctionIR } from "./model.ts";

/** Immediate dominators over normal and exceptional edges, by the iterative
 * algorithm of Cooper, Harvey and Kennedy ("A Simple, Fast Dominance
 * Algorithm"). `idom[b]` encodes the immediate dominator ID + 1, the entry
 * names itself, and 0 marks an unreachable block.
 * An exceptional edge leaves from the start of its block, so a block's
 * dominance says nothing about instructions inside it having executed.
 * Undefined on budget exhaustion. */
export interface Dominators {
  readonly idom: Uint32Array;
  readonly visited: number;
}
function successors(block: Block, visit: (target: number) => void): void {
  const t = block.terminator;
  if (t.kind === "jump") visit(t.target);
  else if (
    t.kind === "branch" ||
    t.kind === "record" ||
    t.kind === "record-cell" ||
    t.kind === "cell"
  ) {
    visit(t.consequent);
    visit(t.alternate);
  }
  if (block.exception !== undefined) visit(block.exception.target);
}
export function immediateDominators(
  fn: FunctionIR,
  budget: number,
): Dominators | undefined {
  const count = fn.blocks.length;
  let visited = 0;
  // Reverse postorder by an explicit depth-first walk.
  // Reverse-postorder numbers; unreachable blocks never get one.
  const order = new Uint32Array(count),
    postorder: number[] = [],
    stack: number[] = [fn.entry],
    cursor: number[] = [0],
    state = new Uint8Array(count),
    predecessors: number[][] = [];
  for (let id = 0; id < count; id++) predecessors.push([]);
  for (const block of fn.blocks) {
    if (block === undefined) throw "dominator block invariant";
    if (++visited > budget) return undefined;
    successors(block, (target) => {
      const list = predecessors[target];
      if (list === undefined) throw "dominator edge invariant";
      list.push(block.id);
    });
  }
  state[fn.entry] = 1;
  while (stack.length > 0) {
    if (++visited > budget) return undefined;
    const id = stack[stack.length - 1],
      next = cursor[cursor.length - 1];
    if (id === undefined || next === undefined)
      throw "dominator walk invariant";
    const block = fn.blocks[id];
    if (block === undefined) throw "dominator block invariant";
    const targets: number[] = [];
    successors(block, (target) => {
      targets.push(target);
    });
    if (next < targets.length) {
      cursor[cursor.length - 1] = next + 1;
      const target = targets[next];
      if (target === undefined) throw "dominator target invariant";
      if (state[target] === 0) {
        state[target] = 1;
        stack.push(target);
        cursor.push(0);
      }
      continue;
    }
    stack.pop();
    cursor.pop();
    postorder.push(id);
  }
  const rpo: number[] = [];
  for (let i = postorder.length - 1; i >= 0; i--) {
    const id = postorder[i];
    if (id === undefined) throw "dominator order invariant";
    order[id] = rpo.length + 1;
    rpo.push(id);
  }
  const idom = new Uint32Array(count);
  idom[fn.entry] = fn.entry + 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of rpo) {
      if (id === undefined) throw "dominator order invariant";
      if (id === fn.entry) continue;
      const list = predecessors[id];
      if (list === undefined) throw "dominator predecessor invariant";
      let candidate = -1;
      for (const from of list) {
        if (from === undefined) throw "dominator predecessor invariant";
        if (++visited > budget) return undefined;
        if ((idom[from] ?? 0) === 0) continue;
        if (candidate < 0) {
          candidate = from;
          continue;
        }
        // Intersect: walk both fingers up by reverse-postorder number.
        let a = from,
          b = candidate;
        while (a !== b) {
          if (++visited > budget) return undefined;
          while ((order[a] ?? 0) > (order[b] ?? 0))
            a = (idom[a] ?? fn.entry + 1) - 1;
          while ((order[b] ?? 0) > (order[a] ?? 0))
            b = (idom[b] ?? fn.entry + 1) - 1;
        }
        candidate = a;
      }
      if (candidate >= 0 && idom[id] !== candidate + 1) {
        idom[id] = candidate + 1;
        changed = true;
      }
    }
  }
  return { idom, visited };
}
/** Whether block `a` dominates block `b` (every block dominates itself);
 * false for unreachable blocks. */
export function dominates(
  dominators: Dominators,
  entry: number,
  a: number,
  b: number,
): boolean {
  let current = b;
  for (let steps = 0; steps <= dominators.idom.length; steps++) {
    if (current === a) return true;
    const parent = dominators.idom[current] ?? 0;
    if (parent === 0 || current === entry) return false;
    current = parent - 1;
  }
  return false;
}
