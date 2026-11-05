import test from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import * as syntax from "../src/syntax/index.ts";
import { bindScript } from "../src/binding/index.ts";
function bound(source: string) {
  const parsed = syntax.parseScript(createSourceTextView(source));
  assert.ok(parsed.ok);
  const result = bindScript(parsed.value);
  assert.ok(result.ok);
  return result.value;
}
test("direct eval sites retain their own function and parameter phase", () => {
  const text = "eval(x);function f(a=eval(x)){eval(x);()=>eval(x);}";
  const result = bound(text);
  assert.ok(result.directEvalOwners);
  assert.deepEqual(
    result.directEvalOwners.map((site) => ({
      owner:
        site.owner === undefined
          ? "script"
          : text.slice(site.owner.start, site.owner.end).startsWith("function")
            ? "function"
            : "arrow",
      parameters: site.parameters,
    })),
    [
      { owner: "script", parameters: false },
      { owner: "function", parameters: true },
      { owner: "function", parameters: false },
      { owner: "arrow", parameters: false },
    ],
  );
});
test("a nested function in a parameter default owns its eval independently", () => {
  const result = bound("function f(a=()=>eval(x)){}");
  assert.equal(result.directEvalOwners?.length, 1);
  assert.equal(result.directEvalOwners?.[0]?.parameters, false);
  assert.ok(result.directEvalOwners?.[0]?.owner === result.functions[1]?.node);
});
test("optional, comma, member, new and tagged calls do not mark eval owners", () => {
  const result = bound(
    "function f(){eval?.(x);(0,eval)(x);globalThis.eval(x);new eval(x);eval`x`;}",
  );
  assert.equal(result.directEvalOwners?.length ?? 0, 0);
});
test("shared direct-eval predicate recognizes grouped and decoded identifier calls", () => {
  assert.equal(typeof syntax.isDirectEvalCandidate, "function");
  const input = syntax.parseScript(
    createSourceTextView("(eval)(x);(\\u0065val)(x);eval(x)?.y;"),
  );
  assert.ok(input.ok);
  let candidates = 0;
  syntax.rewriteModule(input.value, {
    expression(node) {
      if (syntax.isDirectEvalCandidate(node)) candidates++;
      return node;
    },
  });
  assert.equal(candidates, 3);
});
