import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceSources, workspaceModules } from "./workspace-sources.ts";
import * as service from "./date-time-native-service.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("linked DateTimeFormat source keeps normal Intl installation without formatter bodies or CLDR data", () => {
  assert.equal(typeof service.dateTimeNativeServiceSource, "function");
  const snapshot = workspaceSources(),
    source = service.dateTimeNativeServiceSource(snapshot);
  const modules = source.transformModules(
    workspaceModules(["packages/js-runtime/src/objects/index.ts"], snapshot),
  );
  const ids = new Set(modules.map((m) => m.id));
  for (const name of [
    "date-time-format",
    "date-time-locale",
    "date-time-parts",
    "date-time-range",
    "date-time-format-data",
    "date-time-zone-format-data",
    "date-time-service-factory",
  ])
    assert.equal(
      ids.has("packages/js-runtime/src/objects/" + name + ".ts"),
      false,
      name,
    );
  assert.ok(
    ids.has("packages/js-runtime/src/objects/intl-date-time-format.ts"),
  );
  assert.ok(
    ids.has("packages/js-runtime/src/objects/date-time-service-contracts.ts"),
  );
  assert.equal(source.surface.frame, "Frame");
  assert.equal(source.surface.values.length, 24);
  assert.equal(source.surface.types.length, 3);
  const idsBefore = modules.map((m) => m.id);
  assert.deepEqual(
    source.transformModules(modules).map((m) => m.id),
    idsBefore,
  );
});
test("DateTimeFormat compiles once and accepts an identical full-key cache hit", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-date-time-unit-"));
  try {
    const snapshot = workspaceSources(),
      first = service.prepareDateTimeNativeService(
        snapshot,
        "a".repeat(64),
        directory,
      ),
      second = service.prepareDateTimeNativeService(
        snapshot,
        "a".repeat(64),
        directory,
      );
    assert.equal(first.hit, false);
    assert.equal(second.hit, true);
    assert.equal(
      first.identity.nativeServiceUnitIndexSha256,
      second.identity.nativeServiceUnitIndexSha256,
    );
    assert.ok(first.unitBytes > 0);
    assert.equal(first.services.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
