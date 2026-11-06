import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { testMetadata, syntaxVariants } from "./test262.ts";
import { executionTotals } from "./test262-execution.ts";
import { test262Source, test262Checkout } from "./test262-checkout.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tint-selection-"));
  for (const path of [
    "intl402/a.js",
    "intl402/b.js",
    "intl402/helper_FIXTURE.js",
    "intl402/Temporal/nested.js",
    "intl402/nested.js/child.js",
  ]) {
    const file = join(root, "test", path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "/*---\ndescription: selection fixture\n---*/\n");
  }
  mkdirSync(join(root, "harness"));
  writeFileSync(join(root, "harness/assert.js"), "");
  writeFileSync(join(root, "harness/sta.js"), "");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Tint fixture",
    "-c",
    "user.email=fixture@invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  return root;
}

test("an explicit top-level JavaScript selector batches every standalone file without descending", () => {
  const root = fixture();
  try {
    const suite = test262Checkout(root, "intl402/*.js");
    assert.equal(suite.selection, "intl402/*.js");
    assert.equal(suite.dirty, false);
    assert.match(suite.revision, /^[a-f0-9]{40}$/);
    assert.deepEqual(
      suite.files.map((file) => file.path),
      ["intl402/a.js", "intl402/b.js"],
    );
    assert.deepEqual(
      test262Checkout(root, "intl402").files.map((file) => file.path),
      [
        "intl402/Temporal/nested.js",
        "intl402/a.js",
        "intl402/b.js",
        "intl402/nested.js/child.js",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a completed shallow batch extracts canonical complete per-file reports", () => {
  const root = fixture();
  try {
    const suite = test262Checkout(root, "intl402/*.js");
    const observations = suite.files.flatMap((file) => {
      const input = test262Source(file.filename),
        metadata = testMetadata(input.source);
      return syntaxVariants(metadata).map((variant) => ({
        kind: "observation",
        path: file.path,
        sha256: input.sha256,
        metadata,
        variant,
        canSuspend: true,
        harness: ["assert.js", "sta.js"].map((name) => ({
          name,
          sha256: test262Source(join(root, "harness", name)).sha256,
        })),
        outcome: { kind: "completed" },
        status: "pass",
        elapsedMs: 0,
        batch: 0,
      }));
    });
    const journal = join(root, "batch.jsonl"),
      output = join(root, "extracted.json");
    const header = {
      kind: "start",
      schemaVersion: 2,
      frozenToolchainSha256: "a".repeat(64),
      revision: suite.revision,
      dirty: false,
      selection: suite.selection,
      engine: "native-script-test",
      sourceSnapshot: { sha256: "b".repeat(64), files: 0 },
      batchSize: 64,
    };
    writeFileSync(
      journal,
      [
        header,
        {
          kind: "compilation",
          compilation: {
            id: 0,
            variants: observations.length,
            kind: "execution",
            compileMs: 0,
            outcome: "compiled",
          },
        },
        ...observations,
        {
          kind: "complete",
          totals: executionTotals(observations.map(() => "pass")),
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    execFileSync(
      process.execPath,
      [
        "tools/test262-native-extract.ts",
        root,
        journal,
        "intl402/a.js",
        output,
      ],
      { stdio: "pipe" },
    );
    const report = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(report.kind, "runtime-execution");
    assert.equal(report.selection, "intl402/a.js");
    assert.equal(report.totals.total, 2);
    assert.equal(report.totals.passed, 2);
    assert.deepEqual(
      report.observations.map((o: { path: string }) => o.path),
      ["intl402/a.js", "intl402/a.js"],
    );
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          "tools/test262-native-extract.ts",
          root,
          journal,
          "intl402/Temporal",
          join(root, "outside.json"),
        ],
        { stdio: "pipe" },
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shallow selection retains the checkout boundary and rejects unsupported wildcard forms", () => {
  const root = fixture();
  try {
    assert.throws(() => test262Checkout(root, "../*.js"), /remain within/);
    assert.throws(() => test262Checkout(root, "intl402/**"), /trailing \*\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
