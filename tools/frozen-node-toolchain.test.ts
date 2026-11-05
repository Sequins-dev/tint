import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { freezeNodeToolchain } from "./frozen-node-toolchain.ts";
test("frozen Node tools retain their package code and runner after workspace changes", () => {
  const root = mkdtempSync(join(tmpdir(), "tint-frozen-node-"));
  try {
    mkdirSync(join(root, "packages/example/src"), { recursive: true });
    mkdirSync(join(root, "packages/example/dist"));
    mkdirSync(join(root, "tools"));
    const source = "export const value=19;";
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    writeFileSync(
      join(root, "packages/example/package.json"),
      JSON.stringify({
        name: "@tint/example",
        type: "module",
        exports: "./dist/index.js",
      }),
    );
    writeFileSync(join(root, "packages/example/src/index.ts"), source);
    writeFileSync(join(root, "packages/example/dist/index.js"), source);
    writeFileSync(
      join(root, "tools/probe.ts"),
      'import {value} from "@tint/example";process.stdout.write(String(value));',
    );
    const snapshot = {
      inputs: [
        {
          id: "packages/example/src/index.ts",
          packageId: "example",
          bytes: new TextEncoder().encode(source),
        },
      ],
      mappings: [],
    };
    const frozen = freezeNodeToolchain(snapshot, join(root, "frozen"), {
      workspaceRoot: root,
      entry: "tools/probe.ts",
    });
    writeFileSync(
      join(root, "packages/example/dist/index.js"),
      "export const value=42;",
    );
    writeFileSync(
      join(root, "tools/probe.ts"),
      'process.stdout.write("changed");',
    );
    const run = spawnSync(process.execPath, [frozen.entry], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "19");
    assert.equal(
      JSON.parse(readFileSync(frozen.manifest, "utf8")).sourceSnapshot.files,
      1,
    );
    assert.throws(() =>
      freezeNodeToolchain(snapshot, join(root, "frozen"), {
        workspaceRoot: root,
      }),
    );
    writeFileSync(
      join(root, "packages/example/src/index.ts"),
      "export const value=42;",
    );
    assert.throws(() =>
      freezeNodeToolchain(snapshot, join(root, "mismatched"), {
        workspaceRoot: root,
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("frozen Node packages retain explicit compiled nested subpaths without a root export", () => {
  const root = mkdtempSync(join(tmpdir(), "tint-frozen-subpath-"));
  try {
    mkdirSync(join(root, "packages/foundation/src/binary"), {
      recursive: true,
    });
    mkdirSync(join(root, "packages/foundation/dist/binary"), {
      recursive: true,
    });
    mkdirSync(join(root, "tools"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    writeFileSync(
      join(root, "packages/foundation/package.json"),
      JSON.stringify({
        name: "@tint/foundation",
        type: "module",
        exports: {
          "./binary/word64": {
            types: "./dist/binary/word64.d.ts",
            import: "./dist/binary/word64.js",
          },
        },
      }),
    );
    const text = "export const value=42;";
    writeFileSync(join(root, "packages/foundation/src/binary/word64.ts"), text);
    writeFileSync(
      join(root, "packages/foundation/dist/binary/word64.js"),
      text,
    );
    writeFileSync(
      join(root, "tools/probe.ts"),
      'import {value} from "@tint/foundation/binary/word64"; console.log(value);',
    );
    const snapshot = {
      inputs: [
        {
          id: "packages/foundation/src/binary/word64.ts",
          packageId: "foundation",
          bytes: new TextEncoder().encode(text),
        },
      ],
      mappings: [],
    };
    const frozen = freezeNodeToolchain(snapshot, join(root, "frozen"), {
      workspaceRoot: root,
      entry: "tools/probe.ts",
    });
    writeFileSync(
      join(root, "packages/foundation/package.json"),
      JSON.stringify({ name: "@tint/foundation", exports: {} }),
    );
    writeFileSync(
      join(root, "packages/foundation/dist/binary/word64.js"),
      "export const value=99;",
    );
    const run = spawnSync(process.execPath, [frozen.entry], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "42");
    assert.equal(
      JSON.parse(
        readFileSync(
          join(frozen.directory, "packages/foundation/package.json"),
          "utf8",
        ),
      ).exports["."],
      undefined,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("freezing rejects manifest exports that drift from captured public entry metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "tint-public-freeze-"));
  try {
    mkdirSync(join(root, "packages/example/src"), { recursive: true });
    mkdirSync(join(root, "packages/example/dist"));
    mkdirSync(join(root, "tools"));
    const text = "export const value=42;";
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    writeFileSync(join(root, "packages/example/src/index.ts"), text);
    writeFileSync(join(root, "packages/example/dist/index.js"), text);
    writeFileSync(
      join(root, "tools/probe.ts"),
      'import {value} from "@tint/example";console.log(value);',
    );
    const entry = { types: "./dist/index.d.ts", import: "./dist/index.js" };
    writeFileSync(
      join(root, "packages/example/package.json"),
      JSON.stringify({
        name: "@tint/example",
        type: "module",
        exports: { ".": entry, "./unexpected": entry },
      }),
    );
    const snapshot = {
      inputs: [
        {
          id: "packages/example/src/index.ts",
          packageId: "example",
          bytes: new TextEncoder().encode(text),
        },
      ],
      mappings: [],
      publicEntries: [
        { specifier: "@tint/example", target: "packages/example/src/index.ts" },
      ],
    };
    assert.throws(
      () =>
        freezeNodeToolchain(snapshot, join(root, "frozen"), {
          workspaceRoot: root,
          entry: "tools/probe.ts",
        }),
      /public.*(export|entry|metadata)|export.*(drift|differ)/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
