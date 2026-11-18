import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSuiteExcludingFailures,
  nativeSuiteSummary,
  suiteDispatchModules,
  type NativeSuiteBuild,
} from "./test262-native-suite.ts";

function fakeBuilds(
  attributed: ReadonlySet<number>,
  hidden: ReadonlySet<number>,
) {
  const attempts: number[][] = [];
  const build = (members: readonly number[]): NativeSuiteBuild => {
    attempts.push(members.slice());
    const named = members.filter((member) => attributed.has(member));
    if (named.length > 0)
      return {
        ok: false,
        error: { stage: "check", message: "named", module: "m" },
        culprits: named.slice(0, 1),
        stages: [],
      };
    if (members.some((member) => hidden.has(member)))
      return {
        ok: false,
        error: { stage: "emit", message: "hidden" },
        culprits: [],
        stages: [],
      };
    return {
      ok: true,
      bytes: new Uint8Array(members.length),
      modules: members.length,
      stages: [],
    };
  };
  return { build, attempts };
}

test("suite builds exclude attributed failures without bisection", () => {
  const { build, attempts } = fakeBuilds(new Set([4, 9]), new Set());
  const result = buildSuiteExcludingFailures(12, build);
  assert.deepEqual(
    [...result.failures.keys()].sort((a, b) => a - b),
    [4, 9],
  );
  assert.equal(result.failures.get(4)?.message, "named");
  assert.deepEqual(result.image?.members, [0, 1, 2, 3, 5, 6, 7, 8, 10, 11]);
  // One attempt per named culprit plus the successful build.
  assert.equal(attempts.length, 3);
});

test("suite builds bisect failures that name no member", () => {
  const { build } = fakeBuilds(new Set([2]), new Set([13, 30]));
  const seen: number[] = [];
  const result = buildSuiteExcludingFailures(37, build, (variants) =>
    seen.push(variants),
  );
  assert.deepEqual(
    [...result.failures.keys()].sort((a, b) => a - b),
    [2, 13, 30],
  );
  assert.equal(result.failures.get(13)?.message, "hidden");
  assert.equal(result.failures.get(30)?.stage, "emit");
  assert.equal(result.image?.members.length, 34);
  assert.ok(!result.image?.members.includes(13));
  assert.equal(seen[0], 37);
});

test("suites whose every member fails build no image", () => {
  const { build } = fakeBuilds(new Set(), new Set([0, 1]));
  const result = buildSuiteExcludingFailures(2, build);
  assert.equal(result.image, undefined);
  assert.equal(result.failures.size, 2);
});

test("suite dispatch is a bounded-fan-out tree over every case", () => {
  for (const count of [1, 2, 64, 65, 4096, 4097]) {
    const hosts = Array.from({ length: count }, (_, i) => `case-${i}`);
    const modules = suiteDispatchModules(hosts, undefined);
    const entry = modules.at(-1)!;
    assert.equal(entry.id, "test262-host");
    // Every case host is imported by exactly one leaf.
    const imported = modules.flatMap((module) =>
      [...module.dependencies.values()].filter((id) => id.startsWith("case-")),
    );
    assert.deepEqual(imported.sort(), hosts.slice().sort());
    for (const module of modules)
      assert.ok(module.dependencies.size <= 65, module.id);
  }
  const threaded = suiteDispatchModules(["a", "b"], "runtime").at(-1)!;
  assert.equal(threaded.dependencies.get("agent-runtime"), "runtime");
});

test("whole-program limits fail the suite without bisection", () => {
  let attempts = 0;
  const result = buildSuiteExcludingFailures(64, () => {
    attempts++;
    return {
      ok: false,
      error: { stage: "runtime link", message: "module count limit exceeded" },
      culprits: [],
      stages: [],
    };
  });
  assert.equal(attempts, 1);
  assert.equal(result.image, undefined);
  assert.equal(result.failures.size, 64);
});

test("suite summaries separate build failures from run outcomes", () => {
  const negative = { negative: { phase: "parse" } };
  const summary = nativeSuiteSummary([
    { path: "a.js", variant: "strict", status: "pass", metadata: {} },
    {
      path: "b.js",
      variant: "sloppy",
      status: "unsupported",
      metadata: {},
      buildFailure: { stage: "check", message: "x", module: "m" },
    },
    {
      path: "c.js",
      variant: "sloppy",
      status: "unsupported",
      metadata: {},
      buildFailure: { stage: "check", message: "x" },
    },
    {
      path: "d.js",
      variant: "sloppy",
      status: "pass",
      metadata: negative,
      route: "early-error-dynamic",
    },
    {
      path: "d.js",
      variant: "strict",
      status: "fail",
      metadata: negative,
      route: "early-error-dynamic",
    },
  ]);
  assert.equal(summary.builtVariants, 3);
  assert.equal(summary.buildFailureCount, 2);
  assert.deepEqual(summary.buildFailureCauses, [
    { cause: "check: x", variants: 2 },
  ]);
  assert.deepEqual(summary.dynamicEarlyErrors, [
    { phase: "parse", variants: 2, statuses: { pass: 1, fail: 1 } },
  ]);
});
