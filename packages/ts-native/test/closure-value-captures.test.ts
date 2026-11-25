import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
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
function lower(text: string, sloppyOwner = false, valueHint?: string) {
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
  const input =
    valueHint === undefined
      ? module
      : rewriteModule(module, {
          statement(node) {
            return node.kind !== "variable"
              ? node
              : {
                  ...node,
                  declarations: node.declarations.map((declaration) =>
                    declaration.kind !== "object-binding" &&
                    declaration.kind !== "array-binding" &&
                    declaration.name === valueHint
                      ? { ...declaration, capture: "value" }
                      : declaration,
                  ),
                };
          },
        });
  const checked = checkClosureModule(input);
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
    // A hoisted declaration referred to before the const stays at scope
    // entry, before the const is initialized.
    "function make():()=>number{const early:()=>number=()=>read();const value:number=42;function read():number{return value;}return early;}",
    // An early helper reaches a sibling that captures the const: both stay
    // at scope entry.
    "function make():()=>number{const early:()=>number=()=>a();const value:number=42;function a():number{return b();}function b():number{return value;}return early;}",
    // The closure is created inside the binding's own initializer.
    "function make():()=>number{const read:()=>number=()=>read();return read;}",
  ]) {
    const module = lower(text);
    // The closure reading the const (not one that only captures a function
    // declaration by value) keeps its cell.
    assert.ok(
      module.functions.some(
        (fn) =>
          fn.closureEnvironment !== undefined &&
          fn.blocks.some((block) => block.terminator.kind === "record-cell"),
      ),
      text,
    );
  }
});

function cellAccesses(module: ReturnType<typeof lower>): boolean {
  return module.functions.some((fn) =>
    fn.blocks.some((block) => block.terminator.kind === "record-cell"),
  );
}
test("never-reassigned function declarations are captured by value once created", () => {
  for (const text of [
    // Created at scope entry, before the arrow that captures it.
    "function make(n:number):()=>number{function read():number{return n;}return ()=>read();}",
    // Both sink past the const; the earlier declaration is created first.
    "function make():()=>number{const base:number=1;function read():number{return base;}function outer():number{return read()+1;}return outer;}",
  ]) {
    const module = lower(text);
    assert.ok(
      module.functions.some((fn) => fn.closureEnvironment !== undefined),
      text,
    );
    assert.equal(cellAccesses(module), false, text);
  }
});

test("function declarations keep cells when a captor may be created first", () => {
  // Both sink past the const, and the captor precedes the declaration it
  // calls: it is created first, so it shares a cell.
  const module = lower(
    "function make():()=>number{const base:number=1;function outer():number{return read()+1;}function read():number{return base;}return outer;}",
  );
  assert.equal(cellAccesses(module), true);
});

test("hoisted declarations sink past the locals they capture", () => {
  for (const text of [
    "function make():()=>number{const value:number=42;function read():number{return value;}return read;}",
    // A helper called partway through does not hold back the others.
    "function make():()=>number{const a:number=1;function first():number{return a;}const b:number=first();const c:number=2;function second():number{return c+b;}return second;}",
    // Sibling declarations refer to each other only from their own bodies.
    "function make(flag:boolean):()=>number{function a():number{return b()+base;}const base:number=1;function b():number{return flag?base:2;}return a;}",
  ]) {
    const module = lower(text);
    for (const closure of module.functions.filter(
      (fn) => fn.closureEnvironment !== undefined,
    )) {
      const layout = module.records![closure.closureEnvironment!]!;
      // The captured const is a number payload, never a cell reference.
      assert.ok(
        layout.fields.some((field) => field.type === "number"),
        text,
      );
    }
  }
});

test("lets written only by their owner before every captor are captured by value", () => {
  for (const text of [
    "function make():()=>number{let n:number=0;n=n+1;n++;return ()=>n;}",
    // Counted in a loop that ends before the closure is created.
    "function make(k:number):()=>number{let n:number=0;for(let i:number=0;i<k;i++)if(i%2===1)++n;return ()=>n;}",
    // A binding declared in the loop body is a fresh one per iteration.
    "function make(k:number):()=>number{let last:()=>number=()=>0;for(let i:number=0;i<k;i++){let n:number=i;n+=1;last=()=>n;}return last;}",
    // A hoisted declaration sinking past a later declaration is created
    // after the writes before it.
    "function make(k:number):()=>number{let n:number=0;while(n<k)n+=2;const after:number=n;function read():number{return n+after;}return read;}",
  ]) {
    const module = lower(text);
    assert.equal(cellAccesses(module), false, text);
  }
});

test("lets written after a captor may exist keep their cells", () => {
  for (const text of [
    // Written after the closure is created.
    "function make():()=>number{let n:number=0;const read:()=>number=()=>n;n=5;return read;}",
    // Written by the closure itself.
    "function make():()=>number{let n:number=0;return ()=>++n;}",
    // Written in the statement that creates the closure: the assignment
    // completes after the closure exists.
    "function make():()=>number{let n:number=0;let read:()=>number=()=>0;n=(read=()=>n)()+5;return read;}",
    // A loop around both the write and the closure, with the binding
    // declared outside it, writes again after the closure exists.
    "function make(k:number):()=>number{let n:number=0;let read:()=>number=()=>0;while(n<k){n+=1;read=()=>n;}return read;}",
    // The update clause runs after the body that creates the closure.
    "function make(k:number):()=>number{let n:number=0;let read:()=>number=()=>0;for(let i:number=0;i<k;i=i+1+(n++)*0){read=()=>n;}return read;}",
    // A hoisted declaration created at its sink point, the binding's
    // declaration, before the write.
    "function make():()=>number{let n:number=0;function read():number{return n;}n=5;return read;}",
    // Written inside a switch clause's loop after the closure.
    "function make(k:number):()=>number{let n:number=0;let read:()=>number=()=>0;switch(k){case 1:while(n<k){read=()=>n;n++;}}return read;}",
  ]) {
    const module = lower(text);
    assert.equal(cellAccesses(module), true, text);
  }
});

test("a by-value hint keeps its cell when the hoisted closure is created before it", () => {
  const module = lower(
    "function make():()=>number{try{const value:number=42;function read():number{return value;}return read;}catch(e){return ():number=>0;}}",
    false,
    "value",
  );
  assert.equal(cellAccesses(module), true);
});
