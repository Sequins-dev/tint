import { bindModule } from "@tint/typescript/binding";
import { specializeModule } from "@tint/ts-native/modules";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
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
function fixture(
  source: string,
  key: string = "string",
  value: string = "number",
) {
  const bytes = new TextEncoder().encode(
    // These are ABI contract tests, independent of the production map's storage.
    `interface Slot<K,V>{key:K;value:V}
interface LinkedMap<K,V>{slot:Slot<K,V>|undefined;size:number}
function createMap<K,V>():LinkedMap<K,V>{return {slot:undefined,size:0};}
function getMap<K,V>(map:LinkedMap<K,V>,key:K):V|undefined{const slot=map.slot;return slot===undefined?undefined:slot.value;}
function hasMap<K,V>(map:LinkedMap<K,V>,key:K):boolean{return map.slot!==undefined;}
function setMap<K,V>(map:LinkedMap<K,V>,key:K,value:V):boolean{map.slot={key,value};map.size=1;return true;}
function deleteMap<K,V>(map:LinkedMap<K,V>,key:K):boolean{map.slot=undefined;map.size=0;return true;}
function clearMap<K,V>(map:LinkedMap<K,V>):void{map.slot=undefined;map.size=0;}
function sizeMap<K,V>(map:LinkedMap<K,V>):number{return map.size;}
` + source,
  );
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindModule(parsed.value, ["undefined", "Map"]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const helperNames = [
    "createMap",
    "getMap",
    "hasMap",
    "setMap",
    "deleteMap",
    "clearMap",
    "sizeMap",
  ];
  const roots = helperNames.map((name) => {
    const node = parsed.value.statements.find(
      (s) => s.kind === "function" && s.name === name,
    );
    const fn = bound.value.functions.find((f) => f.node === node);
    assert.ok(fn);
    return {
      function: fn.id,
      arguments: [
        { kind: "named", name: key, start: 0, end: 0 } as const,
        { kind: "named", name: value, start: 0, end: 0 } as const,
      ],
    };
  });
  const prepared = specializeModule(parsed.value, bound.value, { roots });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const module = prepared.value.module;
  const checked = checkClosureModule(module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const c = checked.value;
  const aliases = new Map(
    helperNames.map((name, index) => [name, prepared.value.roots[index]]),
  );
  function id(name: string) {
    const declaration = module.statements.find(
      (s) => s.kind === "function" && s.name === (aliases.get(name) ?? name),
    );
    const fn = c.bindings.functions.find((f) => f.node === declaration);
    assert.ok(fn);
    return fn.id;
  }
  function encoding(name: string, index: number): "number" | "string" | number {
    if (name === "number" || name === "string") return name;
    const parameter = c.bodies.get(id("setMap"))?.parameters[index];
    const binding = c.bindings.bindings.find((b) => b.node === parameter);
    assert.ok(binding);
    const type = c.bindingTypes[binding.id];
    assert.notEqual(type, undefined);
    return type!;
  }
  return {
    key: encoding(key, 1),
    value: encoding(value, 2),
    checked: checked.value,
    entries: checked.value.bindings.functions.map((f) => f.id),
    id,
    runtime: {
      create: id("createMap"),
      get: id("getMap"),
      has: id("hasMap"),
      set: id("setMap"),
      delete: id("deleteMap"),
      clear: id("clearMap"),
      size: id("sizeMap"),
    },
  };
}

test("source maps lower through explicit bindings, relocate IDs and occupy writable traced fields", () => {
  const f = fixture(`interface Box{values:Map<string,number>}
 function run():number{const b:Box={values:new Map<string,number>()};b.values.set("a",1).set("b",2);const n=b.values.get("a")??0;b.values=new Map<string,number>();b.values.set("c",3);if(!b.values.has("c"))return -1;b.values.delete("c");b.values.clear();return n+b.values.size;}`);
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const r = lowerModuleEntries(f.checked, entries, target, 4096, {
      maps: [{ key: "string", value: "number", runtime: f.runtime }],
    });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(verify(r.value.module).ok);
    const run = r.value.module.functions[entries.indexOf(f.id("run"))]!;
    const calls = run.blocks
      .flatMap((b) => b.instructions)
      .filter((i) => i.kind === "call");
    for (const id of Object.values(f.runtime))
      assert.ok(calls.some((c) => c.target === entries.indexOf(id)));
  }
  assert.ok(!lowerModuleEntries(f.checked, f.entries, target, 4096).ok);
  assert.ok(
    !lowerModuleEntries(
      f.checked,
      f.entries.filter((id) => id !== f.runtime.get),
      target,
      4096,
      { maps: [{ key: "string", value: "number", runtime: f.runtime }] },
    ).ok,
  );
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      maps: [{ key: "number", value: "number", runtime: f.runtime }],
    }).ok,
  );
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      maps: [
        {
          key: "string",
          value: "number",
          runtime: { ...f.runtime, get: f.runtime.has },
        },
      ],
    }).ok,
  );
});
test("numeric maps reject duplicate contracts and unsupported value encodings", () => {
  const f = fixture(
    "function run():number{const m=new Map<number,number>();m.set(1,2);return m.get(1)??0;}",
    "number",
  );
  const r = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    maps: [{ key: "number", value: "number", runtime: f.runtime }],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      maps: [
        { key: "number", value: "number", runtime: f.runtime },
        { key: "number", value: "number", runtime: f.runtime },
      ],
    }).ok,
  );
  const s = fixture(
    "function run():number{return new Map<string,boolean>().size;}",
  );
  assert.ok(
    !lowerModuleEntries(s.checked, s.entries, target, 4096, {
      maps: [{ key: "string", value: "number", runtime: s.runtime }],
    }).ok,
  );
});

test("string-valued maps return optional strings through the shared runtime binding", () => {
  const f = fixture(
    'function run():string{const m=new Map<string,string>();m.set("name","Tint");return m.get("name")??"missing";}',
    "string",
    "string",
  );
  const r = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    maps: [{ key: "string", value: "string", runtime: f.runtime }],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      maps: [{ key: "string", value: "number", runtime: f.runtime }],
    }).ok,
  );
});

test("object map keys and values retain their checked contracts through lowering", () => {
  const f = fixture(
    `interface Key {id:number} type Item={readonly kind:"ok";value:number}|{readonly kind:"error";message:string};
    interface Box {map:Map<Key,Item>}
    function run():number {const key:Key={id:1};const box:Box={map:new Map<Key,Item>()};
      box.map.set(key,{kind:"ok",value:7});const item=box.map.get(key);
      if(item===undefined)return 0;if(item.kind==="ok")return item.value;return item.message.length;
    }`,
    "Key",
    "Item",
  );
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const lowered = lowerModuleEntries(f.checked, entries, target, 4096, {
      maps: [{ key: f.key, value: f.value, runtime: f.runtime }],
    });
    assert.ok(lowered.ok, JSON.stringify(lowered));
    assert.ok(verify(lowered.value.module).ok);
  }
});

test("map helper contracts reject narrow object keys and widened object values", () => {
  const f = fixture(
    `interface Key{id:number} interface Item{value:number}
    function badHas(map:LinkedMap<Key,Item>,key:{id:number;extra:number}):boolean{return true;}
    function badGet(map:LinkedMap<Key,Item>,key:Key):{other:number}|undefined{return {other:1};}
    function run():number{const map=new Map<Key,Item>();return map.size;}`,
    "Key",
    "Item",
  );
  for (const runtime of [
    { ...f.runtime, has: f.id("badHas") },
    { ...f.runtime, get: f.id("badGet") },
  ]) {
    const lowered = lowerModuleEntries(f.checked, f.entries, target, 4096, {
      maps: [{ key: f.key, value: f.value, runtime }],
    });
    assert.ok(!lowered.ok);
    assert.match(lowered.error, /contract mismatch/);
  }
});
