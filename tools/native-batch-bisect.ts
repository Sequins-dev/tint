/** Batch compilation cost is dominated by the shared runtime, so batches are
 * large; one variant that does not compile must not fail its neighbours.
 * A failed build of several items is retried as two halves, recursively, so
 * every failure is attributed to a single-item build. `run` receives each
 * successfully built group with its build value, or each single failed item
 * with its failure, in the original item order. */
export function buildWithBisection<Item, Built, Failure>(
  items: readonly Item[],
  build: (
    group: readonly Item[],
  ) => { ok: true; value: Built } | { ok: false; failure: Failure },
  run: (
    group: readonly Item[],
    result: { ok: true; value: Built } | { ok: false; failure: Failure },
  ) => void,
): void {
  if (items.length === 0) return;
  const result = build(items);
  if (result.ok || items.length === 1) {
    run(items, result);
    return;
  }
  const middle = Math.ceil(items.length / 2);
  buildWithBisection(items.slice(0, middle), build, run);
  buildWithBisection(items.slice(middle), build, run);
}
