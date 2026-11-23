import { syntaxShapeJSON } from "./syntax-shape.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, rewriteModule } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
function lower(source: string) {
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok);
  const result = lowerScript(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
for (const source of [
  "eval(x);",
  "(eval)(x);",
  "((eval))(x);",
  "\\u0065val(x);",
  "ev\\u0061l(x);",
  "eval(x)?.y;",
  "(eval(x))?.y;",
  "eval(x)(y);",
  "eval(x)(y)?.z;",
  "with(w)eval(x);",
])
  test("direct eval candidate guard: " + source, () => {
    const module = lower(source),
      calls: string[] = [];
    rewriteModule(module, {
      expression(node) {
        if (node.kind === "call" && node.callee.kind === "identifier")
          calls.push(node.callee.name);
        return node;
      },
    });
    assert.equal(calls.filter((x) => x === "callEvalCandidate").length, 1);
    assert.ok(
      module.imports.some((x) =>
        x.bindings.some((y) => y?.imported === "callEvalCandidate"),
      ),
    );
  });
for (const source of [
  "eval?.(x);",
  "(0,eval)(x);",
  "globalThis.eval(x);",
  "o.eval(x);",
  "eval`x`;",
  "new eval(x);",
])
  test("indirect eval shape has no guard: " + source, () => {
    const module = lower(source);
    assert.ok(
      !module.imports.some((x) =>
        x.bindings.some((y) => y?.imported === "callEvalCandidate"),
      ),
    );
    rewriteModule(module, {
      expression(node) {
        if (node.kind === "call" && node.callee.kind === "identifier")
          assert.notEqual(node.callee.name, "callEvalCandidate");
        return node;
      },
    });
  });
test("eval guard receives the evaluated argument list, witness and running realm", () => {
  const module = lower("eval(first(),...rest,last());");
  let args: unknown;
  rewriteModule(module, {
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === "callEvalCandidate"
      )
        args = node.arguments;
      return node;
    },
  });
  assert.ok(Array.isArray(args));
  assert.equal(args.length, 7);
  assert.equal(args[3].kind, "member");
  assert.equal(args[3].property, "object");
  assert.equal(args[4].kind, "identifier");
  assert.equal(args[4].name, "$errors");
});
test("indirect-only lowering keeps its caller-policy output contract", () => {
  const module = lower(
    "(0,eval)(1);eval?.(1);(eval)?.(1);this.eval(1);var e=eval;e(1);eval`x`;new eval(1);",
  );
  assert.equal(
    createHash("sha256").update(syntaxShapeJSON(module)).digest("hex"),
    "ceedef371e6ed757ad92e00dfaca758dc6ffe7f6cf4dfd34d2e41776a9c9d975",
  );
  // No indirect form may reach the direct-eval guard.
  assert.doesNotMatch(JSON.stringify(module), /"name":"callEvalCandidate"/);
});
