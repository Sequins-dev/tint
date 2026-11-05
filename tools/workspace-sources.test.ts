import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  workspaceModules,
  saveWorkspaceSourceSnapshot,
  readWorkspaceSourceSnapshot,
  workspaceSourceIdentity,
  type WorkspaceSourceSnapshot,
} from "./workspace-sources.ts";
test("explicit source snapshots resolve virtual modules without rereading the workspace", () => {
  const snapshot: WorkspaceSourceSnapshot = {
    inputs: [
      {
        id: "virtual/main.ts",
        packageId: "main",
        bytes: new TextEncoder().encode(
          'import {value} from "value"; export function run():number{return value();}',
        ),
      },
      {
        id: "virtual/value.ts",
        packageId: "value",
        bytes: new TextEncoder().encode(
          "export function value():number{return 42;}",
        ),
      },
    ],
    mappings: [
      { packageId: "main", specifier: "value", target: "virtual/value.ts" },
    ],
  };
  const first = workspaceModules(["virtual/main.ts"], snapshot);
  const second = workspaceModules(["virtual/main.ts"], snapshot);
  assert.deepEqual(
    first.map((m) => m.id),
    second.map((m) => m.id),
  );
  assert.deepEqual(
    new Set(first.map((m) => m.id)),
    new Set(["virtual/main.ts", "virtual/value.ts"]),
  );
  assert.equal(
    first.find((m) => m.id === "virtual/main.ts")!.dependencies.get("value"),
    "virtual/value.ts",
  );
  assert.throws(
    () => workspaceModules(["packages/source/src/text.ts"], snapshot),
    /source|root|module/i,
  );
});

test("source identities include bytes, module identity, ownership and dependency grants", () => {
  const snapshot: WorkspaceSourceSnapshot = {
    inputs: [
      { id: "main.ts", packageId: "main", bytes: new Uint8Array([65, 66]) },
    ],
    mappings: [],
  };
  const first = workspaceSourceIdentity(snapshot);
  assert.equal(first.files, 1);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(workspaceSourceIdentity(snapshot), first);
  for (const changed of [
    {
      ...snapshot,
      inputs: [{ ...snapshot.inputs[0]!, bytes: new Uint8Array([65, 67]) }],
    },
    { ...snapshot, inputs: [{ ...snapshot.inputs[0]!, id: "other.ts" }] },
    { ...snapshot, inputs: [{ ...snapshot.inputs[0]!, packageId: "other" }] },
    {
      ...snapshot,
      mappings: [{ packageId: "main", specifier: "alias", target: "main.ts" }],
    },
  ])
    assert.notEqual(workspaceSourceIdentity(changed).sha256, first.sha256);
});

test("saved source snapshots preserve exact bytes and reject drift or overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "tint-source-snapshot-")),
    path = join(dir, "source.json");
  const snapshot: WorkspaceSourceSnapshot = {
    inputs: [
      {
        id: "virtual.ts",
        packageId: "main",
        bytes: new Uint8Array([0, 255, 195, 169]),
      },
    ],
    mappings: [{ packageId: "main", specifier: "self", target: "virtual.ts" }],
  };
  try {
    saveWorkspaceSourceSnapshot(path, snapshot);
    assert.deepEqual(readWorkspaceSourceSnapshot(path), snapshot);
    assert.throws(() => saveWorkspaceSourceSnapshot(path, snapshot), /exist/i);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    saved.inputs[0].bytes = "AQ==";
    writeFileSync(path, JSON.stringify(saved));
    assert.throws(
      () => readWorkspaceSourceSnapshot(path),
      /identity|fingerprint/i,
    );
    saved.schemaVersion = 999;
    writeFileSync(path, JSON.stringify(saved));
    assert.throws(() => readWorkspaceSourceSnapshot(path), /schema/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("declared compiled subpaths drive source graphs, frozen snapshots and native compilation", async () => {
  const { mkdirSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { workspaceSources } = await import("./workspace-sources.ts");
  const { compileArm64Program } = await import("@tint/compiler/native");
  const directory = mkdtempSync(join(tmpdir(), "tint-public-subpaths-"));
  function write(path: string, value: unknown): void {
    const file = join(directory, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(
      file,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  const compiled = (path: string) => ({
    types: `./dist/${path}.d.ts`,
    import: `./dist/${path}.js`,
  });
  const foundation = {
    name: "@tint/foundation",
    type: "module",
    exports: {
      "./binary/word64": compiled("binary/word64"),
      "./binary/bytes": compiled("binary/bytes"),
    },
    dependencies: {},
  };
  write("packages/foundation/package.json", foundation);
  write("packages/foundation/tsconfig.json", { references: [] });
  write(
    "packages/foundation/src/binary/word64.ts",
    'import {base} from "./bytes.ts"; export function value():number{return base()+2;}',
  );
  write(
    "packages/foundation/src/binary/bytes.ts",
    "export function base():number{return 40;}",
  );
  write(
    "packages/foundation/src/binary/sha256.ts",
    "export function unusedHash():number{return 99;}",
  );
  write("packages/app/package.json", {
    name: "@tint/app",
    type: "module",
    exports: { ".": compiled("index") },
    dependencies: { "@tint/foundation": "workspace:*" },
  });
  write("packages/app/tsconfig.json", {
    references: [{ path: "../foundation" }],
  });
  write(
    "packages/app/src/index.ts",
    'import {value} from "@tint/foundation/binary/word64"; export function run():number{return value();}',
  );
  write("workspace-contracts.json", {
    "@tint/foundation": [],
    "@tint/app": ["@tint/foundation"],
  });
  try {
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./check-boundaries.ts", import.meta.url))],
      { cwd: directory },
    );
    const snapshot = workspaceSources(directory);
    assert.deepEqual(snapshot.mappings, [
      {
        packageId: "app",
        specifier: "@tint/foundation/binary/word64",
        target: "packages/foundation/src/binary/word64.ts",
      },
      {
        packageId: "app",
        specifier: "@tint/foundation/binary/bytes",
        target: "packages/foundation/src/binary/bytes.ts",
      },
    ]);
    const root = "packages/app/src/index.ts";
    const modules = workspaceModules([root], snapshot);
    assert.deepEqual(
      new Set(modules.map((module) => module.id)),
      new Set([
        root,
        "packages/foundation/src/binary/word64.ts",
        "packages/foundation/src/binary/bytes.ts",
      ]),
    );
    assert.equal(
      modules[0]!.dependencies.get("@tint/foundation/binary/word64"),
      "packages/foundation/src/binary/word64.ts",
    );
    const sourcePath = "packages/app/src/index.ts";
    const mainSource = readFileSync(join(directory, sourcePath), "utf8");
    write(
      sourcePath,
      'import {unusedHash} from "@tint/foundation/binary/sha256"; export function run():number{return unusedHash();}',
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL("./check-boundaries.ts", import.meta.url))],
          { cwd: directory, stdio: "pipe" },
        ),
      /Command failed/,
    );
    assert.throws(
      () => workspaceModules([root], workspaceSources(directory)),
      /DEEP_IMPORT/,
    );
    write(sourcePath, mainSource);
    const appManifest = JSON.parse(
      readFileSync(join(directory, "packages/app/package.json"), "utf8"),
    );
    write("packages/app/package.json", { ...appManifest, dependencies: {} });
    assert.throws(
      () => workspaceModules([root], workspaceSources(directory)),
      /DEEP_IMPORT/,
    );
    write("packages/app/package.json", appManifest);
    write("packages/foundation/package.json", {
      ...foundation,
      exports: {
        "./binary/word64": {
          types: "./dist/binary/bytes.d.ts",
          import: "./dist/binary/word64.js",
        },
      },
    });
    assert.throws(() => workspaceSources(directory), /mismatched/);
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL("./check-boundaries.ts", import.meta.url))],
          { cwd: directory, stdio: "pipe" },
        ),
      /Command failed/,
    );
    write("packages/foundation/package.json", foundation);
    const frozen = join(directory, "snapshot.json");
    saveWorkspaceSourceSnapshot(frozen, snapshot);
    rmSync(join(directory, "packages"), { recursive: true, force: true });
    const restored = readWorkspaceSourceSnapshot(frozen);
    assert.deepEqual(restored, snapshot);
    const native = compileArm64Program({
      modules: workspaceModules([root], restored),
      entry: root,
      exports: ["run"],
      start: "run",
      runtimes: [],
    });
    assert.ok(native.ok, JSON.stringify(native));
    assert.ok(native.value.native.code.length > 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshots capture unused public entrypoints without granting package imports", async () => {
  const { workspaceSources } = await import("./workspace-sources.ts");
  const snapshot = workspaceSources();
  const entry = snapshot.publicEntries?.find(
    (entry) => entry.specifier === "@tint/js-engine/native/code-storage",
  );
  assert.equal(entry?.target, "packages/js-engine/src/native/code-storage.ts");
  assert.equal(
    snapshot.mappings.some(
      (entry) => entry.specifier === "@tint/js-engine/native/code-storage",
    ),
    false,
  );
});
test("public entry metadata is serialized, fingerprinted and validated separately from grants", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-public-snapshot-"));
  const snapshot: WorkspaceSourceSnapshot = {
    inputs: [
      {
        id: "value.ts",
        packageId: "value",
        bytes: new TextEncoder().encode("export const value=42;"),
      },
    ],
    mappings: [],
    publicEntries: [{ specifier: "@tint/value/public", target: "value.ts" }],
  };
  try {
    const path = join(directory, "snapshot.json");
    saveWorkspaceSourceSnapshot(path, snapshot);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).schemaVersion, 2);
    assert.deepEqual(readWorkspaceSourceSnapshot(path), snapshot);
    assert.notEqual(
      workspaceSourceIdentity(snapshot).sha256,
      workspaceSourceIdentity({ ...snapshot, publicEntries: [] }).sha256,
    );
    const saved = JSON.parse(readFileSync(path, "utf8"));
    saved.publicEntries[0].specifier = "@tint/value/changed";
    writeFileSync(path, JSON.stringify(saved));
    assert.throws(
      () => readWorkspaceSourceSnapshot(path),
      /identity|fingerprint/,
    );
    saved.publicEntries[0].target = "missing.ts";
    writeFileSync(path, JSON.stringify(saved));
    assert.throws(
      () => readWorkspaceSourceSnapshot(path),
      /public|source|target/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
