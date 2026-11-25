import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { stringBuilderSource } from "./string-builder-fixture-source.ts";

// The reference for tools/native-string-builder.test.ts: Node runs the same
// typed source (with its types stripped) and must also return 42.
test("string builder fixture source holds under Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-string-builder-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, stringBuilderSource);
    const loaded = (await import(pathToFileURL(file).href)) as {
      run(): number;
    };
    assert.equal(loaded.run(), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
