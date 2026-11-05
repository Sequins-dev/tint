import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { verify } from "@tint/ir/scalar";
const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
function input(
  id: string,
  text: string,
  dependencies: readonly [string, string][],
): SourceModule {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}
function fixture(
  body: string,
  objectElements = false,
  declaration = "export interface Item {value:number} ",
) {
  const linked = linkModules(
    [
      input(
        "key-index",
        readFileSync(
          new URL(
            "../../foundation/src/collections/key-index.ts",
            import.meta.url,
          ),
          "utf8",
        ),
        [],
      ),
      input(
        "map",
        readFileSync(
          new URL(
            "../../foundation/src/collections/linked-map.ts",
            import.meta.url,
          ),
          "utf8",
        ),
        [["./key-index.ts", "key-index"]],
      ),
      input(
        "list",
        readFileSync(
          new URL(
            "../../foundation/src/collections/sparse-list.ts",
            import.meta.url,
          ),
          "utf8",
        ),
        [["@tint/foundation/collections/linked-map", "map"]],
      ),
      input(
        "main",
        'import {createList,type SparseList} from "list";' +
          (objectElements ? declaration : "") +
          body,
        [["list", "list"]],
      ),
    ],
    "main",
    ["undefined", "Number"],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module, ["undefined", "Number"]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const names = [
    "createList",
    "readList",
    "writeList",
    "pushList",
    "lengthList",
  ];
  const elementName = objectElements
    ? linked.value.exports.find(
        (e) =>
          e.module === "main" && e.name === "Item" && e.namespace === "type",
      )?.linkedName
    : "string";
  assert.ok(elementName);
  const roots = names.map((name) => {
    const exported = linked.value.exports.find(
      (e) => e.module === "list" && e.name === name,
    );
    assert.ok(exported);
    const node = linked.value.module.statements.find(
      (s) => s.kind === "function" && s.name === exported.linkedName,
    );
    const fn = bound.value.functions.find((f) => f.node === node);
    assert.ok(fn);
    return {
      function: fn.id,
      arguments: [
        {
          kind: "union",
          members: [
            { kind: "named", name: elementName, start: 0, end: 0 },
            { kind: "named", name: "undefined", start: 0, end: 0 },
          ],
          start: 0,
          end: 0,
        } as const,
      ],
    };
  });
  const prepared = specializeModule(linked.value.module, bound.value, {
    roots,
  });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const checked = checkClosureModule(prepared.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const ids = prepared.value.roots.map((name) => {
    const node = prepared.value.module.statements.find(
        (s) => s.kind === "function" && s.name === name,
      ),
      fn = checked.value.bindings.functions.find((f) => f.node === node);
    assert.ok(fn);
    return fn.id;
  });
  return {
    named(name: string): number {
      const exported = linked.value.exports.find(
        (e) =>
          e.module === "main" && e.name === name && e.namespace === "value",
      );
      assert.ok(exported);
      const node = prepared.value.module.statements.find(
        (s) => s.kind === "function" && s.name === exported.linkedName,
      );
      const fn = checked.value.bindings.functions.find((f) => f.node === node);
      assert.ok(fn);
      return fn.id;
    },
    element: checked.value.types.find(
      (t) =>
        t.kind === "array" &&
        (checked.value.types[t.element]?.kind === "object" ||
          checked.value.types[t.element]?.kind === "union"),
    ),
    checked: checked.value,
    entries: checked.value.bindings.functions.map((f) => f.id),
    runtime: {
      create: ids[0]!,
      read: ids[1]!,
      write: ids[2]!,
      push: ids[3]!,
      length: ids[4]!,
    },
  };
}
test("string arrays compose linked generic storage with reads, writes, fields and iteration", () => {
  const f = fixture(`interface Box{items:string[]}
 export function run():string{const box:Box={items:["a","b"]};box.items[4]="e";box.items.push("f","g");let result="";for(const item of box.items){result=result+(item??"_");}box.items=[];return result;}`);
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const r = lowerModuleEntries(f.checked, entries, target, 4096, {
      lists: [{ element: "string", runtime: f.runtime }],
    });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(verify(r.value.module).ok);
  }
  assert.ok(!lowerModuleEntries(f.checked, f.entries, target, 4096).ok);
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: "number", runtime: f.runtime }],
    }).ok,
  );
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [
        { element: "string", runtime: f.runtime },
        { element: "string", runtime: f.runtime },
      ],
    }).ok,
  );
});

test("object arrays preserve element shapes through generic storage, holes and iteration", () => {
  const f = fixture(
    `interface Box {items:Item[]}
    export function run():number {
      const first:Item={value:7}; const box:Box={items:[first]};
      box.items[3]={value:9}; box.items.push(first);
      let result=0;
      for(const item of box.items) {if(item!==undefined)result+=item.value;}
      box.items=[];
      return result;
    }`,
    true,
  );
  assert.ok(f.element?.kind === "array");
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const lowered = lowerModuleEntries(f.checked, entries, target, 4096, {
      lists: [{ element: f.element.element, runtime: f.runtime }],
    });
    assert.ok(lowered.ok, JSON.stringify(lowered));
    assert.ok(verify(lowered.value.module).ok);
  }
  const wrong = f.checked.types.findIndex(
    (t) => t.kind === "object" && t.properties.some((p) => p.name === "items"),
  );
  assert.ok(wrong >= 0);
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: wrong, runtime: f.runtime }],
    }).ok,
  );
});

test("object list helper contracts reject narrowed writes and widened reads", () => {
  const f = fixture(
    `export function badWrite(list:SparseList<Item>,index:number,value:{value:number;extra:number}):void{}
    export function badRead(list:SparseList<Item>,index:number):{other:number}|undefined{return {other:1};}
    export function run():number{const items:Item[]=[];return items.length;}`,
    true,
  );
  assert.ok(f.element?.kind === "array");
  for (const runtime of [
    { ...f.runtime, write: f.named("badWrite") },
    { ...f.runtime, read: f.named("badRead") },
  ]) {
    const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: f.element.element, runtime }],
    });
    assert.ok(!result.ok);
    assert.match(result.error, /contract mismatch/);
  }
});

test("object union arrays retain discriminants and hole guards", () => {
  const f = fixture(
    `export function run():number {
    const items:Item[]=[{kind:"a",value:7},{kind:"b",label:"hello"}];
    const copied=[...items];let result=0;for(const item of copied){if(item===undefined)continue;
      if(item.kind==="a")result+=item.value;else result+=item.label.length;}
    return result;
  }`,
    true,
    'export type Item = {readonly kind:"a";value:number}|{readonly kind:"b";label:string};',
  );
  assert.ok(f.element?.kind === "array");
  const lowered = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: f.element.element, runtime: f.runtime }],
  });
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
});

test("nullable string list helpers must accept every string as well as undefined", () => {
  const f = fixture(`
    export function narrow(list:SparseList<string|undefined>,index:number,value:"only"|undefined):void{}
    export function run():number{const values:string[]=[];return values.length;}
  `);
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [
      {
        element: "string",
        runtime: { ...f.runtime, write: f.named("narrow") },
      },
    ],
  });
  assert.ok(!result.ok);
  assert.match(result.error, /parameter contract mismatch/);
});

test("string split composes slicing with the explicit string list runtime", () => {
  const f = fixture(
    "export function run(text:string,separator:string|undefined,limit:number|undefined):number{return text.split(separator,limit).length;}",
  );
  const lowered = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "string", runtime: f.runtime }],
  });
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
});

test("string array join lowers optional separators and nullable elements", () => {
  const f = fixture(
    "export function run(a:readonly (string|undefined)[],separator:string|undefined):string{return a.join(separator);}",
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "string", runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("nested array storage requires an inner collection runtime binding", () => {
  const f = fixture(
    "export function run():Item[]{const result:Item[]=[];return result;}",
    true,
    "export type Item=string[];",
  );
  const outer = f.checked.types.find(
    (t) => t.kind === "array" && f.checked.types[t.element]?.kind === "array",
  );
  assert.ok(outer?.kind === "array");
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: outer.element, runtime: f.runtime }],
  });
  assert.equal(result.ok, false);
});

test("arrays of sets require their element set runtime registration", () => {
  const f = fixture(
    "export function run():Item[]{return [];}",
    true,
    "export type Item=Set<number>;",
  );
  const outer = f.checked.types.find(
    (t) => t.kind === "array" && f.checked.types[t.element]?.kind === "set",
  );
  assert.ok(outer?.kind === "array");
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: outer.element, runtime: f.runtime }],
    }).ok,
    false,
  );
});

test("literal string membership avoids transient list allocation and evaluates its argument once", () => {
  const f = fixture(
    'export function search(text:string):string{return text;} export function run(text:string):boolean{return ["a","b","a","😀"].includes(search(text));}',
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "string", runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  const run = result.value.module.functions.find(
    (fn) => fn.id === f.named("run"),
  );
  assert.ok(run);
  const calls = run.blocks
    .flatMap((block) => block.instructions)
    .filter((op) => op.kind === "call");
  assert.equal(
    calls.length,
    1,
    "only the search expression should call a function",
  );
});

test("literal membership keeps runtime lowering when its proof does not apply", () => {
  for (const [parameter, expression] of [
    ["text:string", '["a",text].includes(text)'],
    ["text:string", '["a","b"].includes(text,1)'],
    ["text:string|undefined", '["a","b"].includes(text)'],
    [
      "text:string",
      `[${Array.from({ length: 33 }, (_, index) => JSON.stringify(String(index))).join(",")}].includes(text)`,
    ],
  ]) {
    const f = fixture(
      `export function run(${parameter}):boolean{return ${expression};}`,
    );
    const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: "string", runtime: f.runtime }],
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(verify(result.value.module).ok);
    const run = result.value.module.functions.find(
      (fn) => fn.id === f.named("run"),
    );
    assert.ok(run);
    assert.ok(
      run.blocks.some((block) =>
        block.instructions.some((op) => op.kind === "call"),
      ),
      expression,
    );
  }
});

test("lowering snapshots collection encodings instead of remapping them for every scalar", () => {
  const f = fixture(
    "export function run(n:number):number{" +
      Array.from({ length: 100 }, () => "n=n+1;").join("") +
      "return n;}",
  );
  let reads = 0;
  const binding = {
    get element() {
      reads++;
      return "string" as const;
    },
    runtime: f.runtime,
  };
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [binding],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(reads < 100, `collection encoding read ${reads} times`);
});

test("boolean lists use the generic runtime with optional boolean payloads", () => {
  const f = fixture(
    "export function run(a:Item[]):boolean|undefined{a.push(false,true);return a[0];}",
    true,
    "export type Item=boolean;",
  );
  const element = f.checked.types.findIndex((t) => t.kind === "boolean");
  assert.ok(element >= 0);
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element, runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("boolean joins lower without a numeric formatter", () => {
  const f = fixture(
    'export function run(a:Item[]):string{return a.join("-");}',
    true,
    "export type Item=boolean;",
  );
  const element = f.checked.types.findIndex((t) => t.kind === "boolean");
  assert.ok(element >= 0);
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element, runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
