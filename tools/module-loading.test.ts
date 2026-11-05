import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { publishFile, readFile } from "@tint/platform/files/service";
import { createSourceText } from "@tint/source/text";
import { createCatalog, type CatalogEntry } from "@tint/source/catalog";
import { createResolver, type ModuleSource } from "@tint/source/resolver";
import { parseModule } from "@tint/typescript/syntax";
import { createNodeFileHost } from "./node-file-host.ts";
test("file loading, snapshots, catalog and resolution compose reproducibly across physical roots", () => {
  const roots = [
    mkdtempSync(join(tmpdir(), "tint-project-a-")),
    mkdtempSync(join(tmpdir(), "tint-project-b-")),
  ];
  try {
    const manifest = [
      {
        id: "app/main.ts",
        packageId: "app",
        text: '// 🙂\r\nimport { value } from "@lib/core";\n',
      },
      {
        id: "lib/index.ts",
        packageId: "lib",
        text: "export const value = 42;\n",
      },
    ];
    const results = roots.map((root, index) => {
      const host = createNodeFileHost(),
        entries: CatalogEntry<ModuleSource>[] = [];
      for (const item of index === 0 ? manifest : [...manifest].reverse()) {
        const file = join(root, item.id);
        mkdirSync(dirname(file), { recursive: true });
        const bytes = new TextEncoder().encode(item.text);
        assert.equal(publishFile(host, file, bytes, false).ok, true);
        const read = readFile(host, file, 1024);
        assert.equal(read.ok, true);
        const source = createSourceText(read.value, 1024);
        assert.equal(source.ok, true);
        entries.push({
          id: item.id,
          value: { packageId: item.packageId, source: source.value },
        });
      }
      const catalog = createCatalog(entries);
      assert.equal(catalog.ok, true);
      const resolver = createResolver(catalog.value, [
        { packageId: "app", specifier: "@lib/core", target: "lib/index.ts" },
      ]);
      assert.equal(resolver.ok, true);
      const entry = catalog.value.lookup("app/main.ts");
      assert.equal(entry.found, true);
      const parsed = parseModule(entry.value.source);
      assert.equal(parsed.ok, true);
      const declaration = parsed.value.imports[0];
      assert.ok(declaration);
      const request = {
        importer: "app/main.ts",
        specifier: declaration.specifier,
        start: declaration.specifierSpan.start,
        end: declaration.specifierSpan.end,
        kind: "runtime" as const,
      };
      return {
        ids: catalog.value.ids(),
        resolved: resolver.value.resolve(request),
        diagnostic: resolver.value.resolve({
          ...request,
          specifier: "@lib/missing",
        }),
      };
    });
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0]?.resolved.ok, true);
    assert.equal(results[0]?.diagnostic.ok, false);
    for (const root of roots)
      assert.equal(JSON.stringify(results).includes(root), false);
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

test("parsed import metadata drives resolution without treating comments or strings as imports", () => {
  const text =
    '// import "./fake.ts"; 🙂\r\nconst text = "import fake";\nimport type { T } from "./types\\u002ets";\nimport { type T } from "./types.ts";\nimport "./missing.ts";';
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.equal(source.ok, true);
  const parsed = parseModule(source.value);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.imports.length, 3);
  const catalog = createCatalog([
    { id: "app/main.ts", value: { packageId: "app", source: source.value } },
    { id: "app/types.ts", value: { packageId: "app", source: source.value } },
  ]);
  assert.equal(catalog.ok, true);
  const resolver = createResolver(catalog.value, []);
  assert.equal(resolver.ok, true);
  const results = parsed.value.imports.map((declaration) =>
    resolver.value.resolve({
      importer: "app/main.ts",
      specifier: declaration.specifier,
      kind: declaration.typeOnly ? "type" : "runtime",
      ...declaration.specifierSpan,
    }),
  );
  assert.deepEqual(results.slice(0, 2), [
    {
      ok: true,
      value: { importer: "app/main.ts", target: "app/types.ts", kind: "type" },
    },
    {
      ok: true,
      value: {
        importer: "app/main.ts",
        target: "app/types.ts",
        kind: "runtime",
      },
    },
  ]);
  assert.equal(parsed.value.imports[1]?.bindings[0]?.typeOnly, true);
  const missing = results[2];
  assert.ok(missing && !missing.ok);
  assert.equal(missing.error.code, "MISSING_MODULE");
  assert.equal(missing.error.position?.line, 5);
  assert.equal(
    text.slice(missing.error.start, missing.error.end),
    '"./missing.ts"',
  );
});
