import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FunctionIR } from "@tint/ir/scalar";
import { createFunctionStore } from "@tint/ir/storage";
import {
  automaticPackingSize,
  automaticResidentBytes,
  createFileSpillBackend,
  emissionStorage,
} from "@tint/compiler/spill-files";
import { createNodeFileHost } from "./node-file-host.ts";

function body(id: number): FunctionIR {
  const instructions: FunctionIR["blocks"][number]["instructions"][number][] =
    [];
  for (let index = 0; index < 40; index++)
    instructions.push({
      kind: "constant",
      id: index,
      value: id * 1000 + index + 0.5,
      start: index,
      end: index + 1,
    });
  return {
    id,
    name: "spilled$" + id,
    exported: false,
    parameters: [],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: 39, start: 0, end: 0 },
      },
    ],
  };
}

test("spilled function bodies round-trip through temporary files", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-spill-"));
  try {
    const store = createFunctionStore({
      policy: "all",
      residentBytes: 0,
      packedBytes: 0,
      chunkBytes: 1024,
      backend: createFileSpillBackend(
        createNodeFileHost(),
        join(directory, "image.spill"),
      ),
    });
    for (let id = 0; id < 50; id++) store.put(body(id));
    // Sealed chunks are on disk, one file each.
    assert.ok(readdirSync(directory).length > 1);
    for (let id = 49; id >= 0; id--)
      assert.deepStrictEqual(store.get(id), body(id));
    // Replacing every body retires the old segments' files.
    for (let id = 0; id < 50; id++) store.put(body(id));
    const statistics = store.statistics();
    assert.ok(statistics.spilledChunks > 1);
    assert.ok(statistics.reloadedChunks > 1);
    store.close();
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("emission packs automatically only above the IR size threshold", () => {
  assert.equal(emissionStorage(undefined, automaticPackingSize), undefined);
  assert.deepEqual(emissionStorage(undefined, automaticPackingSize + 1), {
    policy: "budget",
    byteBudget: automaticResidentBytes,
  });
  assert.deepEqual(emissionStorage(undefined, 11, 10), {
    policy: "budget",
    byteBudget: automaticResidentBytes,
  });
  // An explicit request wins in both directions.
  assert.equal(
    emissionStorage({ policy: "memory" }, automaticPackingSize * 4),
    undefined,
  );
  const budget = { policy: "budget" as const, byteBudget: 1024 };
  assert.equal(emissionStorage(budget, 1), budget);
});
