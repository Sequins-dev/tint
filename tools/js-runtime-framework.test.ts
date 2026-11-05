import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";
test("ECMAScript runtime modules share one framework with narrow independently reachable entries", () => {
  assert.ok(existsSync("packages/js-runtime/package.json"));
  const manifest = JSON.parse(
    readFileSync("packages/js-runtime/package.json", "utf8"),
  );
  for (const [old, entry] of [
    ["ordinary-object", "objects"],
    ["property-descriptor", "descriptors"],
    ["environment-record", "environments/records"],
    ["global-environment", "environments/global"],
    ["iterator-protocol", "iterators"],
    ["job-queue", "jobs"],
    ["promise-protocol", "promises"],
    ["disposal-protocol", "disposal"],
    ["byte-storage", "bytes"],
  ]) {
    assert.equal(existsSync("packages/" + old), false);
    assert.deepEqual(manifest.exports["./" + entry], {
      types: "./dist/" + entry + "/index.d.ts",
      import: "./dist/" + entry + "/index.js",
    });
  }
  assert.deepEqual(manifest.dependencies, {
    "@tint/foundation": "workspace:*",
  });
  const bytes = workspaceModules(["packages/js-runtime/src/bytes/shared.ts"]);
  assert.ok(
    bytes.every((module) =>
      /packages\/(js-runtime|foundation)\//.test(module.id),
    ),
  );
  assert.ok(
    bytes.every(
      (module) => !module.id.startsWith("packages/js-runtime/src/objects/"),
    ),
  );
});
