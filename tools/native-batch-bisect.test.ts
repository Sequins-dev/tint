import assert from "node:assert/strict";
import test from "node:test";
import { buildWithBisection } from "./native-batch-bisect.ts";

function exercise(items: readonly number[], bad: ReadonlySet<number>) {
  const builds: number[][] = [],
    runs: { group: number[]; ok: boolean }[] = [];
  buildWithBisection(
    items,
    (group) => {
      builds.push([...group]);
      return group.some((item) => bad.has(item))
        ? { ok: false as const, failure: "bad" }
        : { ok: true as const, value: group.length };
    },
    (group, result) => runs.push({ group: [...group], ok: result.ok }),
  );
  return { builds, runs };
}

test("a batch that compiles is built and run once", () => {
  const { builds, runs } = exercise([1, 2, 3, 4], new Set());
  assert.deepEqual(builds, [[1, 2, 3, 4]]);
  assert.deepEqual(runs, [{ group: [1, 2, 3, 4], ok: true }]);
});

test("a failing variant is isolated without failing its neighbours", () => {
  const { runs } = exercise([1, 2, 3, 4, 5, 6, 7], new Set([5]));
  assert.deepEqual(
    runs.map((run) => [run.group, run.ok]),
    [
      [[1, 2, 3, 4], true],
      [[5], false],
      [[6], true],
      [[7], true],
    ],
  );
});

test("every item is run exactly once and in order, whatever fails", () => {
  for (let mask = 0; mask < 64; mask++) {
    const items = [0, 1, 2, 3, 4, 5],
      bad = new Set(items.filter((item) => (mask & (1 << item)) !== 0));
    const { runs } = exercise(items, bad);
    assert.deepEqual(
      runs.flatMap((run) => run.group),
      items,
    );
    for (const run of runs) {
      assert.equal(run.ok, !run.group.some((item) => bad.has(item)));
      if (!run.ok) assert.equal(run.group.length, 1);
    }
  }
});

test("an empty batch builds nothing", () => {
  const { builds, runs } = exercise([], new Set());
  assert.equal(builds.length + runs.length, 0);
});
