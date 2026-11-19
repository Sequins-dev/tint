import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  errorProducerSource,
  mixedRealmErrorViewsSource,
} from "./mixed-realm-error-views-fixture-source.ts";

test("mixed error view fixture semantics under Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-mixed-error-views-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(join(directory, "trusted.ts"), errorProducerSource);
    writeFileSync(file, mixedRealmErrorViewsSource);
    const loaded = (await import(pathToFileURL(file).href)) as {
      run(): number;
    };
    assert.equal(loaded.run(), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
