import { test } from "node:test";
import assert from "node:assert/strict";
import * as reify from "../src/reify/index.ts";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, type Statement } from "@tint/typescript/syntax";
import { resolveInterfaceTypes } from "@tint/typescript/checker";
import type { Type } from "@tint/typescript/types";
function roundtrip(types: readonly Type[], roots: readonly number[]) {
  const result = reify.reifyTypes(types, roots, "$T");
  assert.ok(result.ok, JSON.stringify(result));
  const printed = reify.printReifiedTypes(result.value.declarations);
  assert.ok(printed.ok, JSON.stringify(printed));
  const parsed = parseModule(createSourceTextView(printed.value));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(
    parsed.value.statements.length,
    result.value.declarations.length,
  );
  const resolved = resolveInterfaceTypes(parsed.value, result.value.roots);
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const second = reify.printReifiedTypes(parsed.value.statements);
  assert.deepEqual(second, printed);
  return {
    printed: printed.value,
    resolved: resolved.value,
    roots: result.value.roots,
  };
}
test("reified declaration text preserves recursive records, mutability and collections", () => {
  const r = roundtrip(
    [
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
    ],
    [3, 1],
  );
  const object = r.resolved.types[r.resolved.annotations.get(r.roots[1]!)!];
  assert.equal(object?.kind, "object");
  assert.ok(object?.kind === "object");
  assert.deepEqual(
    object.properties.map((p) => [p.name, p.readonly, p.optional]),
    [
      ["value", false, undefined],
      ["next", true, true],
    ],
  );
});
test("reified text quotes UTF16 literals and property names without injecting source", () => {
  const value = '";export const injected=1;//\n\u0000\u2028\ud800😀';
  const r = roundtrip(
    [
      { kind: "literal", value },
      {
        kind: "object",
        properties: [{ name: value, type: 0, readonly: true }],
      },
      { kind: "literal", value: -0 },
    ],
    [1, 2],
  );
  assert.match(r.printed, /\\ud800/);
  assert.match(r.printed, /\\u2028/);
  const object = r.resolved.types[r.resolved.annotations.get(r.roots[0]!)!];
  assert.ok(object?.kind === "object");
  assert.equal(object.properties[0]?.name, value);
  const zero = r.resolved.types[r.resolved.annotations.get(r.roots[1]!)!];
  assert.ok(zero?.kind === "literal");
  assert.ok(Object.is(zero.value, -0));
});
test("function aliases preserve optional arguments, receiver, call and construct signatures", () => {
  const r = roundtrip(
    [
      { kind: "number" },
      { kind: "undefined" },
      { kind: "union", members: [0, 1] },
      { kind: "object", properties: [] },
      {
        kind: "function",
        parameters: [2],
        minimumArguments: 0,
        result: 0,
        receiver: 3,
      },
      { kind: "function", parameters: [0], result: 3 },
      { kind: "object", properties: [], call: 4, construct: 5 },
    ],
    [6],
  );
  const object = r.resolved.types[r.resolved.annotations.get(r.roots[0]!)!];
  assert.ok(object?.kind === "object");
  assert.notEqual(object.call, undefined);
  assert.notEqual(object.construct, undefined);
  const call = r.resolved.types[object.call!];
  assert.ok(call?.kind === "function");
  assert.equal(call.minimumArguments, 0);
  assert.notEqual(call.receiver, undefined);
});
test("declaration serialization rejects executable statements and invalid generated names", () => {
  const parsed = parseModule(createSourceTextView("const sideEffect=42;"));
  assert.ok(parsed.ok);
  assert.equal(reify.printReifiedTypes(parsed.value.statements).ok, false);
  const invalid: Statement = {
    start: 0,
    end: 0,
    kind: "type-alias",
    name: "T;injected",
    exported: false,
    type: { start: 0, end: 0, kind: "named", name: "number" },
  };
  assert.equal(reify.printReifiedTypes([invalid]).ok, false);
});

test("reifies string index signatures and Record origins", () => {
  const r = roundtrip(
    [
      { kind: "number" },
      {
        kind: "object",
        properties: [],
        stringIndex: { type: 0, readonly: true, origin: "signature" },
      },
      {
        kind: "object",
        properties: [],
        stringIndex: { type: 0, readonly: false, origin: "record" },
      },
    ],
    [1, 2],
  );
  for (const [i, origin] of ["signature", "record"].entries()) {
    const type = r.resolved.types[r.resolved.annotations.get(r.roots[i]!)!];
    assert.ok(type?.kind === "object");
    assert.equal(type.stringIndex?.origin, origin);
    assert.equal(type.stringIndex?.readonly, i === 0);
  }
});

test("reifies fixed entry pairs and preserves their positions", () => {
  const r = roundtrip(
    [
      { kind: "string" },
      { kind: "number" },
      { kind: "union", members: [0, 1] },
      {
        kind: "array",
        realmArray: true,
        tupleElements: [0, 1],
        element: 2,
        readonly: false,
      },
      { kind: "array", realmArray: true, element: 3, readonly: false },
    ],
    [4],
  );
  const outer = r.resolved.types[r.resolved.annotations.get(r.roots[0]!)!];
  assert.ok(outer?.kind === "array" && outer.realmArray === true);
  const pair = r.resolved.types[outer.element];
  assert.ok(pair?.kind === "array" && pair.realmArray === true);
  assert.deepEqual(
    pair.tupleElements?.map((id) => r.resolved.types[id]?.kind),
    ["string", "number"],
  );
});
