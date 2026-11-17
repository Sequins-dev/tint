import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { workspaceModules } from "./workspace-sources.ts";

const entries = {
  "./layout": "layout",
  "./dwarf": "dwarf",
  "./eh-frame": "eh-frame",
  "./darwin/dyld-fixups": "darwin/dyld-fixups",
  "./darwin/signature": "darwin/signature",
  "./darwin/macho": "darwin/macho/index",
  "./linux/elf": "linux/elf/index",
  "./trace-table": "trace-table",
  "./darwin/macho/jit-object": "darwin/macho/jit-object",
  "./executable": "executable",
};

test("image framework exposes only ten exact compiled entrypoints", () => {
  const path = "packages/image/package.json";
  assert.ok(existsSync(path), "image framework manifest must exist");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), Object.keys(entries));
  for (const [entry, target] of Object.entries(entries))
    assert.deepEqual(manifest.exports[entry], {
      types: "./dist/" + target + ".d.ts",
      import: "./dist/" + target + ".js",
    });
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@tint/abi",
    "@tint/foundation",
  ]);
});

test("narrow image entries retain only their own implementation and foundation", () => {
  for (const target of Object.values(entries).slice(0, 5)) {
    const entry = "packages/image/src/" + target + ".ts";
    const modules = workspaceModules([entry]);
    assert.ok(modules.some((module) => module.id === entry));
    assert.ok(
      modules.every(
        (module) =>
          module.id === entry ||
          module.id.startsWith("packages/foundation/src/") ||
          // The portable call-frame encoder reads the ABI unwind contract.
          (target === "eh-frame" && module.id === "packages/abi/src/unwind.ts"),
      ),
      target,
    );
  }
});

test("Mach-O entry retains only image, foundation, relocation and unwind contracts", () => {
  const modules = workspaceModules([
    "packages/image/src/darwin/macho/index.ts",
  ]);
  const imageFiles = modules
    .map((module) => module.id)
    .filter((id) => id.startsWith("packages/image/src/"))
    .sort();
  assert.deepEqual(imageFiles, [
    "packages/image/src/darwin/dyld-fixups.ts",
    "packages/image/src/darwin/macho/compact-unwind.ts",
    "packages/image/src/darwin/macho/index.ts",
    "packages/image/src/darwin/macho/runtime-entitlements.ts",
    "packages/image/src/darwin/signature.ts",
    "packages/image/src/dwarf.ts",
    "packages/image/src/eh-frame.ts",
    "packages/image/src/executable.ts",
    "packages/image/src/layout.ts",
  ]);
  assert.deepEqual(
    modules
      .map((module) => module.id)
      .filter((id) => id.startsWith("packages/codegen/")),
    [],
  );
  assert.ok(
    modules.every(
      (module) =>
        module.id.startsWith("packages/image/src/") ||
        module.id.startsWith("packages/foundation/src/") ||
        module.id === "packages/abi/src/relocation.ts" ||
        module.id === "packages/abi/src/unwind.ts",
    ),
  );
});

test("ELF entry retains only image, foundation, relocation and unwind contracts", () => {
  const modules = workspaceModules(["packages/image/src/linux/elf/index.ts"]);
  assert.deepEqual(
    modules
      .map((module) => module.id)
      .filter((id) => id.startsWith("packages/image/src/"))
      .sort(),
    [
      "packages/image/src/dwarf.ts",
      "packages/image/src/eh-frame.ts",
      "packages/image/src/layout.ts",
      "packages/image/src/linux/elf/eh-frame-header.ts",
      "packages/image/src/linux/elf/index.ts",
      "packages/image/src/linux/elf/sysv-hash.ts",
    ],
  );
  assert.ok(
    modules.every(
      (module) =>
        module.id.startsWith("packages/image/src/") ||
        module.id.startsWith("packages/foundation/src/") ||
        module.id === "packages/abi/src/relocation.ts" ||
        module.id === "packages/abi/src/unwind.ts",
    ),
  );
});
