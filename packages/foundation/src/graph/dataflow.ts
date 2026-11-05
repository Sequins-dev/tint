export interface DataflowResult {
  readonly complete: boolean;
  readonly work: number;
}
/** Solve a finite dependency graph. Transfer must join into caller-owned facts
 * monotonically and return whether they changed. On incomplete results, callers
 * must discard all facts; intermediate states are not proofs. Dependency lists
 * are immutable for this invocation. Rebuild after any IR mutation. */
export function solveDataflow(
  dependents: readonly (readonly number[])[],
  seeds: readonly number[],
  transfer: (node: number) => boolean,
  maxWork: number,
): DataflowResult {
  let work = 0;
  const count = dependents.length;
  if (!Number.isSafeInteger(maxWork) || maxWork < count || count > 0xffffffff)
    return { complete: false, work };
  for (const edges of dependents) {
    if (edges === undefined) return { complete: false, work };
    if (work >= maxWork) return { complete: false, work };
    work++;
    for (const edge of edges) {
      if (work >= maxWork) return { complete: false, work };
      work++;
      if (
        edge === undefined ||
        !Number.isSafeInteger(edge) ||
        edge < 0 ||
        edge >= count
      )
        return { complete: false, work };
    }
  }
  for (const seed of seeds) {
    if (work >= maxWork) return { complete: false, work };
    work++;
    if (
      seed === undefined ||
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed >= count
    )
      return { complete: false, work };
  }
  const pending = new Uint8Array(count),
    queue = new Uint32Array(count);
  let head = 0,
    tail = 0,
    size = 0;
  function enqueue(node: number): void {
    if (pending[node] !== 0) return;
    pending[node] = 1;
    queue[tail] = node;
    tail = (tail + 1) % count;
    size++;
  }
  for (const seed of seeds) {
    if (seed === undefined) throw "dataflow seed invariant";
    enqueue(seed);
  }
  while (size > 0) {
    if (work >= maxWork) return { complete: false, work };
    work++;
    const node = queue[head];
    if (node === undefined) throw "dataflow queue invariant";
    head = (head + 1) % count;
    size--;
    pending[node] = 0;
    if (!transfer(node)) continue;
    const edges = dependents[node];
    if (edges === undefined) throw "dataflow dependency invariant";
    for (const edge of edges) {
      if (work >= maxWork) return { complete: false, work };
      work++;
      if (edge === undefined) throw "dataflow edge invariant";
      enqueue(edge);
    }
  }
  return { complete: true, work };
}
