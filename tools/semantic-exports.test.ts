import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { workspaceModules } from "./workspace-sources.ts";

test("semantic export resolver is an independent exact compiled frontend entry", () => {
  const manifest = JSON.parse(
    readFileSync("packages/typescript/package.json", "utf8"),
  );
  assert.deepEqual(manifest.exports["./modules/exports"], {
    types: "./dist/modules/exports.d.ts",
    import: "./dist/modules/exports.js",
  });
  assert.ok(!existsSync("packages/ts-linking/src/exports.ts"));
  const modules = workspaceModules([
    "packages/typescript/src/modules/exports.ts",
  ]);
  assert.ok(
    modules.some((module) => module.id.endsWith("/modules/exports.ts")),
  );
  assert.ok(
    modules.every(
      (module) =>
        module.id.startsWith("packages/typescript/src/") ||
        module.id.startsWith("packages/source/src/") ||
        module.id.startsWith("packages/foundation/src/") ||
        module.id.startsWith("packages/regexp-syntax/src/"),
    ),
  );
  assert.ok(modules.every((module) => !module.id.includes("/checker/")));
});
