import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { latin1TextSource } from "./latin1-text-fixture-source.ts";

// The reference for tools/native-latin1-text.test.ts: Node runs the same
// typed source (with its types stripped) against the portable bodies of the
// primitives and must also return 42.
test("Latin-1 text fixture source holds under Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-latin1-text-"));
  try {
    const file = join(directory, "fixture.ts");
    let source = latin1TextSource;
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
