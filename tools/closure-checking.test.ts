import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { planClosures } from "@tint/ts-native/closure/layout";

test("allocator source checking composes with environment layout through explicit representations", () => {
  const bytes = readFileSync(
    new URL(
      "../packages/native-runtime/src/allocators/region/index.ts",
      import.meta.url,
    ),
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const ast = parseModule(source.value);
  assert.ok(ast.ok);
  const checked = checkClosureModule(ast.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const { bindings, types, bindingTypes } = checked.value;
  // This fixture explicitly chooses 64-bit numbers and handles. It is not a
  // representation selector, allocation implementation or escape-safety proof.
  const representations = bindings.bindings
    .filter((b) => b.captured)
    .map((b) => {
      const id = bindingTypes[b.id];
      assert.notEqual(id, undefined);
      const type = id === undefined ? undefined : types[id];
      assert.ok(type);
      assert.ok(
        ["number", "function", "Uint32Array"].includes(type.kind),
        type.kind,
      );
      return { binding: b.id, size: 8, alignment: 8 };
    });
  const planned = planClosures(
    bindings,
    representations,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(planned.ok);
  assert.equal(planned.value.functions.length, 30);
  assert.equal(planned.value.environments.length, 1);
  assert.equal(
    planned.value.environments[0]?.cells.length,
    representations.length,
  );
  const used = bindings.bindings.find((b) => b.name === "used");
  assert.ok(used);
  const addresses = planned.value.functions.flatMap((f) =>
    f.captures.filter((c) => c.binding === used.id),
  );
  assert.equal(addresses.length, 6);
  for (const address of addresses) assert.deepEqual(address, addresses[0]);
});

test("the unchanged region allocator source lowers and emits native factory and method entries", async () => {
  const { planScalarClosures, lowerClosureFactory } =
    await import("@tint/ts-native/closure/lowering");
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const bytes = readFileSync(
    new URL(
      "../packages/native-runtime/src/allocators/region/index.ts",
      import.meta.url,
    ),
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const ast = parseModule(source.value);
  assert.ok(ast.ok);
  const checked = checkClosureModule(ast.value);
  assert.ok(checked.ok);
  const layouts = planScalarClosures(
    checked.value,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(layouts.ok);
  const env = layouts.value.environments[0];
  assert.ok(env);
  const lowered = lowerClosureFactory(checked.value, 0, env);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const native = emitModule(lowered.value.module);
  assert.ok(native.ok, JSON.stringify(native));
  assert.deepEqual(
    lowered.value.exports.map((e) => e.name),
    [
      "replaceAllocations",
      "descriptorCount",
      "disableSearchIndex",
      "enableSearchIndex",
      "allocate",
      "allocateFromEnd",
      "allocateBelow",
      "allocateAbove",
      "release",
      "releaseAll",
      "retainDescriptors",
      "releaseDescriptors",
      "allocationSize",
      "usedBytes",
    ],
  );
});
