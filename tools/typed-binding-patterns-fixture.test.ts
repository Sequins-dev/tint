import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  realmBindingPatternsSource,
  nodeBindingPatternProviders,
  typedRealmBindingPatternsSource,
  typedBindingPatternsSource,
} from "./typed-binding-patterns-fixture-source.ts";

// The reference for tools/build-typed-binding-patterns-fixture.ts: Node runs the same
// typed source (with its types stripped) and must also return 42.
for (const [name, source] of [
  ["typed binding patterns", typedBindingPatternsSource],
  ["realm binding patterns", realmBindingPatternsSource],
  ["typed realm binding patterns", typedRealmBindingPatternsSource],
] as const)
  test(name + " fixture source holds under Node", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "tint-typed-binding-patterns-"),
    );
    try {
      const file = join(directory, "fixture.ts");
      writeFileSync(file, source);
      writeFileSync(
        join(directory, "providers.ts"),
        nodeBindingPatternProviders,
      );
      const loaded = (await import(pathToFileURL(file).href)) as {
        run(): number;
      };
      assert.equal(loaded.run(), 42);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
