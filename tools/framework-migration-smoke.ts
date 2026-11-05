/** Build an immutable non-debug smoke image for a package-move comparison.
 * An optional frozen toolchain keeps the baseline independent of live changes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { frozenCompilerRoleURL } from "./captured-compiler-roles.ts";
import { frozenGraphLoaderURL } from "./frozen-graph-loader.ts";
const destination = process.argv[2],
  frozen = process.argv[3];
assert.ok(
  destination,
  "usage: framework-migration-smoke.ts <new-output-directory> [frozen-toolchain]",
);
const base = frozen === undefined ? undefined : resolve(frozen);
const compiler: typeof import("@tint/compiler/build") = await import(
  base === undefined
    ? "@tint/compiler/build"
    : frozenCompilerRoleURL(base, "build")
);
const project: typeof import("@tint/compiler/project") = await import(
  base === undefined
    ? "@tint/compiler/project"
    : frozenCompilerRoleURL(base, "project")
);
const loader: typeof import("@tint/typescript/modules") = await import(
  base === undefined ? "@tint/typescript/modules" : frozenGraphLoaderURL(base)
);
const sources: typeof import("./workspace-sources.ts") = await import(
  base === undefined
    ? "./workspace-sources.ts"
    : pathToFileURL(join(base, "tools/workspace-sources.ts")).href
);
const snapshot =
  base === undefined
    ? sources.workspaceSources()
    : sources.readWorkspaceSourceSnapshot(join(base, "source-snapshot.json"));
const roots = project.projectRoots(),
  originals = snapshot.inputs,
  request = project.projectBuildRequest([], () => {});
const runtime = loader.loadSourceGraph(
  originals,
  snapshot.mappings,
  roots.filter((id) => id !== request.entry),
);
assert.ok(runtime.ok, JSON.stringify(runtime));
const needed = new Set(runtime.value.map((module) => module.id));
const inputs = originals.map((file) => ({
  ...file,
  bytes:
    file.id === request.entry
      ? new TextEncoder().encode("export function main():number{return 42;}\n")
      : needed.has(file.id)
        ? file.bytes
        : new Uint8Array(0),
}));
const graph = loader.loadSourceGraph(inputs, snapshot.mappings, roots);
assert.ok(graph.ok, JSON.stringify(graph));
const policy = {
  debugSymbols: false,
  allowDebugger: true,
  runtimeEntry: "initializeCopyingRuntime" as const,
  denseReferenceLists: false,
  managedBytes: 16777216,
  allocationCapacity: 1048576,
  rootCapacity: 65536,
  stackBytes: 1048576,
};
const result = compiler.buildMacOSProgram({
  ...project.projectBuildRequest(graph.value, () => {}),
  ...policy,
});
if (!result.ok) assert.fail(JSON.stringify(result.error));
const output = resolve(destination),
  path = join(output, "smoke");
mkdirSync(output);
writeFileSync(path, result.value, { flag: "wx", mode: 0o755 });
sources.saveWorkspaceSourceSnapshot(
  join(output, "source-snapshot.json"),
  snapshot,
);
const manifest = {
  kind: "framework-migration-smoke",
  sourceSnapshot: sources.workspaceSourceIdentity(snapshot),
  toolchain: base ?? "live-workspace",
  path,
  expectedExitStatus: 42,
  bytes: result.value.length,
  sha256: createHash("sha256").update(result.value).digest("hex"),
  policy,
  scope:
    "Non-debug image of unchanged main returning42 with real declared runtime roots. Byte identity and algorithm/native regressions are separate checks.",
};
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(manifest));
