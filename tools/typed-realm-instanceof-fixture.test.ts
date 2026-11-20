import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  realmInstanceofDriverSource,
  typedRealmInstanceofSource,
} from "./typed-realm-instanceof-fixture-source.ts";

test("realm instanceof fixture source holds under Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-realm-instanceof-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, realmInstanceofDriverSource);
    writeFileSync(join(directory, "trusted.ts"), typedRealmInstanceofSource);
    const loaded = (await import(pathToFileURL(file).href)) as {
      run(): number;
    };
    assert.equal(loaded.run(), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
