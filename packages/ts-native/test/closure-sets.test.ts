import { bindModule } from "@tint/typescript/binding";
import { specializeModule } from "@tint/ts-native/modules";
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
function fixture(source: string, element: string = "string") {
  const bytes = new TextEncoder().encode(
    readFileSync(
      new URL(
        "../../foundation/src/collections/linked-set.ts",
        import.meta.url,
      ),
      "utf8",
    ) + source,
  );
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindModule(parsed.value, ["undefined", "Set"]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const helperNames = [
    "createSet",
    "hasSet",
    "addSet",
    "deleteSet",
    "clearSet",
    "sizeSet",
    "createSetCursor",
    "advanceSetCursor",
    "readSetCursor",
    "cloneSet",
  ];
  const roots = helperNames.map((name) => {
    const node = parsed.value.statements.find(
      (s) => s.kind === "function" && s.name === name,
    );
    const fn = bound.value.functions.find((f) => f.node === node);
    assert.ok(fn);
    return {
      function: fn.id,
      arguments: [{ kind: "named", name: element, start: 0, end: 0 } as const],
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
  return {
    checked: checked.value,
    entries: checked.value.bindings.functions.map((f) => f.id),
    id,
    iterator: {
      create: id("createSetCursor"),
      advance: id("advanceSetCursor"),
      read: id("readSetCursor"),
    },
    runtime: {
      create: id("createSet"),
      has: id("hasSet"),
      add: id("addSet"),
      delete: id("deleteSet"),
      clear: id("clearSet"),
      size: id("sizeSet"),
    },
  };
}
test("same-element Set construction uses a validated linear clone binding", () => {
  const f = fixture(
    "function run(source:Set<number>):Set<number>{return new Set(source);}",
    "number",
  );
  const runtime = {
    ...f.runtime,
    clone: f.id("cloneSet"),
    iterator: f.iterator,
  };
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const result = lowerModuleEntries(f.checked, entries, target, 4096, {
      sets: [{ element: "number", runtime }],
    });
    assert.ok(result.ok, JSON.stringify(result));
    const run = result.value.module.functions[entries.indexOf(f.id("run"))]!;
    const calls = run.blocks
      .flatMap((block) => block.instructions)
      .filter((op) => op.kind === "call");
    assert.deepEqual(
      calls.map((call) => call.target),
      [entries.indexOf(runtime.clone)],
    );
    assert.ok(verify(result.value.module).ok);
  }
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      sets: [
        { element: "number", runtime: { ...runtime, clone: runtime.size } },
      ],
    }).ok,
    false,
  );
});
test("string sets lower through explicit runtime bindings and relocate entry IDs", () => {
  const f = fixture(`
 interface Box {readonly values:ReadonlySet<string>}
 function view(s:Set<string>):Box{return {values:s};}
 function run():number {
   const s=new Set<string>();s.add("a").add("b");
   if(!view(s).values.has("a"))return -1;
   s.delete("b");const n=s.size;s.clear();return n;
 }`);
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const r = lowerModuleEntries(f.checked, entries, target, 4096, {
      sets: [{ element: "string", runtime: f.runtime }],
    });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(verify(r.value.module).ok);
    const run = r.value.module.functions[entries.indexOf(f.id("run"))]!;
    const calls = run.blocks
      .flatMap((b) => b.instructions)
      .filter((i) => i.kind === "call");
    for (const id of Object.values(f.runtime).filter(
      (id) => id !== f.runtime.has,
    ))
      assert.ok(calls.some((c) => c.target === entries.indexOf(id)));
  }
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096).ok,
    false,
  );
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      sets: [
        { element: "string", runtime: { ...f.runtime, size: f.runtime.add } },
      ],
    }).ok,
    false,
  );
  assert.equal(
    lowerModuleEntries(
      f.checked,
      f.entries.filter((id) => id !== f.runtime.add),
      target,
      4096,
      { sets: [{ element: "string", runtime: f.runtime }] },
    ).ok,
    false,
  );
});
test("string set runtime rejects incompatible receivers and unsupported elements", () => {
  const f = fixture(
    "interface Wrong{value:number}function wrong(w:Wrong):number{return w.value;}function run():number{return new Set<string>().size;}",
  );
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      sets: [
        { element: "string", runtime: { ...f.runtime, size: f.id("wrong") } },
      ],
    }).ok,
    false,
  );
  const n = fixture("function run():number{return new Set<number>().size;}");
  assert.equal(
    lowerModuleEntries(n.checked, n.entries, target, 4096, {
      sets: [{ element: "string", runtime: n.runtime }],
    }).ok,
    false,
  );
});

test("runtime string parameters must accept all strings, not only their encoding", () => {
  const f = fixture(
    'function narrow(s:LinkedSet<string>,v:"a"):boolean{return hasSet<string>(s,v);}function run():number{return new Set<string>().size;}',
  );
  const r = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    sets: [
      { element: "string", runtime: { ...f.runtime, has: f.id("narrow") } },
    ],
  });
  assert.ok(!r.ok);
  assert.match(r.error, /parameter contract/);
});

test("numeric sets select numeric specializations and reject mismatched or duplicate runtime bindings", () => {
  const f = fixture(
    "function read(s:ReadonlySet<number>):number{return s.size;}function run():number{const s=new Set<number>();s.add(0/0).add(-0);if(!s.has(0/0))return -1;s.delete(0);return read(s);}",
    "number",
  );
  const r = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    sets: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      sets: [{ element: "string", runtime: f.runtime }],
    }).ok,
  );
  assert.ok(
    !lowerModuleEntries(f.checked, f.entries, target, 4096, {
      sets: [
        { element: "number", runtime: f.runtime },
        { element: "number", runtime: f.runtime },
      ],
    }).ok,
  );
  const string = fixture(
    "function run():number{return new Set<number>().size;}",
  );
  assert.ok(
    !lowerModuleEntries(string.checked, string.entries, target, 4096, {
      sets: [{ element: "number", runtime: string.runtime }],
    }).ok,
  );
});

test("sets infer numeric elements from typed-array constructor inputs", () => {
  const f = fixture(
    `function run(input:Uint8Array):number {
    const values=new Set(input);return values.size;
  }`,
    "number",
  );
  const lowered = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    sets: [{ element: "number", runtime: f.runtime }],
  });
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
  const run = lowered.value.module.functions[f.entries.indexOf(f.id("run"))]!;
  assert.ok(
    run.blocks
      .flatMap((b) => b.instructions)
      .some((i) => i.kind === "array-read"),
  );
  assert.ok(
    run.blocks
      .flatMap((b) => b.instructions)
      .some(
        (i) =>
          i.kind === "call" && i.target === f.entries.indexOf(f.runtime.add),
      ),
  );
});

test("set iteration validates cursor receiver contracts and included helpers", () => {
  const f = fixture(
    "function run(values:ReadonlySet<number>):number{let sum=0;for(const value of values)sum+=value;return sum;}",
    "number",
  );
  const runtime = { ...f.runtime, iterator: f.iterator };
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const result = lowerModuleEntries(f.checked, entries, target, 4096, {
      sets: [{ element: "number", runtime }],
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(verify(result.value.module).ok);
  }
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      sets: [{ element: "number", runtime: f.runtime }],
    }).ok,
    false,
  );
  for (const iterator of [
    { ...f.iterator, create: f.runtime.create },
    { ...f.iterator, advance: f.runtime.has },
    { ...f.iterator, read: f.runtime.size },
  ])
    assert.equal(
      lowerModuleEntries(f.checked, f.entries, target, 4096, {
        sets: [{ element: "number", runtime: { ...f.runtime, iterator } }],
      }).ok,
      false,
    );
  assert.equal(
    lowerModuleEntries(
      f.checked,
      f.entries.filter((id) => id !== f.iterator.advance),
      target,
      4096,
      { sets: [{ element: "number", runtime }] },
    ).ok,
    false,
  );
});

test("Set copies require an iterator contract and relocate its helpers", () => {
  const f = fixture(
    "function run(values:ReadonlySet<number>):number{const copy=new Set(values);return copy.size;}",
    "number",
  );
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      sets: [{ element: "number", runtime: f.runtime }],
    }).ok,
    false,
  );
  for (const entries of [f.entries, [...f.entries].reverse()]) {
    const result = lowerModuleEntries(f.checked, entries, target, 4096, {
      sets: [
        { element: "number", runtime: { ...f.runtime, iterator: f.iterator } },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(verify(result.value.module).ok);
  }
});

test("object sets preserve reference contracts through iteration", () => {
  const f = fixture(
    `interface Item {value:number}
 interface Wrong {text:string}
 function wrongRead(cursor:SetCursor<Item>):Wrong{return {text:"bad"};}
 function run():number{const s=new Set<Item>();const item:Item={value:7};s.add(item);let result=0;for(const value of s){result+=value.value;}return result;}`,
    "Item",
  );
  const body = f.checked.bodies.get(f.runtime.add)!;
  const parameter = body.parameters[1]!;
  const binding = f.checked.bindings.bindings.find(
    (b) => b.node === parameter,
  )!;
  const element = f.checked.bindingTypes[binding.id]!;
  const lowered = lowerModuleEntries(f.checked, f.entries, target, 4096, {
    sets: [{ element, runtime: { ...f.runtime, iterator: f.iterator } }],
  });
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
  assert.equal(
    lowerModuleEntries(f.checked, f.entries, target, 4096, {
      sets: [
        {
          element,
          runtime: {
            ...f.runtime,
            iterator: { ...f.iterator, read: f.id("wrongRead") },
          },
        },
      ],
    }).ok,
    false,
  );
});
