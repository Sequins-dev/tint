import {
  bindingIdentifiers,
  rewriteModule,
  syntaxHash,
  type Span,
} from "@tint/typescript/syntax";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectionFixtureLocations,
  numericFixtureLocations,
  testWorkspaceModules,
} from "../../../tools/test-workspace-modules.ts";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import {
  linkModules,
  specializeModule,
  locateSource,
  prepareModuleInstance,
} from "@tint/ts-native/modules";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { verify } from "@tint/ir/scalar";
import {
  prepareCollectionRuntimes,
  type RuntimeBindingContext,
  type RuntimeCollectionNames,
} from "../src/runtime/index.ts";
import { createPreparedBindingIndex } from "../src/runtime/bindings.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
const globals = [
  "undefined",
  "NaN",
  "Infinity",
  "Number",
  "String",
  "Math",
  "Map",
  "Set",
  "Uint8Array",
  "Float64Array",
  "Uint32Array",
];
function fixture(body: string, nestedRuntime = false) {
  const names = [
    "key-index",
    "number-list",
    "linked-map",
    "number-key-map",
    "string-key-map",
    "sparse-list",
    "linked-set",
    "primitive-value",
    "number-text",
    "indexed-sort",
    "list-sort",
  ];
  const modules = testWorkspaceModules(
    names,
    (text) =>
      text
        .replace(
          "const entry = findMap<K, V>(map, key, hash);",
          nestedRuntime
            ? "const scratch: {key:K}[] = [{key}]; const seen = new Set<K>(); seen.add(key); const entry = findMap<K, V>(map, key, hash);"
            : "const entry = findMap<K, V>(map, key, hash);",
        )
        .replace(
          "export function createSet<T>(): LinkedSet<T> {",
          nestedRuntime
            ? "export function createSet<T>(): LinkedSet<T> { const scratch: {value:T}[]=[];"
            : "export function createSet<T>(): LinkedSet<T> {",
        ),
    new Map([...collectionFixtureLocations, ...numericFixtureLocations]),
  );
  modules.push({
    id: "main",
    module: parse(names.map((n) => `import "${n}";`).join("") + body),
    dependencies: new Map(names.map((n) => [n, n])),
  });
  const linked = linkModules(modules, "main", globals, {
    evaluation: "instance",
  });
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module, globals);
  assert.ok(bound.ok);
  const source = specializeModule(linked.value.module, bound.value);
  assert.ok(source.ok, JSON.stringify(source));
  const checked = checkClosureModule(source.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const helpers = new Map(
    linked.value.exports
      .filter((e) => e.namespace === "value")
      .map((e) => [e.module + ":" + e.name, e.linkedName]),
  );
  return { linked, checked, helpers };
}
test("registers sort adapters for demanded numeric and string arrays", () => {
  const f = fixture(
    "function run(a:number[],b:string[]):void {a.sort((x,y)=>x-y);b.sort((x,y)=>x.length-y.length);}",
  );
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.notEqual(
    prepared.value.options.lists?.find((list) => list.element === "number")
      ?.runtime.sort,
    undefined,
  );
  assert.notEqual(
    prepared.value.options.lists?.find((list) => list.element === "string")
      ?.runtime.sort,
    undefined,
  );
});
test("registers numeric lists, object lists, maps and object Sets from checked demands", () => {
  const f = fixture(`interface Item {value:number}
 function run():number {
   const a:Item={value:7};const list:Item[]=[a];const numbers:number[]=[2];
   const map=new Map<string,Item>();map.set("a",a);
   const set=new Set<Item>();set.add(a);let total=0;
   for(const item of set) total+=item.value;
   const found=map.get("a"),item=list[0];
   if(found===undefined||item===undefined)return -1;
   return total+found.value+item.value+(numbers[0]??0);
 }`);
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const c = prepared.value.checked;
  const lowered = lowerModuleEntries(
    c,
    c.bindings.functions.filter((f) => f.parent === undefined).map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(prepared.value.options.lists?.length);
  assert.ok(prepared.value.options.maps?.length);
  assert.ok(prepared.value.options.sets?.length);
});
test("reports missing runtime templates and unsupported encodings", () => {
  const f = fixture("function run(a:number[]):number{return a.length;}");
  assert.equal(
    prepareCollectionRuntimes(
      f.linked.value.module,
      f.checked.value,
      new Map(),
      globals,
    ).ok,
    false,
  );
  const unsupported = fixture("function run(a:Set<never>):number{return 0;}");
  assert.equal(
    prepareCollectionRuntimes(
      unsupported.linked.value.module,
      unsupported.checked.value,
      unsupported.helpers,
      globals,
    ).ok,
    false,
  );
});
test("prepares mixed primitive lists, Sets and Maps using the shared tagged runtime", () => {
  const f = fixture(`
    function run():number {
      const list:(number|string|boolean|undefined)[]=[7,"a",false,undefined];
      const set=new Set<number|string|boolean|undefined>();
      set.add(7);set.add("a");set.add(false);set.add(undefined);
      const map=new Map<string,number|string>();map.set("a",7);
      const first=list[0],found=map.get("a");
      if(typeof first!=="number"||typeof found!=="number")return -1;
      return first+found+set.size;
    }`);
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const c = prepared.value.checked;
  const lowered = lowerModuleEntries(
    c,
    c.bindings.functions.filter((f) => f.parent === undefined).map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
});

test("registers standard number conversion helpers", () => {
  const f = fixture(
    "function run(value:number,text:string):string {return String(value+Number(text));}",
  );
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.notEqual(prepared.value.options.numberToString, undefined);
  assert.notEqual(prepared.value.options.numberFromString, undefined);
});
test("optional object Map values retain presence and share reference storage", () => {
  const f = fixture(
    "interface Item {value:number} function run():number {const map=new Map<number,Item|undefined>();map.set(1,undefined);map.set(2,{value:42});const value=map.get(2);return map.has(1)&&value!==undefined?value.value:-1;}",
  );
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const c = prepared.value.checked;
  const lowered = lowerModuleEntries(
    c,
    c.bindings.functions.filter((f) => f.parent === undefined).map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
});

test("runtime preparation composes with a module instance after specialization", () => {
  const f = fixture(
    'const values=[20,21];function increment(x:number):number{return x+1;}export function run():number{const map=new Map<string,number>();map.set("x",values.map(increment)[0]??0);return map.get("x")??0;}',
    true,
  );
  const selected = f.linked.value.exports.find(
    (e) => e.module === "main" && e.name === "run",
  );
  assert.ok(selected);
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module) => {
      const retained = module.statements.flatMap((s) =>
        locateSource(f.linked.value, s)?.module !== "main"
          ? s.kind === "function"
            ? [s.name]
            : s.kind === "variable"
              ? s.declarations.flatMap((d) =>
                  bindingIdentifiers(d).map((identifier) => identifier.name),
                )
              : []
          : [],
      );
      const bound = bindModule(module, globals);
      assert.ok(bound.ok);
      const instance = prepareModuleInstance(
        module,
        bound.value,
        [{ name: "run", local: selected.linkedName }],
        retained,
      );
      assert.ok(instance.ok, JSON.stringify(instance));
      return { ok: true, value: instance.value.module };
    },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.ok(
    prepared.value.checked.module.statements.some(
      (s) => s.kind === "function" && s.name.startsWith("__tint_initialize"),
    ),
  );
  const c = prepared.value.checked;
  const lowered = lowerModuleEntries(
    c,
    c.bindings.functions.filter((f) => f.parent === undefined).map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
});

test("nullish fallback widens optional payloads through the result representation", () => {
  const f =
    fixture(`function text(value:string|undefined):string|number{return value??22;}
    function flag(value:boolean|undefined):boolean|number{return value??22;}
    function run():number{const a=text("x"),b=flag(false);if(typeof a!=="string"||typeof b!=="boolean")return -1;return a.length;}`);
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const checked = prepared.value.checked;
  const lowered = lowerModuleEntries(
    checked,
    checked.bindings.functions
      .filter((f) => f.parent === undefined)
      .map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
});

test("lowers general-value arrays through specialized sparse-list helpers", () => {
  const f = fixture(`
  function mixed(index:number):number|string|boolean|null|undefined {
    if(index===0)return undefined;if(index===1)return null;
    if(index===2)return false;if(index===3)return "text";return 42;
  }
  function run():number {
    const values:unknown[]=[1,"text",{value:7},undefined,null,mixed(1)];
    values.push(false);values[0]=42;
    const value=values[0];return typeof value==="number"?value:0;
  }`);
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const c = prepared.value.checked;
  const lowered = lowerModuleEntries(
    c,
    c.bindings.functions.filter((f) => f.parent === undefined).map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
});
test("mixed reference and primitive Map contracts preserve general get results", () => {
  const f = fixture(`
    type Key=string|{id:number};
    function run():unknown {
      const key={id:42};const map=new Map<Key,unknown>();
      map.set(key,"value");map.set("key",key);
      const set=new Set<Key>();set.add(key);set.add("key");
      const keys:Key[]=[key,"key"];
      if(!keys.includes(key)||keys.indexOf("key")!==1)return undefined;
      for(const item of keys){if(item===undefined||!set.has(item))return undefined;}
      return set.has(key)?map.get(key):undefined;
    }
  `);
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const checked = prepared.value.checked;
  const lowered = lowerModuleEntries(
    checked,
    checked.bindings.functions
      .filter((f) => f.parent === undefined)
      .map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
});
test("rejects array views that would reinterpret incompatible native storage", () => {
  for (const body of [
    "function run():unknown {const values:number[]=[42];const view:readonly unknown[]=values;return view[0];}",
    "function read(values:readonly unknown[]):unknown{return values[0];} function run():unknown {const values:number[]=[42];return read(values);}",
    "function run():readonly unknown[] {const values:number[]=[42];return values;}",
    "function run():unknown {const box={values:[42]};const view:{readonly values:readonly unknown[]}=box;return view.values[0];}",
    "function run(flag:boolean):unknown {const values:number[]=[42];const general:readonly unknown[]=[1];const view=flag?values:general;return view[0];}",
    "function run():unknown {const read=(values:readonly unknown[]):unknown=>values[0];const alias:(values:readonly number[])=>unknown=read;return alias([42]);}",
  ]) {
    const f = fixture(body);
    const prepared = prepareCollectionRuntimes(
      f.linked.value.module,
      f.checked.value,
      f.helpers,
      globals,
    );
    assert.ok(prepared.ok, JSON.stringify(prepared));
    const c = prepared.value.checked;
    const lowered = lowerModuleEntries(
      c,
      c.bindings.functions
        .filter((f) => f.parent === undefined)
        .map((f) => f.id),
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
      prepared.value.options,
    );
    assert.equal(lowered.ok, false, body);
    if (!lowered.ok)
      assert.match(
        lowered.error,
        /array view requires a representation adapter/,
      );
  }
});

test("discovers collections transitively through Map, Set and reference-array helpers", () => {
  const f = fixture(
    'function run():number {const map=new Map<string,number>();map.set("x",42);return map.get("x")??0;}',
    true,
  );
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.ok(
    prepared.value.options.lists?.some(
      (list) => typeof list.element === "number",
    ),
  );
  const c = prepared.value.checked;
  const lowered = lowerModuleEntries(
    c,
    c.bindings.functions.filter((f) => f.parent === undefined).map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
});

test("transitive runtime discovery retains the specialization budget", () => {
  const f = fixture(
    'function run():number {const map=new Map<string,number>();return map.get("x")??0;}',
    true,
  );
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    undefined,
    1,
  );
  assert.equal(prepared.ok, false);
  if (!prepared.ok) {
    assert.match(prepared.error, /specialization.*limit/i);
    assert.match(prepared.error, /runtime demand:.*lists.*maps.*roots/);
  }
});

test("prepares boolean Map values and Set members with their native encodings", () => {
  const f = fixture(
    'function run():number{const values=new Map<string,boolean>();values.set("false",false);values.set("true",true);const seen=new Set<boolean>();seen.add(false);seen.add(true);if(values.get("false")!==false||values.get("missing")!==undefined||!seen.has(false)||!seen.has(true))return 1;return 42;}',
  );
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const checked = prepared.value.checked;
  const lowered = lowerModuleEntries(
    checked,
    checked.bindings.functions
      .filter((fn) => fn.parent === undefined)
      .map((fn) => fn.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
});

test("literal-typed lists use helpers that accept their whole encoding", () => {
  // A `true[]` (e.g. compact key-index values of KeyIndex<K, true>) shares
  // the boolean list encoding; an unsound assertion can still write false,
  // so its helpers must accept every boolean, alongside a plain boolean[].
  for (const source of [
    "function run():number{const marks:true[]=[];marks.push(true);marks[0]=true;return marks.length===1&&marks[0]===true?42:1;}",
    "function run():number{const marks:true[]=[];const flags:boolean[]=[];marks.push(true);flags.push(false);return marks.length+flags.length===2&&marks[0]===true&&flags[0]===false?42:1;}",
    'function run():number{const counts:1[]=[];counts.push(1);const names:"a"[]=[];names.push("a");return counts[0]===1&&names[0]==="a"?42:1;}',
  ])
    for (const eraseRecordLists of [false, true]) {
      const f = fixture(source);
      const prepared = prepareCollectionRuntimes(
        f.linked.value.module,
        f.checked.value,
        f.helpers,
        globals,
        undefined,
        8192,
        undefined,
        undefined,
        eraseRecordLists,
      );
      assert.ok(prepared.ok, JSON.stringify(prepared));
      const checked = prepared.value.checked;
      const lowered = lowerModuleEntries(
        checked,
        checked.bindings.functions
          .filter((fn) => fn.parent === undefined)
          .map((fn) => fn.id),
        {
          pointerSize: 8,
          wordSize: 8,
          allocationAlignment: 16,
          frameAlignment: 16,
          maxAlignment: 16,
        },
        4096,
        prepared.value.options,
      );
      assert.ok(lowered.ok, source + ": " + JSON.stringify(lowered));
      assert.ok(verify(lowered.value.module).ok);
    }
});

test("runtime transforms stamp late synthetic syntax without changing source spans or input nodes", () => {
  const f = fixture("export function anchor(a:string[]):void { a.push('x'); }");
  function synthetic<T extends Span>(node: T): T {
    const { nodeHash: _hash, ...rest } = node;
    return { ...rest, start: 0, end: 0 } as T;
  }
  const generated = rewriteModule(
    parse(
      Array.from(
        { length: 256 },
        (_, i) => `function __lateSynthetic${i}():number{return ${i + 1};}`,
      ).join("\n"),
    ),
    { type: synthetic, expression: synthetic, statement: synthetic },
  );
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module) => ({
      ok: true,
      value: {
        ...module,
        statements: [...module.statements, ...generated.statements],
      },
    }),
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const hashes = new Set<number>();
  let found = 0;
  for (const statement of prepared.value.checked.module.statements) {
    if (
      statement.kind !== "function" ||
      !statement.name.startsWith("__lateSynthetic")
    )
      continue;
    assert.equal(statement.body.kind, "block");
    if (statement.body.kind !== "block") throw "body invariant";
    const returned = statement.body.statements[0];
    assert.equal(returned?.kind, "return");
    if (returned?.kind !== "return" || returned.expression?.kind !== "number")
      throw "return invariant";
    const value = returned.expression;
    assert.equal(value.start, 0);
    assert.equal(value.end, 0);
    assert.equal(
      value.value,
      Number(statement.name.slice("__lateSynthetic".length)) + 1,
    );
    hashes.add(syntaxHash(value));
    found++;
  }
  assert.equal(found, 256);
  assert.equal(
    hashes.size,
    256,
    "late literals must not all probe the zero-hash bucket",
  );
  for (const statement of generated.statements) {
    if (statement.kind !== "function" || statement.body.kind !== "block")
      continue;
    const returned = statement.body.statements[0];
    if (returned?.kind === "return")
      assert.equal(returned.expression?.nodeHash, undefined);
  }
});

test("runtime transforms receive pass-scoped collection names matching final bindings", () => {
  const f = fixture("export function anchor(a:string[]):void { a.push('x'); }");
  const anchor = f.linked.value.exports.find(
    (e) => e.module === "main" && e.name === "anchor",
  )!.linkedName;
  let last: RuntimeCollectionNames | undefined;
  let saved: RuntimeBindingContext | undefined;
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module, context) => {
      assert.ok(context, "runtime binding context is missing");
      const names = context.collection({ function: anchor, parameter: 0 });
      assert.ok(names.ok, JSON.stringify(names));
      assert.equal(names.value.kind, "list");
      last = names.value;
      saved = context;
      return { ok: true, value: module };
    },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const binding = prepared.value.options.lists!.find(
    (b) => b.element === "string",
  )!;
  assert.ok(last);
  assert.ok(saved);
  const index = createPreparedBindingIndex(prepared.value.checked);
  for (const [operation, name] of last.operations) {
    const id = index.functionId(name);
    assert.equal(
      id,
      binding.runtime[operation as keyof typeof binding.runtime],
    );
  }
  assert.deepEqual(saved.collection({ function: anchor, parameter: 0 }), {
    ok: false,
    error: "runtime binding context is closed",
  });
});

test("runtime binding contexts validate subjects before selecting operations", () => {
  const f = fixture(
    "export function anchor(a:string[], n:number):void { a.push('x'); }",
  );
  const anchor = f.linked.value.exports.find(
    (e) => e.module === "main" && e.name === "anchor",
  )!.linkedName;
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module, context) => {
      assert.deepEqual(
        context.collection({ function: "missing", parameter: 0 }),
        {
          ok: false,
          error: "runtime binding subject is not a top-level function: missing",
        },
      );
      for (const parameter of [-1, 2, 0.5])
        assert.deepEqual(context.collection({ function: anchor, parameter }), {
          ok: false,
          error:
            "runtime binding subject has no parameter " +
            parameter +
            ": " +
            anchor,
        });
      assert.deepEqual(context.collection({ function: anchor, parameter: 1 }), {
        ok: false,
        error: "runtime binding subject is not a collection: " + anchor,
      });
      return { ok: true, value: module };
    },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
});

test("runtime binding contexts expose numeric, Set, Map and primitive names", () => {
  const f = fixture(
    "export function anchor(a:number[], s:Set<string>, m:Map<string,number>):void {a.push(1);s.add('x');m.set('x',1);}",
  );
  const anchor = f.linked.value.exports.find(
    (e) => e.module === "main" && e.name === "anchor",
  )!.linkedName;
  let seen: RuntimeCollectionNames[] = [];
  let primitives: ReadonlyMap<string, string> | undefined;
  let numberText:
    { readonly toString: string; readonly fromString: string } | undefined;
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module, context) => {
      seen = [];
      for (let parameter = 0; parameter < 3; parameter++) {
        const found = context.collection({ function: anchor, parameter });
        assert.ok(found.ok, JSON.stringify(found));
        seen.push(found.value);
      }
      primitives = context.primitives();
      numberText = context.numberText();
      return { ok: true, value: module };
    },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.deepEqual(
    seen.map((n) => n.kind),
    ["list", "set", "map"],
  );
  const index = createPreparedBindingIndex(prepared.value.checked);
  assert.equal(
    seen[0]!.operations.get("create"),
    f.helpers.get("number-list:createNumberList"),
  );
  const set = prepared.value.options.sets!.find(
    (s) => s.element === "string",
  )!.runtime;
  assert.equal(
    index.functionId(seen[1]!.operations.get("iterator.read")!),
    set.iterator!.read,
  );
  const map = prepared.value.options.maps!.find(
    (m) => m.key === "string" && m.value === "number",
  )!.runtime;
  assert.equal(index.functionId(seen[2]!.operations.get("set")!), map.set);
  assert.equal(
    index.functionId(primitives!.get("fromNumber")!),
    prepared.value.options.primitives!.fromNumber,
  );
  assert.equal(
    index.functionId(numberText!.toString),
    prepared.value.options.numberToString,
  );
});

test("runtime binding contexts reject cached names skipped on retries", () => {
  const f = fixture(
    "export function anchor(m:Map<string,string>):void {m.set('x','y');}",
    true,
  );
  const anchor = f.linked.value.exports.find(
    (e) => e.module === "main" && e.name === "anchor",
  )!.linkedName;
  let calls = 0;
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module, context) => {
      if (calls++ === 0)
        assert.ok(context.collection({ function: anchor, parameter: 0 }).ok);
      return { ok: true, value: module };
    },
  );
  assert.ok(calls > 1);
  assert.equal(prepared.ok, false);
  if (!prepared.ok)
    assert.equal(
      prepared.error,
      "runtime binding context was not consulted on retry: " + anchor,
    );
});

test("unused runtime contexts do not inspect observed declaration bindings", () => {
  const f = fixture("function run(a:string[]):void {a.push('x');}");
  const baseline = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(baseline.ok);
  let reads = 0;
  const observed = {
    ...f.checked.value,
    get bindings() {
      reads++;
      return f.checked.value.bindings;
    },
  };
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    observed,
    f.helpers,
    globals,
    (module) => ({ ok: true, value: module }),
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(reads, 0);
  assert.deepEqual(prepared.value.options, baseline.value.options);
  assert.deepEqual(
    prepared.value.checked.module,
    baseline.value.checked.module,
  );
});

test("runtime binding agreement rejects a transform removing its subject", () => {
  const f = fixture("export function anchor(a:string[]):void {a.push('x');}");
  const anchor = f.linked.value.exports.find(
    (e) => e.module === "main" && e.name === "anchor",
  )!.linkedName;
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module, context) => {
      assert.ok(context.collection({ function: anchor, parameter: 0 }).ok);
      return {
        ok: true,
        value: {
          ...module,
          statements: module.statements.filter(
            (s) => s.kind !== "function" || s.name !== anchor,
          ),
        },
      };
    },
  );
  assert.equal(prepared.ok, false);
  if (!prepared.ok)
    assert.equal(
      prepared.error,
      "runtime binding subject disappeared after transform: " + anchor,
    );
});

test("equal-shaped collection subjects select the same first helper instances", () => {
  const f = fixture(
    "interface A{value:number}interface B{value:number}export function anchor(a:A[],b:B[]):void{a.push({value:1});b.push({value:2});}",
  );
  const anchor = f.linked.value.exports.find(
    (e) => e.module === "main" && e.name === "anchor",
  )!.linkedName;
  let last: ReadonlyMap<string, string> | undefined;
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module, context) => {
      const first = context.collection({ function: anchor, parameter: 0 }),
        second = context.collection({ function: anchor, parameter: 1 });
      assert.ok(first.ok, JSON.stringify(first));
      assert.ok(second.ok, JSON.stringify(second));
      assert.deepEqual(first.value.operations, second.value.operations);
      last = first.value.operations;
      return { ok: true, value: module };
    },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.ok(last);
});

test("missing helpers queried by a transform remain runtime-preparation diagnostics", () => {
  const f = fixture(
    "export function anchor(values:number[]):void{values.push(1);}",
  );
  const anchor = f.linked.value.exports.find(
    (e) => e.module === "main" && e.name === "anchor",
  )!.linkedName;
  f.helpers.delete("number-list:readNumberList");
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    (module, context) => {
      context.collection({ function: anchor, parameter: 0 });
      return { ok: true, value: module };
    },
  );
  assert.equal(prepared.ok, false);
  if (!prepared.ok)
    assert.equal(
      prepared.error,
      "missing runtime helper: number-list:readNumberList",
    );
});

test("reference-encoded list elements share one sparse-list instantiation", () => {
  const f =
    fixture(`interface A {value:number} interface B {label:string; next:A|undefined}
 export function run():number {
   const a:A={value:7};const b:B={label:"x",next:a};
   const as:A[]=[a];const bs:B[]=[b];as.push({value:2});bs.push({label:"y",next:undefined});
   const nested:number[][]=[[1]];const words:string[][]=[["a"]];nested.push([2,3]);
   const first=as[1],second=bs[0],inner=nested[1],word=words[0];
   if(first===undefined||second===undefined||inner===undefined||word===undefined)return -1;
   return first.value+second.label.length+as.length+bs.length+inner.length+word.length;
 }`);
  const separate = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
  );
  assert.ok(separate.ok, JSON.stringify(separate));
  const perElement = (separate.value.options.lists ?? []).filter(
    (list) => typeof list.element === "number",
  );
  // Without the option (published surfaces key helpers by element), every
  // record element keeps its own instantiation.
  assert.equal(
    new Set(perElement.map((list) => list.runtime.create)).size,
    perElement.length,
  );
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    undefined,
    8192,
    undefined,
    undefined,
    true,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const records = (prepared.value.options.lists ?? []).filter(
    (list) => typeof list.element === "number",
  );
  assert.ok(records.length >= 4, JSON.stringify(records));
  const creates = new Set(records.map((list) => list.runtime.create));
  assert.equal(creates.size, 1, "records and nested arrays share createList");
  assert.ok(records.every((list) => list.erasedRecords === true));
  const c = prepared.value.checked;
  const lowered = lowerModuleEntries(
    c,
    c.bindings.functions.filter((f) => f.parent === undefined).map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
});

test("Maps share an instantiation per key and value encoding class", () => {
  const f = fixture(`interface A {value:number} interface B {label:string}
 export function run():number {
   const a:A={value:1};const b:B={label:"x"};
   const byName=new Map<string,A>();const labels=new Map<string,B>();
   byName.set("a",a);labels.set("b",b);
   const counts=new Map<A,number>();const sizes=new Map<B,number>();
   counts.set(a,2);sizes.set(b,3);
   const found=byName.get("a"),label=labels.get("b");
   if(found===undefined||label===undefined)return -1;
   return found.value+label.label.length+(counts.get(a)??0)+(sizes.get(b)??0);
 }`);
  const prepared = prepareCollectionRuntimes(
    f.linked.value.module,
    f.checked.value,
    f.helpers,
    globals,
    undefined,
    8192,
    undefined,
    undefined,
    true,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const maps = prepared.value.options.maps ?? [];
  const byKey = (key: "string" | "record") =>
    new Set(
      maps
        .filter((map) =>
          key === "string" ? map.key === "string" : typeof map.key === "number",
        )
        .map((map) => map.runtime.create),
    );
  assert.equal(byKey("string").size, 1, "string-keyed record maps share");
  assert.equal(byKey("record").size, 1, "record-keyed number maps share");
  const c = prepared.value.checked;
  const lowered = lowerModuleEntries(
    c,
    c.bindings.functions.filter((f) => f.parent === undefined).map((f) => f.id),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
});
