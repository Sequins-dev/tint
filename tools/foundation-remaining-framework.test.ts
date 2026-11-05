import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";
test("generic layout, RegExp and chrono algorithms share the foundation framework", () => {
  const exports = JSON.parse(
    readFileSync("packages/foundation/package.json", "utf8"),
  ).exports;
  for (const [old, entry] of [
    ["storage-layout", "layout"],
    ["regexp-syntax", "regexp/syntax"],
    ["regexp-engine", "regexp/engine"],
    ["gregorian-calendar", "chrono/gregorian-calendar"],
    ["iso-date-time", "chrono/iso-date-time"],
    ["temporal-duration", "chrono/temporal-duration"],
    ["tzif", "chrono/tzif"],
    ["time-zone-identifiers", "chrono/time-zone-identifiers"],
  ]) {
    assert.equal(
      existsSync("packages/" + old),
      false,
      old + " must have one owner",
    );
    assert.deepEqual(exports["./" + entry], {
      types: "./dist/" + entry + "/index.d.ts",
      import: "./dist/" + entry + "/index.js",
    });
    const modules = workspaceModules([
      "packages/foundation/src/" + entry + "/index.ts",
    ]);
    assert.ok(
      modules.every((module) => module.id.startsWith("packages/foundation/")),
    );
  }
});
