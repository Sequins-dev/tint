import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runtimeTreeFiles } from "./frozen-runtime-tree.ts";

const abiManifest = JSON.stringify({
  name: "@tint/abi",
  exports: Object.fromEntries(
    ["host", "c", "weak-slot", "unwind"].map((name) => {
      const stem = name === "c" ? "c/index" : name;
      return [
        "./" + name,
        { types: `./dist/${stem}.d.ts`, import: `./dist/${stem}.js` },
      ];
    }),
  ),
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tint-runtime-tree-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const shared = {
  "packages/abi/src/host.ts":
    'import type { CTarget } from "./c/types.ts";\nexport const shutdown = -1;',
  "packages/abi/src/c/types.ts": "export interface CTarget {}",
  "packages/abi/src/c/index.ts": 'export * from "./types.ts";',
  "packages/abi/src/weak-slot.ts": "export const weak = 1;",
  "packages/abi/src/unwind.ts": "export const unwind = 1;",
  "packages/native-runtime/src/tracing/scan.ts": [
    'import { shutdown } from "@tint/abi/host";',
    'import { weak } from "@tint/abi/weak-slot";',
    'import { list } from "@tint/foundation/collections/number-list";',
    'import { helper } from "../helper.ts";',
    'export { other } from "tint:ffi";',
  ].join("\n"),
  "packages/native-runtime/src/helper.ts":
    'import { fresh } from "./fresh.ts";\nexport const helper = fresh;',
};

test("--runtime-tree copies the runtime and the host-ABI files it imports", () => {
  const tree = workspace({
    ...shared,
    "packages/abi/package.json": abiManifest,
    // Only the tree has it, so its import of @tint/abi/c is not followed.
    "packages/native-runtime/src/fresh.ts":
      'import type { CTarget } from "@tint/abi/c";\nexport const fresh = 1;',
  });
  const snapshot = workspace({
    ...shared,
    // A snapshot-only runtime file keeps its frozen version.
    "packages/native-runtime/src/retired.ts": "export const retired = 1;",
  });
  try {
    assert.deepEqual(runtimeTreeFiles(tree, snapshot), {
      files: [
        "packages/abi/src/c/types.ts",
        "packages/abi/src/host.ts",
        "packages/abi/src/weak-slot.ts",
        "packages/native-runtime/src/helper.ts",
        "packages/native-runtime/src/tracing/scan.ts",
      ],
      missing: [
        "packages/native-runtime/src/helper.ts -> packages/native-runtime/src/fresh.ts",
      ],
    });
  } finally {
    rmSync(tree, { recursive: true, force: true });
    rmSync(snapshot, { recursive: true, force: true });
  }
});

test("--runtime-tree rejects host-ABI imports the package does not export", () => {
  const files = {
    ...shared,
    "packages/native-runtime/src/fresh.ts": "export const fresh = 1;",
    "packages/native-runtime/src/agents.ts":
      'import { hidden } from "@tint/abi/private";',
  };
  const tree = workspace({
      ...files,
      "packages/abi/package.json": abiManifest,
    }),
    snapshot = workspace(files);
  try {
    assert.throws(
      () => runtimeTreeFiles(tree, snapshot),
      /agents\.ts imports unknown @tint\/abi\/private/,
    );
  } finally {
    rmSync(tree, { recursive: true, force: true });
    rmSync(snapshot, { recursive: true, force: true });
  }
});
