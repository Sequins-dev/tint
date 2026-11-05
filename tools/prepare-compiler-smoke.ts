import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { workspaceModules } from "./workspace-sources.ts";
import {
  projectFiles,
  projectMappings,
  projectRoots,
  projectBuildRequest,
} from "@tint/compiler/cli";
import { loadSourceGraph } from "@tint/typescript/modules";
import { buildMacOSProgram } from "@tint/compiler/build";

// A small target for the real native compiler, not a self-hosting substitute.
// Keep the complete runtime source graph and replace only the application entry.
const entry = "packages/compiler/src/cli.ts";
const root = resolve(".tint-bootstrap/smoke-project");
const runtime = new Set(
  workspaceModules(projectRoots().filter((id) => id !== entry)).map(
    (module) => module.id,
  ),
);
const inputs = projectFiles().map((file) => {
  const bytes =
    file.id === entry
      ? new TextEncoder().encode("export function main():number{return 42;}\n")
      : runtime.has(file.id)
        ? new Uint8Array(readFileSync(file.id))
        : new Uint8Array(0);
  const path = resolve(root, file.id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { ...file, bytes };
});
const graph = loadSourceGraph(inputs, projectMappings(), projectRoots());
assert.ok(graph.ok, JSON.stringify(graph));
const built = buildMacOSProgram({
  ...projectBuildRequest(graph.value, (stage) => console.log(stage)),
  debugSymbols: process.argv.includes("--debug-symbols"),
  debugDirectory: root,
});
assert.ok(built.ok, JSON.stringify(built));
const expected = resolve(".tint-bootstrap/smoke-node");
writeFileSync(expected, built.value, { mode: 0o755 });
console.log(
  JSON.stringify({
    root,
    expected,
    modules: graph.value.length,
    bytes: built.value.length,
  }),
);
