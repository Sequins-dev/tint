import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  classifierSource,
  mixedGeneralTypeofSource,
  typedGeneralTypeofSource,
} from "./typed-general-typeof-fixture-source.ts";

test("general typeof fixture sources hold under Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-general-typeof-"));
  try {
    writeFileSync(join(directory, "trusted.ts"), classifierSource);
    writeFileSync(join(directory, "typed.ts"), typedGeneralTypeofSource);
    writeFileSync(
      join(directory, "mixed.ts"),
      mixedGeneralTypeofSource.replace('"trusted"', '"./trusted.ts"'),
    );
    for (const name of ["typed", "mixed"]) {
      const file = join(directory, name + ".ts");
      const { run } = (await import(pathToFileURL(file).href)) as {
        run(): number;
      };
      assert.equal(run(), 42, name);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
