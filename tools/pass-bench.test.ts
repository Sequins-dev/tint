import assert from "node:assert/strict";
import { test } from "node:test";
import { keyedPasses, report, summarize } from "./pass-bench.ts";

const pass = (name: string, milliseconds: number, exhausted = false) => ({
  pass: name,
  visited: 10,
  rewritten: 1,
  budgetExhausted: exhausted,
  milliseconds,
});

test("repeated passes are keyed by occurrence", () => {
  const keys = keyedPasses({
    budgetExhausted: false,
    passes: [pass("fold", 1), pass("cleanup", 1), pass("fold", 1)],
  }).map((item) => item.key);
  assert.deepEqual(keys, ["fold#1", "cleanup#1", "fold#2"]);
});

test("pass times are medians over rounds, compared by key", () => {
  const rounds = [3, 1, 2].map((ms) => ({
    budgetExhausted: false,
    passes: [pass("fold", ms), pass("split", ms * 10)],
  }));
  const current = summarize("node", rounds);
  assert.deepEqual(
    current.passes.map((item) => item.milliseconds),
    [2, 20],
  );
  assert.equal(current.totalMilliseconds, 22);
  const baseline = summarize("node", [
    { budgetExhausted: false, passes: [pass("fold", 4), pass("old", 1)] },
  ]);
  const text = report(current, baseline);
  assert.match(text, /split#1 .* new/);
  assert.match(text, /old#1 .* removed/);
  assert.match(text, /fold#1 .*-2\.0/);
});

test("budget exhaustion fails the benchmark", () => {
  assert.throws(
    () =>
      summarize("node", [
        { budgetExhausted: true, passes: [pass("fold", 1, true)] },
      ]),
    /budget exhausted in fold/,
  );
});
