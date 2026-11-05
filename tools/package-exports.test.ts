import test from "node:test";
import assert from "node:assert/strict";
import * as exportsHelper from "./package-exports.ts";
const name = "@tint/foundation",
  directory = "packages/foundation";
const source = [
  "packages/foundation/src/binary.ts",
  "packages/foundation/src/text/index.ts",
];
const valid = {
  "./binary": { types: "./dist/binary.d.ts", import: "./dist/binary.js" },
  "./text": { types: "./dist/text/index.d.ts", import: "./dist/text/index.js" },
};
test("compiled public subpath exports infer exact owned TypeScript sources without a root entry", () => {
  assert.deepEqual(
    exportsHelper.compiledPackageExports(name, directory, valid, source),
    [
      {
        specifier: "@tint/foundation/binary",
        source: "packages/foundation/src/binary.ts",
      },
      {
        specifier: "@tint/foundation/text",
        source: "packages/foundation/src/text/index.ts",
      },
    ],
  );
});
test("exports reject wildcards, escapes, conditional drift, missing sources and mismatched declarations", () => {
  for (const exports of [
    undefined,
    null,
    {},
    [],
    { "./*": { types: "./dist/*.d.ts", import: "./dist/*.js" } },
    { "./../outside": valid["./binary"] },
    { "./binary": { ...valid["./binary"], import: "../dist/binary.js" } },
    { "./binary": { ...valid["./binary"], import: "./dist/../outside.js" } },
    { "./binary": { ...valid["./binary"], types: "./dist/text/index.d.ts" } },
    { "./binary": { ...valid["./binary"], import: "./src/binary.ts" } },
    { "./binary": { ...valid["./binary"], default: "./dist/binary.js" } },
    {
      "./binary": {
        types: "./dist/binary.d.ts",
        import: { node: "./dist/binary.js" },
      },
    },
    {
      "./missing": {
        types: "./dist/missing.d.ts",
        import: "./dist/missing.js",
      },
    },
    {
      "./binary": { types: "./dist/binary.d.ts", import: "./dist/binary.js?x" },
    },
    {
      "./binary": {
        types: "./dist/binary.d.ts",
        import: "./dist/binary\\x.js",
      },
    },
    {
      "./binary": {
        types: "./dist/binary.d.ts",
        import: "./dist/%2e%2e/binary.js",
      },
    },
  ])
    assert.throws(
      () =>
        exportsHelper.compiledPackageExports(name, directory, exports, source),
      /export|entrypoint|source/i,
      JSON.stringify(exports),
    );
});
