import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  enumerateVariants,
  aggregateEvidence,
  readJournal,
  canonicalTable,
  compactEvidence,
  fallbackEvidenceDate,
} from "./test262-coverage-ledger.ts";
import type { NativeObservation } from "./native-run-journal.ts";
import { executionTotals } from "./test262-execution.ts";

test("denominator shares strictness, raw, module, negative and fixture policy", () => {
  const root = mkdtempSync(join(tmpdir(), "tint-ledger-"));
  try {
    mkdirSync(join(root, "test"));
    mkdirSync(join(root, "harness"));
    for (const name of ["assert.js", "sta.js"])
      writeFileSync(join(root, "harness", name), "");
    for (const [name, flags] of [
      ["normal", ""],
      ["strict", "onlyStrict"],
      ["sloppy", "noStrict"],
      ["raw", "raw"],
      ["module", "module"],
      ["ignore_FIXTURE", ""],
    ])
      writeFileSync(
        join(root, "test", name + ".js"),
        `/*---\nflags: [${flags}]\n---*/\n`,
      );
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    ]);
    writeFileSync(
      join(root, "test", "negative.js"),
      "/*---\nnegative: {phase: parse, type: SyntaxError}\n---*/\n",
    );
    const inventory = enumerateVariants(root);
    assert.equal(inventory.variants.size, 8);
    assert.deepEqual(
      [...inventory.variants.values()].map((v) => v.variant).sort(),
      [
        "module",
        "raw",
        "sloppy",
        "sloppy",
        "sloppy",
        "strict",
        "strict",
        "strict",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const input = {
  path: "language/statements/x/a.js",
  variant: "sloppy" as const,
  sha256: "abc",
  metadata: { flags: [], includes: [], features: [] },
  harness: [],
  canSuspend: true,
};
const observation: NativeObservation = {
  ...input,
  outcome: { kind: "completed" as const },
  status: "pass" as const,
  elapsedMs: 0,
};
const expected = new Map([[input.path + "\0sloppy", input]]);
function report(file: string, date: string, observations = [observation]) {
  return {
    file,
    date,
    dateSource: "test",
    engine: "native-script-test",
    frozenToolchainSha256: null,
    sourceSnapshot: null,
    selection: "language",
    observations,
    totals: executionTotals(observations.map((o) => o.status)),
  };
}
test("historical extractions keep the linked journal date behind newer focused results", () => {
  const additions = new Map([
    ["old.jsonl", "2026-01-01"],
    ["extracted.json", "2026-01-03"],
  ]);
  const historical = fallbackEvidenceDate(
    "extracted.json",
    "old.jsonl",
    additions,
  );
  assert.deepEqual(historical, {
    date: "2026-01-01",
    dateSource:
      "linked journal first Git addition commit (run date unavailable)",
  });
  const failed = {
    ...observation,
    outcome: { kind: "error", phase: "runtime", type: "Error", message: "old" },
    status: "fail",
  } as NativeObservation;
  const result = aggregateEvidence(expected, [
    report("extracted.json", historical.date, [failed]),
    report("focused.json", "2026-01-02"),
  ]);
  assert.equal(result.ledger[0]!.status, "pass");
  assert.equal(result.ledger[0]!.report, "focused.json");
});
test("evidence date fallback uses the report only without a dated linked journal", () => {
  const additions = new Map([["report.json", "2026-01-03"]]);
  assert.deepEqual(
    fallbackEvidenceDate("report.json", "missing.jsonl", additions),
    {
      date: "2026-01-03",
      dateSource: "first Git addition commit (run date unavailable)",
    },
  );
  assert.equal(
    fallbackEvidenceDate("missing.json", undefined, additions).date,
    "",
  );
});
test("latest complete overlap replaces passes with failures; ties use lexical filename", () => {
  const failed = {
    ...observation,
    outcome: { kind: "error", phase: "runtime", type: "Error", message: "x" },
    status: "fail",
  } as NativeObservation;
  const a = report("a.json", "2026-01-01", [observation]);
  const b = report("b.json", "2026-01-02", [failed]);
  const c = report("c.json", "2026-01-02", [observation]);
  assert.equal(aggregateEvidence(expected, [b, a]).ledger[0]!.status, "fail");
  const result = aggregateEvidence(expected, [c, b, a]);
  assert.equal(result.ledger.length, 1);
  assert.equal(result.ledger[0]!.report, "c.json");
});
test("rejects source, harness, path, status, duplicates and incomplete selection evidence", () => {
  for (const bad of [
    { ...observation, sha256: "wrong" },
    { ...observation, harness: [{ name: "fake", sha256: "x" }] },
    { ...observation, path: "../escape.js" },
    { ...observation, status: "fail" },
  ]) {
    const result = aggregateEvidence(expected, [
      report("bad.json", "2026-01-01", [bad as NativeObservation]),
    ]);
    assert.equal(result.ledger[0]!.status, "unmeasured");
    assert.equal(result.rejected.length, 1);
  }
  for (const rows of [[], [observation, observation]]) {
    assert.equal(
      aggregateEvidence(expected, [report("bad.json", "2026-01-01", rows)])
        .ledger[0]!.status,
      "unmeasured",
    );
  }
});
test("streamed journal must end in a consistent complete record", async () => {
  const root = mkdtempSync(join(tmpdir(), "tint-ledger-journal-"));
  try {
    const file = join(root, "run.jsonl");
    const start = {
      kind: "start",
      engine: "native-script-test",
      selection: "language",
    };
    const lines = [start, { ...observation, kind: "observation" }];
    writeFileSync(file, lines.map((r) => JSON.stringify(r) + "\n").join(""));
    assert.equal((await readJournal(file)).complete, false);
    writeFileSync(
      file,
      JSON.stringify({ kind: "complete", totals: executionTotals(["pass"]) }) +
        "\n",
      { flag: "a" },
    );
    assert.equal((await readJournal(file)).complete, true);
    writeFileSync(file, "{}\n", { flag: "a" });
    await assert.rejects(readJournal(file), /after complete/);
    writeFileSync(
      file,
      [...lines, { kind: "complete", totals: executionTotals(["fail"]) }]
        .map((r) => JSON.stringify(r) + "\n")
        .join(""),
    );
    await assert.rejects(readJournal(file), /inconsistent journal completion/);
    writeFileSync(file, JSON.stringify(start));
    await assert.rejects(readJournal(file), /truncated journal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit completed subset reports deduplicate with directory runs", () => {
  const subset = {
    ...report("subset.json", "2026-02-01"),
    selection: "language [subset]",
    rootSelection: "language",
    complete: true,
    requestedVariants: 1,
  };
  assert.equal(aggregateEvidence(expected, [subset]).ledger[0]!.status, "pass");
  assert.equal(
    aggregateEvidence(expected, [{ ...subset, complete: false }]).ledger[0]!
      .status,
    "unmeasured",
  );
});

test("canonical full table is independent of input order and has a verifiable hash", () => {
  const rows = aggregateEvidence(expected, [
    report("a.json", "2026-01-01"),
  ]).ledger;
  const extra = { ...rows[0]!, path: "a.js", variant: "strict" as const };
  const before = canonicalTable([rows[0]!, extra]);
  const after = canonicalTable([extra, rows[0]!]);
  assert.equal(before.text, after.text);
  assert.equal(
    before.sha256,
    createHash("sha256").update(before.text).digest("hex"),
  );
  assert.equal(
    before.text,
    [extra, rows[0]!].map((row) => JSON.stringify(row) + "\n").join(""),
  );
  assert.notEqual(
    canonicalTable([{ ...extra, status: "fail" }]).sha256,
    canonicalTable([extra]).sha256,
  );
});

test("compact evidence keeps accepted names and selected provenance without per-variant rows", () => {
  const rows = aggregateEvidence(expected, []).ledger;
  const table = canonicalTable(rows);
  const artifacts = [
    { ...report("a.json", "2026-01-01"), selectedVariants: 0 },
    { ...report("b.json", "2026-01-02"), selectedVariants: 1 },
  ].map(({ observations, totals, ...provenance }) => provenance);
  const compact = compactEvidence(artifacts, table, rows.length);
  assert.deepEqual(compact.acceptedArtifacts, ["a.json", "b.json"]);
  assert.deepEqual(
    compact.reports.map((report) => report.file),
    ["b.json"],
  );
  assert.equal(compact.fullTable.sha256, table.sha256);
  assert.equal(compact.fullTable.bytes, Buffer.byteLength(table.text));
  assert.equal(compact.fullTable.variants, 1);
  assert.ok(!("ledger" in compact));
  assert.ok(!JSON.stringify(compact).includes(input.path));
});
