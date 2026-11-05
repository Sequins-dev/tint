import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verify } from "@tint/ir/scalar";
import * as compiler from "@tint/compiler/native";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const result = parseModule(source.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
const frame =
  "interface Frame{readonly first:()=>unknown;readonly second:()=>unknown;readonly input:unknown}";
test("checked native entry preparation retains typed frame layouts and indirect helper witnesses", () => {
  const source = parse(
    frame +
      "export function entry(frame:Frame):unknown{const value=frame.first();frame.second();return value;}",
  );
  const prepared = compiler.prepareNativeFunctionEntry(source, "entry");
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const { module, entryId, fn } = prepared.value;
  assert.equal(module.functions[entryId], fn);
  assert.equal(fn.returnType, "general");
  assert.deepEqual(
    fn.parameters.map((slot) => fn.slots[slot]),
    ["reference"],
  );
  assert.deepEqual(verify(module), { ok: true });
  assert.ok(
    module.records?.some(
      (record) => record.byteLength === 48 && record.fields.length === 3,
    ),
  );
  assert.equal(
    fn.blocks
      .flatMap((block) => block.instructions)
      .filter((op) => op.kind === "call-indirect").length,
    2,
  );
  assert.equal(
    compiler.compileClosedFunction(source, "entry").ok,
    false,
    "managed preparation must not weaken the borrowed execution profile",
  );
});
test("checked entry preparation supports control flow and captured frame references", () => {
  const result = compiler.prepareNativeFunctionEntry(
    parse(
      frame +
        "export function entry(frame:Frame):unknown{const read=():unknown=>frame.first();let result:unknown=undefined;for(let i=0;i<2;i++){result=read();}return result;}",
    ),
    "entry",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.functions.some(
      (fn) => fn.closureEnvironment !== undefined,
    ),
  );
});
test("checked entry preparation rejects module execution and hidden environment requirements", () => {
  for (const text of [
    "const state=1;export function entry():number{return state;}",
    "import {value} from 'other';export function entry():number{return value;}",
  ]) {
    const result = compiler.prepareNativeFunctionEntry(parse(text), "entry");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.stage, "profile");
  }
  assert.equal(
    compiler.prepareNativeFunctionEntry(
      parse("function other():number{return 1;}"),
      "entry",
    ).ok,
    false,
  );
});

test("requested record identities follow both reachability compactions", () => {
  const source = parse(`interface Unused {readonly skipped:number;}
function unused(value:Unused):number{return value.skipped;}
interface Frame {readonly value:number;}
type Alias=Frame;
export function entry(frame:Frame):number{return frame.value;}`);
  const result = compiler.prepareNativeFunctionEntry(source, "entry", {
    recordTypes: true,
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.recordTypes);
  assert.deepEqual(
    result.value.recordTypes.filter(
      (item) => item.name === "Frame" || item.name === "Alias",
    ),
    [
      { name: "Frame", record: 0 },
      { name: "Alias", record: 0 },
    ],
  );
  assert.ok(!result.value.recordTypes.some((item) => item.name === "Unused"));
  assert.equal(result.value.module.records?.length, 1);
  const ordinary = compiler.prepareNativeFunctionEntry(source, "entry");
  assert.ok(ordinary.ok);
  assert.equal(ordinary.value.recordTypes, undefined);
});

test("semantic callback witnesses distinguish record types with the same machine encoding", () => {
  const source =
    parse(`function unused(value:number):number{return value;}interface Left{readonly left:number;}interface Right{readonly right:number;}
type ReadLeft=(value:Left)=>unknown;type LeftAlias=ReadLeft;
type ReadRight=(value:Right)=>unknown;
interface Frame{readonly first:ReadLeft;readonly second:ReadRight;}
export function entry(frame:Frame,left:Left,right:Right):unknown{const result=frame.first(left);frame.second(right);return result;}`);
  const result = compiler.prepareNativeFunctionEntry(source, "entry", {
    signatureTypes: true,
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.signatureTypes);
  const left = result.value.signatureTypes.find(
    (item) => item.name === "ReadLeft",
  );
  const alias = result.value.signatureTypes.find(
    (item) => item.name === "LeftAlias",
  );
  const right = result.value.signatureTypes.find(
    (item) => item.name === "ReadRight",
  );
  assert.ok(left && right && alias);
  assert.equal(left.witness, alias.witness);
  assert.notEqual(left.witness, right.witness);
  const first = result.value.module.functions[left.witness]!,
    second = result.value.module.functions[right.witness]!;
  assert.deepEqual(
    first.parameters.map((slot) => first.slots[slot]),
    ["reference"],
  );
  assert.deepEqual(
    second.parameters.map((slot) => second.slots[slot]),
    ["reference"],
  );
  assert.equal(first.returnType, second.returnType);
  const targets = result.value.fn.blocks
    .flatMap((block) => block.instructions)
    .filter((op) => op.kind === "call-indirect")
    .map((op) => op.target);
  assert.deepEqual(new Set(targets), new Set([left.witness, right.witness]));
  const ordinary = compiler.prepareNativeFunctionEntry(source, "entry");
  assert.ok(ordinary.ok);
  assert.equal(ordinary.value.signatureTypes, undefined);
});

test("semantic witnesses also follow explicit receiver calls", () => {
  const source = parse(
    `interface Value{readonly value:number;}type Read=(value:Value)=>unknown;interface Frame{readonly read:Read;}export function entry(frame:Frame,value:Value):unknown{return frame.read.call(undefined,value);}`,
  );
  const result = compiler.prepareNativeFunctionEntry(source, "entry", {
    signatureTypes: true,
  });
  assert.ok(result.ok, JSON.stringify(result));
  const read = result.value.signatureTypes?.find(
    (item) => item.name === "Read",
  );
  assert.ok(read);
  const call = result.value.fn.blocks
    .flatMap((block) => block.instructions)
    .find((op) => op.kind === "call-indirect");
  assert.ok(call?.kind === "call-indirect");
  assert.equal(call.target, read.witness);
});

test("entry selection uses native identities when earlier functions contain nested closures", () => {
  const source = parse(
    `function other():number{const nested=():number=>19;return nested();}interface Frame{readonly read:()=>unknown;}export function entry(frame:Frame):unknown{return frame.read();}`,
  );
  const result = compiler.prepareNativeFunctionEntry(source, "entry");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.fn.returnType, "general");
  assert.deepEqual(
    result.value.fn.parameters.map((slot) => result.value.fn.slots[slot]),
    ["reference"],
  );
  assert.ok(
    result.value.fn.blocks.some((block) =>
      block.instructions.some((op) => op.kind === "call-indirect"),
    ),
  );
});
