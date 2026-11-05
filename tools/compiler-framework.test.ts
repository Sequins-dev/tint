import assert from "node:assert/strict";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";

const root = "packages/compiler/src/";

test("native and build entries do not load the CLI, project or generated catalog", () => {
  for (const entry of ["native/index.ts", "build.ts"]) {
    const modules = workspaceModules([root + entry]);
    assert.ok(
      modules.every(
        (module) =>
          !["cli.ts", "project.ts", "catalog.ts"].some(
            (file) => module.id === root + file,
          ),
      ),
    );
  }
});

test("project configuration and catalog entries do not load CLI host bindings", () => {
  for (const entry of ["project.ts", "catalog.ts"]) {
    const modules = workspaceModules([root + entry]);
    assert.ok(modules.every((module) => module.id !== root + "cli.ts"));
    assert.ok(
      modules.every(
        (module) =>
          !module.id.startsWith("packages/native-fs/src/") &&
          !module.id.startsWith("packages/native-process/src/"),
      ),
    );
  }
});

test("TypeScript frontend entries remain independent of compiler orchestration", () => {
  for (const entry of [
    "syntax/index.ts",
    "checker/index.ts",
    "modules/index.ts",
  ]) {
    const modules = workspaceModules(["packages/typescript/src/" + entry]);
    assert.ok(modules.every((module) => !module.id.startsWith(root)));
  }
});
