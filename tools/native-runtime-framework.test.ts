import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";
test("native allocation, tracing and trusted leaves have one runtime owner", () => {
  const manifest = JSON.parse(
    readFileSync("packages/native-runtime/package.json", "utf8"),
  );
  for (const [old, entry] of [
    ["native-tracing", "tracing"],
    ["native-heap", "heap"],
    ["region-allocator", "allocators/region"],
    ["linear-allocator", "allocators/linear"],
    ["graph-marking", "graph"],
    ["relocation-plan", "relocation"],
    ["primitive-value", "values"],
    ["native-memory", "intrinsics/memory"],
    ["native-clock", "intrinsics/clock"],
    ["native-random", "intrinsics/random"],
    ["native-process", "intrinsics/process"],
  ]) {
    assert.equal(existsSync("packages/" + old), false, old);
    assert.ok(manifest.exports["./" + entry], entry);
  }
  assert.ok(manifest.exports["./intrinsics/fs"]);
  assert.equal(existsSync("packages/native-fs/src/host.ts"), false);
  const intrinsics = workspaceModules([
    "packages/native-runtime/src/intrinsics/fs.ts",
  ]);
  assert.deepEqual(
    intrinsics.map((m) => m.id),
    ["packages/native-runtime/src/intrinsics/fs.ts"],
  );
  const bytes = workspaceModules([
    "packages/native-runtime/src/shared-blocks.ts",
  ]);
  assert.ok(
    bytes.every((m) => !m.id.startsWith("packages/js-runtime/src/objects/")),
  );
});
