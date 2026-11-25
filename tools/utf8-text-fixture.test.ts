import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { utf8TextSource } from "./utf8-text-fixture-source.ts";

// The reference for tools/native-utf8-text.test.ts: Node runs the same typed
// source (with its types stripped) against the portable bodies of the
// primitives and must also return 42.
test("UTF-8 text fixture source holds under Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-utf8-text-"));
  try {
    const file = join(directory, "fixture.ts");
    const source = utf8TextSource.replace(
      JSON.stringify("@tint/foundation/text/utf8"),
      JSON.stringify(
        pathToFileURL(resolve("packages/foundation/src/text/utf8.ts")).href,
      ),
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
