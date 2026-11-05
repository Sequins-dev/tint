import { test } from "node:test";
import assert from "node:assert/strict";
import { reifyTypes } from "../src/reify/index.ts";
import { rewriteModule } from "@tint/typescript/syntax";
import { resolveInterfaceTypes } from "@tint/typescript/checker";
import type { Type } from "@tint/typescript/types";

test("reifies reachable recursive structural contracts without unfolding cycles", () => {
  const types: Type[] = [
    { kind: "number" },
    {
      kind: "object",
      properties: [
        { name: "value", type: 0, readonly: false },
        { name: "next", type: 1, readonly: true, optional: true },
      ],
    },
    { kind: "array", element: 1, readonly: true },
    { kind: "map", key: 0, value: 2, readonly: false },
    { kind: "string" },
  ];
  const result = reifyTypes(types, [3, 1, 3], "Generated");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.declarations.length, 4);
  assert.equal(result.value.roots.length, 3);
  assert.deepEqual(result.value.roots[0], result.value.roots[2]);
  const resolved = resolveInterfaceTypes(
    { statements: result.value.declarations, imports: [], start: 0, end: 0 },
    result.value.roots,
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const mapId = resolved.value.annotations.get(result.value.roots[0]!)!;
  const map = resolved.value.types[mapId];
  assert.equal(map?.kind, "map");
  const objectId = resolved.value.annotations.get(result.value.roots[1]!)!;
  const object = resolved.value.types[objectId];
  assert.equal(object?.kind, "object");
  if (object?.kind !== "object") throw "missing object";
  assert.deepEqual(
    object.properties.map((p) => [p.name, p.readonly, p.optional]),
    [
      ["value", false, undefined],
      ["next", true, true],
    ],
  );
  assert.equal(object.properties[1]?.type, objectId);
});

test("preserves collection mutability, literals, unions and optional function parameters", () => {
  const types: Type[] = [
    { kind: "string" },
    { kind: "undefined" },
    { kind: "union", members: [0, 1] },
    { kind: "function", parameters: [0, 2], minimumArguments: 1, result: 0 },
    { kind: "set", element: 0, readonly: true },
    { kind: "literal", value: "tag" },
  ];
  const emitted = reifyTypes(types, [3, 4, 5], "T");
  assert.ok(emitted.ok);
  const resolved = resolveInterfaceTypes(
    { statements: emitted.value.declarations, imports: [], start: 0, end: 0 },
    emitted.value.roots,
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const fn =
    resolved.value.types[
      resolved.value.annotations.get(emitted.value.roots[0]!)!
    ];
  assert.equal(fn?.kind, "function");
  if (fn?.kind !== "function") throw "missing function";
  assert.equal(fn.minimumArguments, 1);
  const set =
    resolved.value.types[
      resolved.value.annotations.get(emitted.value.roots[1]!)!
    ];
  assert.deepEqual(set?.kind === "set" && set.readonly, true);
});

test("rejects invalid type graphs and roots without partial output", () => {
  assert.equal(
    reifyTypes([{ kind: "array", element: 9, readonly: false }], [0], "T").ok,
    false,
  );
  assert.equal(reifyTypes([{ kind: "number" }], [4], "T").ok, false);
  assert.equal(reifyTypes([{ kind: "number" }], [0.5], "T").ok, false);
  assert.equal(reifyTypes([{ kind: "number" }], [0], "").ok, false);
});

test("does not silently widen an optional parameter that excludes undefined", () => {
  const result = reifyTypes(
    [
      { kind: "number" },
      { kind: "function", parameters: [0], minimumArguments: 0, result: 0 },
    ],
    [1],
    "T",
  );
  assert.equal(result.ok, false);
});

test("receiver contracts survive type reification and alias resolution", () => {
  const emitted = reifyTypes(
    [
      { kind: "number" },
      { kind: "object", properties: [{ name: "x", type: 0, readonly: true }] },
      { kind: "function", parameters: [], result: 0, receiver: 1 },
    ],
    [2],
    "Receiver",
  );
  assert.ok(emitted.ok);
  const resolved = resolveInterfaceTypes(
    rewriteModule(
      { statements: emitted.value.declarations, imports: [], start: 0, end: 0 },
      { hashes: true },
    ),
    emitted.value.roots,
  );
  assert.ok(resolved.ok);
  const fn =
    resolved.value.types[
      resolved.value.annotations.get(emitted.value.roots[0]!)!
    ];
  assert.equal(fn?.kind, "function");
  if (fn?.kind !== "function") throw "missing function";
  assert.notEqual(fn.receiver, undefined);
  assert.equal(resolved.value.types[fn.receiver!]?.kind, "object");
  assert.equal(fn.parameters.length, 0);
});

test("reification never silently erases callable or constructible object contracts", () => {
  for (const signatures of [
    { call: 1 },
    { construct: 1 },
    { call: 1, construct: 1 },
  ]) {
    const types: Type[] = [
      { kind: "number" },
      { kind: "function", parameters: [], result: 0 },
      { kind: "object", properties: [], ...signatures },
    ];
    const result = reifyTypes(types, [2], "T");
    assert.ok(result.ok, JSON.stringify(result));
    const resolved = resolveInterfaceTypes(
      { statements: result.value.declarations, imports: [], start: 0, end: 0 },
      result.value.roots,
    );
    assert.ok(resolved.ok, JSON.stringify(resolved));
    const id = resolved.value.annotations.get(result.value.roots[0]!)!;
    assert.equal(
      resolved.value.system.call(id, []).ok,
      signatures.call !== undefined,
    );
    assert.equal(
      resolved.value.system.construct(id, []).ok,
      signatures.construct !== undefined,
    );
  }
});
