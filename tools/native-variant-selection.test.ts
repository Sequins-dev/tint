import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testMetadata } from "./test262.ts";
import { createNativeRunJournal } from "./native-run-journal.ts";
import { aggregateEvidence } from "./test262-coverage-ledger.ts";
import { executionTotals } from "./test262-execution.ts";
import { nativeVariantSelection } from "./native-variant-selection.ts";

const normal = {
  path: "language/x/a.js",
  sha256: "a".repeat(64),
  metadata: testMetadata("/*---\nflags: []\n---*/\n"),
};
const negative = {
  path: "language/x/negative.js",
  sha256: "b".repeat(64),
  metadata: testMetadata(
    "/*---\nnegative: { phase: parse, type: SyntaxError }\n---*/\n",
  ),
};
const raw = {
  path: "language/x/raw.js",
  sha256: "c".repeat(64),
  metadata: testMetadata("/*---\nflags: [raw]\n---*/\n"),
};
const moduleFile = {
  path: "language/x/module.js",
  sha256: "d".repeat(64),
  metadata: testMetadata("/*---\nflags: [module]\n---*/\n"),
};
const files = [normal, negative, raw, moduleFile];
function select(manifest?: unknown, catalog = files) {
  return nativeVariantSelection(catalog, "language/x", manifest);
}
type Selection = ReturnType<typeof select>;
const keys = (selection: Selection) =>
  selection.files.flatMap((file) =>
    file.variants.map((variant) => file.path + ":" + variant),
  );
const request = (path = normal.path, variant = "strict", sha256?: string) => ({
  path,
  variant,
  ...(sha256 === undefined ? {} : { sha256 }),
});

test("default native selection keeps all strictness variants and groups syntax negatives", () => {
  const selected = select();
  assert.deepEqual(keys(selected), [
    negative.path + ":sloppy",
    negative.path + ":strict",
    normal.path + ":sloppy",
    normal.path + ":strict",
    raw.path + ":raw",
    moduleFile.path + ":module",
  ]);
  assert.equal(selected.totalVariants, 6);
  assert.equal(selected.subset, undefined);
  assert.deepEqual(
    files.map((file) => file.path),
    [normal.path, negative.path, raw.path, moduleFile.path],
  );
});
test("explicit variants retain native ordering and carry a stable complete-subset identity", () => {
  const manifest = [
    request(normal.path, "strict", normal.sha256),
    request(negative.path, "sloppy"),
  ];
  const selected = select(manifest);
  assert.deepEqual(keys(selected), [
    negative.path + ":sloppy",
    normal.path + ":strict",
  ]);
  assert.equal(selected.totalVariants, 2);
  assert.equal(selected.subset?.rootSelection, "language/x");
  assert.equal(selected.subset?.requestedVariants, 2);
  assert.match(selected.subset!.variantSubsetSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(select([...manifest].reverse()), selected);
  assert.deepEqual(
    select([
      request(normal.path, "strict"),
      request(negative.path, "sloppy", negative.sha256),
    ]),
    selected,
  );
  assert.notEqual(
    select([request(normal.path, "sloppy")]).subset?.variantSubsetSha256,
    select([request(normal.path, "strict")]).subset?.variantSubsetSha256,
  );
});
test("raw and module requests must match the pinned metadata policy", () => {
  assert.deepEqual(
    keys(
      select([request(raw.path, "raw"), request(moduleFile.path, "module")]),
    ),
    [raw.path + ":raw", moduleFile.path + ":module"],
  );
  for (const entry of [
    request(raw.path, "strict"),
    request(moduleFile.path, "sloppy"),
    request(normal.path, "module"),
  ])
    assert.throws(() => select([entry]), /variant/);
});
test("variant manifests reject missing, fixture and out-of-root paths", () => {
  for (const path of [
    "language/y/a.js",
    "language/x/missing.js",
    "language/x/a_FIXTURE.js",
    "../language/x/a.js",
    "./language/x/a.js",
  ])
    assert.throws(() => select([request(path)]), /path/);
});
test("variant manifests reject duplicate requests instead of reducing the denominator", () => {
  assert.throws(() => select([request(), request()]), /duplicate/);
});
test("optional hashes must match the pinned source", () => {
  assert.doesNotThrow(() =>
    select([request(normal.path, "strict", normal.sha256)]),
  );
  for (const sha256 of ["e".repeat(64), "bad", null, 42])
    assert.throws(
      () => select([{ path: normal.path, variant: "strict", sha256 }]),
      /sha256/,
    );
});
test("invalid or empty manifests fail before any native preparation", () => {
  for (const manifest of [
    null,
    {},
    [],
    "x",
    [null],
    [[]],
    [{}],
    [{ path: normal.path }],
    [{ path: normal.path, variant: 5 }],
  ])
    assert.throws(() => select(manifest), /manifest|entry|variant/);
});
test("resume rejects a changed subset before appending any records", () => {
  const dir = mkdtempSync(join(tmpdir(), "tint-native-subset-"));
  try {
    const path = join(dir, "run.jsonl"),
      subset = select([request()]).subset;
    const header = {
      kind: "start",
      schemaVersion: 2,
      frozenToolchainSha256: "f".repeat(64),
      selection: "language/x",
      ...subset,
    };
    createNativeRunJournal(path, header);
    const before = readFileSync(path, "utf8");
    const changed = select([request(normal.path, "sloppy")]).subset;
    assert.throws(
      () =>
        createNativeRunJournal(
          path,
          { ...header, ...changed },
          { resume: true },
        ),
      /identity differs/,
    );
    assert.equal(readFileSync(path, "utf8"), before);
    assert.equal(
      createNativeRunJournal(path, header, { resume: true }).checkpoint
        .observations.length,
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("subset metadata is ledger accepted while retaining a non-pass", () => {
  const selected = select([request()]);
  const input = {
    ...normal,
    variant: "strict" as const,
    canSuspend: true,
    harness: [],
  };
  const observation = {
    ...input,
    outcome: { kind: "crash" as const, detail: "retained launch failure" },
    status: "crash" as const,
    elapsedMs: 1,
  };
  const report = {
    file: "subset.json",
    date: "2026-11-07",
    dateSource: "test",
    engine: "native-script-test",
    frozenToolchainSha256: null,
    sourceSnapshot: null,
    selection: "language/x [explicit variant subset]",
    complete: true,
    ...selected.subset,
    totals: executionTotals([observation.status]),
    observations: [observation],
  };
  const result = aggregateEvidence(
    new Map([[input.path + "\0strict", input]]),
    [report],
  );
  assert.equal(result.ledger[0]!.status, "crash");
  assert.equal(result.rejected.length, 0);
});

test(
  "native CLI validates the manifest environment option before opening a journal",
  {
    skip: process.platform !== "darwin" || process.arch !== "arm64",
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), "tint-native-manifest-"));
    try {
      mkdirSync(join(root, "test"));
      mkdirSync(join(root, "harness"));
      writeFileSync(join(root, "test", "case.js"), "/*---\nflags: []\n---*/\n");
      execFileSync("git", ["init", "-q", root]);
      execFileSync("git", ["-C", root, "add", "."]);
      execFileSync("git", [
        "-C",
        root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "pinned fixture",
      ]);
      const manifest = join(root, "variants.json"),
        journal = join(root, "run.jsonl");
      writeFileSync(
        manifest,
        JSON.stringify([
          { path: "case.js", variant: "strict", sha256: "0".repeat(64) },
        ]),
      );
      const result = spawnSync(
        process.execPath,
        ["tools/test262-native-run.ts", root, ".", "64"],
        {
          encoding: "utf8",
          timeout: 15000,
          env: {
            ...process.env,
            TINT_TEST262_VARIANTS: manifest,
            TINT_TEST262_JOURNAL: journal,
            TINT_TEST262_DEBUGGER_LAUNCH: "debugserver-direct",
            TINT_TEST262_HEARTBEAT_MS: "30000",
            TINT_TEST262_STALL_MS: "150000",
          },
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /variant manifest sha256 differs from pinned source/,
      );
      assert.equal(result.stdout, "");
      assert.equal(existsSync(journal), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
