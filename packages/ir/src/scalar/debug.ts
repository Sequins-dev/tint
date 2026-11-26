import type {
  Block,
  FunctionDebug,
  FunctionIR,
  Instruction,
  ValueBinding,
} from "./model.ts";
import { instructionResult } from "./operands.ts";

/** Variable index plus one by slot (0 where no variable is named), for
 * passes that remove stores to named slots. */
export function slotVariables(fn: FunctionIR): Uint32Array | undefined {
  const debug = fn.debug;
  if (debug === undefined || debug.slots.length === 0) return undefined;
  const variables = new Uint32Array(fn.slots.length);
  for (const binding of debug.slots) {
    if (binding === undefined) throw "debug slot binding invariant";
    if (variables[binding.slot] === 0)
      variables[binding.slot] = binding.variable + 1;
  }
  return variables;
}
/** Records that a removed `store` left `variable` holding the stored value,
 * just after the latest result defined before the store (`previous`). */
export function removedStoreBinding(
  variables: Uint32Array | undefined,
  op: Instruction,
  previous: number,
  bindings: ValueBinding[],
): void {
  if (variables === undefined || op.kind !== "store") return;
  const variable = (variables[op.slot] ?? 0) - 1;
  if (variable < 0) return;
  bindings.push({
    variable,
    value: op.value,
    after: previous === op.value ? -1 : previous,
  });
}
/** Follow (acyclic, short) alias chains to the replacing value. */
function alias(aliases: Uint32Array, id: number): number {
  let current = id;
  for (let step = 0; step < 64; step++) {
    const next = aliases[current] ?? 0;
    if (next === 0) return current;
    current = next - 1;
  }
  return current;
}
/** Value bindings after a pass rewrote `before` into `blocks`: substituted
 * values follow `aliases` (replacement + 1 by value ID), anchors removed
 * with their instruction move back to the nearest earlier kept result, and
 * bindings of values that no longer exist are dropped. */
export function retainDebugValues(
  before: FunctionIR,
  blocks: readonly Block[],
  added: readonly ValueBinding[] = [],
  aliases?: Uint32Array,
): FunctionDebug | undefined {
  const debug = before.debug;
  if (debug === undefined) return undefined;
  if (debug.values.length === 0 && added.length === 0) return debug;
  const kept = new Set<number>();
  for (const block of blocks) {
    if (block === undefined) throw "debug block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "debug instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined) kept.add(id);
    }
  }
  // The nearest kept result at or before each original result (-1: none).
  const nearest = new Map<number, number>();
  for (const block of before.blocks) {
    if (block === undefined) throw "debug block invariant";
    let last = -1;
    for (const op of block.instructions) {
      if (op === undefined) throw "debug instruction invariant";
      const id = instructionResult(op);
      if (id === undefined) continue;
      if (kept.has(id)) last = id;
      nearest.set(id, last);
    }
  }
  const values: ValueBinding[] = [],
    bindings: ValueBinding[] = debug.values.slice();
  for (const binding of added) {
    if (binding === undefined) throw "debug value binding invariant";
    bindings.push(binding);
  }
  for (const binding of bindings) {
    if (binding === undefined) throw "debug value binding invariant";
    const value =
      aliases === undefined ? binding.value : alias(aliases, binding.value);
    if (!kept.has(value)) continue;
    // The binding's original position: its anchor, else its old value.
    const anchor = binding.after >= 0 ? binding.after : binding.value,
      after = kept.has(anchor) ? anchor : nearest.get(anchor);
    if (after === undefined) continue;
    values.push({
      variable: binding.variable,
      value,
      after: after === value ? -1 : after,
    });
  }
  return { ...debug, values };
}
