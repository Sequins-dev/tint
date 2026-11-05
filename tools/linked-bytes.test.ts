import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { linkModules } from "@tint/ts-native/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { emitModule } from "@tint/codegen/aarch64/scalar";
function source(
  id: string,
  dependencies: readonly [string, string][],
): SourceModule {
  const bytes = new TextEncoder().encode(
    readFileSync(
      new URL(
        "../packages/foundation/src/binary/" + id + ".ts",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}
test("unchanged bytes and word64 modules compose, check and emit together", () => {
  const linked = linkModules(
    [source("bytes", [["./word64.ts", "word64"]]), source("word64", [])],
    "bytes",
    ["Number", "Math", "undefined"],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const checked = checkClosureModule(linked.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const entries = checked.value.bindings.functions
    .filter((f) => f.parent === undefined)
    .map((f) => f.id);
  const lowered = lowerModuleEntries(
    checked.value,
    entries,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const native = emitModule(lowered.value.module);
  assert.ok(native.ok, JSON.stringify(native));
  assert.ok(entries.length > 0);
  assert.equal(native.value.functions.length, entries.length);
});
test("imported constants are checked before entry function bodies", () => {
  function parse(text: string) {
    const bytes = new TextEncoder().encode(text),
      s = createSourceText(bytes, bytes.length);
    assert.ok(s.ok);
    const p = parseModule(s.value);
    assert.ok(p.ok);
    return p.value;
  }
  const linked = linkModules(
    [
      {
        id: "main",
        module: parse(
          'import {VALUE} from "dep"; export function run():number{return VALUE;}',
        ),
        dependencies: new Map([["dep", "dep"]]),
      },
      {
        id: "dep",
        module: parse("export const VALUE=42;"),
        dependencies: new Map(),
      },
    ],
    "main",
    [],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const checked = checkClosureModule(linked.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
