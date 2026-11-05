import { functionCallFixtures } from "./function-call-fixtures.ts";
import { receiverSourceFixtures } from "./receiver-source-fixtures.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { emitModule } from "@tint/codegen/aarch64/scalar";

function lower(text: string, duplicate = false) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const entries = checked.value.bindings.functions
    .filter((f) => f.parent === undefined)
    .map((f) => f.id);
  if (duplicate && entries[0] !== undefined) entries.push(entries[0]);
  return lowerModuleEntries(
    checked.value,
    entries,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
}

test("source arrows survive callback parameters and factory returns", () => {
  const lowered = lower(`
    function apply(f: (x: number) => number, x: number): number { return f(x); }
    function factory(): (x: number) => number { return (x: number): number => x + 1; }
    function run(): number { const f = factory(); return apply(f, 41); }
  `);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.equal(lowered.value.module.functions.length, 4);
  const instructions = lowered.value.module.functions.flatMap((f) =>
    f.blocks.flatMap((b) => b.instructions),
  );
  assert.ok(instructions.some((i) => i.kind === "function-new"));
  assert.ok(instructions.some((i) => i.kind === "call-indirect"));
  const native = emitModule(lowered.value.module);
  assert.ok(native.ok, JSON.stringify(native));
});

test("source callbacks synthesize missing ABI contracts and reject uninitialized module function values", () => {
  const missing = lower(`function apply(f:()=>number):number{return f();}`);
  assert.ok(missing.ok, JSON.stringify(missing));
  assert.ok(emitModule(missing.value.module).ok);
  const named = lower(
    `function identity(x:number):number{return x;}function run():(x:number)=>number{return identity;}`,
  );
  assert.ok(!named.ok);
  assert.match(named.error, /hoisted initialization/);
});

test("automatic arrow inclusion preserves root order and duplicate rejection", () => {
  const text = `function factory():(x:number)=>number{return (x:number):number=>x;}function run():number{return factory()(9);}`;
  const result = lower(text);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.entries, [0, 2, 1]);
  assert.ok(emitModule(result.value.module).ok);
  const duplicate = lower(text, true);
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.error, "duplicate entry");
});

test("function and object unions require a runtime-discriminable representation", () => {
  const result = lower(
    `function choose(flag:boolean): (()=>number)|{x:number} {if(flag)return ():number=>1;return {x:1};}`,
  );
  assert.ok(!result.ok);
  assert.match(result.error, /unsupported native representation/);
});

test("source captured parameters lower to shared owned cells", () => {
  const result = lower(`
    function factory(x:number):(delta:number)=>number {
      return (delta:number):number=>{x+=delta;return x;};
    }
    function run():number {const f=factory(7);return f(3)+f(2);}
  `);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    result.value.module.functions.some(
      (f) => f.closureEnvironment !== undefined,
    ),
  );
  assert.ok(
    result.value.module.functions.some((f) =>
      f.blocks.some((b) => b.terminator.kind === "record-cell"),
    ),
  );
  const native = emitModule(result.value.module);
  assert.ok(native.ok, JSON.stringify(native));
});

test("named closures hoist once and retain their captured cells", () => {
  const result = lower(`
    function factory(x:number):(delta:number)=>number {
      x=advance(1);return advance;
      function advance(delta:number):number {x+=delta;return x;}
    }
    function run():number {const f=factory(7);return f(3);}
  `);
  assert.ok(result.ok, JSON.stringify(result));
  const native = emitModule(result.value.module);
  assert.ok(native.ok, JSON.stringify(native));
});

test("captured loop headers use owned per-iteration cells", () => {
  const captured = lower(
    `function factory():()=>number{for(let x=0;x<1;x++){return ():number=>x;}return ():number=>0;}`,
  );
  assert.ok(captured.ok, JSON.stringify(captured));
  assert.ok(emitModule(captured.value.module).ok);
});

test("source methods lower this through a separate receiver slot", () => {
  for (const call of [
    "object.add(23)",
    "(object.add)(23)",
    'object["add"](23)',
    "object.add?.(23) ?? 0",
  ]) {
    const lowered = lower(`
      function run(): number {
        const object = { value: 19, add: function(this: { value: number }, n: number): number { return this.value + n; } };
        return ${call};
      }
    `);
    assert.ok(lowered.ok, call + ": " + JSON.stringify(lowered));
    const module = lowered.value.module;
    assert.equal(
      module.functions.filter((fn) => fn.receiverSlot !== undefined).length,
      1,
    );
    const calls = module.functions
      .flatMap((fn) => fn.blocks.flatMap((block) => block.instructions))
      .filter((op) => op.kind === "call-indirect");
    assert.ok(calls.some((op) => op.receiver !== undefined));
    const native = emitModule(module);
    assert.ok(native.ok, JSON.stringify(native));
  }
});

for (const fixture of receiverSourceFixtures) {
  test("source receiver snapshot: " + fixture.name, () => {
    const lowered = lower(fixture.source);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const native = emitModule(lowered.value.module);
    assert.ok(native.ok, JSON.stringify(native));
  });
}

test("conditional spreads retain fields absent from the other branch", () => {
  const result = lower(`function run(n:number):number {
    const call={...(n===0?{}:{receiver:42}),target:1};
    const copied={...call};
    return copied.receiver??0;
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  const native = emitModule(result.value.module);
  assert.ok(native.ok, JSON.stringify(native));
});

test("spread snapshots preserve heterogeneous optional field encodings", () => {
  const result = lower(`
    type Item={readonly kind:"number";value:number|undefined}|{readonly kind:"object";value:{x:number}|undefined};
    function run(item:Item):number {
      const copy:Item={...item};
      if(copy.kind==="number")return copy.value??42;
      return copy.value?.x??42;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  const native = emitModule(result.value.module);
  assert.ok(native.ok, JSON.stringify(native));
});

test("Function.call separates the explicit receiver from positional arguments", () => {
  for (const call of ["add.call({value:19},23)", "(add.call)({value:19},23)"]) {
    const result = lower(`
      function run():number{
        function add(this:{value:number},n:number):number{return this.value+n;}
        return ${call};
      }
    `);
    assert.ok(result.ok, JSON.stringify(result));
    const native = emitModule(result.value.module);
    assert.ok(native.ok, JSON.stringify(native));
  }
});

for (const fixture of functionCallFixtures) {
  test("explicit receiver call: " + fixture.name, () => {
    const result = lower(fixture.source);
    assert.ok(result.ok, JSON.stringify(result));
    const native = emitModule(result.value.module);
    assert.ok(native.ok, JSON.stringify(native));
  });
}
test("strict explicit receiver calls reject incompatible receiver contracts", () => {
  assert.throws(
    () =>
      lower(`function run():number {
    function read(this:{value:number}):number{return this.value;}
    return read.call(42);
  }`),
    /invalid explicit receiver call/,
  );
});

test("optional Function.call skips receiver and argument evaluation", () => {
  const result = lower(`function run(n:number):number {
    const add:((this:number,x:number)=>number)|undefined=n>0?function(this:number,x:number):number{return this+x;}:undefined;
    let effects=0;
    const result=add?.call((effects++,19),(effects++,23));
    return result===undefined?effects+42:result;
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  const native = emitModule(result.value.module);
  assert.ok(native.ok, JSON.stringify(native));
});

test("an ordinary object method named call retains ordinary receiver semantics", () => {
  const result = lower(`function run():number {
    const object={value:19,call:function(this:{value:number},n:number):number{return this.value+n;}};
    return object.call(23);
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  const native = emitModule(result.value.module);
  assert.ok(native.ok, JSON.stringify(native));
});
