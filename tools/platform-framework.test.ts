import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";
test("portable file services and Darwin policy have distinct platform entrypoints", () => {
  assert.ok(existsSync("packages/platform/package.json"));
  const manifest = JSON.parse(
    readFileSync("packages/platform/package.json", "utf8"),
  );
  for (const old of ["sync-io", "file-service", "native-fs"])
    assert.equal(existsSync("packages/" + old), false);
  for (const entry of ["io/sync", "files/service", "files/system", "darwin/fs"])
    assert.ok(manifest.exports["./" + entry]);
  const portable = workspaceModules(["packages/platform/src/files/system.ts"]);
  assert.ok(
    portable.every(
      (m) =>
        m.id.startsWith("packages/platform/src/files/") ||
        m.id.startsWith("packages/platform/src/io/"),
    ),
  );
  assert.ok(
    !portable.some(
      (m) => m.id.includes("/darwin/") || m.id.includes("/intrinsics/"),
    ),
  );
});
