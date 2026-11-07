import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as native from "./test262-native-process.ts";
const header = {
  kind: "start",
  schemaVersion: 2,
  frozenToolchainSha256: "a".repeat(64),
  revision: "pinned",
  selection: ".",
  batchSize: 64,
  sourceSnapshot: { sha256: "b".repeat(64), files: 1 },
  executionResources: { timeoutMs: 1000 },
};
function observation(path: string, status = "pass") {
  return {
    kind: "observation",
    path,
    variant: "sloppy",
    sha256: "c".repeat(64),
    metadata: { flags: [], includes: [], features: [] },
    harness: [],
    canSuspend: true,
    elapsedMs: 10,
    batch: 0,
    status,
    outcome:
      status === "pass"
        ? { kind: "completed" }
        : { kind: "crash", detail: "retained failure" },
  };
}
function directory(run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "tint-resume-"));
  try {
    run(join(dir, "run.jsonl"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("resuming retains all outcomes and incomplete compilation membership without replay", () =>
  directory((path) => {
    const journal = native.createNativeRunJournal(path, header);
    journal.append({
      kind: "compilation",
      compilation: {
        id: 0,
        variants: 64,
        kind: "execution",
        compileMs: 1,
        outcome: "compiled",
      },
    });
    journal.append(observation("a.js"));
    journal.append(observation("b.js", "crash"));
    const before = readFileSync(path, "utf8");
    const resumed = native.createNativeRunJournal(path, header, {
      resume: true,
    });
    assert.equal(resumed.checkpoint.observations.length, 2);
    assert.equal("kind" in resumed.checkpoint.observations[0]!, false);
    assert.equal(resumed.checkpoint.observations[1]!.status, "crash");
    assert.equal(resumed.checkpoint.batches.length, 1);
    assert.ok(readFileSync(path, "utf8").startsWith(before));
    resumed.append({
      kind: "compilation",
      compilation: {
        id: 1,
        variants: 1,
        kind: "execution",
        compileMs: 1,
        outcome: "compiled",
      },
    });
    assert.equal(
      readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((r) => r.kind === "resume").length,
      1,
    );
  }));
test("resume rejects changed source, toolchain, batch policy and resources before appending", () =>
  directory((path) => {
    native.createNativeRunJournal(path, header);
    const before = readFileSync(path, "utf8");
    for (const changed of [
      { ...header, frozenToolchainSha256: "d".repeat(64) },
      {
        ...header,
        sourceSnapshot: { ...header.sourceSnapshot, sha256: "e".repeat(64) },
      },
      { ...header, batchSize: 8 },
      { ...header, executionResources: { timeoutMs: 2000 } },
    ])
      assert.throws(
        () => native.createNativeRunJournal(path, changed, { resume: true }),
        /identity/,
      );
    assert.equal(readFileSync(path, "utf8"), before);
  }));
test("resume rejects truncated, duplicate and inconsistent observations", () =>
  directory((path) => {
    for (const rows of [
      [
        header,
        {
          kind: "compilation",
          compilation: {
            id: 0,
            variants: 64,
            kind: "execution",
            compileMs: 1,
            outcome: "compiled",
          },
        },
        observation("a.js"),
        observation("a.js"),
      ],
      [
        header,
        {
          kind: "compilation",
          compilation: {
            id: 0,
            variants: 64,
            kind: "execution",
            compileMs: 1,
            outcome: "compiled",
          },
        },
        { ...observation("a.js"), status: "fail" },
      ],
    ]) {
      writeFileSync(
        path,
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
      assert.throws(() =>
        native.createNativeRunJournal(path, header, { resume: true }),
      );
    }
    writeFileSync(path, JSON.stringify(header) + "\n");
    appendFileSync(path, '{"kind":');
    assert.throws(
      () => native.createNativeRunJournal(path, header, { resume: true }),
      /truncated/,
    );
  }));

test("completed journals can restore a report without execution or further appends", () =>
  directory((path) => {
    const observationRow = { ...observation("a.js"), batch: undefined };
    writeFileSync(
      path,
      [
        header,
        observationRow,
        {
          kind: "complete",
          totals: {
            total: 1,
            passed: 1,
            failed: 0,
            unsupported: 0,
            timeouts: 0,
            harnessErrors: 0,
            crashes: 0,
            passFraction: 1,
          },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    const before = readFileSync(path, "utf8"),
      journal = native.createNativeRunJournal(path, header, { resume: true });
    assert.equal(journal.checkpoint.complete, true);
    assert.equal(journal.checkpoint.observations.length, 1);
    assert.throws(() => journal.append(observation("b.js")), /read-only/);
    assert.equal(readFileSync(path, "utf8"), before);
  }));

test("a freshly completed journal becomes read-only", () =>
  directory((path) => {
    const journal = native.createNativeRunJournal(path, header);
    journal.append({ kind: "complete", totals: {} });
    const before = readFileSync(path, "utf8");
    assert.throws(() => journal.append(observation("a.js")), /read-only/);
    assert.equal(readFileSync(path, "utf8"), before);
  }));

test("module fixture hashes participate in resume identity without changing historical Script inputs", async () => {
  const { sameNativeObservationInput } =
    await import("./native-run-journal.ts");
  const input = {
    path: "module.js",
    sha256: "root",
    variant: "module" as const,
    canSuspend: true,
    metadata: { flags: [], includes: [], features: [] },
    harness: [],
    fixtures: [{ name: "dep.js", sha256: "original" }],
  };
  const prior = {
    ...input,
    outcome: { kind: "completed" as const },
    status: "pass" as const,
    elapsedMs: 1,
  };
  assert.equal(sameNativeObservationInput(prior, input), true);
  assert.equal(
    sameNativeObservationInput(prior, {
      ...input,
      fixtures: [{ name: "dep.js", sha256: "changed" }],
    }),
    false,
  );
  const { fixtures, ...without } = input;
  assert.equal(sameNativeObservationInput(prior, without), false);
  const { fixtures: priorFixtures, ...scriptPrior } = prior;
  assert.equal(sameNativeObservationInput(scriptPrior, without), true);
});

test("Script-root absence proofs participate in resume identity", async () => {
  const { sameNativeObservationInput } =
    await import("./native-run-journal.ts");
  const input = {
    path: "script.js",
    sha256: "root",
    variant: "sloppy" as const,
    canSuspend: true,
    metadata: { flags: [], includes: [], features: [] },
    harness: [],
    absent: ["missing.js"],
  };
  const prior = {
    ...input,
    outcome: { kind: "completed" as const },
    status: "pass" as const,
    elapsedMs: 1,
  };
  assert.equal(sameNativeObservationInput(prior, input), true);
  assert.equal(
    sameNativeObservationInput(prior, { ...input, absent: ["other.js"] }),
    false,
  );
  const { absent, ...historical } = input;
  assert.equal(sameNativeObservationInput(prior, historical), false);
  const { absent: oldAbsent, ...oldPrior } = prior;
  assert.equal(sameNativeObservationInput(oldPrior, historical), true);
});

test("linked native journals require a unit-index digest and reject changed linking identity on resume", () =>
  directory((path) => {
    const linked = {
      ...header,
      nativeLinkingMode: "aot-native-services-v1",
      nativeServiceUnitIndexSha256: "c".repeat(64),
    };
    for (const invalid of [
      { ...linked, nativeServiceUnitIndexSha256: null },
      { ...linked, nativeLinkingMode: "unknown" },
      { ...linked, nativeLinkingMode: "monolithic" },
    ]) {
      assert.throws(
        () => native.createNativeRunJournal(path, invalid),
        /linking identity/,
      );
    }
    native.createNativeRunJournal(path, linked);
    const before = readFileSync(path, "utf8");
    for (const changed of [
      { ...linked, nativeServiceUnitIndexSha256: "d".repeat(64) },
      {
        ...linked,
        nativeLinkingMode: "monolithic",
        nativeServiceUnitIndexSha256: null,
      },
    ])
      assert.throws(
        () => native.createNativeRunJournal(path, changed, { resume: true }),
        /identity/,
      );
    assert.equal(readFileSync(path, "utf8"), before);
  }));
