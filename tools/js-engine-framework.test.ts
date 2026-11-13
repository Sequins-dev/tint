import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";
import { frozenSourcePackageExports } from "./frozen-source-exports.ts";
test("JavaScript lowering has a narrow engine entry independent of execution and native code", () => {
  assert.ok(existsSync("packages/js-engine/package.json"));
  assert.equal(existsSync("packages/script-lowering"), false);
  const manifest = JSON.parse(
    readFileSync("packages/js-engine/package.json", "utf8"),
  );
  assert.deepEqual(manifest.exports, {
    "./lowering": {
      types: "./dist/lowering/index.d.ts",
      import: "./dist/lowering/index.js",
    },
    "./dynamic-function": {
      types: "./dist/dynamic-function.d.ts",
      import: "./dist/dynamic-function.js",
    },
    "./native/code-storage": {
      types: "./dist/native/code-storage.d.ts",
      import: "./dist/native/code-storage.js",
    },
    "./script-evaluation": {
      types: "./dist/script-evaluation.d.ts",
      import: "./dist/script-evaluation.js",
    },
    "./native/script-entry": {
      types: "./dist/native/script-entry.d.ts",
      import: "./dist/native/script-entry.js",
    },
    "./native/script-compile": {
      types: "./dist/native/script-compile.d.ts",
      import: "./dist/native/script-compile.js",
    },
    // Whole programs with general semantics (the typed pipeline's fallback).
    "./program": {
      types: "./dist/program/index.d.ts",
      import: "./dist/program/index.js",
    },
    // Debugger and perf-map registration of published code (diagnostics).
    "./native/jit-debug": {
      types: "./dist/native/jit-debug.d.ts",
      import: "./dist/native/jit-debug.js",
    },
  });
  assert.deepEqual(manifest.dependencies, {
    "@tint/typescript": "workspace:*",
    "@tint/abi": "workspace:*",
    "@tint/compiler": "workspace:*",
    "@tint/js-runtime": "workspace:*",
    "@tint/source": "workspace:*",
    "@tint/foundation": "workspace:*",
    "@tint/image": "workspace:*",
  });
  const modules = workspaceModules([
    "packages/js-engine/src/lowering/index.ts",
  ]);
  assert.ok(
    modules.every((module) =>
      /^(packages\/(js-engine|typescript|source|foundation)\/)/.test(module.id),
    ),
    modules.map((module) => module.id).join("\n"),
  );
  const entry = frozenSourcePackageExports(".").find(
    (pkg) => pkg.name === "@tint/js-engine",
  );
  assert.equal(entry?.exports["./lowering"], "./src/lowering/index.ts");
});
