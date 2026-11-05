import test from "node:test";
import assert from "node:assert/strict";
import { capturedGraphLoader } from "./frozen-graph-loader.ts";
test("captured public exports choose old and new frozen loader roles without live path inference", () => {
  const old = {
    id: "module-loader",
    name: "@tint/module-loader",
    exports: { ".": "./src/index.ts" },
  };
  const partial = {
    id: "typescript",
    name: "@tint/typescript",
    exports: { "./modules/model": "./src/modules/model.ts" },
  };
  const current = {
    id: "typescript",
    name: "@tint/typescript",
    exports: { "./modules": "./src/modules/index.ts" },
  };
  assert.deepEqual(capturedGraphLoader([old, partial]), {
    packageId: "module-loader",
    specifier: "@tint/module-loader",
    key: ".",
  });
  assert.deepEqual(capturedGraphLoader([current]), {
    packageId: "typescript",
    specifier: "@tint/typescript/modules",
    key: "./modules",
  });
  assert.equal(
    capturedGraphLoader([old, current]).specifier,
    "@tint/typescript/modules",
  );
  assert.throws(
    () => capturedGraphLoader([partial]),
    /no public.*loader export/,
  );
  assert.throws(() => capturedGraphLoader([]), /no public.*loader export/);
});

test("frozen loader URLs resolve captured compiled exports for both layouts", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { frozenGraphLoaderURL } = await import("./frozen-graph-loader.ts");
  for (const current of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "tint-frozen-loader-"));
    function write(path: string, text: string) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    try {
      const owner = current ? "typescript" : "module-loader",
        stem = current ? "modules/index" : "index",
        specifier = current
          ? "@tint/typescript/modules"
          : "@tint/module-loader",
        key = current ? "./modules" : ".";
      const source = "packages/" + owner + "/src/" + stem + ".ts";
      const files = [
        {
          id: "packages/compiler-cli/src/catalog.ts",
          packageId: "compiler-cli",
        },
        { id: source, packageId: owner },
      ];
      const mappings = [
        { packageId: "compiler-cli", specifier, target: source },
      ];
      write(
        "packages/compiler-cli/src/catalog.ts",
        "export function projectFiles(){return " +
          JSON.stringify(files) +
          ";} export function projectMappings(){return " +
          JSON.stringify(mappings) +
          ";}",
      );
      write(source, "export {};");
      write(
        "packages/" + owner + "/package.json",
        JSON.stringify({
          name: "@tint/" + owner,
          type: "module",
          exports: {
            [key]: {
              types: "./dist/" + stem + ".d.ts",
              import: "./dist/" + stem + ".js",
            },
          },
        }),
      );
      write(
        "packages/" + owner + "/dist/" + stem + ".js",
        'export const captured="' + owner + '";',
      );
      const module = await import(frozenGraphLoaderURL(root));
      assert.equal(module.captured, owner);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
