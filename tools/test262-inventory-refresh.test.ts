import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  refreshInventory,
  totalsOf,
  type EvidenceSource,
  type Inventory,
} from "./test262-inventory-refresh.ts";

const encoder = new TextEncoder();
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const sources: Record<string, string> = {
  "language/x/a.js": "a",
  "language/x/b.js": "b",
};
const harness = { name: "assert.js", sha256: digest("harness") };
type Status = "pass" | "fail" | "unsupported";

function report(
  statuses: readonly Status[],
  overrides: Record<string, unknown> = {},
) {
  const observations = [
    { path: "language/x/a.js", variant: "strict" },
    { path: "language/x/a.js", variant: "sloppy" },
    { path: "language/x/b.js", variant: "strict" },
  ].map((item, index) => ({
    ...item,
    sha256: digest(sources[item.path]!),
    harness: [harness],
    status: statuses[index]!,
  }));
  return {
    kind: "runtime-execution",
    selection: "language/x",
    revision: "pinned",
    dirty: false,
    sourceSnapshot: { sha256: "c".repeat(64), files: 1 },
    frozenToolchainSha256: "f".repeat(64),
    resumption: { restoredVariants: 0 },
    engine: { adapter: "native" },
    executionResources: { managedBytes: 1 },
    totals: totalsOf(observations),
    observations,
    ...overrides,
  };
}
function journal(data: ReturnType<typeof report>, complete = true): string {
  const rows: unknown[] = [
    {
      kind: "start",
      selection: data.selection,
      revision: data.revision,
      dirty: false,
      sourceSnapshot: data.sourceSnapshot,
      frozenToolchainSha256: data.frozenToolchainSha256,
    },
    ...data.observations.map((item) => ({ kind: "observation", ...item })),
  ];
  if (complete) rows.push({ kind: "complete", totals: data.totals });
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function fixture(files: Record<string, string>) {
  const old = files["old.json"]!;
  const base: Inventory = {
    kind: "native-test-group-inventory",
    generatedAt: "then",
    revision: "pinned",
    selections: [
      {
        selection: "language/x",
        report: "old.json",
        reportSha256: digest(old),
        reportModified: "then",
        totals: JSON.parse(old).totals,
        kind: "directory",
      },
    ],
    families: [
      {
        group: "language/x",
        variants: 3,
        recordedOutcomes: 3,
        nativePassFraction: 1 / 3,
        fullReport: {
          selection: "language/x",
          report: "old.json",
          reportModified: "then",
          totals: JSON.parse(old).totals,
        },
      },
    ],
    summary: { families: 1, recordedDistinctVariants: 3 },
  };
  const evidence: EvidenceSource = {
    readResult: (name) => encoder.encode(files[name]!),
    readTest: (path) => encoder.encode(sources[path]!),
    readHarness: () => encoder.encode("harness"),
    checkoutRevision: "pinned",
    recordedAt: () => "2026-11-06T00:00:00.000Z",
  };
  return { base, evidence };
}
const options = {
  baseName: "base.json",
  generatedAt: "now",
  replacements: [
    { selection: "language/x", report: "new.json", journal: "new.jsonl" },
  ],
};

test("replaces a complete family report with a verified same-population report", () => {
  const next = report(["pass", "pass", "fail"]);
  const { base, evidence } = fixture({
    "old.json": JSON.stringify(report(["pass", "unsupported", "fail"])),
    "new.json": JSON.stringify(next),
    "new.jsonl": journal(next),
  });
  const before = structuredClone(base);
  const refreshed = refreshInventory(base, evidence, options);
  assert.deepEqual(base, before);
  assert.equal(refreshed.selections[0]!.report, "new.json");
  assert.equal(refreshed.families[0]!.fullReport!.totals.passed, 2);
  assert.equal(refreshed.families[0]!.nativePassFraction, 2 / 3);
  assert.equal(refreshed.families[0]!.recordedOutcomes, 3);
  assert.deepEqual(refreshed.summary, base.summary);
  assert.deepEqual(refreshed.refreshedSelections, ["language/x"]);
});

function rejects(
  mutate: (files: Record<string, string>) => void,
  message: RegExp,
): void {
  const next = report(["pass", "pass", "pass"]);
  const files: Record<string, string> = {
    "old.json": JSON.stringify(report(["pass", "pass", "fail"])),
    "new.json": JSON.stringify(next),
    "new.jsonl": journal(next),
  };
  mutate(files);
  const { base, evidence } = fixture(files);
  assert.throws(() => refreshInventory(base, evidence, options), message);
}

test("rejects a focused report that omits family variants", () => {
  rejects((files) => {
    const partial = report(["pass", "pass", "pass"]);
    partial.observations.pop();
    partial.totals = totalsOf(partial.observations);
    files["new.json"] = JSON.stringify(partial);
    files["new.jsonl"] = journal(partial);
  }, /does not cover the family population/);
});

test("rejects source hashes that differ from the pinned checkout", () => {
  rejects((files) => {
    const stale = report(["pass", "pass", "pass"]);
    stale.observations[0] = {
      ...stale.observations[0]!,
      sha256: "0".repeat(64),
    };
    files["new.json"] = JSON.stringify(stale);
    files["new.jsonl"] = journal(stale);
  }, /source hash differs/);
});

test("rejects an unfinished journal and restored variants", () => {
  rejects((files) => {
    files["new.jsonl"] = journal(JSON.parse(files["new.json"]!), false);
  }, /not completed/);
  rejects((files) => {
    const resumed = report(["pass", "pass", "pass"], {
      resumption: { restoredVariants: 1 },
    });
    files["new.json"] = JSON.stringify(resumed);
  }, /zero restored variants/);
});

test("rejects totals that disagree with observation statuses", () => {
  rejects((files) => {
    const wrong = report(["pass", "pass", "fail"]);
    files["new.json"] = JSON.stringify({ ...wrong, totals: totalsOf([]) });
  }, /observation count differs|inconsistent/);
});
