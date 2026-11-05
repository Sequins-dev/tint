import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { workspaceModules, workspaceSources } from "./workspace-sources.ts";
test("module loading is a narrow frontend entry independent of native linking and checking", () => {
  const path = "packages/typescript/src/modules/index.ts";
  assert.ok(existsSync(path), "frontend loader entry must exist");
  const manifest = JSON.parse(
    readFileSync("packages/typescript/package.json", "utf8"),
  );
  assert.deepEqual(manifest.exports["./modules"], {
    types: "./dist/modules/index.d.ts",
    import: "./dist/modules/index.js",
  });
  assert.ok(!existsSync("packages/module-loader"));
  const graph = workspaceModules([path], workspaceSources()).map(
    (module) => module.id,
  );
  assert.ok(graph.includes("packages/typescript/src/modules/model.ts"));
  assert.ok(graph.includes("packages/typescript/src/syntax/index.ts"));
  assert.ok(
    graph.every(
      (id) =>
        !id.startsWith("packages/ts-native/") &&
        !id.includes("/checker/") &&
        !id.startsWith("packages/native-"),
    ),
  );
});
