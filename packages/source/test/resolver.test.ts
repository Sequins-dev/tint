import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog } from "@tint/source/catalog";
import { createSourceText } from "@tint/source/text";
import {
  createResolver,
  type ImportRequest,
  type ImportMapping,
  type ModuleSource,
} from "@tint/source/resolver";
function snapshot(text: string) {
  const bytes = new TextEncoder().encode(text),
    r = createSourceText(bytes, bytes.length);
  assert.equal(r.ok, true);
  return r.value;
}
function setup(
  mappings: readonly ImportMapping[] = [
    { packageId: "app", specifier: "@lib/core", target: "lib/index.ts" },
  ],
) {
  const source = snapshot('\ufeff// 🙂\r\nimport "./util.ts";\n');
  const c = createCatalog<ModuleSource>([
    { id: "app/main.ts", value: { packageId: "app", source } },
    { id: "app/util.ts", value: { packageId: "app", source } },
    { id: "app/sub/other.ts", value: { packageId: "app", source } },
    { id: "lib/index.ts", value: { packageId: "lib", source } },
    { id: "lib/private.ts", value: { packageId: "lib", source } },
  ]);
  assert.equal(c.ok, true);
  return {
    catalog: c.value,
    source,
    result: createResolver(c.value, mappings),
  };
}
function request(specifier: string): ImportRequest {
  return {
    importer: "app/main.ts",
    specifier,
    kind: "runtime",
    start: 15,
    end: 26,
  };
}
function resolver() {
  const r = setup().result;
  assert.equal(r.ok, true);
  return r.value;
}
test("relative normalization and explicit public mappings resolve exact catalog members", () => {
  const r = resolver();
  for (const specifier of ["./util.ts", "./sub/../util.ts", "././util.ts"])
    assert.deepEqual(r.resolve(request(specifier)), {
      ok: true,
      value: {
        importer: "app/main.ts",
        target: "app/util.ts",
        kind: "runtime",
      },
    });
  assert.deepEqual(
    r.resolve({
      ...request("../util.ts"),
      importer: "app/sub/other.ts",
      kind: "type",
    }),
    {
      ok: true,
      value: {
        importer: "app/sub/other.ts",
        target: "app/util.ts",
        kind: "type",
      },
    },
  );
  assert.deepEqual(r.resolve(request("@lib/core")), {
    ok: true,
    value: { importer: "app/main.ts", target: "lib/index.ts", kind: "runtime" },
  });
  assert.equal(r.resolve(request("./main.ts")).ok, true); // Resolution alone does not reject cycles.
});
test("rejections distinguish syntax, escape, missing targets and package policy with source positions", () => {
  const r = resolver(),
    cases: [string, string][] = [
      ["./absent.ts", "MISSING_MODULE"],
      ["./Util.ts", "MISSING_MODULE"],
      ["./util", "INVALID_SPECIFIER"],
      ["./util.js", "INVALID_SPECIFIER"],
      ["./util.TS", "INVALID_SPECIFIER"],
      ["/app/util.ts", "INVALID_SPECIFIER"],
      ["./a//b.ts", "INVALID_SPECIFIER"],
      ["./a\\b.ts", "INVALID_SPECIFIER"],
      ["./util.ts?x", "INVALID_SPECIFIER"],
      ["./util.ts#x", "INVALID_SPECIFIER"],
      ["./%2e%2e/x.ts", "INVALID_SPECIFIER"],
      ["file:///x.ts", "INVALID_SPECIFIER"],
      ["../../escape.ts", "ROOT_ESCAPE"],
      ["../lib/index.ts", "CROSS_PACKAGE_IMPORT"],
      ["@lib/core/private.ts", "DEEP_IMPORT"],
      ["other/private", "DEEP_IMPORT"],
      ["other", "UNDECLARED_IMPORT"],
      ["node:fs", "UNDECLARED_IMPORT"],
      ["@scope", "INVALID_SPECIFIER"],
      ["", "INVALID_SPECIFIER"],
    ];
  for (const [specifier, code] of cases) {
    const result = r.resolve(request(specifier));
    assert.equal(result.ok, false, specifier);
    if (!result.ok) {
      assert.equal(result.error.code, code, specifier);
      assert.deepEqual(result.error.position, { line: 2, column: 8 });
      assert.equal(result.error.start, 15);
      assert.equal(result.error.end, 26);
    }
  }
  const missing = r.resolve(request("./absent.ts"));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.candidate, "app/absent.ts");
});
test("mapping authority is scoped to importing package, and configuration errors fail early", () => {
  const r = resolver(),
    other = r.resolve({ ...request("@lib/core"), importer: "lib/index.ts" });
  assert.equal(other.ok, false);
  assert.equal(other.error.code, "UNDECLARED_IMPORT");
  const cases: [ImportMapping[], string][] = [
    [
      [{ packageId: "missing", specifier: "pkg", target: "lib/index.ts" }],
      "UNKNOWN_PACKAGE",
    ],
    [
      [{ packageId: "app", specifier: "pkg/*", target: "lib/index.ts" }],
      "INVALID_MAPPING",
    ],
    [
      [{ packageId: "app", specifier: "pkg", target: "lib/missing.ts" }],
      "MISSING_TARGET",
    ],
    [
      [
        { packageId: "app", specifier: "pkg", target: "lib/index.ts" },
        { packageId: "app", specifier: "pkg", target: "lib/private.ts" },
      ],
      "DUPLICATE_MAPPING",
    ],
  ];
  for (const [mappings, code] of cases) {
    const r = setup(mappings).result;
    assert.equal(r.ok, false);
    assert.equal(r.error.code, code);
  }
  const c = createCatalog([
    { id: "a.ts", value: { packageId: "", source: setup().source } },
  ]);
  assert.equal(c.ok, true);
  assert.equal(createResolver(c.value, []).ok, false);
});
test("validates UTF-16 spans before resolving, including unknown importer and EOF", () => {
  const r = resolver();
  const unknown = r.resolve({
    ...request("./util.ts"),
    importer: "missing.ts",
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "UNKNOWN_IMPORTER");
  assert.equal(unknown.error.position, undefined);
  for (const [start, end] of [
    [-1, 0],
    [1, 0],
    [0, 999],
    [NaN, 0],
    [0, 0.5],
  ]) {
    const result = r.resolve({
      ...request("./util.ts"),
      start: start!,
      end: end!,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_SPAN");
    assert.equal(result.error.position, undefined);
  }
  const length = setup().source.text.length;
  assert.equal(
    r.resolve({ ...request("./util.ts"), start: length, end: length }).ok,
    true,
  );
});
test("resolver snapshots configuration and permits a mapped cycle without evaluation", () => {
  const mappings = [
      { packageId: "app", specifier: "@lib/core", target: "lib/index.ts" },
      { packageId: "lib", specifier: "app", target: "app/main.ts" },
    ],
    s = setup(mappings);
  assert.equal(s.result.ok, true);
  mappings[0]!.target = "lib/private.ts";
  assert.equal(s.result.value.resolve(request("@lib/core")).ok, true);
  assert.deepEqual(
    s.result.value.resolve({ ...request("app"), importer: "lib/index.ts" }),
    {
      ok: true,
      value: {
        importer: "lib/index.ts",
        target: "app/main.ts",
        kind: "runtime",
      },
    },
  );
  const target = s.result.value.resolve(request("@lib/core"));
  assert.equal(target.ok, true);
  assert.equal(target.value.target, "lib/index.ts");
});

test("node:fs is a finite explicitly granted host module", () => {
  const absent = resolver().resolve(request("node:fs"));
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.error.code, "UNDECLARED_IMPORT");
  const configured = setup([
    { packageId: "app", specifier: "node:fs", target: "lib/index.ts" },
  ]).result;
  assert.ok(configured.ok);
  assert.deepEqual(configured.value.resolve(request("node:fs")), {
    ok: true,
    value: { importer: "app/main.ts", target: "lib/index.ts", kind: "runtime" },
  });
  for (const name of ["node:fs/promises", "node:child_process", "node:"]) {
    const result = configured.value.resolve(request(name));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_SPECIFIER");
  }
});

test("explicit nested public subpaths resolve only exact consumer-scoped grants", () => {
  const configured = setup([
    {
      packageId: "app",
      specifier: "@lib/core/binary/word64",
      target: "lib/index.ts",
    },
  ]).result;
  assert.ok(configured.ok, JSON.stringify(configured));
  assert.deepEqual(
    configured.value.resolve(request("@lib/core/binary/word64")),
    {
      ok: true,
      value: {
        importer: "app/main.ts",
        target: "lib/index.ts",
        kind: "runtime",
      },
    },
  );
  for (const specifier of [
    "@lib/core/binary",
    "@lib/core/binary/word64/internal",
    "@lib/core/private.ts",
  ]) {
    const result = configured.value.resolve(request(specifier));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DEEP_IMPORT");
  }
  const other = configured.value.resolve({
    ...request("@lib/core/binary/word64"),
    importer: "lib/private.ts",
  });
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.error.code, "DEEP_IMPORT");
  for (const specifier of [
    "@lib/core/*",
    "@lib/core/../private",
    "@lib/core//binary",
    "@lib/core/%2e%2e/private",
    "@lib/core/\\private",
  ]) {
    const result = setup([
      { packageId: "app", specifier, target: "lib/index.ts" },
    ]).result;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_MAPPING");
  }
});
