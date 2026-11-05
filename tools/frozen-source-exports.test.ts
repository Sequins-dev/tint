import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
test("plain frozen bootstrap catalogs preserve exact nested exports without live manifests or root aliases", async () => {
  const helper = await import("./frozen-source-exports.ts");
  assert.equal(typeof helper.frozenSourcePackageExports, "function");
  if (helper.frozenSourcePackageExports === undefined) return;
  const root = mkdtempSync(join(tmpdir(), "tint-frozen-public-"));
  function write(path: string, text: string) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const files = [
    { id: "packages/compiler-cli/src/catalog.ts", packageId: "compiler-cli" },
    { id: "packages/compiler-cli/src/index.ts", packageId: "compiler-cli" },
    { id: "packages/foundation/src/binary/word64.ts", packageId: "foundation" },
    { id: "packages/foundation/src/private.ts", packageId: "foundation" },
  ];
  const mappings = [
    {
      packageId: "compiler-cli",
      specifier: "@tint/foundation/binary/word64",
      target: "packages/foundation/src/binary/word64.ts",
    },
  ];
  try {
    write("packages/compiler-cli/src/index.ts", "export const legacy=19;");
    write("packages/foundation/src/binary/word64.ts", "export const value=42;");
    write("packages/foundation/src/private.ts", "export const hidden=99;");
    write(
      "packages/compiler-cli/src/catalog.ts",
      'import type {Ignored} from "not-live"; export function projectFiles(){return ' +
        JSON.stringify(files) +
        ";} export function projectMappings(){return " +
        JSON.stringify(mappings) +
        ";}",
    );
    const packages = helper.frozenSourcePackageExports(root);
    const foundation = packages.find((item) => item.id === "foundation");
    assert.ok(foundation);
    assert.deepEqual(foundation.exports, {
      "./binary/word64": "./src/binary/word64.ts",
    });
    assert.deepEqual(
      packages.find((item) => item.id === "compiler-cli")!.exports,
      { ".": "./src/index.ts" },
    );
    mkdirSync(join(root, "node_modules/@tint"), { recursive: true });
    write("package.json", JSON.stringify({ type: "module" }));
    for (const pkg of packages) {
      write(
        "packages/" + pkg.id + "/package.json",
        JSON.stringify({
          name: pkg.name,
          type: "module",
          exports: pkg.exports,
        }),
      );
      symlinkSync(
        join(root, "packages", pkg.id),
        join(root, "node_modules/@tint", pkg.id),
      );
    }
    const script =
      'import {value} from "@tint/foundation/binary/word64"; import {legacy} from "@tint/compiler-cli"; console.log(value+legacy);for(const path of ["@tint/foundation","@tint/foundation/private","@tint/foundation/src/private.ts"]){try{await import(path);throw Error("unexpected success");}catch(error){if(error.code!=="ERR_PACKAGE_PATH_NOT_EXPORTED")throw error;}}';
    write("probe.mjs", script);
    assert.equal(
      execFileSync(process.execPath, [join(root, "probe.mjs")], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      "61",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("frozen manifests constrain catalog exports and malformed metadata is never executed", async () => {
  const { frozenSourcePackageExports } =
    await import("./frozen-source-exports.ts");
  const root = mkdtempSync(join(tmpdir(), "tint-frozen-export-policy-"));
  function write(path: string, value: unknown) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  const files = [
    { id: "packages/compiler-cli/src/catalog.ts", packageId: "compiler-cli" },
    { id: "packages/compiler-cli/src/index.ts", packageId: "compiler-cli" },
    { id: "packages/foundation/src/index.ts", packageId: "foundation" },
    { id: "packages/foundation/src/binary.ts", packageId: "foundation" },
  ];
  const mappings = [
    {
      packageId: "compiler-cli",
      specifier: "@tint/foundation/binary",
      target: "packages/foundation/src/binary.ts",
    },
  ];
  const catalog = (rows: unknown) =>
    "export function projectFiles(){return " +
    JSON.stringify(files) +
    ";} export function projectMappings(){return " +
    JSON.stringify(rows) +
    ";}";
  try {
    for (const file of files) write(file.id, "export {};");
    write("packages/compiler-cli/src/catalog.ts", catalog(mappings));
    const manifest = {
      name: "@tint/foundation",
      exports: {
        "./binary": { types: "./dist/binary.d.ts", import: "./dist/binary.js" },
      },
    };
    write("packages/foundation/package.json", manifest);
    assert.deepEqual(
      frozenSourcePackageExports(root).find((pkg) => pkg.id === "foundation")!
        .exports,
      { "./binary": "./src/binary.ts" },
      "manifest without root does not inherit a source index alias",
    );
    for (const bad of [
      { name: manifest.name },
      { ...manifest, exports: null },
      {
        ...manifest,
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        },
      },
    ]) {
      write("packages/foundation/package.json", bad);
      assert.throws(
        () => frozenSourcePackageExports(root),
        /export|entrypoint/i,
      );
    }
    write("packages/foundation/package.json", manifest);
    write(
      "packages/compiler-cli/src/catalog.ts",
      catalog([
        ...mappings,
        {
          ...mappings[0],
          packageId: "foundation",
          target: "packages/foundation/src/index.ts",
        },
      ]),
    );
    assert.throws(
      () => frozenSourcePackageExports(root),
      /inconsistent.*target/,
    );
    write(
      "packages/compiler-cli/src/catalog.ts",
      catalog([
        { ...mappings[0], target: "packages/foundation/src/../index.ts" },
      ]),
    );
    assert.throws(() => frozenSourcePackageExports(root), /mapping/);
    write("packages/compiler-cli/src/catalog.ts", catalog(mappings));
    write("live-manifest.json", manifest);
    rmSync(join(root, "packages/foundation/package.json"));
    symlinkSync(
      join(root, "live-manifest.json"),
      join(root, "packages/foundation/package.json"),
    );
    assert.throws(() => frozenSourcePackageExports(root), /symlink/);
    rmSync(join(root, "packages/foundation/package.json"));
    write("packages/foundation/package.json", manifest);
    write(
      "packages/compiler-cli/src/catalog.ts",
      'export function projectFiles(){throw Error("must not execute");} export function projectMappings(){return [];}',
    );
    assert.throws(() => frozenSourcePackageExports(root), /catalog literal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
