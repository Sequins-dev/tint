import type {
  OrdinaryObject,
  ScriptPropertyKey,
  ObjectHooks,
} from "../src/objects/index.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import { exoticSlots } from "../src/objects/operations.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const o = await import("../src/objects/index.ts");
type Obj = OrdinaryObject<ScriptPropertyKey, unknown>;
// Node ephemeron table holds values only through their weak key. Cell handles
// retain a WeakRef and an ID, so values pointing back at keys cannot keep them alive.
function storage() {
  const values = new WeakMap<object, Map<number, unknown>>();
  let next = 0;
  type Cell = {
    key: WeakRef<object> | undefined;
    id: number;
    ephemeron: boolean;
  };
  const service = {
    create(key: unknown, value: unknown, ephemeron: boolean): unknown {
      const object = key as object,
        id = next++,
        cell: Cell = { key: new WeakRef(object), id, ephemeron };
      if (ephemeron) {
        let entries = values.get(object);
        if (!entries) {
          entries = new Map();
          values.set(object, entries);
        }
        entries.set(id, value);
      }
      return cell;
    },
    key(handle: unknown): unknown {
      return (handle as Cell).key?.deref();
    },
    value(handle: unknown): unknown {
      const cell = handle as Cell,
        key = cell.key?.deref();
      return key === undefined ? undefined : values.get(key)?.get(cell.id);
    },
    setValue(handle: unknown, value: unknown): void {
      const cell = handle as Cell,
        key = cell.key?.deref();
      assert.ok(key && cell.ephemeron);
      values.get(key)!.set(cell.id, value);
    },
    clear(handle: unknown): void {
      const cell = handle as Cell,
        key = cell.key?.deref();
      if (key) values.get(key)?.delete(cell.id);
      cell.key = undefined;
    },
  };
  return service;
}
function setup() {
  assert.equal(typeof o.installWeakCollectionIntrinsics, "function");
  const root = o.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (fn, receiver, args) => {
      const r = o.callObjectValue(fn, receiver, args, root);
      assert.equal(r.error, "none");
      return r.value;
    },
  };
  const realm = o.createErrorRealm(root, hooks);
  realm.agent.weakStorage = storage();
  o.installWeakCollectionIntrinsics(root, realm, hooks);
  const get = (object: Obj, name: string) =>
    o.getProperty(object, name, object, hooks);
  const make = (name: string) => {
    const ctor = get(root, name) as Obj,
      r = o.constructObjectValue(ctor, [], root);
    assert.equal(r.error, "none");
    return r.value as Obj;
  };
  const call = (object: Obj, name: string, args: unknown[] = []) => {
    const r = o.callObjectValue(get(object, name), object, args, root);
    assert.equal(r.error, "none");
    return r.value;
  };
  const type = (action: () => unknown) =>
    assert.throws(
      action,
      (e) => (e as Obj).prototype === realm.prototypes.get("type"),
    );
  return {
    root,
    realm,
    hooks,
    get,
    make,
    call,
    type,
    key: () => o.createObject<ScriptPropertyKey, unknown>(undefined),
  };
}
test("weak collections preserve key identity, symbols, undefined values and separate brands", () => {
  const f = setup(),
    map = f.make("WeakMap"),
    set = f.make("WeakSet"),
    key = f.key(),
    other = f.key();
  assert.equal(f.call(map, "set", [key, undefined]), map);
  assert.equal(f.call(map, "has", [key]), true);
  assert.equal(f.call(map, "has", [other]), false);
  assert.equal(f.call(map, "get", [key]), undefined);
  assert.equal(f.call(map, "delete", [key]), true);
  assert.equal(f.call(map, "delete", [key]), false);
  assert.equal(f.call(set, "add", [key]), set);
  assert.equal(f.call(set, "has", [key]), true);
  const symbol = o.createSymbolValue("key");
  f.call(map, "set", [symbol, 42]);
  assert.equal(f.call(map, "get", [symbol]), 42);
  const registered = o.registeredSymbol(f.realm.symbolRegistry, "registered");
  for (const invalid of [undefined, null, 0, "x", false, registered]) {
    f.type(() => f.call(map, "set", [invalid, 1]));
    f.type(() => f.call(set, "add", [invalid]));
    assert.equal(f.call(map, "has", [invalid]), false);
    assert.equal(f.call(set, "delete", [invalid]), false);
  }
  const method = f.get(map, "get") as Obj;
  f.type(() => method.internalRareSlots!.internalCall!(set, [key]));
});
test("weak map upserts validate callbacks, skip hits and replace callback insertions", () => {
  const f = setup(),
    map = f.make("WeakMap"),
    key = f.key();
  f.call(map, "set", [key, 19]);
  assert.equal(f.call(map, "getOrInsert", [key, 42]), 19);
  f.type(() => f.call(map, "getOrInsertComputed", [key, 0]));
  let calls = 0;
  const callback = o.createCallableObject<ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    (receiver, args) => {
      assert.equal(receiver, undefined);
      assert.equal(args[0], key);
      calls++;
      f.call(map, "set", [key, 23]);
      return 42;
    },
  );
  assert.equal(f.call(map, "getOrInsertComputed", [key, callback]), 19);
  assert.equal(calls, 0);
  f.call(map, "delete", [key]);
  assert.equal(f.call(map, "getOrInsertComputed", [key, callback]), 42);
  assert.equal(calls, 1);
  assert.equal(f.call(map, "get", [key]), 42);
});
test("WeakRef retains constructor/deref targets until the host checkpoint and returns undefined after clearing", () => {
  const f = setup();
  assert.equal(typeof o.installWeakRefIntrinsics, "function");
  o.installWeakRefIntrinsics(f.root, f.realm, f.hooks);
  const key = f.key(),
    constructor = f.get(f.root, "WeakRef") as Obj;
  const built = o.constructObjectValue(constructor, [key], f.root);
  assert.equal(built.error, "none");
  const ref = built.value as Obj;
  assert.ok(f.realm.agent.keptAlive.includes(key));
  assert.equal(f.call(ref, "deref"), key);
  o.clearKeptObjects(f.realm.agent);
  assert.equal(f.realm.agent.keptAlive.length, 0);
  assert.equal(f.call(ref, "deref"), key);
  assert.ok(f.realm.agent.keptAlive.includes(key));
  o.clearKeptObjects(f.realm.agent);
  const data = exoticSlots(ref).internalWeakData;
  assert.equal(data?.kind, "ref");
  if (data?.kind !== "ref") throw Error("brand");
  data.storage.clear(data.cell);
  assert.equal(f.call(ref, "deref"), undefined);
  assert.equal(f.realm.agent.keptAlive.length, 0);
  for (const invalid of [
    undefined,
    null,
    1,
    "x",
    o.registeredSymbol(f.realm.symbolRegistry, "registered"),
  ])
    f.type(() => o.constructObjectValue(constructor, [invalid], f.root));
  const deref = f.get(ref, "deref") as Obj;
  f.type(() => deref.internalRareSlots!.internalCall!(f.make("WeakMap"), []));
});
test("FinalizationRegistry validates held values and tokens, and unregister removes every matching cell", () => {
  const f = setup();
  assert.equal(typeof o.installFinalizationRegistryIntrinsics, "function");
  o.installFinalizationRegistryIntrinsics(f.root, f.realm, f.hooks);
  const callback = o.createCallableObject<ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => undefined,
    ),
    constructor = f.get(f.root, "FinalizationRegistry") as Obj;
  const built = o.constructObjectValue(constructor, [callback], f.root);
  assert.equal(built.error, "none");
  const registry = built.value as Obj;
  const key = f.key(),
    token = f.key();
  assert.equal(f.call(registry, "register", [key, 19, token]), undefined);
  f.call(registry, "register", [key, 23, token]);
  assert.equal(f.call(registry, "unregister", [token]), true);
  assert.equal(f.call(registry, "unregister", [token]), false);
  f.type(() => f.call(registry, "register", [key, key]));
  f.type(() => f.call(registry, "register", [key, 1, null]));
  f.type(() => f.call(registry, "unregister", [undefined]));
  f.type(() => o.constructObjectValue(constructor, [undefined], f.root));
});
test("finalization cleanup is queued outside collection, removes cells before callbacks and continues after errors", () => {
  const f = setup();
  assert.equal(typeof o.installFinalizationRegistryIntrinsics, "function");
  o.installFinalizationRegistryIntrinsics(f.root, f.realm, f.hooks);
  const seen: unknown[] = [],
    errors: unknown[] = [],
    // Thrown values are JavaScript values: ordinary objects of the realm.
    failure = o.createObject<ScriptPropertyKey, unknown>(
      f.realm.objectPrototype,
    );
  const callback = o.createCallableObject<ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    (receiver, args) => {
      assert.equal(receiver, undefined);
      assert.equal(args.length, 1);
      seen.push(args[0]);
      if (args[0] === 19) throw failure;
      return undefined;
    },
  );
  const constructor = f.get(f.root, "FinalizationRegistry") as Obj,
    built = o.constructObjectValue(constructor, [callback], f.root);
  assert.equal(built.error, "none");
  const registry = built.value as Obj;
  f.call(registry, "register", [f.key(), 19]);
  f.call(registry, "register", [f.key(), 23]);
  const data = exoticSlots(registry).internalWeakData;
  if (data?.kind !== "registry") throw Error("brand");
  for (const cell of data.cells) data.storage.clear(cell.target);
  assert.deepEqual(seen, []);
  o.drainScriptJobs(f.realm.agent, (error) => errors.push(error));
  assert.deepEqual(seen, [19, 23]);
  assert.deepEqual(errors, [failure]);
  assert.equal(data.cells.length, 0);
  assert.equal(data.scheduled, false);
});
test("weak map operations stay linear in total for a long chain of keys", () => {
  const f = setup(),
    map = f.make("WeakMap"),
    storage = f.realm.agent.weakStorage!;
  let keyReads = 0;
  const key = storage.key.bind(storage);
  storage.key = (cell: unknown): unknown => {
    keyReads++;
    return key(cell);
  };
  // staging/sm/regress-1507322-deep-weakmap shape: each value is the next key.
  const n = 2000,
    head = f.key();
  let current: Obj = head;
  for (let i = 0; i < n; i++) {
    f.call(map, "set", [current, f.key()]);
    current = f.call(map, "get", [current]) as Obj;
  }
  let length = 0;
  for (let k: unknown = head; k !== undefined; k = f.call(map, "get", [k]))
    length++;
  assert.equal(length, n + 1);
  // A linear scan per operation needs about n * n / 2 key reads.
  assert.ok(keyReads < 20 * n, `${keyReads} key reads for ${n} keys`);
});
test("weak cells survive delete and reinsertion churn and mixed symbol keys", () => {
  const f = setup(),
    map = f.make("WeakMap"),
    set = f.make("WeakSet"),
    keys = Array.from({ length: 300 }, () => f.key()),
    symbols = Array.from({ length: 5 }, (_, i) => o.createSymbolValue("s" + i));
  for (let round = 0; round < 6; round++) {
    keys.forEach((k, i) => f.call(map, "set", [k, round * 1000 + i]));
    keys.forEach((k, i) => {
      if (i % 3 === round % 3) assert.equal(f.call(map, "delete", [k]), true);
    });
    keys.forEach((k, i) =>
      assert.equal(
        f.call(map, "get", [k]),
        i % 3 === round % 3 ? undefined : round * 1000 + i,
      ),
    );
    symbols.forEach((s) => f.call(set, "add", [s]));
    assert.equal(f.call(set, "delete", [symbols[round % 5]]), true);
    assert.equal(f.call(set, "has", [symbols[round % 5]]), false);
    f.call(set, "add", [symbols[round % 5]]);
  }
  const data = exoticSlots(map).internalWeakData;
  assert.ok(data !== undefined && data.kind === "map");
  if (data.kind !== "map") throw Error("brand");
  assert.ok(data.identities.length <= 2 * keys.length + 64);
  for (const s of symbols) assert.equal(f.call(set, "has", [s]), true);
  assert.equal(f.call(map, "has", [f.key()]), false);
});
