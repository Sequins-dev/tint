import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { verify } from "@tint/ir/scalar";
import { lowerModuleEntries } from "../src/closure/lowering/index.ts";

const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
function lower(text: string, sloppyOwner = false) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const module = sloppyOwner
    ? {
        ...parsed.value,
        statements: parsed.value.statements.map((node) =>
          node.kind === "function" ? { ...node, strict: false } : node,
        ),
      }
    : parsed.value;
  const checked = checkClosureModule(module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const output = lowerModuleEntries(checked.value, [0], target, 4096);
  assert.ok(output.ok, JSON.stringify(output));
  assert.deepEqual(verify(output.value.module), { ok: true });
  return output.value.module;
}
test("read-only numeric parameters are captured as payloads without cells", () => {
  const module = lower(
    "function make(value:number):()=>number{return ()=>value;}",
  );
  const closure = module.functions.find(
    (fn) => fn.closureEnvironment !== undefined,
  )!;
  assert.ok(closure);
  const layout = module.records![closure.closureEnvironment!]!;
  assert.equal(layout.fields[0]!.type, "number");
  assert.equal(layout.fields[0]!.stateOffset, undefined);
  assert.ok(
    !closure.blocks.some((block) => block.terminator.kind === "record-cell"),
  );
  const owner = module.functions[0]!;
  assert.equal(
    owner.blocks
      .flatMap((block) => block.instructions)
      .filter((op) => op.kind === "record-new").length,
    1,
  );
});
test("writes in either owner or nested closure retain shared parameter cells", () => {
  for (const text of [
    "function make(value:number):()=>number{const read:()=>number=()=>value;value=9;return read;}",
    "function make(value:number):()=>number{return ()=>++value;}",
    "function make(value:number):()=>number{return ()=>{value+=1;return value;};}",
    "function make(value:number):()=>number{const read:()=>number=()=>value;var value:number=9;return read;}",
  ]) {
    const module = lower(text);
    const closure = module.functions.find(
      (fn) => fn.closureEnvironment !== undefined,
    )!;
    assert.equal(
      module.records![closure.closureEnvironment!]!.fields[0]!.type,
      "reference",
    );
    assert.ok(
      closure.blocks.some((block) => block.terminator.kind === "record-cell"),
    );
  }
});
test("parameter defaults and captured local TDZ retain cells", () => {
  for (const text of [
    "function make(value:number=42):()=>number{return ()=>value;}",
    "function make():()=>number{const read:()=>number=()=>value;const value:number=42;return read;}",
  ]) {
    const module = lower(text);
    const closure = module.functions.find(
      (fn) => fn.closureEnvironment !== undefined,
    )!;
    assert.equal(
      module.records![closure.closureEnvironment!]!.fields[0]!.type,
      "reference",
    );
  }
});
test("forwarded numeric captures retain payload representation", () => {
  const module = lower(
    "function make(value:number):()=>()=>number{return ()=>()=>value;}",
  );
  const closures = module.functions.filter(
    (fn) => fn.closureEnvironment !== undefined,
  );
  assert.equal(closures.length, 2);
  for (const closure of closures)
    assert.equal(
      module.records![closure.closureEnvironment!]!.fields[0]!.type,
      "number",
    );
});
test("a sloppy function inside a linked module retains shared cells", () => {
  const module = lower(
    "function make(value:number):()=>number{return ()=>value;}",
    true,
  );
  const closure = module.functions.find(
    (fn) => fn.closureEnvironment !== undefined,
  )!;
  assert.equal(
    module.records![closure.closureEnvironment!]!.fields[0]!.type,
    "reference",
  );
});
test("initialized never-written locals are captured as payloads without cells", () => {
  for (const text of [
    "function make():()=>number{const value:number=40+2;return ()=>value;}",
    "function make():()=>number{let value:number=42;return ()=>value;}",
    "function make():()=>number{const box:{v:number}={v:42};return ()=>box.v;}",
    "function make():()=>number{const a:number=1,read:()=>number=()=>a;return read;}",
  ]) {
    const module = lower(text);
    const closure = module.functions.find(
      (fn) => fn.closureEnvironment !== undefined,
    )!;
    assert.ok(
      !closure.blocks.some((block) => block.terminator.kind === "record-cell"),
      text,
    );
    // The owner keeps the binding in a local: no cell initialization.
    const owner = module.functions[0]!;
    assert.ok(
      !owner.blocks.some((block) => block.terminator.kind === "record-cell"),
      text,
    );
  }
});
test("locals captured before initialization can be observed keep cells", () => {
  for (const text of [
    // A hoisted declaration is created at scope entry, before the const.
    "function make():()=>number{const value:number=42;function read():number{return value;}return read;}",
    // The closure is created inside the binding's own initializer.
    "function make():()=>number{const read:()=>number=()=>read();return read;}",
  ]) {
    const module = lower(text);
    const closure = module.functions.find(
      (fn) => fn.closureEnvironment !== undefined,
    )!;
    assert.ok(
      closure.blocks.some((block) => block.terminator.kind === "record-cell"),
      text,
    );
  }
});
