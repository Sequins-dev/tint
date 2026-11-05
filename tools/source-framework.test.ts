import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { workspaceModules, workspaceSources } from "./workspace-sources.ts";
test("source framework has three explicit independent public entrypoints", () => {
  const path = "packages/source/package.json";
  assert.ok(existsSync(path), "source framework manifest must exist");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), [
    "./text",
    "./catalog",
    "./resolver",
  ]);
  assert.equal(manifest.exports["."], undefined);
  assert.deepEqual(manifest.dependencies, {});
  const source = workspaceSources();
  for (const entry of ["text", "catalog"])
    assert.deepEqual(
      workspaceModules(["packages/source/src/" + entry + ".ts"], source).map(
        (module) => module.id,
      ),
      ["packages/source/src/" + entry + ".ts"],
    );
  assert.deepEqual(
    new Set(
      workspaceModules(["packages/source/src/resolver.ts"], source).map(
        (module) => module.id,
      ),
    ),
    new Set([
      "packages/source/src/resolver.ts",
      "packages/source/src/catalog.ts",
      "packages/source/src/text.ts",
    ]),
  );
});
