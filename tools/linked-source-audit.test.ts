import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCatalog } from "@tint/source/catalog";
import { createSourceText } from "@tint/source/text";
import {
  auditLinkedSources,
  retainedRuntimeModuleIds,
} from "./linked-source-audit.ts";
import { loadSourceGraph } from "@tint/typescript/modules";
test("audit helper contracts and runtime retention follow explicit providers rather than merged package ownership", () => {
  const sparse =
    'import {initialLength} from "./support.ts";\n' +
    readFileSync(
      "packages/foundation/src/collections/sparse-list.ts",
      "utf8",
    ).replace(
      "return { length: 0, root: undefined };",
      "return { length: initialLength(), root: undefined };",
    );
  const files = {
    "framework/sparse.ts": sparse,
    "framework/numbers.ts": readFileSync(
      "packages/foundation/src/collections/number-list.ts",
      "utf8",
    ),
    "framework/support.ts":
      "const zero=0;export function initialLength():number{return zero;}",
    "framework/application.ts":
      "let counter=19;export function read():number{counter+=1;return counter;}",
    "framework/main.ts":
      'import {read} from "./application.ts";export function run():number{const items=["x"];return items[0]==="x"?read():0;}',
  };
  const loaded = loadSourceGraph(
    Object.entries(files).map(([id, text]) => ({
      id,
      packageId: "foundation",
      bytes: new TextEncoder().encode(text),
    })),
    [],
    ["framework/main.ts", "framework/sparse.ts", "framework/numbers.ts"],
  );
  assert.ok(loaded.ok, JSON.stringify(loaded));
  assert.deepEqual(
    new Set(
      retainedRuntimeModuleIds(loaded.value, [
        "framework/sparse.ts",
        "framework/numbers.ts",
      ]),
    ),
    new Set([
      "framework/sparse.ts",
      "framework/numbers.ts",
      "framework/support.ts",
    ]),
  );
  const reports = ["foundation", "renamed-owner"].map((packageId) => {
    const catalog = createCatalog(
      Object.entries(files).map(([id, text]) => {
        const bytes = new TextEncoder().encode(text),
          source = createSourceText(bytes, bytes.length);
        assert.ok(source.ok);
        return { id, value: { packageId, source: source.value } };
      }),
    );
    assert.ok(catalog.ok);
    return auditLinkedSources(catalog.value, [], "framework/main.ts", {
      runtime: true,
      instance: true,
      runtimeProviders: [
        { module: "framework/sparse.ts", namespace: "sparse-list" },
        { module: "framework/numbers.ts", namespace: "number-list" },
      ],
    });
  });
  for (const report of reports) {
    assert.equal(report.stage, "emitted", JSON.stringify(report));
    assert.ok(report.modules.includes("framework/support.ts"));
    assert.ok(report.modules.includes("framework/application.ts"));
  }
  const first = reports[0]!,
    second = reports[1]!;
  assert.ok("nativeByteLength" in first);
  assert.ok("nativeByteLength" in second);
  assert.equal(first.nativeByteLength, second.nativeByteLength);
});
