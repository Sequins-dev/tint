import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordNativeFixture } from "./record-native-fixture.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "tint-record-native-"));
  const binary = join(directory, "image"),
    source = join(directory, "fixture.ts"),
    report = join(directory, "report.json");
  writeFileSync(binary, new Uint8Array([1, 2, 3]));
  writeFileSync(source, "export function run():number{return 42;}");
  return {
    directory,
    options: {
      binary,
      fixture: source,
      report,
      sourceSnapshot: { files: 0, sha256: "test" },
    },
  };
}

test("native recording validates fixture metadata and report ownership before execution", () => {
  const { directory, options } = fixture();
  let created = false;
  const factory = () => {
    created = true;
    throw Error("must not execute");
  };
  try {
    assert.throws(
      () =>
        recordNativeFixture(
          { ...options, fixture: join(directory, "missing.ts") },
          factory,
        ),
      /ENOENT/,
    );
    assert.equal(created, false);
    assert.equal(existsSync(options.report), false);
    writeFileSync(options.report, "retained");
    assert.throws(() => recordNativeFixture(options, factory), /EEXIST/);
    assert.equal(created, false);
    assert.equal(readFileSync(options.report, "utf8"), "retained");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native outcome is persisted before runner cleanup", () => {
  const { directory, options } = fixture();
  let closed = false;
  try {
    const outcome = recordNativeFixture(
      { ...options, timeoutMs: 180000, relatedReports: ["prior.json"] },
      (bytes) => {
        assert.deepEqual(bytes, new Uint8Array([1, 2, 3]));
        return {
          run: () => ({ kind: "completed" }),
          close: () => {
            assert.equal(
              JSON.parse(readFileSync(options.report, "utf8")).outcome.kind,
              "completed",
            );
            closed = true;
          },
        };
      },
    );
    assert.deepEqual(outcome, { kind: "completed" });
    assert.equal(closed, true);
    const report = JSON.parse(readFileSync(options.report, "utf8"));
    assert.equal(report.conformance, false);
    assert.equal(report.containmentTimeoutMs, 180000);
    assert.equal(typeof report.startedAt, "string");
    assert.ok(Number.isFinite(report.elapsedMs) && report.elapsedMs >= 0);
    assert.deepEqual(report.relatedReports, ["prior.json"]);
    assert.equal(report.fixtureSha256.length, 64);
    assert.equal(report.imageSha256.length, 64);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recording preserves native failures and adapter exceptions", () => {
  for (const throws of [false, true]) {
    const { directory, options } = fixture();
    let closed = false;
    try {
      const run = () =>
        recordNativeFixture(options, () => ({
          run: () => {
            if (throws) throw Error("adapter fault");
            return { kind: "crash", detail: "native fault" };
          },
          close: () => {
            closed = true;
          },
        }));
      if (throws) assert.throws(run, /adapter fault/);
      else assert.deepEqual(run(), { kind: "crash", detail: "native fault" });
      const report = JSON.parse(readFileSync(options.report, "utf8"));
      if (throws) {
        assert.match(report.recordingError, /adapter fault/);
        assert.equal(report.outcome, undefined);
      } else assert.equal(report.outcome.detail, "native fault");
      assert.equal(closed, true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("native recording uses build-time provenance and rejects mismatches before execution", () => {
  const sample = fixture(),
    { directory, options } = sample;
  try {
    const manifest = {
      kind: "tint-hosted-native-build",
      version: 1,
      sourceSnapshot: options.sourceSnapshot,
      imageSha256: createHash("sha256")
        .update(readFileSync(options.binary))
        .digest("hex"),
    };
    writeFileSync(options.binary + ".manifest.json", JSON.stringify(manifest));
    let created = false;
    const factory = () => {
      created = true;
      return { run: () => ({ kind: "completed" }) as const, close: () => {} };
    };
    assert.throws(
      () =>
        recordNativeFixture(
          { ...options, sourceSnapshot: { files: 1, sha256: "different" } },
          factory,
        ),
      /source.*provenance/i,
    );
    assert.equal(created, false);
    assert.equal(existsSync(options.report), false);
    const { sourceSnapshot: _source, ...captured } = options;
    assert.deepEqual(recordNativeFixture(captured, factory), {
      kind: "completed",
    });
    assert.deepEqual(
      JSON.parse(readFileSync(options.report, "utf8")).sourceSnapshot,
      manifest.sourceSnapshot,
    );
    assert.equal(
      JSON.parse(readFileSync(options.report, "utf8")).buildManifest,
      options.binary + ".manifest.json",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("build manifests reject a changed image before reserving a native observation", () => {
  const { directory, options } = fixture();
  let created = false;
  try {
    writeFileSync(
      options.binary + ".manifest.json",
      JSON.stringify({
        kind: "tint-hosted-native-build",
        version: 1,
        sourceSnapshot: options.sourceSnapshot,
        imageSha256: "different",
      }),
    );
    assert.throws(
      () =>
        recordNativeFixture(options, () => {
          created = true;
          throw Error("must not execute");
        }),
      /image build provenance/,
    );
    assert.equal(created, false);
    assert.equal(existsSync(options.report), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
