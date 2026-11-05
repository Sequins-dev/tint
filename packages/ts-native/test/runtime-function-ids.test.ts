import { test } from "node:test";
import assert from "node:assert/strict";
import * as runtime from "../src/runtime/index.ts";
import type { ModuleEntryOptions } from "../src/closure/lowering/index.ts";

test("runtime function roots include optional operations and exclude representation identities", () => {
  assert.equal(typeof runtime.runtimeFunctionIds, "function");
  assert.deepEqual(runtime.runtimeFunctionIds({}), []);
  const options: ModuleEntryOptions = {
    lists: [
      {
        element: 901,
        runtime: {
          create: 0,
          read: 1,
          write: 2,
          push: 3,
          length: 4,
          has: 5,
          delete: 6,
          resize: 7,
          sort: 8,
        },
      },
      {
        element: 902,
        runtime: { create: 0, read: 1, write: 2, push: 3, length: 4 },
      },
    ],
    sets: [
      {
        element: 903,
        runtime: {
          create: 9,
          has: 10,
          add: 11,
          delete: 12,
          clear: 13,
          size: 14,
          iterator: { create: 15, advance: 16, read: 17 },
          clone: 18,
        },
      },
    ],
    maps: [
      {
        key: 904,
        value: 905,
        runtime: {
          create: 19,
          get: 20,
          has: 21,
          set: 22,
          delete: 23,
          clear: 24,
          size: 25,
          iterator: { create: 26, advance: 27, key: 28, value: 29 },
        },
      },
    ],
    numberToString: 30,
    numberFromString: 31,
    importedFunctions: [906],
    recordBindings: [{ function: 907, operation: "identity" }],
  };
  const before = JSON.stringify(options);
  const ids = runtime.runtimeFunctionIds(options);
  assert.deepEqual(
    ids.slice().sort((a, b) => a - b),
    Array.from({ length: 32 }, (_, i) => i),
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(runtime.runtimeFunctionIds(options), ids);
  assert.equal(JSON.stringify(options), before);
});

test("runtime roots include every primitive operation and preserve shared functions", () => {
  const primitives = {
    fromNull: 100,
    isNullish: 101,
    fromUndefined: 102,
    fromNumber: 103,
    fromBoolean: 104,
    fromString: 105,
    fromOptionalNumber: 106,
    fromOptionalString: 107,
    fromOptionalBoolean: 108,
    fromOptionalBox: 109,
    readNumber: 110,
    readBoolean: 111,
    readString: 112,
    readOptionalNumber: 113,
    readOptionalString: 114,
    readOptionalBoolean: 115,
    kindOf: 116,
    truthy: 117,
    strictEqual: 118,
    canonicalKey: 119,
    canonicalOptionalNumber: 120,
  };
  assert.deepEqual(
    runtime
      .runtimeFunctionIds({ primitives })
      .slice()
      .sort((a, b) => a - b),
    Array.from({ length: 21 }, (_, i) => 100 + i),
  );
  assert.deepEqual(
    runtime.runtimeFunctionIds({ numberToString: 0, numberFromString: 0 }),
    [0],
  );
});

test("runtime visitation retains every operation identity when functions are shared", () => {
  assert.equal(typeof runtime.visitRuntimeFunctions, "function");
  const events: {
    id: number;
    kind: string;
    binding: number;
    operation: string;
  }[] = [];
  runtime.visitRuntimeFunctions(
    {
      lists: [
        {
          element: 999,
          runtime: {
            create: 0,
            read: 0,
            write: 0,
            push: 0,
            length: 0,
            sort: 1,
          },
        },
        {
          element: 998,
          runtime: { create: 0, read: 0, write: 0, push: 0, length: 0 },
        },
      ],
      numberToString: 2,
      numberFromString: 2,
    },
    (id, kind, binding, operation) =>
      events.push({ id, kind, binding, operation }),
  );
  assert.deepEqual(
    events
      .filter((event) => event.kind === "list" && event.binding === 0)
      .map((event) => event.operation),
    ["create", "read", "write", "push", "length", "sort"],
  );
  assert.deepEqual(
    events
      .filter((event) => event.kind === "list" && event.binding === 1)
      .map((event) => event.operation),
    ["create", "read", "write", "push", "length"],
  );
  assert.deepEqual(events.slice(-2), [
    { id: 2, kind: "number-text", binding: -1, operation: "toString" },
    { id: 2, kind: "number-text", binding: -1, operation: "fromString" },
  ]);
});
