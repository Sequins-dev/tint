import { test } from "node:test";
import assert from "node:assert/strict";
import type { SerializedManagedSurfaceDirectory } from "../src/native/managed-directory-data.ts";
import { managedSurfaceContract } from "../src/native/managed-directory-reader.ts";
import * as selection from "../src/native/managed-runtime-selection.ts";

// This unit tests selection over already validated metadata. Equal ABIs are
// intentional: neither signatures nor addresses may establish operation identity.
function directory(): SerializedManagedSurfaceDirectory {
  return {
    version: 3,
    name: "runtime",
    digest: "a".repeat(64),
    frame: undefined,
    abi: { signature: 1, functionBrand: [48, 1, 24, 0] },
    types: {
      version: 1,
      declarations: "",
      table: "$T0",
      entries: [],
      types: [],
    },
    signatures: [],
    records: [],
    runtimes: [
      {
        kind: "list",
        element: "$T7",
        value: "",
        operations: [
          "create",
          "read",
          "write",
          "push",
          "length",
          "has",
          "delete",
          "resize",
        ].map((operation) => ({
          operation,
          parameters: ["reference", "number"],
          returnType: "number",
        })),
      },
      {
        kind: "list",
        element: "$T8",
        value: "",
        operations: [
          "create",
          "read",
          "write",
          "push",
          "length",
          "has",
          "delete",
          "resize",
        ].map((operation) => ({
          operation,
          parameters: ["reference", "number"],
          returnType: "number",
        })),
      },
      {
        kind: "number-text",
        element: "",
        value: "",
        operations: [
          {
            operation: "toString",
            parameters: ["number"],
            returnType: "string",
          },
          {
            operation: "fromString",
            parameters: ["string"],
            returnType: "number",
          },
        ],
      },
    ],
  };
}
test("runtime slots require exact canonical keys and operation names even for equal ABIs", () => {
  assert.equal(typeof selection.selectManagedRuntimeSlot, "function");
  const source = directory(),
    key = { kind: "list", element: "$T7", value: "" } as const;
  const has = selection.selectManagedRuntimeSlot(source, key, "has"),
    del = selection.selectManagedRuntimeSlot(source, key, "delete");
  assert.ok(has.ok);
  assert.ok(del.ok);
  assert.equal(has.value.slot, 5);
  assert.equal(del.value.slot, 6);
  assert.deepEqual(has.value.parameters, del.value.parameters);
  assert.notEqual(has.value.contract, del.value.contract);
  assert.equal(
    del.value.contract,
    managedSurfaceContract(source.name, source.digest, "runtime", 6),
  );
  const other = selection.selectManagedRuntimeSlot(
    source,
    { ...key, element: "$T8" },
    "push",
  );
  assert.ok(other.ok);
  assert.equal(other.value.slot, 11);
  const text = selection.selectManagedRuntimeSlot(
    source,
    { kind: "number-text", element: "", value: "" },
    "toString",
  );
  assert.ok(text.ok);
  assert.equal(text.value.slot, 16);
  for (const [candidate, operation] of [
    [key, "sort"],
    [{ ...key, element: "$T9" }, "has"],
    [{ ...key, value: "$T8" }, "has"],
    [{ ...key, kind: "set" }, "has"],
  ] as const) {
    const result = selection.selectManagedRuntimeSlot(
      source,
      candidate,
      operation,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not provided by the surface/);
  }
  const before = JSON.stringify(source);
  selection.selectManagedRuntimeSlot(source, key, "has");
  assert.equal(JSON.stringify(source), before);
});

test("source identities compose through both pruning passes without inventing witnesses", () => {
  assert.equal(typeof selection.finalFunctionSources, "function");
  assert.deepEqual(
    selection.finalFunctionSources(
      [70, 71, 72],
      [new Uint32Array([3, 0, 1, 2]), new Uint32Array([2, 0, 1])],
      2,
    ),
    [70, 72],
  );
  assert.deepEqual(selection.finalFunctionSources([70], [], 2), [
    70,
    undefined,
  ]);
});

test("import bindings require one exact operation slot and its matching lowered ABI", () => {
  const source = directory(),
    key = { kind: "list", element: "$T7", value: "" } as const;
  const fn = {
    id: 0,
    name: "opaque",
    exported: false,
    import: true as const,
    parameters: [0, 1],
    slots: ["reference", "number"] as const,
    returnType: "number" as const,
    entry: 0,
    blocks: [],
  };
  const uses = new Map([[17, [{ key, operation: "has" }]]]);
  const result = selection.bindManagedRuntimeImports(
    source,
    { functions: [fn] },
    [17],
    uses,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value, [
    {
      function: 0,
      name: "$runtime0",
      contract: managedSurfaceContract(
        source.name,
        source.digest,
        "runtime",
        5,
      ),
      parameters: ["reference", "number"],
      returnType: "number",
    },
  ]);
  const crossed = selection.bindManagedRuntimeImports(
    source,
    { functions: [fn] },
    [17],
    new Map([
      [
        17,
        [
          { key, operation: "has" },
          { key, operation: "delete" },
        ],
      ],
    ]),
  );
  assert.equal(crossed.ok, false);
  if (!crossed.ok) assert.match(crossed.error, /selects two surface slots/);
  for (const sources of [[], [999]])
    assert.equal(
      selection.bindManagedRuntimeImports(
        source,
        { functions: [fn] },
        sources,
        uses,
      ).ok,
      false,
    );
  for (const changed of [
    { ...fn, slots: ["number", "number"] as const },
    { ...fn, returnType: "boolean" as const },
    { ...fn, parameters: [0] },
  ]) {
    const skew = selection.bindManagedRuntimeImports(
      source,
      { functions: [changed] },
      [17],
      uses,
    );
    assert.equal(skew.ok, false);
    if (!skew.ok) assert.match(skew.error, /runtime ABI skew/);
  }
  const { import: imported, ...local } = fn;
  assert.equal(imported, true);
  assert.deepEqual(
    selection.bindManagedRuntimeImports(
      source,
      { functions: [local] },
      [],
      new Map(),
    ),
    { ok: true, value: [] },
  );
});

test("collection keys come from canonical named surface exports", async () => {
  const { createSourceTextView } = await import("@tint/source/text");
  const { parseModule } = await import("@tint/typescript/syntax");
  const { checkClosureModule } = await import("@tint/typescript/checker");
  const compiler = await import("../src/native/index.ts");
  const parsed = parseModule(
    createSourceTextView(
      "type Names=readonly string[];interface Box{readonly value:number;}function size(value:Names):number{return value.length;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const surface = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [{ name: "size", local: "size" }],
    "$Surface",
    [
      { name: "Names", local: "Names" },
      { name: "Box", local: "Box" },
    ],
  );
  assert.ok(surface.ok);
  const contracts = compiler.planManagedSurfaceContracts(surface.value);
  assert.ok(contracts.ok);
  const census = compiler.planManagedSurfaceRuntimes(contracts.value);
  assert.ok(census.ok);
  const key = selection.managedRuntimeKeyForSurfaceType(
    contracts.value,
    "Names",
  );
  assert.ok(key.ok, JSON.stringify(key));
  const expected = census.value.collections[0]!;
  assert.deepEqual(key.value, {
    kind: expected.kind,
    element: expected.element,
    value: expected.value,
  });
  assert.equal(
    selection.managedRuntimeKeyForSurfaceType(contracts.value, "missing").ok,
    false,
  );
  assert.equal(
    selection.managedRuntimeKeyForSurfaceType(contracts.value, "Box").ok,
    false,
  );
});

test("runtime use descriptions retain each operation while covering all imported roots", async () => {
  const { runtimeFunctionIds } = await import("@tint/ts-native/runtime");
  const options = {
    lists: [
      {
        element: 999,
        runtime: {
          create: 1,
          read: 2,
          write: 3,
          push: 4,
          length: 5,
          has: 6,
          delete: 6,
          resize: 7,
          sort: 8,
        },
      },
    ],
    numberToString: 9,
    numberFromString: 10,
  };
  const key = { kind: "list", element: "$T7", value: "" } as const;
  const result = selection.describeManagedRuntimeUses(options, {
    lists: [key],
    sets: [],
    maps: [],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual([...result.value.keys()], runtimeFunctionIds(options));
  assert.deepEqual(
    result.value.get(6)?.map((use) => use.operation),
    ["has", "delete"],
  );
  assert.deepEqual(result.value.get(8), [{ key, operation: "sort" }]);
  assert.deepEqual(result.value.get(9), [
    {
      key: { kind: "number-text", element: "", value: "" },
      operation: "toString",
    },
  ]);
  const absent = selection.describeManagedRuntimeUses(options, {
    lists: [undefined],
    sets: [],
    maps: [],
  });
  assert.ok(absent.ok);
  assert.deepEqual([...absent.value.keys()], [9, 10]);
  assert.equal(
    selection.describeManagedRuntimeUses(options, {
      lists: [],
      sets: [],
      maps: [],
    }).ok,
    false,
  );
  assert.equal(
    selection.describeManagedRuntimeUses(options, {
      lists: [{ ...key, kind: "set" }],
      sets: [],
      maps: [],
    }).ok,
    false,
  );
});

test("JIT runtime keys use exact type contracts and first-provider order", async () => {
  const { createSourceTextView } = await import("@tint/source/text");
  const { parseModule } = await import("@tint/typescript/syntax");
  const { checkClosureModule } = await import("@tint/typescript/checker");
  const parsed = parseModule(
    createSourceTextView(
      "type S=string;type N=number;type Optional=string|undefined;type ReadonlyBox={readonly value:string};type MutableBox={value:string};function schema(s:S,n:N,o:Optional,r:ReadonlyBox,m:MutableBox):void{}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const id = (name: string) => {
    const value = checked.value.typeNames.get(name);
    assert.ok(value !== undefined);
    return value;
  };
  const aliases = new Map([
    ["$T7", id("S")],
    ["$T8", id("S")],
    ["$N", id("N")],
    ["$R", id("ReadonlyBox")],
  ]);
  const source = {
    ...directory(),
    runtimes: [
      ...directory().runtimes,
      { kind: "set" as const, element: "$N", value: "", operations: [] },
      { kind: "map" as const, element: "$N", value: "$T7", operations: [] },
      { kind: "list" as const, element: "$R", value: "", operations: [] },
    ],
  };
  const list = (element: number | "string") => ({
    element,
    runtime: { create: 0, read: 1, write: 2, push: 3, length: 4 },
  });
  const options = {
    lists: [list("string"), list(id("Optional")), list(id("MutableBox"))],
    sets: [
      {
        element: "number" as const,
        runtime: { create: 5, has: 6, add: 7, delete: 8, clear: 9, size: 10 },
      },
    ],
    maps: [
      {
        key: "number" as const,
        value: "string" as const,
        runtime: {
          create: 11,
          get: 12,
          has: 13,
          set: 14,
          delete: 15,
          clear: 16,
          size: 17,
        },
      },
    ],
  };
  const selected = selection.managedRuntimeKeysForOptions(
    source,
    checked.value,
    aliases,
    options,
  );
  assert.ok(selected.ok, JSON.stringify(selected));
  assert.deepEqual(selected.value.lists, [
    { kind: "list", element: "$T7", value: "" },
    undefined,
    undefined,
  ]);
  assert.deepEqual(selected.value.sets, [
    { kind: "set", element: "$N", value: "" },
  ]);
  assert.deepEqual(selected.value.maps, [
    { kind: "map", element: "$N", value: "$T7" },
  ]);
  assert.equal(
    selection.managedRuntimeKeysForOptions(
      source,
      checked.value,
      new Map(),
      options,
    ).ok,
    false,
  );
});
