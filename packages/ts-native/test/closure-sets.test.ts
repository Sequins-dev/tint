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
// These are ABI contract tests for the set helper bindings, independent of the
// production set's storage: a self-contained linear set with the same API.
const linearSet = `interface SetEntry<T> {
  readonly value: T;
  readonly order: number;
  next: SetEntry<T> | undefined;
}
export interface LinkedSet<T> {
  head: SetEntry<T> | undefined;
  tail: SetEntry<T> | undefined;
  size: number;
  order: number;
}
export function createSet<T>(): LinkedSet<T> {
  return { head: undefined, tail: undefined, size: 0, order: 0 };
}
export function hasSet<T>(set: LinkedSet<T>, value: T): boolean {
  let entry = set.head;
  while (entry !== undefined) {
    if (
      entry.value === value ||
      (entry.value !== entry.value && value !== value)
    )
      return true;
    entry = entry.next;
  }
  return false;
}
/** Return whether a new member was added. Duplicate insertion does not allocate. */
export function addSet<T>(set: LinkedSet<T>, value: T): boolean {
  if (hasSet<T>(set, value)) return false;
  appendSet<T>(set, value);
  return true;
}
/** Append an already unique member. Keep ownership/order updates shared by
 * insertion and cloning without repeating a membership search during a copy. */
function appendSet<T>(set: LinkedSet<T>, value: T): void {
  if (set.order >= 9007199254740991) throw "SET_ORDER_LIMIT";
  const order = set.order + 1;
  const entry: SetEntry<T> = { value, next: undefined, order };
  const tail = set.tail;
  if (tail === undefined) set.head = entry;
  else tail.next = entry;
  set.order = order;
  set.tail = entry;
  set.size = set.size + 1;
}
/** Copy the live insertion sequence in linear time. Links and order counters are
 * independent; member values retain their identity. The source is not mutated. */
export function cloneSet<T>(source: LinkedSet<T>): LinkedSet<T> {
  const result = createSet<T>();
  let entry = source.head;
  while (entry !== undefined) {
    appendSet<T>(result, entry.value);
    entry = entry.next;
  }
  return result;
}
export function deleteSet<T>(set: LinkedSet<T>, value: T): boolean {
  let entry = set.head;
  let previous: SetEntry<T> | undefined = undefined;
  while (entry !== undefined) {
    if (
      entry.value === value ||
      (entry.value !== entry.value && value !== value)
    ) {
      if (previous === undefined) set.head = entry.next;
      else previous.next = entry.next;
      if (set.tail === entry) set.tail = previous;
      set.size = set.size - 1;
      return true;
    }
    previous = entry;
    entry = entry.next;
  }
  return false;
}
export function clearSet<T>(set: LinkedSet<T>): void {
  set.head = undefined;
  set.tail = undefined;
  set.size = 0;
}
export function sizeSet<T>(set: LinkedSet<T>): number {
  return set.size;
}

/** Cursor state is private to these operations; exhaustion releases the set. */
export interface SetCursor<T> {
  set: LinkedSet<T> | undefined;
  after: number;
  current: SetEntry<T> | undefined;
  next: SetEntry<T> | undefined;
  tail: SetEntry<T> | undefined;
  size: number;
}
export function createSetCursor<T>(set: LinkedSet<T>): SetCursor<T> {
  return {
    set,
    after: 0,
    current: undefined,
    next: set.head,
    tail: set.tail,
    size: set.size,
  };
}
export function advanceSetCursor<T>(cursor: SetCursor<T>): boolean {
  const set = cursor.set;
  cursor.current = undefined;
  if (set === undefined) return false;
  // Without structural changes, the next live link is already known. Tail
  // identity and size together detect every change to the surviving sequence:
  // additions append fresh tail nodes, while deletion alone reduces its size.
  let selected = cursor.next;
  if (cursor.tail !== set.tail || cursor.size !== set.size) {
    selected = set.head;
    while (selected !== undefined && selected.order <= cursor.after)
      selected = selected.next;
  }
  if (selected === undefined) {
    cursor.set = undefined;
    cursor.next = undefined;
    cursor.tail = undefined;
    return false;
  }
  cursor.next = selected.next;
  cursor.tail = set.tail;
  cursor.size = set.size;
  cursor.current = selected;
  cursor.after = selected.order;
  return true;
}
export function readSetCursor<T>(cursor: SetCursor<T>): T {
  const entry = cursor.current;
  if (entry === undefined) throw "SET_CURSOR_NOT_POSITIONED";
  return entry.value;
}
`;
function fixture(source: string, element: string = "string") {
  const bytes = new TextEncoder().encode(linearSet + source);
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
