import assert from "node:assert/strict";
import test from "node:test";
import { solveDataflow } from "../src/graph/dataflow.ts";

test("propagates changed facts through cyclic dependencies to a fixed point", () => {
  const facts = [1, 0, 0];
  const result = solveDataflow(
    [[1], [2], [0]],
    [0, 1, 2],
    (node) => {
      const next = facts[node]! | facts[(node + 2) % 3]!;
      const changed = next !== facts[node];
      facts[node] = next;
      return changed;
    },
    100,
  );
  assert.equal(result.complete, true);
  assert.deepEqual(facts, [1, 1, 1]);
});

test("only revisits dependents when a fact changes and deduplicates pending visits", () => {
  const visits = [0, 0, 0, 0];
  const result = solveDataflow(
    [[1, 1], [2], [], []],
    [0, 0],
    (node) => {
      visits[node]!++;
      return node < 2;
    },
    100,
  );
  assert.equal(result.complete, true);
  assert.deepEqual(visits, [1, 1, 1, 0]);
});

test("bounds nonconvergent transfers and reports incomplete analysis", () => {
  const result = solveDataflow([[0]], [0], () => true, 10);
  assert.equal(result.complete, false);
  assert.ok(result.work <= 10);
});

test("rejects malformed dependencies before executing transfers", () => {
  let visits = 0;
  assert.equal(
    solveDataflow(
      [[2]],
      [0],
      () => {
        visits++;
        return true;
      },
      100,
    ).complete,
    false,
  );
  assert.equal(visits, 0);
  assert.equal(solveDataflow([[]], [-1], () => true, 100).complete, false);
  assert.equal(solveDataflow([[]], [0], () => true, 0).complete, false);
});
