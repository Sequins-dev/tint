import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { slicedStringsSource } from "./sliced-strings-fixture-source.ts";

// The reference for tools/native-sliced-strings.test.ts: Node runs the same
// typed source (with its types stripped) and must also return 42.
test("sliced strings fixture source holds under Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-sliced-strings-"));
  try {
    const file = join(directory, "fixture.ts");
    let source = slicedStringsSource;
    for (const [specifier, path] of [
      [
        "@tint/foundation/text/latin1",
        "packages/foundation/src/text/latin1.ts",
      ],
      [
        "@tint/foundation/text/text-encoding",
        "packages/foundation/src/text/text-encoding/index.ts",
      ],
    ] as const)
      source = source.replace(
        JSON.stringify(specifier),
        JSON.stringify(pathToFileURL(resolve(path)).href),
      );
    writeFileSync(file, source);
    const loaded = (await import(pathToFileURL(file).href)) as {
      run(): number;
    };
    assert.equal(loaded.run(), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
