import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  numericFixtureLocations,
  testWorkspaceModules,
} from "./test-workspace-modules.ts";
import { workspaceModules } from "./workspace-sources.ts";
const entries = new Map([
  ["big-integer", "big-integer.ts"],
  ["integer-rounding", "integer-rounding.ts"],
  ["exact-sum", "exact-sum.ts"],
  ["number-text", "number-text/index.ts"],
  ["binary64-trigonometry", "binary64-trigonometry/index.ts"],
]);
test("foundation numeric capabilities have explicit independent dependency-free entries", () => {
  const manifest = JSON.parse(
    readFileSync("packages/foundation/package.json", "utf8"),
  );
  assert.deepEqual(manifest.dependencies, {});
  assert.equal(manifest.exports["./numeric"], undefined);
  for (const [name, file] of entries) {
    assert.deepEqual(manifest.exports["./numeric/" + name], {
      types: "./dist/numeric/" + file.replace(/\.ts$/, ".d.ts"),
      import: "./dist/numeric/" + file.replace(/\.ts$/, ".js"),
    });
    assert.ok(
      workspaceModules(["packages/foundation/src/numeric/" + file]).every(
        (module) => module.id.startsWith("packages/foundation/"),
      ),
    );
  }
  assert.deepEqual(
    workspaceModules(["packages/foundation/src/numeric/big-integer.ts"]).map(
      (module) => module.id,
    ),
    ["packages/foundation/src/numeric/big-integer.ts"],
  );
  assert.deepEqual(
    workspaceModules(["packages/foundation/src/numeric/number-text/index.ts"])
      .map((module) => module.id)
      .sort(),
    [
      "big-integer.ts",
      "integer-rounding.ts",
      "number-string-cache.ts",
      "number-text/decimal-format.ts",
      "number-text/decimal.ts",
      "number-text/index.ts",
    ]
      .map((file) => "packages/foundation/src/numeric/" + file)
      .sort(),
  );
});
test("active source consumers no longer import obsolete numeric owners", () => {
  function visit(path: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      const file = path + "/" + entry.name;
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith(".ts"))
        assert.doesNotMatch(
          readFileSync(file, "utf8"),
          /(?:from\s*|import\s*\()["']@tint\/(?:big-integer|number-text|exact-sum|binary64-trigonometry|integer-rounding)["']/u,
          file,
        );
    }
  }
  for (const directory of ["packages", "tools", "benchmarks"]) visit(directory);
});

test("numeric fixture aliases retain number-text identity and the actual transitive graph", () => {
  const modules = testWorkspaceModules(
    ["number-text"],
    undefined,
    numericFixtureLocations,
  );
  const provider = modules.find((module) => module.id === "number-text");
  assert.ok(provider);
  const decimalId = provider.dependencies.get("./decimal.ts");
  assert.ok(decimalId);
  const decimal = modules.find((module) => module.id === decimalId);
  assert.ok(decimal);
  assert.equal(
    decimal.dependencies.get("../integer-rounding.ts"),
    "integer-rounding",
  );
  const rounding = modules.find((module) => module.id === "integer-rounding");
  assert.ok(rounding);
  assert.equal(rounding.dependencies.get("./big-integer.ts"), "big-integer");
  assert.ok(modules.some((module) => module.id === "big-integer"));
  assert.ok(
    modules.every((module) =>
      [...module.dependencies.values()].every((id) =>
        modules.some((target) => target.id === id),
      ),
    ),
  );
});
