import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executionPlan,
  judgeExecution,
  executionTotals,
} from "./test262-execution.ts";
const metadata = { flags: [], features: [], includes: [] };
test("execution planning retains global source goals and harness order", () => {
  const plan = executionPlan("let x=1;", "strict", {
    ...metadata,
    includes: ["compareArray.js"],
  });
  assert.equal(plan.source, '"use strict";\nlet x=1;');
  assert.equal(plan.goal, "script");
  assert.deepEqual(plan.harness, ["assert.js", "sta.js", "compareArray.js"]);
  assert.equal(executionPlan("export {};", "module", metadata).goal, "module");
  assert.deepEqual(
    executionPlan("raw", "raw", { ...metadata, flags: ["raw"] }).harness,
    [],
  );
  assert.deepEqual(
    executionPlan("bad", "strict", {
      ...metadata,
      negative: { phase: "parse", type: "SyntaxError" },
    }).harness,
    [],
  );
  assert.deepEqual(
    executionPlan("async", "strict", {
      ...metadata,
      flags: ["async"],
      includes: ["extra.js"],
    }).harness,
    ["assert.js", "sta.js", "doneprintHandle.js", "extra.js"],
  );
});
test("only exact phase and constructor matches pass negative tests", () => {
  const negative = {
    ...metadata,
    negative: { phase: "runtime", type: "TypeError" },
  };
  assert.equal(
    judgeExecution(negative, {
      kind: "error",
      phase: "runtime",
      type: "TypeError",
      message: "bad",
    }),
    "pass",
  );
  assert.equal(
    judgeExecution(negative, {
      kind: "error",
      phase: "parse",
      type: "TypeError",
      message: "bad",
    }),
    "fail",
  );
  assert.equal(
    judgeExecution(negative, {
      kind: "error",
      phase: "harness",
      type: "TypeError",
      message: "bad",
    }),
    "harness-error",
  );
  assert.equal(
    judgeExecution(negative, {
      kind: "error",
      phase: "runtime",
      type: "RangeError",
      message: "bad",
    }),
    "fail",
  );
  assert.equal(judgeExecution(negative, { kind: "completed" }), "fail");
  assert.equal(
    judgeExecution(negative, {
      kind: "unsupported",
      reason: "missing runtime",
    }),
    "unsupported",
  );
  assert.equal(judgeExecution(metadata, { kind: "completed" }), "pass");
  assert.equal(judgeExecution(metadata, { kind: "timeout" }), "timeout");
});
test("coverage denominators retain unavailable and failed variants", () => {
  assert.deepEqual(
    executionTotals([
      "pass",
      "fail",
      "unsupported",
      "timeout",
      "harness-error",
      "crash",
    ]),
    {
      total: 6,
      passed: 1,
      failed: 1,
      unsupported: 1,
      timeouts: 1,
      harnessErrors: 1,
      crashes: 1,
      passFraction: 1 / 6,
    },
  );
  assert.equal(executionTotals([]).passFraction, null);
});

test("execution planning preserves per-agent CanBlock requirements", () => {
  for (const [flags, expected] of [
    [[], true],
    [["CanBlockIsTrue"], true],
    [["CanBlockIsFalse"], false],
  ] as const)
    assert.equal(
      executionPlan("42;", "sloppy", { ...metadata, flags: [...flags] })
        .canSuspend,
      expected,
    );
  assert.throws(
    () =>
      executionPlan("42;", "sloppy", {
        ...metadata,
        flags: ["CanBlockIsTrue", "CanBlockIsFalse"],
      }),
    /conflicting.*CanBlock/,
  );
});
