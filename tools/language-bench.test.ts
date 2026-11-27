import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LANGUAGE_CATEGORIES,
  LANGUAGE_KERNELS,
  kernelByName,
  kernelsBySuite,
} from "./language-bench/registry.ts";
import {
  LANG_BENCH_MARKER,
  distribution,
  geometricMean,
  parseBenchmarkOutput,
  selectSuiteKernels,
} from "./language-bench/bench.ts";
import {
  TEST262_CANARY_MARKER,
  isValidTest262Checkout,
  loadCanaryManifest,
  parseCanaryOutput,
  prepareTest262Canary,
  stripTest262Frontmatter,
  synthesizeCanaryWorkload,
} from "./language-bench/test262-canary.ts";
import * as typedKernels from "./language-bench/kernels-typed.ts";
import * as generalKernels from "./language-bench/kernels-general.ts";
import * as asyncKernels from "./language-bench/kernels-async.ts";

test("language-bench registry covers every category with unique names and valid scales", () => {
  const names = new Set<string>();
  const categoriesCovered = new Set<string>();
  for (const spec of LANGUAGE_KERNELS) {
    assert.ok(!names.has(spec.name), "duplicate kernel: " + spec.name);
    names.add(spec.name);
    categoriesCovered.add(spec.category);
    assert.ok(spec.scale >= spec.quickScale && spec.quickScale >= 1);
    assert.ok(spec.features.length >= 1);
    assert.equal(kernelByName(spec.name), spec);
  }
  for (const cat of LANGUAGE_CATEGORIES) {
    assert.ok(
      categoriesCovered.has(cat.id),
      "uncovered language category: " + cat.id,
    );
  }
  assert.ok(kernelsBySuite("typed").length >= 30);
  assert.ok(kernelsBySuite("general").length >= 8);
  assert.ok(kernelsBySuite("async").length >= 3);
  assert.deepEqual(
    selectSuiteKernels("untyped", []).map((k) => k.name),
    selectSuiteKernels("typed", [])
      .filter((k) => k.requiresScriptHostInGeneral !== true)
      .map((k) => k.name),
  );
  assert.deepEqual(
    selectSuiteKernels("untyped", ["sharedArrayBufferViews"]).map(
      (k) => k.name,
    ),
    ["sharedArrayBufferViews"],
  );
});

test("every language-bench kernel executes deterministically in Node with integer checksums", async () => {
  const typedMap = typedKernels as Record<string, (scale: number) => number>;
  const generalMap = generalKernels as Record<
    string,
    (scale: number) => number
  >;
  const asyncMap = asyncKernels as Record<
    string,
    (scale: number) => Promise<number>
  >;

  for (const spec of LANGUAGE_KERNELS) {
    const fn =
      spec.suite === "typed"
        ? typedMap[spec.name]
        : spec.suite === "general"
          ? generalMap[spec.name]
          : asyncMap[spec.name];
    assert.ok(fn !== undefined, "missing exported kernel: " + spec.name);
    const tinyScale = Math.min(spec.quickScale, 16);
    const first = await fn(tinyScale);
    const second = await fn(tinyScale);
    assert.ok(
      Number.isSafeInteger(first),
      `kernel ${spec.name} must return a safe integer`,
    );
    assert.equal(first, second, `kernel ${spec.name} must be deterministic`);
  }
});

test("language-bench output parser enforces checksum parity and iteration order", () => {
  const output = [
    `${LANG_BENCH_MARKER} alpha 0 12.5 42`,
    `${LANG_BENCH_MARKER} alpha 1 10.0 42`,
    `${LANG_BENCH_MARKER} alpha 2 8.0 42`,
    `${LANG_BENCH_MARKER}_DONE 42`,
  ].join("\n");
  const parsed = parseBenchmarkOutput(
    output,
    { alpha: { checksum: 42 } },
    2,
    true,
  );
  assert.equal(parsed.alpha?.cold, 12.5);
  assert.equal(parsed.alpha?.steady, 9.0);
  assert.deepEqual(parsed.alpha?.warm, [10.0, 8.0]);

  assert.throws(
    () =>
      parseBenchmarkOutput(
        `${LANG_BENCH_MARKER} alpha 0 12.5 99\n${LANG_BENCH_MARKER} alpha 1 10.0 99`,
        { alpha: { checksum: 42 } },
        1,
        false,
      ),
    /invalid benchmark line/,
  );
  assert.throws(() =>
    parseBenchmarkOutput(
      `${LANG_BENCH_MARKER}_ERROR boom`,
      { alpha: { checksum: 42 } },
      1,
      true,
    ),
  );
  assert.equal(geometricMean([0.5, 2.0]), 1.0);
  assert.deepEqual(distribution([1, 2, 3, 4, 5]), { median: 3, q1: 2, q3: 4 });
});

test("Test262 canary manifest is well-formed, balanced, and handles missing checkouts cleanly", () => {
  const manifest = loadCanaryManifest();
  assert.equal(manifest.version, 1);
  assert.ok(manifest.cases.length >= 60);
  const paths = new Set<string>();
  const groups = new Set<string>();
  const families = new Set<string>();
  for (const entry of manifest.cases) {
    assert.ok(!paths.has(entry.path), "duplicate Test262 path: " + entry.path);
    paths.add(entry.path);
    groups.add(entry.group);
    families.add(entry.family);
    assert.ok(entry.path.endsWith(".js"));
  }
  assert.ok(groups.size >= 6);
  assert.ok(families.size >= 20);

  // Missing checkout degrades cleanly when allowMissing=true.
  const emptyDir = mkdtempSync(join(tmpdir(), "tint-missing-t262-"));
  try {
    assert.equal(isValidTest262Checkout(emptyDir), false);
    const saved = process.env.TINT_TEST262_DIR;
    process.env.TINT_TEST262_DIR = emptyDir;
    try {
      // Only checks explicit missing path if local repo has no checkout; test
      // direct synthesis on a synthetic mini Test262 directory below.
      assert.equal(
        stripTest262Frontmatter(
          "// header\n/*---\ninfo: test\n---*/\nlet x = 1;\n",
        ).trim(),
        "let x = 1;",
      );
    } finally {
      if (saved === undefined) delete process.env.TINT_TEST262_DIR;
      else process.env.TINT_TEST262_DIR = saved;
    }

    // Synthetic Test262 tree validates workload synthesis and output parsing
    // even on machines without a full .tint-bootstrap/test262 checkout.
    mkdirSync(join(emptyDir, "harness"), { recursive: true });
    mkdirSync(join(emptyDir, "test/language/expressions"), { recursive: true });
    writeFileSync(
      join(emptyDir, "harness/assert.js"),
      "function assert(v){ if(!v) throw new Error('fail'); }\n",
    );
    writeFileSync(
      join(emptyDir, "harness/sta.js"),
      "function Test262Error(m){ this.message = m; }\n",
    );
    writeFileSync(
      join(emptyDir, "test/language/expressions/sample.js"),
      "/*---\ndescription: sample\n---*/\nassert(1 + 1 === 2);\n",
    );
    assert.equal(isValidTest262Checkout(emptyDir), true);

    const synth = synthesizeCanaryWorkload(
      emptyDir,
      {
        version: 1,
        description: "synthetic",
        harnesses: ["assert.js", "sta.js"],
        defaultIterations: 5,
        quickIterations: 2,
        cases: [
          {
            group: "expressions",
            family: "language/expressions",
            path: "language/expressions/sample.js",
          },
        ],
      },
      4,
      2,
    );
    assert.equal(synth.totalCases, 1);
    assert.equal(synth.groups.expressions?.expectedExecutions, 4);
    assert.match(synth.workload, /__t262_case_0/);

    const parsed = parseCanaryOutput(
      [
        `${TEST262_CANARY_MARKER} expressions 0 2.0 4`,
        `${TEST262_CANARY_MARKER} expressions 1 1.2 4`,
        `${TEST262_CANARY_MARKER} expressions 2 1.6 4`,
      ].join("\n"),
      synth.groups,
      2,
    );
    assert.equal(parsed.expressions?.cold, 2.0);
    assert.equal(parsed.expressions?.steady, 1.4);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("prepareTest262Canary skips cleanly when explicitly pointed at a missing checkout", () => {
  const probe = prepareTest262Canary({
    node: process.execPath,
    test262Dir: "/nonexistent/tint-test262-path",
    allowMissing: true,
    quick: true,
    steady: 1,
    iterations: 1,
  });
  assert.deepEqual(probe, {
    kind: "tint-test262-canary-skipped",
    version: 1,
    reason: "test262-checkout-not-found",
  });
});
