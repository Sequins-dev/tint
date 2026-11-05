import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Type } from "@tint/typescript/types";
import * as compiler from "../src/native/index.ts";
const types: Type[] = [
  { kind: "number" },
  { kind: "string" },
  {
    kind: "object",
    properties: [
      { name: "value", type: 0, readonly: true },
      { name: "next", type: 2, readonly: true },
    ],
  },
  {
    kind: "object",
    properties: [
      { name: "value", type: 0, readonly: true },
      { name: "next", type: 3, readonly: true },
    ],
  },
  { kind: "function", parameters: [2], result: 2 },
  { kind: "function", parameters: [3], minimumArguments: 1, result: 3 },
  {
    kind: "object",
    properties: [
      { name: "value", type: 1, readonly: true },
      { name: "next", type: 6, readonly: true },
    ],
  },
  { kind: "function", parameters: [6], result: 6 },
  {
    kind: "object",
    properties: [
      { name: "value", type: 0, readonly: false },
      { name: "next", type: 8, readonly: true },
    ],
  },
  { kind: "function", parameters: [8], result: 8 },
  {
    kind: "object",
    properties: [
      { name: "next", type: 10, readonly: true },
      { name: "value", type: 0, readonly: true },
    ],
  },
  { kind: "function", parameters: [10], result: 10 },
  { kind: "function", parameters: [2], minimumArguments: 0, result: 2 },
  { kind: "function", parameters: [2], receiver: 2, result: 2 },
];
test("managed contracts compare recursive shapes independently of transient type IDs", () => {
  const index = compiler.createManagedTypeContractIndex(types);
  assert.ok(index.ok, JSON.stringify(index));
  assert.deepEqual(index.value.matches(4, 5), { ok: true, value: true });
  assert.deepEqual(index.value.matches(5, 4), { ok: true, value: true });
  for (const id of [7, 9, 11, 12, 13])
    assert.deepEqual(
      index.value.matches(4, id),
      { ok: true, value: false },
      String(id),
    );
});
test("managed contract comparisons reject invalid graphs/roots and bound work", () => {
  assert.equal(
    compiler.createManagedTypeContractIndex([
      { kind: "array", element: 9, readonly: false },
    ]).ok,
    false,
  );
  const index = compiler.createManagedTypeContractIndex(types, 1);
  assert.ok(index.ok);
  assert.equal(index.value.matches(4, 5).ok, false);
  assert.equal(index.value.matches(-1, 4).ok, false);
  assert.equal(index.value.matches(4, 999).ok, false);
  assert.equal(compiler.createManagedTypeContractIndex(types, 0).ok, false);
});

test("signature groups admit exact recursive contracts and reject equal-ABI mismatches", () => {
  const parsed = parseModule(
    createSourceTextView(
      "interface A{readonly value:number;readonly next:A|undefined;}interface B{readonly value:number;readonly next:B|undefined;}interface Wrong{readonly value:string;readonly next:Wrong|undefined;}function a(value:A):A{return value;}function b(value:B):B{return value;}function wrong(value:Wrong):Wrong{return value;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const graph = checked.value;
  function source(name: string) {
    const binding = graph.bindings.bindings.find(
      (binding) => binding.kind === "function" && binding.name === name,
    );
    assert.ok(binding);
    const fn = graph.bindings.functions.find((fn) => fn.node === binding.node);
    assert.ok(fn);
    const type = graph.bindingTypes[binding.id];
    assert.notEqual(type, undefined);
    return { id: fn.id, type: type! };
  }
  const a = source("a"),
    b = source("b"),
    wrong = source("wrong");
  const request = {
    name: "recursive",
    contract: "test.recursive.v1",
    type: a.type,
    functions: [a.id, b.id],
    aliases: [b.type],
  };
  const grouped = compiler.planManagedSignatureGroups(graph, [request]);
  assert.ok(grouped.ok, JSON.stringify(grouped));
  assert.deepEqual(grouped.value[0]?.sourceFunctions, [a.id, b.id]);
  assert.ok(grouped.value[0]?.sourceTypes.includes(a.type));
  assert.ok(grouped.value[0]?.sourceTypes.includes(b.type));
  assert.equal(
    compiler.planManagedSignatureGroups(graph, [
      { ...request, functions: [a.id, wrong.id] },
    ]).ok,
    false,
  );
  assert.equal(
    compiler.planManagedSignatureGroups(graph, [
      { ...request, aliases: [wrong.type] },
    ]).ok,
    false,
  );
  assert.equal(
    compiler.planManagedSignatureGroups(graph, [
      request,
      { ...request, name: "other", contract: "test.other.v1" },
    ]).ok,
    false,
  );
  assert.equal(
    compiler.planManagedSignatureGroups(graph, [
      { ...request, functions: [a.id], aliases: [] },
      {
        name: "same-shape",
        contract: "test.same.v1",
        type: b.type,
        functions: [b.id],
      },
    ]).ok,
    false,
  );
});

test("signature memberships follow lowering direction and both pruning maps", () => {
  const groups = [
    {
      name: "group",
      contract: "test.group.v1",
      sourceFunctions: [4, 8],
      sourceTypes: [2, 5],
    },
  ];
  const types = new Uint32Array(6);
  types[2] = 3;
  types[5] = 3;
  const first = new Uint32Array([3, 0, 1]),
    second = new Uint32Array([2, 0, 1]);
  const lowered = compiler.lowerManagedSignatureGroups(groups, [8, 4], types, [
    first,
    second,
  ]);
  assert.deepEqual(lowered, {
    ok: true,
    value: [{ name: "group", contract: "test.group.v1", functions: [0, 1] }],
  });
  assert.equal(
    compiler.lowerManagedSignatureGroups(groups, [8, 4], undefined).ok,
    false,
  );
  assert.equal(
    compiler.lowerManagedSignatureGroups(groups, [8], types).ok,
    false,
  );
  assert.deepEqual(
    compiler.lowerManagedSignatureGroups(groups, [8, 4], types, [
      new Uint32Array(3),
    ]),
    { ok: true, value: [] },
  );
});

test("signature membership resolves anonymous functions from checked expressions", () => {
  const parsed = parseModule(
    createSourceTextView(
      "export function outer():(value:number)=>number{const first=(value:number):number=>value;const second=(value:number):number=>value+1;return first;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const graph = checked.value,
    children = graph.bindings.functions.filter((fn) => fn.parent !== undefined);
  assert.equal(children.length, 2);
  let type: number | undefined;
  graph.expressions.forEach((candidate, expression) => {
    if (expression === children[0]!.node) type = candidate;
  });
  assert.notEqual(type, undefined);
  const plan = compiler.planManagedSignatureGroups(graph, [
    {
      name: "callbacks",
      contract: "test.callbacks.v1",
      type: type!,
      functions: children.map((fn) => fn.id),
    },
  ]);
  assert.ok(plan.ok, JSON.stringify(plan));
  assert.deepEqual(
    plan.value[0]?.sourceFunctions,
    children.map((fn) => fn.id),
  );
  assert.equal(
    compiler.planManagedSignatureGroups(graph, [
      {
        name: "duplicates",
        contract: "test.duplicates.v1",
        type: type!,
        functions: [children[0]!.id, children[0]!.id],
      },
    ]).ok,
    false,
  );
});

test("ordered contracts preserve callable capabilities, collection mutability and union variants", () => {
  const graph: Type[] = [
    { kind: "number" },
    { kind: "number" },
    { kind: "string" },
    { kind: "undefined" },
    { kind: "object", properties: [], call: 9, construct: 10 },
    { kind: "array", element: 4, readonly: false },
    { kind: "array", element: 4, readonly: true },
    { kind: "set", element: 4, readonly: true },
    { kind: "map", key: 2, value: 5, readonly: false },
    { kind: "function", parameters: [], result: 0 },
    { kind: "function", parameters: [0], result: 4 },
    { kind: "union", members: [0, 3] },
    { kind: "union", members: [1, 3] },
    { kind: "union", members: [3, 0] },
    { kind: "literal", value: false },
    { kind: "literal", value: false },
    { kind: "literal", value: true },
    { kind: "map", key: 2, value: 6, readonly: false },
    { kind: "map", key: 2, value: 5, readonly: true },
    { kind: "set", element: 4, readonly: false },
    { kind: "object", properties: [], call: 9, construct: 10 },
    { kind: "object", properties: [] },
    { kind: "array", element: 20, readonly: false },
  ];
  const index = compiler.createManagedTypeContractIndex(graph);
  assert.ok(index.ok, JSON.stringify(index));
  for (const [left, right] of [
    [4, 20],
    [5, 22],
    [11, 12],
    [14, 15],
  ])
    assert.deepEqual(index.value.matches(left!, right!), {
      ok: true,
      value: true,
    });
  for (const [left, right] of [
    [4, 21],
    [5, 6],
    [7, 19],
    [8, 17],
    [8, 18],
    [11, 13],
    [14, 16],
  ])
    assert.deepEqual(index.value.matches(left!, right!), {
      ok: true,
      value: false,
    });
});
test("readonly diagnostic matching cannot poison exact membership caches", () => {
  const types: Type[] = [
    { kind: "number" },
    { kind: "string" },
    {
      kind: "object",
      properties: [{ name: "value", type: 0, readonly: true }],
    },
    {
      kind: "object",
      properties: [{ name: "value", type: 0, readonly: false }],
    },
    {
      kind: "object",
      properties: [{ name: "value", type: 1, readonly: false }],
    },
  ];
  const index = compiler.createManagedTypeContractIndex(types);
  assert.ok(index.ok);
  assert.deepEqual(index.value.matches(2, 3), { ok: true, value: false });
  assert.deepEqual(index.value.matchesIgnoringReadonly(2, 3), {
    ok: true,
    value: true,
  });
  assert.deepEqual(index.value.matches(3, 2), { ok: true, value: false });
  assert.deepEqual(index.value.matchesIgnoringReadonly(2, 4), {
    ok: true,
    value: false,
  });
});
