import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  generalCallEntrySource,
  generalCallTypedSource,
} from "./typed-general-call-fixture-source.ts";

test("typed general calls agree with Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-general-call-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(join(directory, "typed.ts"), generalCallTypedSource);
    writeFileSync(
      file,
      generalCallEntrySource.replace('"trusted"', '"./typed.ts"'),
    );
    const loaded = (await import(pathToFileURL(file).href)) as {
      run(): number;
    };
    assert.equal(loaded.run(), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
