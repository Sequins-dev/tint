import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";
import { frozenSourcePackageExports } from "./frozen-source-exports.ts";
const names = ["identifiers", "properties", "casing"] as const;
test("foundation Unicode purposes have narrow public entries without obsolete package aliases", () => {
  const manifest = JSON.parse(
    readFileSync("packages/foundation/package.json", "utf8"),
  );
  assert.deepEqual(manifest.dependencies, {});
  assert.equal(manifest.exports["."], undefined);
  assert.equal(manifest.exports["./unicode"], undefined);
  for (const name of names) {
    assert.equal(existsSync("packages/unicode-" + name), false);
    assert.deepEqual(manifest.exports["./unicode/" + name], {
      types: "./dist/unicode/" + name + "/index.d.ts",
      import: "./dist/unicode/" + name + "/index.js",
    });
    const modules = workspaceModules([
      "packages/foundation/src/unicode/" + name + "/index.ts",
    ]);
    assert.ok(
      modules.every((module) => module.id.startsWith("packages/foundation/")),
    );
    assert.equal(modules.length, name === "casing" ? 4 : 2);
    if (name === "casing")
      assert.ok(
        modules.some(
          (module) =>
            module.id === "packages/foundation/src/unicode/properties/index.ts",
        ),
      );
  }
});
test("frozen source contracts preserve all Unicode public entries without wildcard/root aliases", () => {
  const packages = frozenSourcePackageExports("."),
    foundation = packages.find((p) => p.name === "@tint/foundation");
  assert.ok(foundation);
  for (const name of names) {
    assert.equal(
      foundation.exports["./unicode/" + name],
      "./src/unicode/" + name + "/index.ts",
    );
    assert.ok(!packages.some((p) => p.name === "@tint/unicode-" + name));
  }
});
test("active consumers cannot import obsolete Unicode owners", () => {
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      const path = directory + "/" + entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".ts"))
        assert.doesNotMatch(
          readFileSync(path, "utf8"),
          /(?:from\s*|import\s*\()["']@tint\/unicode-(?:identifiers|properties|casing)["']/u,
          path,
        );
    }
  }
  for (const directory of ["packages", "tools", "benchmarks"]) visit(directory);
});

test("Unicode 17 generated tables remain byte-identical to the ownership baseline", () => {
  const tables = [
    [
      "packages/foundation/src/unicode/identifiers/ranges.ts",
      "193d8ca368dd5ad4320a1672c7b96c992f57ff84c7dd16c14bbbc35092f7737a",
    ],
    [
      "packages/foundation/src/unicode/properties/data.ts",
      "5fab753408e73a5d7fa9544d454cc62c66b8e723c0cd6e8ccac17a9d9bc0d015",
    ],
    [
      "packages/foundation/src/unicode/casing/data.ts",
      "95e64db69cc9313abe00824baa3e2c5aaab3e80b3494febdf96b3e42e889d04e",
    ],
  ];
  for (const [path, digest] of tables)
    assert.equal(
      createHash("sha256").update(readFileSync(path!)).digest("hex"),
      digest,
    );
});
