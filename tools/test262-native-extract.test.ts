import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { testMetadata } from "./test262.ts";

const hash = (source: string) =>
  createHash("sha256").update(source).digest("hex");
test("native extraction verifies recorded fixture bytes and absent siblings", () => {
  const root = mkdtempSync(join(tmpdir(), "tint-extract-"));
  try {
    const checkout = join(root, "suite"),
      directory = join(checkout, "test", "family");
    mkdirSync(directory, { recursive: true });
    const source =
      '/*---\nflags: [module, raw]\n---*/\nimport "./dep_FIXTURE.js";';
    const fixture = "export const value=42;";
    writeFileSync(join(directory, "test.js"), source);
    writeFileSync(join(directory, "dep_FIXTURE.js"), fixture);
    execFileSync("git", ["init", "-q", checkout]);
    execFileSync("git", ["-C", checkout, "add", "."]);
    execFileSync("git", [
      "-C",
      checkout,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    ]);
    const revision = execFileSync(
      "git",
      ["-C", checkout, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    const header = {
      kind: "start",
      schemaVersion: 2,
      frozenToolchainSha256: "a".repeat(64),
      revision,
      dirty: false,
      selection: "family",
    };
    const observation = {
      kind: "observation",
      path: "family/test.js",
      sha256: hash(source),
      metadata: testMetadata(source),
      variant: "module",
      canSuspend: true,
      harness: [],
      fixtures: [{ name: "dep_FIXTURE.js", sha256: hash(fixture) }],
      absent: ["missing.js"],
      outcome: { kind: "completed" },
      status: "pass",
      elapsedMs: 1,
    };
    let run = 0;
    const extract = (row: object, start: object = header) => {
      const journal = join(root, `journal-${run}.jsonl`),
        output = join(root, `report-${run++}.json`);
      writeFileSync(
        journal,
        JSON.stringify(start) + "\n" + JSON.stringify(row) + "\n",
      );
      const result = spawnSync(
        process.execPath,
        [
          resolve("tools/test262-native-extract.ts"),
          checkout,
          journal,
          "family",
          output,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
      return { result, output };
    };
    const valid = extract(observation);
    assert.equal(valid.result.status, 0, valid.result.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(valid.output, "utf8")).observations[0].fixtures,
      observation.fixtures,
    );
    // Legacy journals carry no run times; extraction must not invent them.
    const legacy = JSON.parse(readFileSync(valid.output, "utf8"));
    assert.equal(legacy.generatedAt, undefined);
    assert.equal(legacy.startedAt, undefined);
    assert.match(legacy.generatedAtUnavailable, /predate/);
    assert.ok(Number.isFinite(Date.parse(legacy.extractedAt)));
    const startedAt = "2026-11-08T10:00:00.000Z",
      completedAt = "2026-11-08T10:05:00.000Z";
    const timed = extract(
      { ...observation, completedAt },
      { ...header, startedAt },
    );
    assert.equal(timed.result.status, 0, timed.result.stderr);
    const dated = JSON.parse(readFileSync(timed.output, "utf8"));
    assert.equal(dated.startedAt, startedAt);
    assert.equal(dated.generatedAt, completedAt);
    assert.equal(dated.generatedAtUnavailable, undefined);
    assert.ok(Date.parse(dated.extractedAt) > Date.parse(completedAt));
    const changed = extract({
      ...observation,
      fixtures: [{ name: "dep_FIXTURE.js", sha256: "b".repeat(64) }],
    });
    assert.notEqual(changed.result.status, 0);
    assert.match(changed.result.stderr, /fixture identity differs/);
    const notAbsent = extract({ ...observation, absent: ["dep_FIXTURE.js"] });
    assert.notEqual(notAbsent.result.status, 0);
    assert.match(notAbsent.result.stderr, /absent fixture now exists/);
    const escaped = extract({
      ...observation,
      fixtures: [{ name: "../outside.js", sha256: hash(fixture) }],
    });
    assert.notEqual(escaped.result.status, 0);
    assert.match(escaped.result.stderr, /fixture name/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
