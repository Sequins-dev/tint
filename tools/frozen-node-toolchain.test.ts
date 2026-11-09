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
import { createHash } from "node:crypto";
import { freezeNodeToolchain } from "./frozen-node-toolchain.ts";
/** Record a completed `tsc -b` of one fixture package: the build info lists
 * each compiled source with the SHA-256 of its text, as TypeScript does. */
function recordBuild(
  root: string,
  id: string,
  files: readonly string[],
  extra: Record<string, unknown> = {},
): void {
  const folder = join(root, "packages", id);
  writeFileSync(
    join(folder, "tsconfig.tsbuildinfo"),
    JSON.stringify({
      fileNames: files.map((file) => "./" + file),
      fileInfos: files.map((file) => ({
        version: createHash("sha256")
          .update(readFileSync(join(folder, file), "utf8"))
          .digest("hex"),
      })),
      root: [[1, files.length]],
      version: "6.0.3",
      ...extra,
    }),
  );
}
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
    recordBuild(root, "example", ["src/index.ts"]);
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
    recordBuild(root, "foundation", ["src/binary/word64.ts"]);
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
    recordBuild(root, "example", ["src/index.ts"]);
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

test("freezing refuses compiled packages that are stale relative to their sources", () => {
  // P froze a toolchain after checking out newer sources without rebuilding:
  // the snapshot recorded the new sources while dist was the old build.
  const root = mkdtempSync(join(tmpdir(), "tint-frozen-stale-"));
  try {
    mkdirSync(join(root, "packages/example/src"), { recursive: true });
    mkdirSync(join(root, "packages/example/dist"));
    mkdirSync(join(root, "tools"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    writeFileSync(
      join(root, "packages/example/package.json"),
      JSON.stringify({ name: "@tint/example", type: "module" }),
    );
    writeFileSync(join(root, "tools/probe.ts"), "");
    const built = "export const value=19;",
      checkedOut = "export const value=42;";
    writeFileSync(join(root, "packages/example/src/index.ts"), built);
    writeFileSync(join(root, "packages/example/dist/index.js"), built);
    const snapshotOf = (text: string) => ({
      inputs: [
        {
          id: "packages/example/src/index.ts",
          packageId: "example",
          bytes: new TextEncoder().encode(text),
        },
      ],
      mappings: [],
    });
    const freeze = (name: string, text: string) =>
      freezeNodeToolchain(snapshotOf(text), join(root, name), {
        workspaceRoot: root,
        entry: "tools/probe.ts",
      });
    // No build info at all: nothing proves dist was built from these sources.
    assert.throws(() => freeze("unbuilt", built), /build info.*pnpm build/i);
    recordBuild(root, "example", ["src/index.ts"]);
    // A source changed after the build.
    writeFileSync(join(root, "packages/example/src/index.ts"), checkedOut);
    assert.throws(
      () => freeze("stale", checkedOut),
      /stale.*packages\/example\/src\/index\.ts.*pnpm build/i,
    );
    writeFileSync(join(root, "packages/example/src/index.ts"), built);
    // A source added after the build was never compiled.
    writeFileSync(join(root, "packages/example/src/added.ts"), "export {};");
    assert.throws(
      () => freeze("added", built),
      /not built.*packages\/example\/src\/added\.ts.*pnpm build/i,
    );
    rmSync(join(root, "packages/example/src/added.ts"));
    // A source deleted after the build left its stale output behind.
    writeFileSync(join(root, "packages/example/src/gone.ts"), "export {};");
    recordBuild(root, "example", ["src/index.ts", "src/gone.ts"]);
    rmSync(join(root, "packages/example/src/gone.ts"));
    assert.throws(
      () => freeze("deleted", built),
      /stale.*packages\/example\/src\/gone\.ts.*pnpm build/i,
    );
    // A build that reported errors or still has pending emit is incomplete.
    recordBuild(root, "example", ["src/index.ts"], {
      semanticDiagnosticsPerFile: [[1, [{ code: 2322 }]]],
    });
    assert.throws(() => freeze("failed", built), /incomplete.*pnpm build/i);
    recordBuild(root, "example", ["src/index.ts"], {
      affectedFilesPendingEmit: [1],
    });
    assert.throws(() => freeze("pending", built), /incomplete.*pnpm build/i);
    // A complete build of exactly these sources freezes.
    recordBuild(root, "example", ["src/index.ts"]);
    const frozen = freeze("fresh", built);
    assert.equal(
      readFileSync(
        join(frozen.directory, "packages/example/dist/index.js"),
        "utf8",
      ),
      built,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
