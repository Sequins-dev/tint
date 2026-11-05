import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
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
function fixture(source: string) {
  const bytes = new TextEncoder().encode(
    readFileSync(
      new URL(
        "../../foundation/src/collections/number-list.ts",
        import.meta.url,
      ),
      "utf8",
    ) + source,
  );
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const module = parsed.value,
    c = checked.value;
  function id(name: string) {
    const declaration = module.statements.find(
      (s) => s.kind === "function" && s.name === name,
    );
    const fn = c.bindings.functions.find((f) => f.node === declaration);
    assert.ok(fn);
    return fn.id;
  }
  return {
    id,
    checked: checked.value,
    entries: checked.value.bindings.functions.map((f) => f.id),
    runtime: {
      create: id("createNumberList"),
      read: id("readNumberList"),
      write: id("writeNumberList"),
      push: id("pushNumberList"),
      length: id("lengthNumberList"),
      has: id("hasNumberList"),
      delete: id("deleteNumberList"),
      resize: id("resizeNumberList"),
    },
  };
}
test("ordinary numeric arrays lower to explicitly supplied TypeScript runtime functions", () => {
  const f = fixture(
    "function run():number{const a=[1,2,3];a[5]=7;return a.push(4,5)+(a[5]??0)+a.length;}",
  );
  const r = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  const run = r.value.module.functions.at(-1)!;
  const calls = run.blocks
    .flatMap((b) => b.instructions)
    .filter((i) => i.kind === "call");
  assert.ok(calls.some((c) => c.target === f.runtime.create));
  assert.ok(calls.some((c) => c.target === f.runtime.read));
  assert.ok(calls.some((c) => c.target === f.runtime.push));
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096).ok,
    false,
  );
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [
        { element: "number", runtime: { ...f.runtime, read: f.runtime.push } },
      ],
    }).ok,
    false,
  );
});

test("numeric array iteration retains holes and reloads length through the runtime", () => {
  const f = fixture(
    "function run():number{const a:number[]=[];a[2]=7;let sum=0;for(const x of a){sum+=x??3;}return sum;}",
  );
  const r = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("runtime binding IDs relocate with entries and incompatible receivers fail", () => {
  const f = fixture(
    "interface Wrong{value:number}function wrong(a:Wrong):number{return a.value;}function run():number{return [1,2].length;}",
  );
  const reverse = [...f.entries].reverse();
  const r = lowerModuleEntries(f.checked, reverse, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  const createTarget = reverse.indexOf(f.runtime.create);
  assert.ok(
    r.value.module.functions[0]?.blocks.some((b) =>
      b.instructions.some(
        (i) => i.kind === "call" && i.target === createTarget,
      ),
    ),
  );
  const wrong = f.checked.module.statements.find(
    (s) => s.kind === "function" && s.name === "wrong",
  );
  const wrongId = f.checked.bindings.functions.find(
    (f) => f.node === wrong,
  )?.id;
  assert.notEqual(wrongId, undefined);
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [
        { element: "number", runtime: { ...f.runtime, length: wrongId! } },
      ],
    }).ok,
    false,
  );
  assert.equal(
    lowerModuleEntries(
      f.checked,
      f.entries.filter((id) => id !== f.runtime.push),
      target,
      4096,
      { lists: [{ element: "number", runtime: f.runtime }] },
    ).ok,
    false,
  );
});
test("numeric arrays can occupy traced record fields", () => {
  const f = fixture(
    "interface Box{readonly values:readonly number[]}function make():Box{return {values:[1,2]};}function run():number{return make().values.length;}",
  );
  const r = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.ok(
    r.value.module.records?.some(
      (r) => r.fields.length === 1 && r.fields[0]?.type === "reference",
    ),
  );
});
test("typeof preserves evaluation and uses presence for optional numbers", () => {
  const { checked, runtime } = fixture(`
    function touch(a:number[]):number{a.push(7);return 3;}
    function work(a:number[],n:number|undefined):string {
      const effect=typeof touch(a);
      return effect+typeof n+typeof true+typeof a+typeof "x";
    }
  `);
  const lowered = lowerModuleEntries(
    checked,
    checked.bindings.functions
      .filter((f) => f.parent === undefined)
      .map((f) => f.id),
    target,
    4096,
    {
      lists: [{ element: "number", runtime: runtime }],
    },
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
  const instructions = lowered.value.module.functions
    .at(-1)!
    .blocks.flatMap((b) => b.instructions);
  assert.ok(instructions.some((i) => i.kind === "call"));
  assert.ok(instructions.some((i) => i.kind === "optional-present"));
});

test("splice lowers insertion and deletion through explicit list operations", () => {
  const f = fixture(
    "function run():number{const a=[1,2,3];const removed=a.splice(-2,1,7,8);return a.length+(removed[0]??0);}",
  );
  const r = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("splice rejects missing or incompatible mutation capabilities", () => {
  const f = fixture(
    "function run():number{const a=[1];return a.splice(0,1).length;}",
  );
  const missing = {
    create: f.runtime.create,
    read: f.runtime.read,
    write: f.runtime.write,
    push: f.runtime.push,
    length: f.runtime.length,
  };
  for (const runtime of [
    missing,
    { ...f.runtime, has: f.runtime.read },
    { ...f.runtime, resize: f.runtime.push },
  ]) {
    const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: "number", runtime }],
    });
    assert.equal(result.ok, false);
  }
});

test("pop lowers through list reads and resizing with an optional result", () => {
  const f = fixture(
    "function run():number{const a=[1,2];return (a.pop()??0)+(a.pop()??0)+(a.pop()??0)+a.length;}",
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("array includes lowers optional values and numeric positions", () => {
  const f = fixture(
    "function run(a:readonly (number|undefined)[],search:number|undefined,start:number|undefined):boolean{return a.includes(search,start);}",
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("sort runtime bindings validate comparator, receiver, result and inclusion", () => {
  const source = `function sortHelper(list:NumberList,compare:(a:number,b:number)=>number):NumberList{return list;}
 function run():number[]{return [3,1,2].sort((a,b)=>a-b);}`;
  const f = fixture(source);
  const options = {
    lists: [
      {
        element: "number" as const,
        runtime: { ...f.runtime, sort: f.id("sortHelper") },
      },
    ],
  };
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const result = lowerModuleEntries(
      f.checked,
      entries,
      target,
      4096,
      options,
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(verify(result.value.module).ok);
    assert.ok(
      result.value.module.functions.some((fn) =>
        fn.blocks.some((b) =>
          b.instructions.some(
            (i) =>
              i.kind === "call" &&
              i.target === entries.indexOf(f.id("sortHelper")),
          ),
        ),
      ),
    );
  }
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: "number", runtime: f.runtime }],
    }).ok,
    false,
  );
  assert.equal(
    lowerModuleEntries(
      f.checked,
      f.entries.filter((id) => id !== f.id("sortHelper")),
      target,
      4096,
      options,
    ).ok,
    false,
  );
  for (const altered of [
    source.replace(
      "(a:number,b:number)=>number",
      "(a:string,b:string)=>number",
    ),
    source.replace("(a:number,b:number)=>number", "(a:1,b:1)=>number"),
    source.replace("):NumberList{return list;}", " ):number{return 1;}"),
    source
      .replace("list:NumberList", "list:{wrong:number}")
      .replace("):NumberList{return list;}", " ):{wrong:number}{return list;}"),
  ]) {
    const bad = fixture(altered);
    assert.equal(
      lowerModuleEntries(bad.checked, bad.entries, target, 4096, {
        lists: [
          {
            element: "number",
            runtime: { ...bad.runtime, sort: bad.id("sortHelper") },
          },
        ],
      }).ok,
      false,
      altered,
    );
  }
});

test("semantic primitive-union arrays cannot use a homogeneous numeric runtime", () => {
  const f = fixture(
    'function run():number{const values:(number|string)[]=[1,"x"];return values.length;}',
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.match(result.error, /list runtime|unsupported.*type|representation/);
});

test("indexOf requires a presence helper to distinguish holes from undefined", () => {
  const f = fixture("function run():number{return [1].indexOf(undefined);}");
  assert.ok(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: "number", runtime: f.runtime }],
    }).ok,
  );
  const { has, ...runtime } = f.runtime;
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /presence helper/);
});

test("reverse requires presence and deletion contracts and preserves the array result", () => {
  const f = fixture(
    "function reverse(a:number[]):number[]{return a.reverse();}",
  );
  const options = {
    lists: [{ element: "number" as const, runtime: f.runtime }],
  };
  const result = lowerModuleEntries(
    f.checked,
    f.entries,
    target,
    4096,
    options,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  const { has, ...missingPresence } = f.runtime;
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: "number", runtime: missingPresence }],
    }).ok,
  );
  const { delete: deletion, ...missingDeletion } = f.runtime;
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      lists: [{ element: "number", runtime: missingDeletion }],
    }).ok,
  );
});

test("array fill uses the element write contract with optional bounds", () => {
  const f = fixture(
    "function fill(a:number[],b:number|undefined,e:number|undefined):number[]{return a.fill(42,b,e);}",
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("computed array lengths use the list length contract", () => {
  const f = fixture(
    'function length(a:number[],k:"length"):number{return a[k];}',
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("shift and unshift preserve sparse elements through explicit list contracts", () => {
  const f = fixture(
    "function f(a:number[]):number|undefined{a.unshift(1,2);return a.shift();}",
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("empty satisfies arrays retain never elements and use a hole-only list carrier", () => {
  const f = fixture(
    "function f():number{const a=[] satisfies readonly number[];a.length=3;return a.at(0)===undefined?a.length:0;}",
  );
  const result = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    lists: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
