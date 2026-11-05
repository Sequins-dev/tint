import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { workspaceModules, workspaceSources } from "./workspace-sources.ts";
test("TypeScript framework exposes independent language layers without native backedges", () => {
  const path = "packages/typescript/package.json";
  assert.ok(existsSync(path), "TypeScript framework manifest must exist");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), [
    "./syntax",
    "./binding",
    "./types",
    "./reify",
    "./checker",
    "./checker/closures",
    "./checker/interfaces",
    "./modules/model",
    "./modules",
    "./modules/exports",
  ]);
  assert.equal(manifest.exports["."], undefined);
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@tint/foundation",
    "@tint/source",
  ]);
  const source = workspaceSources(),
    ids = (entry: string) =>
      workspaceModules(
        ["packages/typescript/src/" + entry + ".ts"],
        source,
      ).map((module) => module.id);
  for (const entry of [
    "syntax/index",
    "types/index",
    "binding/index",
    "reify/index",
    "checker/index",
    "checker/closures",
    "checker/interfaces",
  ])
    assert.ok(
      ids(entry).every(
        (id) =>
          !id.startsWith("packages/ts-native/") &&
          !id.startsWith("packages/module-loader/") &&
          !id.startsWith("packages/native-") &&
          !id.startsWith("packages/scalar-"),
      ),
    );
  for (const id of ids("syntax/index"))
    assert.ok(
      !/^packages\/typescript\/src\/(binding|types|reify|checker)\//.test(id),
      id,
    );
  for (const id of ids("types/index"))
    assert.ok(
      !/^packages\/typescript\/src\/(syntax|binding|reify|checker)\//.test(id),
      id,
    );
  assert.ok(
    !ids("checker/closures").includes(
      "packages/typescript/src/checker/index.ts",
    ),
  );
});
