import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  typedRestSource,
  typedVoidSource,
} from "./typed-rest-void-fixture-source.ts";

for (const [name, source] of [
  ["typed rest", typedRestSource],
  ["typed void callbacks", typedVoidSource],
] as const) {
  test(name + " fixture source holds under Node", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-rest-void-"));
    try {
      const file = join(directory, "fixture.ts");
      writeFileSync(file, source);
      const loaded = (await import(pathToFileURL(file).href)) as {
        run(): number;
      };
      assert.equal(loaded.run(), 42);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
