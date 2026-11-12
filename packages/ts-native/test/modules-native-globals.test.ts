import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { prepareNativeGlobals } from "../src/modules/native-globals.ts";
function prepare(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const bound = bindModule(parsed.value, ["Codec"]);
  assert.ok(bound.ok);
  return prepareNativeGlobals(parsed.value, bound.value, [
    { global: "Codec", factory: "factory" },
  ]);
}
test("global factories preserve argument evaluation and lexical shadowing", () => {
  const result = prepare(
    "function factory(n:number):number{return n;} function run():number{return new Codec(factory(2));} function shadow(Codec:number):number{return new Codec(3);}",
  );
  assert.ok(result.ok);
  const run = result.value.statements[1],
    shadow = result.value.statements[2];
  assert.equal(run?.kind, "function");
  assert.equal(shadow?.kind, "function");
  if (run?.kind !== "function" || shadow?.kind !== "function")
    throw "function invariant";
  assert.ok(run.body.kind === "block" && shadow.body.kind === "block");
  const r = run.body.statements[0],
    s = shadow.body.statements[0];
  assert.equal(r?.kind, "return");
  assert.equal(s?.kind, "return");
  if (r?.kind !== "return" || s?.kind !== "return") throw "return invariant";
  assert.equal(r.expression?.kind, "call");
  assert.equal(s.expression?.kind, "new");
  if (r.expression?.kind !== "call") throw "call invariant";
  assert.equal(r.expression.callee.kind, "identifier");
  assert.equal(r.expression.arguments[0]?.kind, "call");
});
test("factory names cannot be captured by a source local", () => {
  assert.equal(
    prepare(
      "function factory(n:number):number{return n;} function run(factory:number):number{return new Codec(1);}",
    ).ok,
    false,
  );
});

function consoleCalls(text: string): string[] {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const bound = bindModule(parsed.value, [
    "console",
    "x",
    "y",
    "z",
    "t",
    "rest",
  ]);
  assert.ok(bound.ok);
  const result = prepareNativeGlobals(parsed.value, bound.value, [], {
    log: "log$native",
    error: "error$native",
  });
  assert.ok(result.ok);
  return result.value.statements.map((statement) => {
    if (statement.kind !== "expression") return statement.kind;
    const call = statement.expression;
    if (call.kind !== "call" || call.callee.kind === "member")
      return "unchanged";
    if (call.callee.kind !== "identifier") return "other";
    const argument = call.arguments[0];
    return (
      call.callee.name +
      ":" +
      (argument?.kind === "template-expression"
        ? argument.parts.join("|") + "/" + argument.substitutions.length
        : (argument?.kind ?? "none"))
    );
  });
}

test("console output calls become runtime line writes of joined arguments", () => {
  assert.deepEqual(
    consoleCalls(
      'console.log("a", 1, x); console.error(); console.warn(y); console.info(z); console.table(t); console.log(...rest); console?.log(1);',
    ),
    [
      "log$native:| | |/3",
      "error$native:string",
      "error$native:|/1",
      "log$native:|/1",
      "unchanged",
      "unchanged",
      "unchanged",
    ],
  );
});

test("a shadowing console binding keeps its own calls", () => {
  assert.deepEqual(
    consoleCalls(
      "function f(console: { log(x: number): void }) { console.log(1); } console.log(2);",
    ).slice(1),
    ["log$native:|/1"],
  );
});
