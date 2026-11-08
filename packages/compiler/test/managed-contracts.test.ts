import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Type } from "@tint/typescript/types";
import * as compiler from "../src/native/index.ts";
import {
  createManagedTypeContractCache,
  checkedTypeSystem,
  managedFunctionType,
  managedTypeContracts,
} from "../src/native/managed-contracts.ts";
import { createTypeSystem } from "@tint/typescript/types";
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

test("an owned immutable-graph cache reuses validation and bounds retained graphs", () => {
  const cache = createManagedTypeContractCache();
  const first = cache.get(types),
    again = cache.get(types);
  assert.ok(first.ok && again.ok);
  assert.equal(again.value, first.value);
  assert.equal(first.value.sourceTypes, types);
  assert.equal(first.value.assignable(4, 5), true);
  const copied = structuredClone(types),
    other = cache.get(copied);
  assert.ok(other.ok);
  assert.notEqual(other.value, first.value);
  assert.equal(other.value.sourceTypes, copied);
  const returned = cache.get(types);
  assert.ok(returned.ok);
  assert.notEqual(returned.value, first.value);
  const limited = cache.get(types, 1);
  assert.ok(limited.ok);
  assert.equal(limited.value.matches(4, 5).ok, false);
  const normal = cache.get(types);
  assert.ok(normal.ok);
  assert.deepEqual(normal.value.matches(4, 5), { ok: true, value: true });
});

test("contract-cache ownership separates different graphs and does not cache mutable callers globally", () => {
  const first = createManagedTypeContractCache(),
    second = createManagedTypeContractCache();
  const a = first.get(types),
    b = second.get(types);
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.value, b.value);
  assert.equal(
    first.get([{ kind: "array", element: 99, readonly: false }]).ok,
    false,
  );
  const mutable: Type[] = [{ kind: "number" }, { kind: "string" }];
  const original = compiler.createManagedTypeContractIndex(mutable);
  assert.ok(original.ok);
  mutable[1] = { kind: "number" };
  const fresh = compiler.createManagedTypeContractIndex(mutable);
  assert.ok(fresh.ok);
  assert.notEqual(fresh.value, original.value);
  assert.deepEqual(fresh.value.matches(0, 1), { ok: true, value: true });
});

test("signature planning reuses a validated graph without rebuilding unrelated type indexes", () => {
  const parsed = parseModule(
    createSourceTextView(
      "function identity(value:number):number{return value;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const fn = checked.value.bindings.functions[0];
  assert.ok(fn);
  const type = managedFunctionType(checked.value, fn.id);
  assert.ok(type !== undefined);
  let reads = 0;
  const graph = {
    ...checked.value,
    types: [
      ...checked.value.types,
      ...Array.from({ length: 256 }, (): Type => ({
        get kind(): "number" {
          reads++;
          return "number";
        },
      })),
    ],
  };
  const cache = createManagedTypeContractCache();
  assert.ok(cache.get(graph.types).ok);
  const requests = [
    { name: "identity", contract: "test.identity", type, functions: [fn.id] },
  ];
  reads = 0;
  const warm = compiler.planManagedSignatureGroups(
    graph,
    requests,
    100000,
    cache,
  );
  assert.ok(warm.ok, JSON.stringify(warm));
  assert.equal(reads, 0);
  const cold = compiler.planManagedSignatureGroups(graph, requests);
  assert.deepEqual(warm, cold);
  assert.ok(reads >= 256);
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

/** The comparison semantics before allocation-free keys and root checks. */
function referenceCompare(
  graph: readonly Type[],
  maxWork: number,
  left: number,
  right: number,
  ignoreReadonly: boolean,
): { ok: true; value: boolean } | { ok: false } {
  const valid = (id: number): boolean =>
    Number.isInteger(id) && id >= 0 && id < graph.length;
  if (!valid(left) || !valid(right)) return { ok: false };
  if (left === right) return { ok: true, value: true };
  const pending = [left, right],
    seen = new Set<string>();
  let work = 0,
    exhausted = false;
  const key = (a: number, b: number): string =>
    a < b ? a + ":" + b : b + ":" + a;
  const done = (
    value: boolean,
  ): { ok: true; value: boolean } | { ok: false } =>
    exhausted ? { ok: false } : { ok: true, value };
  const edge = (a: number | undefined, b: number | undefined): boolean => {
    if (++work > maxWork) {
      exhausted = true;
      return false;
    }
    if (a === undefined || b === undefined) return a === b;
    if (a !== b) pending.push(a, b);
    return true;
  };
  for (let index = 0; index < pending.length; index += 2) {
    if (++work > maxWork) return { ok: false };
    const aId = pending[index]!,
      bId = pending[index + 1]!;
    if (aId === bId) continue;
    const pair = key(aId, bId);
    if (seen.has(pair)) continue;
    seen.add(pair);
    const a = graph[aId]!,
      b = graph[bId]!;
    if (a.kind !== b.kind) return done(false);
    if (a.kind === "literal" && b.kind === "literal") {
      if (a.value !== b.value) return done(false);
    } else if (
      (a.kind === "array" || a.kind === "set") &&
      (b.kind === "array" || b.kind === "set")
    ) {
      if (
        (!ignoreReadonly && a.readonly !== b.readonly) ||
        !edge(a.element, b.element)
      )
        return done(false);
    } else if (a.kind === "map" && b.kind === "map") {
      if (
        (!ignoreReadonly && a.readonly !== b.readonly) ||
        !edge(a.key, b.key) ||
        !edge(a.value, b.value)
      )
        return done(false);
    } else if (a.kind === "union" && b.kind === "union") {
      if (a.members.length !== b.members.length) return done(false);
      for (let i = 0; i < a.members.length; i++)
        if (!edge(a.members[i], b.members[i])) return done(false);
    } else if (a.kind === "object" && b.kind === "object") {
      if (
        a.properties.length !== b.properties.length ||
        !edge(a.call, b.call) ||
        !edge(a.construct, b.construct)
      )
        return done(false);
      for (let i = 0; i < a.properties.length; i++) {
        if (++work > maxWork) return { ok: false };
        const x = a.properties[i]!,
          y = b.properties[i]!;
        if (
          x.name !== y.name ||
          (!ignoreReadonly && x.readonly !== y.readonly) ||
          (x.optional === true) !== (y.optional === true) ||
          !edge(x.type, y.type)
        )
          return done(false);
      }
    } else if (a.kind === "function" && b.kind === "function") {
      if (
        a.parameters.length !== b.parameters.length ||
        (a.minimumArguments ?? a.parameters.length) !==
          (b.minimumArguments ?? b.parameters.length) ||
        !edge(a.receiver, b.receiver) ||
        !edge(a.result, b.result)
      )
        return done(false);
      for (let i = 0; i < a.parameters.length; i++)
        if (!edge(a.parameters[i], b.parameters[i])) return done(false);
    }
  }
  return { ok: true, value: true };
}

test("contract comparisons agree with the reference algorithm under every budget", () => {
  const parsed = parseModule(
    createSourceTextView(
      "interface A{readonly x:number;readonly next:A|undefined;f(v:number):string;}interface B{readonly x:number;readonly next:B|undefined;f(v:number):string;}interface C{x:number;readonly next:C|undefined;f(v:number):string;}interface D{readonly y:number;readonly next:D|undefined;f(v:number):string;}type L=readonly number[];type M=number[];type S=ReadonlySet<string>;type P=Map<string,A>;type Q=ReadonlyMap<string,B>;type U=1|'a'|true;type V=2|'a'|true;function g(a:A,b?:B):C|undefined{return undefined;}function h(a:B,b?:A):C|undefined{return undefined;}function k(this:A,a:B):D{throw 1;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const graph = checked.value.types;
  for (const maxWork of [1, 2, 3, 4, 5, 7, 9, 12, 20, 100000]) {
    const fresh = compiler.createManagedTypeContractIndex(graph, maxWork);
    assert.ok(fresh.ok);
    for (let left = 0; left < graph.length; left++)
      for (let right = 0; right < graph.length; right++)
        for (const ignore of [false, true]) {
          const expected = referenceCompare(
              graph,
              maxWork,
              left,
              right,
              ignore,
            ),
            actual: compiler.ManagedTypeContractComparison = ignore
              ? fresh.value.matchesIgnoringReadonly(left, right)
              : fresh.value.matches(left, right);
          assert.deepEqual(
            actual.ok ? { ok: true, value: actual.value } : { ok: false },
            expected,
            [maxWork, left, right, ignore].join(":"),
          );
        }
  }
});

test("checked graphs publish their own relation system for contract indexes", () => {
  const parsed = parseModule(
    createSourceTextView(
      "interface Node{readonly value:number;readonly next:Node|undefined;}function sum(node:Node|undefined):number{let total=0;while(node!==undefined){total=total+node.value;node=node.next;}return total;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const system = checkedTypeSystem(checked.value);
  assert.ok(system);
  assert.equal(checked.value.typeSystem?.types, checked.value.types);
  const fresh = createTypeSystem(checked.value.types);
  assert.ok(fresh.ok);
  for (let a = 0; a < checked.value.types.length; a++)
    for (let b = 0; b < checked.value.types.length; b++)
      assert.equal(system.assignable(a, b), fresh.value.assignable(a, b));
  // A graph whose types were replaced must not borrow the original system.
  assert.equal(
    checkedTypeSystem({ ...checked.value, types: [...checked.value.types] }),
    undefined,
  );
  let reads = 0;
  const counted = checked.value.types.map(
    (type): Type =>
      new Proxy(type, {
        get(target, key, receiver) {
          reads++;
          return Reflect.get(target, key, receiver);
        },
      }),
  );
  const graph = {
    ...checked.value,
    types: counted,
    typeSystem: { types: counted, system },
  };
  const index = managedTypeContracts(graph);
  assert.ok(index.ok);
  assert.equal(reads, 0, "reusing the checker system skips revalidation");
  assert.equal(index.value.assignable, system.assignable);
});
