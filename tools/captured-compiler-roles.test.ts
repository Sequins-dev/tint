import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as roles from "./captured-compiler-roles.ts";
import { frozenSourcePackageExports } from "./frozen-source-exports.ts";

function temporary(
  action: (root: string, write: (path: string, text: string) => void) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "tint-compiler-roles-"));
  try {
    action(root, (path, text) => {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("captured compiler roles select actual old and new public entries", () => {
  const old = [
    {
      id: "native-compiler",
      name: "@tint/native-compiler",
      exports: { ".": "./src/index.ts" },
    },
    {
      id: "compiler-driver",
      name: "@tint/compiler-driver",
      exports: { ".": "./src/index.ts" },
    },
    {
      id: "compiler-cli",
      name: "@tint/compiler-cli",
      exports: { ".": "./src/index.ts" },
    },
  ];
  const current = [
    {
      id: "compiler",
      name: "@tint/compiler",
      exports: {
        "./native": "./src/native/index.ts",
        "./build": "./src/build.ts",
        "./project": "./src/project.ts",
        "./catalog": "./src/catalog.ts",
        "./cli": "./src/cli.ts",
      },
    },
  ];
  for (const role of [
    "native",
    "build",
    "project",
    "catalog",
    "cli",
  ] as const) {
    assert.ok(
      roles.capturedCompilerRole(old, role).specifier.startsWith("@tint/"),
    );
    assert.equal(
      roles.capturedCompilerRole(current, role).specifier,
      "@tint/compiler/" + role,
    );
    assert.throws(() => roles.capturedCompilerRole([], role), /missing/);
    assert.throws(
      () => roles.capturedCompilerRole([...old, ...current], role),
      /ambiguous/,
    );
  }
  assert.equal(
    roles.capturedCompilerRole(old, "cli").source,
    "packages/compiler-cli/src/index.ts",
  );
  assert.throws(
    () =>
      roles.capturedCompilerRole(
        [
          {
            id: "compiler",
            name: "@tint/compiler",
            exports: { "./cli": "./src/../../escape.ts" },
          },
        ],
        "cli",
      ),
    /invalid/,
  );
});

test("frozen catalog discovery accepts only one owned regular old or new location", () => {
  temporary((root, write) => {
    assert.throws(() => frozenSourcePackageExports(root), /missing/);
    const catalog =
      "export function projectFiles(){return [{id:'packages/compiler/src/catalog.ts',packageId:'compiler'}];}export function projectMappings(){return [];}";
    write("packages/compiler/src/catalog.ts", catalog);
    write(
      "packages/compiler/package.json",
      JSON.stringify({
        name: "@tint/compiler",
        exports: {
          "./catalog": {
            types: "./dist/catalog.d.ts",
            import: "./dist/catalog.js",
          },
        },
      }),
    );
    assert.equal(
      frozenSourcePackageExports(root)[0]?.exports["./catalog"],
      "./src/catalog.ts",
    );
    write("packages/compiler-cli/src/catalog.ts", catalog);
    assert.throws(() => frozenSourcePackageExports(root), /ambiguous/);
  });
  temporary((root, write) => {
    write("elsewhere.ts", "export {};");
    mkdirSync(join(root, "packages/compiler/src"), { recursive: true });
    symlinkSync(
      join(root, "elsewhere.ts"),
      join(root, "packages/compiler/src/catalog.ts"),
    );
    assert.throws(() => frozenSourcePackageExports(root), /symlink/);
  });
  temporary((root) => {
    mkdirSync(join(root, "packages/compiler/src/catalog.ts"), {
      recursive: true,
    });
    assert.throws(() => frozenSourcePackageExports(root), /regular/);
  });
});

test("frozen compiler URLs load captured outputs for both layouts", async () => {
  for (const current of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "tint-compiler-outputs-"));
    function write(path: string, text: string) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    try {
      const providers = current
        ? [
            {
              id: "compiler",
              entries: {
                "./native": "native/index",
                "./build": "build",
                "./project": "project",
                "./catalog": "catalog",
                "./cli": "cli",
              },
            },
          ]
        : ["native-compiler", "compiler-driver", "compiler-cli"].map((id) => ({
            id,
            entries: { ".": "index" },
          }));
      const files: { id: string; packageId: string }[] = [];
      for (const provider of providers) {
        const exports: Record<string, { types: string; import: string }> = {};
        for (const [key, stem] of Object.entries(provider.entries)) {
          const path = "packages/" + provider.id + "/src/" + stem + ".ts";
          files.push({ id: path, packageId: provider.id });
          write(path, "export {};");
          write(
            "packages/" + provider.id + "/dist/" + stem + ".js",
            "export const captured=" +
              JSON.stringify(provider.id + "/" + key) +
              ";",
          );
          exports[key] = {
            types: "./dist/" + stem + ".d.ts",
            import: "./dist/" + stem + ".js",
          };
        }
        write(
          "packages/" + provider.id + "/package.json",
          JSON.stringify({
            name: "@tint/" + provider.id,
            type: "module",
            exports,
          }),
        );
      }
      const catalog = current
        ? "packages/compiler/src/catalog.ts"
        : "packages/compiler-cli/src/catalog.ts";
      if (!files.some((file) => file.id === catalog))
        files.push({ id: catalog, packageId: "compiler-cli" });
      write(
        catalog,
        "export function projectFiles(){return " +
          JSON.stringify(files) +
          ";}export function projectMappings(){return [];}",
      );
      for (const role of [
        "native",
        "build",
        "project",
        "catalog",
        "cli",
      ] as const) {
        const module = await import(roles.frozenCompilerRoleURL(root, role));
        assert.equal(typeof module.captured, "string");
        assert.ok(
          module.captured.startsWith(
            current
              ? "compiler/"
              : role === "native"
                ? "native-compiler/"
                : role === "build"
                  ? "compiler-driver/"
                  : "compiler-cli/",
          ),
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("source-only merged snapshots reconstruct the finite compiler role surface", () => {
  temporary((root, write) => {
    const entries = {
      native: "native/index",
      build: "build",
      project: "project",
      catalog: "catalog",
      cli: "cli",
    };
    const files = Object.values(entries).map((stem) => ({
      id: "packages/compiler/src/" + stem + ".ts",
      packageId: "compiler",
    }));
    for (const file of files) write(file.id, "export {};");
    write(
      "packages/compiler/src/catalog.ts",
      "export function projectFiles(){return " +
        JSON.stringify(files) +
        ";}export function projectMappings(){return [];}",
    );
    const packages = frozenSourcePackageExports(root);
    const incomplete = files.filter((file) => !file.id.endsWith("/cli.ts"));
    write(
      "packages/compiler/src/catalog.ts",
      "export function projectFiles(){return " +
        JSON.stringify(incomplete) +
        ";}export function projectMappings(){return [];}",
    );
    assert.throws(
      () => frozenSourcePackageExports(root),
      /missing owned frozen compiler role: cli/,
    );

    for (const role of [
      "native",
      "build",
      "project",
      "catalog",
      "cli",
    ] as const)
      assert.equal(
        roles.capturedCompilerRole(packages, role).specifier,
        "@tint/compiler/" + role,
      );
  });
});
