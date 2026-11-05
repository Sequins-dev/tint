import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";

test("dynamic Function compilation belongs to the reusable engine", () => {
  const manifest = JSON.parse(
    readFileSync("packages/js-engine/package.json", "utf8"),
  );
  assert.deepEqual(manifest.exports["./dynamic-function"], {
    types: "./dist/dynamic-function.d.ts",
    import: "./dist/dynamic-function.js",
  });
  const source = readFileSync(
    "packages/js-engine/src/dynamic-function.ts",
    "utf8",
  );
  assert.match(source, /export function createDynamicFunctionCompiler/);
  assert.doesNotMatch(
    source,
    /\$262|Test262|mapExecutableMemory|nativeFunctionDescriptorWithIndex/,
  );
  const tool = readFileSync("tools/test262-native.ts", "utf8");
  assert.doesNotMatch(tool, /realm\.dynamicFunctionCompiler=\(kind/);
  assert.match(
    tool,
    /realm\.dynamicFunctionCompiler=createDynamicFunctionCompiler/,
  );
  const modules = workspaceModules([
    "packages/js-engine/src/dynamic-function.ts",
  ]);
  assert.ok(
    modules.every((module) => !module.id.startsWith("packages/native-memory/")),
  );
});
