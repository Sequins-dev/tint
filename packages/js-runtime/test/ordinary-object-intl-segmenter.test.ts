import { after, test } from "node:test";
import assert from "node:assert/strict";
import type {
  OrdinaryObject,
  ScriptPropertyKey,
  ObjectHooks,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const o = await import("../src/objects/index.ts");
type Obj = OrdinaryObject<ScriptPropertyKey, unknown>;

function setup() {
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
  o.installIntlIntrinsics(root, realm, hooks);
  const intl = o.getOwnProperty(root, "Intl")!.value as Obj;
  const constructor = o.getOwnProperty(intl, "Segmenter")?.value as Obj;
  assert.ok(constructor, "Intl.Segmenter is installed");
  const prototype = o.getOwnProperty(constructor, "prototype")!.value as Obj;
  const get = (object: Obj, key: ScriptPropertyKey) =>
    o.getProperty(object, key, object, hooks);
  const method = (object: Obj, name: ScriptPropertyKey) =>
    get(object, name) as Obj;
  const call = (fn: Obj, receiver: unknown, args: unknown[] = []) =>
    fn.internalCall!(receiver, args);
  const options = (fields: Record<string, unknown>) => {
    const result = o.createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    for (const [k, v] of Object.entries(fields))
      o.createDataProperty(result, k, v, hooks);
    return result;
  };
  const make = (locale: unknown = undefined, input: unknown = undefined) =>
    constructor.internalConstruct!([locale, input], constructor) as Obj;
  const iteratorKey = o.wellKnownSymbol(realm.symbolRegistry, "iterator");
  const tagKey = o.wellKnownSymbol(realm.symbolRegistry, "toStringTag");
  const segments = (segmenter: Obj, text: string) =>
    call(method(prototype, "segment"), segmenter, [text]) as Obj;
  const collect = (segmenter: Obj, text: string) => {
    const s = segments(segmenter, text);
    const iterator = call(method(s, iteratorKey), s) as Obj;
    const next = method(iterator, "next");
    const out: Obj[] = [];
    for (;;) {
      const step = call(next, iterator) as Obj;
      if (get(step, "done") === true) break;
      out.push(get(step, "value") as Obj);
    }
    return out;
  };
  const isError = (kind: string) => (e: unknown) =>
    (e as Obj).prototype === realm.prototypes.get(kind);
  return {
    realm,
    hooks,
    constructor,
    prototype,
    get,
    method,
    call,
    options,
    make,
    segments,
    collect,
    iteratorKey,
    tagKey,
    isError,
  };
}

test("Intl.Segmenter resolves granularity and a supported locale", () => {
  const f = setup();
  for (const [input, expected] of [
    [undefined, "grapheme"],
    ["grapheme", "grapheme"],
    ["word", "word"],
    ["sentence", "sentence"],
  ] as const) {
    const segmenter = f.make(
      "en-US",
      input === undefined ? undefined : f.options({ granularity: input }),
    );
    const resolved = f.call(
      f.method(f.prototype, "resolvedOptions"),
      segmenter,
    ) as Obj;
    assert.equal(f.get(resolved, "granularity"), expected);
    assert.equal(typeof f.get(resolved, "locale"), "string");
    assert.deepEqual(o.ownKeys(resolved, o.scriptPropertyKeyOrder), [
      "locale",
      "granularity",
    ]);
  }
  assert.throws(
    () => f.make(undefined, f.options({ granularity: "line" })),
    f.isError("range"),
  );
  assert.throws(
    () => f.make(undefined, f.options({ localeMatcher: "nope" })),
    f.isError("range"),
  );
  assert.throws(() => f.make(undefined, "options"), f.isError("type"));
  assert.throws(
    () => f.constructor.internalCall!(undefined, []),
    f.isError("type"),
  );
});

test("option reads happen in specification order", () => {
  const f = setup();
  const reads: string[] = [];
  const options = o.createObject<ScriptPropertyKey, unknown>(
    f.realm.objectPrototype,
  );
  for (const name of ["granularity", "localeMatcher"])
    o.defineOwnProperty(
      options,
      name,
      {
        fields: 4 | 16 | 32,
        value: undefined,
        writable: false,
        get: o.createCallableObject<ScriptPropertyKey, unknown>(
          f.realm.functionPrototype,
          () => {
            reads.push(name);
            return undefined;
          },
        ),
        set: undefined,
        enumerable: true,
        configurable: true,
      },
      f.hooks,
    );
  f.make(undefined, options);
  assert.deepEqual(reads, ["localeMatcher", "granularity"]);
});

test("segments iterate the whole input with word-like flags only for words", () => {
  const f = setup();
  const word = f.make(undefined, f.options({ granularity: "word" }));
  const parts = f.collect(word, "Hello world!");
  assert.deepEqual(
    parts.map((p) => f.get(p, "segment")),
    ["Hello", " ", "world", "!"],
  );
  assert.deepEqual(
    parts.map((p) => f.get(p, "index")),
    [0, 5, 6, 11],
  );
  assert.deepEqual(
    parts.map((p) => f.get(p, "isWordLike")),
    [true, false, true, false],
  );
  assert.deepEqual(o.ownKeys(parts[0]!, o.scriptPropertyKeyOrder), [
    "segment",
    "index",
    "input",
    "isWordLike",
  ]);
  const grapheme = f.make();
  const clusters = f.collect(grapheme, "é\u{1F1FA}\u{1F1F8}");
  assert.deepEqual(
    clusters.map((p) => f.get(p, "segment")),
    ["é", "\u{1F1FA}\u{1F1F8}"],
  );
  assert.deepEqual(o.ownKeys(clusters[0]!, o.scriptPropertyKeyOrder), [
    "segment",
    "index",
    "input",
  ]);
  const sentence = f.make(undefined, f.options({ granularity: "sentence" }));
  assert.deepEqual(
    f.collect(sentence, "Hi. Bye.").map((p) => f.get(p, "segment")),
    ["Hi. ", "Bye."],
  );
  assert.deepEqual(f.collect(grapheme, ""), []);
});

test("containing finds the segment for an index and rejects out-of-range input", () => {
  const f = setup();
  const segmenter = f.make(undefined, f.options({ granularity: "word" }));
  const s = f.segments(segmenter, "a c");
  const containing = f.method(s, "containing");
  for (const index of [1, 1.49, "1", true]) {
    const result = f.call(containing, s, [index]) as Obj;
    assert.equal(f.get(result, "segment"), " ");
    assert.equal(f.get(result, "index"), 1);
    assert.equal(f.get(result, "input"), "a c");
  }
  assert.equal(f.get(f.call(containing, s, []) as Obj, "segment"), "a");
  for (const index of [-1, 3, Infinity, -Infinity])
    assert.equal(f.call(containing, s, [index]), undefined);
  // Iteration and containing share one Segments object independently.
  const iterator = f.call(f.method(s, f.iteratorKey), s) as Obj;
  const next = f.method(iterator, "next");
  assert.equal(
    f.get(f.get(f.call(next, iterator) as Obj, "value") as Obj, "segment"),
    "a",
  );
  assert.equal(f.get(f.call(containing, s, [2]) as Obj, "segment"), "c");
  assert.equal(
    f.get(f.get(f.call(next, iterator) as Obj, "value") as Obj, "segment"),
    " ",
  );
});

test("methods brand-check their receivers and tags match the specification", () => {
  const f = setup();
  const segmenter = f.make();
  const s = f.segments(segmenter, "ab");
  const iterator = f.call(f.method(s, f.iteratorKey), s) as Obj;
  const plain = o.createObject<ScriptPropertyKey, unknown>(
    f.realm.objectPrototype,
  );
  for (const receiver of [plain, s, iterator, undefined])
    assert.throws(
      () => f.call(f.method(f.prototype, "segment"), receiver, ["x"]),
      f.isError("type"),
    );
  for (const receiver of [plain, segmenter, iterator])
    assert.throws(
      () => f.call(f.method(s, "containing"), receiver, [0]),
      f.isError("type"),
    );
  for (const receiver of [plain, segmenter, s])
    assert.throws(
      () => f.call(f.method(iterator, "next"), receiver),
      f.isError("type"),
    );
  assert.equal(f.get(f.prototype, f.tagKey), "Intl.Segmenter");
  assert.equal(f.get(iterator, f.tagKey), "Segmenter String Iterator");
  assert.equal(
    o.getOwnProperty(f.realm.segmentsPrototype, f.tagKey),
    undefined,
  );
  assert.equal(
    o.getPrototype(f.realm.segmentIteratorPrototype),
    f.realm.iteratorPrototype,
  );
});
