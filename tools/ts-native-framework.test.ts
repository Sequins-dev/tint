import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";

const entries = new Map([
  ["closure/layout", "closure/layout.ts"],
  ["closure/lowering", "closure/lowering/index.ts"],
  ["closure/class-construction", "closure/lowering/class-construction.ts"],
  ["closure/class-definition", "closure/lowering/class-definition.ts"],
  ["closure/records", "closure/lowering/records.ts"],
  ["scalar", "scalar.ts"],
  ["runtime", "runtime/index.ts"],
  ["modules", "modules/index.ts"],
]);

test("native TypeScript adaptation exposes explicit entries without an umbrella barrel", () => {
  assert.ok(
    existsSync("packages/ts-native/package.json"),
    "native framework manifest must exist",
  );
  const manifest = JSON.parse(
    readFileSync("packages/ts-native/package.json", "utf8"),
  );
  assert.deepEqual(
    Object.keys(manifest.exports),
    [...entries.keys()].map((entry) => "./" + entry),
  );
  assert.equal(manifest.exports["."], undefined);
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@tint/foundation",
    "@tint/ir",
    "@tint/typescript",
  ]);
  for (const [entry, file] of entries) {
    assert.deepEqual(manifest.exports["./" + entry], {
      types: "./dist/" + file.replace(/\.ts$/, ".d.ts"),
      import: "./dist/" + file.replace(/\.ts$/, ".js"),
    });
    const modules = workspaceModules(["packages/ts-native/src/" + file]);
    assert.ok(
      modules.every(
        (module) =>
          !/^packages\/(compiler|codegen|image|native-runtime|ordinary-object|js-engine)\//.test(
            module.id,
          ),
      ),
    );
  }
});

test("frontend module analysis does not reach native adaptation", () => {
  for (const entry of ["modules/index.ts", "modules/exports.ts"]) {
    assert.ok(
      workspaceModules(["packages/typescript/src/" + entry]).every(
        (module) => !module.id.startsWith("packages/ts-native/"),
      ),
    );
  }
});
