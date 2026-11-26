import assert from "node:assert/strict";
import test from "node:test";
import { projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";

test("optional readlink capability follows the supplied host facade contract", () => {
  for (const declared of [false, true]) {
    const bytes = new TextEncoder().encode(
      declared
        ? 'export function readlink(path:Uint8Array,destination:Uint8Array):number { throw "HOST_UNAVAILABLE"; }'
        : 'export function openRead(path:Uint8Array):number { throw "HOST_UNAVAILABLE"; }',
    );
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const module = parseModule(source.value);
    assert.ok(module.ok);
    const request = projectBuildRequest(
      [
        {
          id: "packages/native-runtime/src/intrinsics/fs.ts",
          module: module.value,
          dependencies: new Map(),
        },
      ],
      () => {},
    );
    assert.equal(
      request.hostBindings?.some(
        (binding) => binding.operation === "read-link",
      ),
      declared,
    );
  }
});

test("runtime providers preserve stable namespaces independently of package paths", () => {
  const sources = projectBuildRequest([], () => {}).runtimes;
  assert.deepEqual(sources, [
    {
      namespace: "number-list",
      module: "packages/foundation/src/collections/number-list.ts",
    },
    {
      namespace: "linked-map",
      module: "packages/foundation/src/collections/linked-map.ts",
    },
    {
      namespace: "number-key-map",
      module: "packages/foundation/src/collections/number-key-map.ts",
    },
    {
      namespace: "number-number-map",
      module: "packages/foundation/src/collections/number-number-map.ts",
    },
    {
      namespace: "string-key-map",
      module: "packages/foundation/src/collections/string-key-map.ts",
    },
    {
      namespace: "string-number-map",
      module: "packages/foundation/src/collections/string-number-map.ts",
    },
    {
      namespace: "sparse-list",
      module: "packages/foundation/src/collections/sparse-list.ts",
    },
    {
      namespace: "linked-set",
      module: "packages/foundation/src/collections/linked-set.ts",
    },
    {
      namespace: "number-key-set",
      module: "packages/foundation/src/collections/number-key-set.ts",
    },
    {
      namespace: "primitive-value",
      module: "packages/native-runtime/src/values/index.ts",
    },
    {
      namespace: "bigint",
      module: "packages/native-runtime/src/values/bigint.ts",
    },
    {
      namespace: "number-string-cache",
      module: "packages/foundation/src/numeric/number-string-cache.ts",
    },
    {
      namespace: "number-text",
      module: "packages/foundation/src/numeric/number-text/index.ts",
    },
    {
      namespace: "sha256-rounds",
      module: "packages/foundation/src/binary/sha256-rounds.ts",
    },
    {
      namespace: "indexed-sort",
      module: "packages/foundation/src/collections/indexed-sort.ts",
    },
    {
      namespace: "list-sort",
      module: "packages/foundation/src/collections/list-sort.ts",
    },
    {
      namespace: "latin1",
      module: "packages/foundation/src/text/latin1.ts",
    },
    {
      namespace: "utf8",
      module: "packages/foundation/src/text/utf8.ts",
    },
    {
      namespace: "text-encoding",
      module: "packages/foundation/src/text/text-encoding/index.ts",
    },
    {
      namespace: "native-fs-host",
      module: "packages/native-runtime/src/intrinsics/fs.ts",
    },
    {
      namespace: "native-process",
      module: "packages/native-runtime/src/intrinsics/process.ts",
    },
    {
      namespace: "native-console",
      module: "packages/native-runtime/src/intrinsics/console.ts",
    },
  ]);
  assert.equal(
    new Set(sources.map((source) => source.namespace)).size,
    sources.length,
  );
  assert.ok(sources.every((source) => !Object.hasOwn(source, "packageId")));
});

test("compiler heap fits the measured live set plus output storage within native offsets", () => {
  const request = projectBuildRequest([], () => {});
  const extent = request.managedBytes;
  assert.ok(Number.isSafeInteger(extent) && extent > 0 && extent <= 0xffffffff);
  assert.equal(extent % 1024, 0);
  const semispace = Math.floor(extent / 1024) * 512;
  const nursery = Math.min(
    268435456,
    Math.max(512, Math.floor(semispace / 2048) * 512),
  );
  // Frozen diagnostic: 1,761,087,024 live bytes at emission. Reserve another
  // 64 MiB for image storage; both Node bootstrap and native CLI use this request.
  assert.ok(semispace - nursery >= 1761087024 + 67108864);
  assert.ok(semispace <= 0x7ffffff0);
});
