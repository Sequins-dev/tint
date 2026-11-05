import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { projectBuildRequest, projectRoots } from "@tint/compiler/project";
import { workspaceModules, workspaceSources } from "./workspace-sources.ts";
import { frozenSourcePackageExports } from "./frozen-source-exports.ts";
const entries = new Map([
  ["text-scanner", "text-scanner.ts"],
  ["string-builder", "string-builder.ts"],
  ["text-encoding", "text-encoding/index.ts"],
  ["base-encoding", "base-encoding/index.ts"],
  ["json-syntax", "json-syntax.ts"],
]);
test("foundation text purposes have narrow dependency-free public entries and retired owners", () => {
  const manifest = JSON.parse(
    readFileSync("packages/foundation/package.json", "utf8"),
  );
  assert.deepEqual(manifest.dependencies, {});
  assert.equal(manifest.exports["./text"], undefined);
  assert.equal(manifest.exports["."], undefined);
  for (const [name, file] of entries) {
    assert.equal(existsSync("packages/" + name), false);
    assert.deepEqual(manifest.exports["./text/" + name], {
      types: "./dist/text/" + file.replace(/\.ts$/, ".d.ts"),
      import: "./dist/text/" + file.replace(/\.ts$/, ".js"),
    });
    const modules = workspaceModules(["packages/foundation/src/text/" + file]);
    assert.ok(
      modules.every((module) => module.id.startsWith("packages/foundation/")),
    );
    if (name !== "text-encoding" && name !== "base-encoding")
      assert.equal(modules.length, 1);
    else
      assert.ok(
        modules.some(
          (module) =>
            module.id === "packages/foundation/src/text/string-builder.ts",
        ),
      );
  }
});
test("text encoding keeps its explicit runtime identity and frozen public source export", () => {
  const snapshot = workspaceSources();
  const modules = workspaceModules(projectRoots(), snapshot);
  const request = projectBuildRequest(modules, () => {});
  assert.deepEqual(
    request.runtimes.filter((runtime) => runtime.namespace === "text-encoding"),
    [
      {
        module: "packages/foundation/src/text/text-encoding/index.ts",
        namespace: "text-encoding",
      },
    ],
  );
  const foundation = frozenSourcePackageExports(".").find(
    (pkg) => pkg.name === "@tint/foundation",
  );
  assert.ok(foundation);
  assert.equal(
    foundation.exports["./text/text-encoding"],
    "./src/text/text-encoding/index.ts",
  );
  assert.ok(
    snapshot.mappings.some(
      (mapping) =>
        mapping.specifier === "@tint/foundation/text/text-encoding" &&
        mapping.target ===
          "packages/foundation/src/text/text-encoding/index.ts",
    ),
  );
});
test("active consumers cannot import superseded text owners", () => {
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      const path = directory + "/" + entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".ts"))
        assert.doesNotMatch(
          readFileSync(path, "utf8"),
          /(?:from\s*|import\s*\()["']@tint\/(?:text-scanner|string-builder|text-encoding|base-encoding|json-syntax)["']/u,
          path,
        );
    }
  }
  for (const directory of ["packages", "tools", "benchmarks"]) visit(directory);
});

test("text fixture aliases retain provider IDs and the complete transitive graph", async () => {
  const { testWorkspaceModules } = await import("./test-workspace-modules.ts");
  const modules = testWorkspaceModules(["text-encoding"]);
  const provider = modules.find((module) => module.id === "text-encoding");
  assert.ok(provider);
  assert.equal(
    provider.dependencies.get("../string-builder.ts"),
    "string-builder",
  );
  assert.ok(modules.some((module) => module.id === "string-builder"));
  assert.ok(
    modules.every((module) =>
      [...module.dependencies.values()].every((id) =>
        modules.some((target) => target.id === id),
      ),
    ),
  );
});
