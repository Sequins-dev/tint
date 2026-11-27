import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateScorecard,
  parseLegacyBenchReport,
  parseLegacyBenchSmoke,
  renderScorecardMarkdown,
  type ScorecardEntry,
  type ScorecardReport,
} from "./scorecard.ts";

test("scorecard aggregation computes geomeans, twin speedups, and >2x deficits", () => {
  const entries: ScorecardEntry[] = [
    {
      suite: "language-typed",
      mode: "typed",
      category: "serialization-binary",
      kernel: "jsonRoundtrip",
      typedStatus: "native",
      nodeMs: 10,
      tintMs: 5,
      ratio: 0.5,
    },
    {
      suite: "language-typed",
      mode: "typed",
      category: "math-builtins",
      kernel: "mathTranscendental",
      typedStatus: "native",
      nodeMs: 10,
      tintMs: 20,
      ratio: 2.0,
    },
    {
      suite: "language-untyped",
      mode: "untyped",
      category: "serialization-binary",
      kernel: "jsonRoundtrip",
      typedStatus: "native",
      nodeMs: 10,
      tintMs: 25,
      ratio: 2.5,
    },
    {
      suite: "language-general",
      mode: "general",
      category: "stdlib-builtins",
      kernel: "regexpMatchExecReplace",
      typedStatus: "fallback",
      nodeMs: 10,
      tintMs: 40,
      ratio: 4.0,
    },
  ];

  const summary = aggregateScorecard(entries);
  assert.equal(summary.totalMeasurements, 4);
  assert.equal(summary.typedCount, 2);
  assert.equal(summary.untypedCount, 2);
  assert.ok(Math.abs((summary.typedGeomean ?? 0) - 1.0) < 1e-9);
  assert.ok(Math.abs((summary.untypedGeomean ?? 0) - Math.sqrt(10)) < 1e-9);
  assert.equal(summary.deficitsOver2x.length, 2);
  assert.equal(summary.deficitsOver2x[0]?.kernel, "regexpMatchExecReplace");
  assert.equal(summary.deficitsOver2x[1]?.kernel, "jsonRoundtrip");

  assert.equal(summary.typedTwins.length, 1);
  assert.equal(summary.typedTwins[0]?.kernel, "jsonRoundtrip");
  assert.equal(summary.typedTwins[0]?.typedSpeedupOverUntyped, 5.0);
  assert.ok(Math.abs((summary.typedVsUntypedSpeedupGeomean ?? 0) - 5.0) < 1e-9);

  const report: ScorecardReport = {
    kind: "tint-holistic-scorecard",
    version: 1,
    label: "unit-test",
    profile: "quick",
    recordedAt: "2026-11-27T00:00:00.000Z",
    head: "deadbeef",
    platform: "darwin-arm64",
    cpu: "Apple M5 Max",
    node: "/opt/homebrew/bin/node",
    nodeVersion: "v26.13.1",
    rounds: 2,
    steady: 2,
    suites: [
      { suite: "language-typed", status: "completed", measurements: 2 },
      { suite: "language-untyped", status: "completed", measurements: 1 },
      { suite: "language-general", status: "completed", measurements: 1 },
      {
        suite: "test262-canary",
        status: "skipped",
        reason: "test262-checkout-not-found",
        measurements: 0,
      },
    ],
    summary,
    entries,
  };
  const md = renderScorecardMarkdown(report);
  assert.match(md, /Tint Holistic Language & Builtin Scorecard/);
  assert.match(md, /Typed vs Untyped Twin Comparison/);
  assert.match(md, /Deficits > 2\.00× Slower Than Node/);
  assert.match(md, /regexpMatchExecReplace/);
  assert.match(md, /test262-checkout-not-found/);
});

test("legacy bench smoke and report parsers extract ratios cleanly", () => {
  const smoke = [
    "node allocation       cold 15.0      steady 12.0",
    "node numeric          cold 20.0      steady 18.0",
    "tint allocation       cold  7.0      steady  6.0",
    "tint numeric          cold 10.0      steady  9.0",
  ].join("\n");
  const smokeEntries = parseLegacyBenchSmoke(
    smoke,
    "typed-bench",
    "typed",
    "typed-bench:typed",
  );
  assert.equal(smokeEntries.length, 2);
  assert.equal(smokeEntries[0]?.ratio, 0.5);
  assert.equal(smokeEntries[1]?.ratio, 0.5);

  const reportEntries = parseLegacyBenchReport(
    {
      summary: {
        concat: {
          node: { steadyMs: { median: 10 } },
          tint: {
            steadyMs: { median: 7.5 },
            steadyOverNode: { median: 0.75 },
          },
        },
      },
    },
    "string-bench",
    "typed",
    "string-bench:typed",
  );
  assert.equal(reportEntries.length, 1);
  assert.equal(reportEntries[0]?.ratio, 0.75);
});
