import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  mixedNodeErrorsSource,
  typedNodeErrorProducers,
  typedNodeErrorsSource,
} from "./typed-node-errors-fixture-source.ts";

test("coded crypto and zlib errors match Node's catches and own descriptors", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-typed-node-errors-"));
  try {
    writeFileSync(join(directory, "producers.ts"), typedNodeErrorProducers);
    writeFileSync(join(directory, "typed.ts"), typedNodeErrorsSource);
    writeFileSync(join(directory, "mixed.ts"), mixedNodeErrorsSource);
    for (const name of ["typed.ts", "mixed.ts"]) {
      const fixture = (await import(
        pathToFileURL(join(directory, name)).href
      )) as {
        run(): number;
      };
      assert.equal(fixture.run(), 42, name);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
