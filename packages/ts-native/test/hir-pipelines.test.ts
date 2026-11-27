import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, type Expression } from "@tint/typescript/syntax";
import {
  planPipeline,
  pureCallback,
  type PipelineFacts,
} from "../src/hir/pipelines.ts";

/** The initializer of the module's first declaration. */
function expression(text: string): Expression {
  const parsed = parseModule(
    createSourceTextView("const value = " + text + ";"),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const statement = parsed.value.statements[0];
  assert.ok(statement?.kind === "variable");
  const declaration = statement.declarations[0];
  assert.ok(
    declaration !== undefined &&
      declaration.kind !== "object-binding" &&
      declaration.kind !== "array-binding",
  );
  assert.ok(declaration.initializer !== undefined);
  return declaration.initializer;
}
/** Builtins by method name, as the checker would resolve them on lists. */
function facts(parameters: number = 1): PipelineFacts {
  const methods = new Map<string, string>([
    ["filter", "list-filter"],
    ["map", "list-map"],
    ["some", "indexed-some"],
    ["every", "indexed-every"],
    ["find", "indexed-find"],
    ["findIndex", "indexed-find-index"],
    ["forEach", "indexed-for-each"],
    ["reduce", "indexed-reduce"],
  ]);
  return {
    builtin: (node) => {
      if (node.kind === "call" && node.callee.kind === "member")
        return methods.get(node.callee.property);
      if (node.kind === "member" && node.property === "length")
        return "list-length";
      return undefined;
    },
    callbackParameters: () => parameters,
    listSource: () => true,
  };
}
function describe(text: string, parameters?: number): string | undefined {
  const plan = planPipeline(expression(text), facts(parameters));
  return plan === undefined
    ? undefined
    : [...plan.stages.map((stage) => stage.kind), plan.sink.kind].join(" > ");
}

test("filter into map fuses into one collecting loop", () => {
  assert.equal(
    describe("xs.filter((x) => x > 1).map((x) => x * 2)"),
    "filter > map > collect",
  );
});

test("length of a filtered list becomes a count without a list", () => {
  assert.equal(describe("xs.filter((x) => x.ok).length"), "filter > count");
  assert.equal(
    describe("(xs.map((x) => x.n).filter((n) => n > 0)).length"),
    "map > filter > count",
  );
});

test("short-circuit sinks fuse over pure stages", () => {
  assert.equal(describe("xs.map((x) => x.n).some((n) => n > 2)"), "map > some");
  assert.equal(
    describe("xs.filter((x) => x.n > 0).findIndex((x) => x.id === 3)"),
    "filter > find-index",
  );
});

test("single operations are left to the per-call lowering", () => {
  assert.equal(describe("xs.filter((x) => x > 1)"), undefined);
  assert.equal(
    describe("xs.map((x) => x).length".replace(".map((x) => x)", "")),
    undefined,
  );
});

test("only the first stage may have effects", () => {
  assert.equal(
    describe("xs.filter((x) => log(x)).map((x) => x * 2)"),
    "filter > map > collect",
  );
  assert.equal(
    describe("xs.filter((x) => x > 0).map((x) => log(x))"),
    undefined,
  );
  assert.equal(
    describe("xs.map((x) => (total += x)).filter((x) => x > 0)"),
    "map > filter > collect",
  );
});

test("short-circuit sinks never skip an effectful stage", () => {
  assert.equal(describe("xs.map((x) => log(x)).some((x) => x > 0)"), undefined);
});

test("later callbacks cannot observe the intermediate list", () => {
  assert.equal(
    describe("xs.filter((x) => x > 0).map((x, i, list) => list.length)", 3),
    undefined,
  );
});

test("purity admits reads, arithmetic and Math, and rejects effects", () => {
  assert.ok(
    pureCallback(expression("(o) => o.price * o.quantity > threshold")),
  );
  assert.ok(pureCallback(expression("(o) => { return Math.max(o.a, o.b); }")));
  assert.ok(pureCallback(expression("(o) => (o.a ? `${o.b}` : o.c)")));
  assert.ok(!pureCallback(expression("(o) => Math.random() > o")));
  assert.ok(!pureCallback(expression("(o) => o.count++")));
  assert.ok(!pureCallback(expression("(o) => f(o)")));
  assert.ok(!pureCallback(expression("(o) => { log(o); return o; }")));
  assert.ok(!pureCallback(expression("check")));
});

test("reduce fuses with pure callback and pure initial value", () => {
  assert.equal(
    describe(
      "xs.map((x) => x * 2).filter((x) => x > 2).reduce((a, b) => a + b, 0)",
      2,
    ),
    "map > filter > reduce",
  );
  assert.equal(
    describe("xs.filter((x) => x > 0).reduce((a, b, i) => a + b + i)", 3),
    "filter > reduce",
  );
  // 4th parameter observes the intermediate array: must stay unfused.
  assert.equal(
    describe(
      "xs.filter((x) => x > 0).reduce((a, b, i, arr) => a + arr.length, 0)",
      4,
    ),
    undefined,
  );
  // Impure initial value or callback must stay unfused to preserve order.
  assert.equal(
    describe("xs.map((x) => x * 2).reduce((a, b) => a + b, init())", 2),
    undefined,
  );
  assert.equal(
    describe("xs.map((x) => x * 2).reduce((a, b) => log(a + b), 0)", 2),
    undefined,
  );
});
