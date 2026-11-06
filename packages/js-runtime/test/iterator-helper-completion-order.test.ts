import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;
type Method = (receiver: unknown, ...args: unknown[]) => unknown;

/** A realm with the Iterator constructor and helpers installed. Script-visible
 * protocol participants are host callables that append to one ordered log. */
function fixture() {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) => {
      const result = objects.callObjectValue(callee, receiver, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = objects.createErrorRealm(root, hooks);
  objects.installErrorIntrinsics(root, realm, hooks);
  objects.installFunctionIntrinsics(root, realm, hooks);
  objects.installIteratorConstructor(root, realm, hooks);
  const log: string[] = [];
  const fn = (body: Method): ScriptObject =>
    objects.createCallableObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args) => body(receiver, ...args),
    );
  const object = (
    properties: Record<string, unknown> = {},
    prototype: ScriptObject | undefined = realm.objectPrototype,
  ): ScriptObject => {
    const result = objects.createObject<ScriptPropertyKey, unknown>(prototype);
    for (const [key, value] of Object.entries(properties))
      assert.ok(objects.createDataProperty(result, key, value, hooks));
    return result;
  };
  const get = (target: unknown, key: ScriptPropertyKey): unknown => {
    const result = objects.getObjectValueProperty(target, key, hooks, realm);
    assert.equal(result.error, "none");
    return result.value;
  };
  const invoke = (
    target: unknown,
    key: ScriptPropertyKey,
    ...args: unknown[]
  ): unknown => hooks.call(get(target, key), target, args);
  const iteratorResult = (value: unknown, done: boolean): ScriptObject =>
    object({ value, done });
  const errorName = (error: unknown): string =>
    String(get(get(error, "constructor"), "name"));
  const thrown = (action: () => unknown): unknown => {
    try {
      action();
    } catch (error) {
      return error;
    }
    assert.fail("expected an abrupt completion");
  };
  /** An Iterator.prototype-derived iterator yielding 0..count-1. */
  const counting = (
    name: string,
    count: number,
    close: (() => unknown) | undefined = () => object(),
  ): ScriptObject => {
    let index = 0;
    const properties: Record<string, unknown> = {
      next: fn(() => {
        log.push(name + ".next");
        return index < count
          ? iteratorResult(index++, false)
          : iteratorResult(undefined, true);
      }),
    };
    if (close !== undefined)
      properties["return"] = fn(() => {
        log.push(name + ".return");
        return close();
      });
    return object(properties, realm.iteratorPrototype);
  };
  const list = (...values: unknown[]): ScriptObject =>
    objects.createArrayFromList(values, 0, realm.arrayPrototype, realm, hooks);
  const iterable = (name: string, iterator: unknown): ScriptObject => {
    const result = object();
    assert.ok(
      objects.createDataProperty(
        result,
        objects.wellKnownSymbol(realm.symbolRegistry, "iterator"),
        fn(() => {
          log.push(name + ".open");
          return iterator;
        }),
        hooks,
      ),
    );
    return result;
  };
  const accessor = (
    target: ScriptObject,
    key: ScriptPropertyKey,
    getter: () => unknown,
  ): void => {
    assert.equal(
      objects.defineOwnProperty(
        target,
        key,
        {
          fields: 60,
          value: undefined,
          writable: false,
          get: fn(getter),
          set: undefined,
          enumerable: true,
          configurable: true,
        },
        hooks,
      ),
      "accepted",
    );
  };
  const Iterator = get(root, "Iterator");
  const disposeKey = objects.wellKnownSymbol(realm.symbolRegistry, "dispose");
  return {
    accessor,
    disposeKey,
    log,
    fn,
    object,
    get,
    invoke,
    errorName,
    thrown,
    counting,
    list,
    iterable,
    Iterator,
  };
}

test("callback methods validate the callback before reading next and keep the TypeError over close failures", () => {
  const f = fixture();
  const receiver = f.counting("a", 1, () => {
    throw f.object();
  });
  f.accessor(receiver, "next", () => {
    f.log.push("get next");
    return undefined;
  });
  for (const name of [
    "map",
    "filter",
    "flatMap",
    "forEach",
    "some",
    "every",
    "find",
    "reduce",
  ]) {
    f.log.length = 0;
    const error = f.thrown(() => f.invoke(receiver, name, 1));
    assert.equal(f.errorName(error), "TypeError", name);
    assert.deepEqual(f.log, ["a.return"], name);
  }
});

test("take and drop close the receiver on argument conversion failures", () => {
  const f = fixture();
  const marker = f.object();
  const limit = f.object({
    valueOf: f.fn(() => {
      f.log.push("valueOf");
      throw marker;
    }),
  });
  for (const name of ["take", "drop"]) {
    f.log.length = 0;
    assert.equal(
      f.thrown(() => f.invoke(f.counting("a", 1), name, limit)),
      marker,
    );
    assert.deepEqual(f.log, ["valueOf", "a.return"]);
    f.log.length = 0;
    const range = f.thrown(() => f.invoke(f.counting("a", 1), name, NaN));
    assert.equal(f.errorName(range), "RangeError");
    assert.deepEqual(f.log, ["a.return"]);
  }
});

test("reentering a running helper throws without disturbing its suspended state", () => {
  const f = fixture();
  let helper: unknown;
  let reentry: unknown;
  helper = f.invoke(
    f.counting("a", 3),
    "map",
    f.fn((receiver, value) => {
      if (value === 1) reentry = f.thrown(() => f.invoke(helper, "next"));
      return value;
    }),
  );
  assert.equal(f.get(f.invoke(helper, "next"), "value"), 0);
  assert.equal(f.get(f.invoke(helper, "next"), "value"), 1);
  assert.equal(f.errorName(reentry), "TypeError");
  assert.equal(f.get(f.invoke(helper, "next"), "value"), 2);
  assert.equal(f.get(f.invoke(helper, "next"), "done"), true);
  assert.deepEqual(f.log, ["a.next", "a.next", "a.next", "a.next"]);
});

test("an uncaught reentry TypeError closes the underlying iterator and completes the helper", () => {
  const f = fixture();
  let helper: unknown;
  helper = f.invoke(
    f.counting("a", 3),
    "filter",
    f.fn(() => f.invoke(helper, "next")),
  );
  assert.equal(
    f.errorName(f.thrown(() => f.invoke(helper, "next"))),
    "TypeError",
  );
  assert.deepEqual(f.log, ["a.next", "a.return"]);
  assert.equal(f.get(f.invoke(helper, "next"), "done"), true);
  f.invoke(helper, "return");
  assert.deepEqual(f.log, ["a.next", "a.return"]);
});

test("helper return before start completes first, then closes exactly once", () => {
  const f = fixture();
  let helper: unknown;
  let observed: unknown;
  const iterator = f.counting("a", 1, () => {
    // Completion is visible to code run by the underlying return method.
    observed = f.get(f.invoke(helper, "next"), "done");
    return f.object();
  });
  helper = f.invoke(iterator, "take", 1);
  const result = f.invoke(helper, "return");
  assert.equal(f.get(result, "done"), true);
  assert.equal(f.get(result, "value"), undefined);
  assert.equal(observed, true);
  f.invoke(helper, "return");
  assert.deepEqual(f.log, ["a.return"]);
});

test("flatMap closes the outer iterator when closing the inner iterator fails", () => {
  const f = fixture();
  const innerError = f.object();
  const inner = f.counting("inner", 5, () => {
    throw innerError;
  });
  const outer = f.counting("outer", 5, () => {
    throw f.object();
  });
  const helper = f.invoke(
    outer,
    "flatMap",
    f.fn(() => inner),
  );
  f.invoke(helper, "next");
  assert.equal(
    f.thrown(() => f.invoke(helper, "return")),
    innerError,
  );
  assert.deepEqual(f.log, [
    "outer.next",
    "inner.next",
    "inner.return",
    "outer.return",
  ]);
});

test("flatMap rejects string results and closes only the outer iterator", () => {
  const f = fixture();
  const helper = f.invoke(
    f.counting("outer", 2),
    "flatMap",
    f.fn(() => "ab"),
  );
  assert.equal(
    f.errorName(f.thrown(() => f.invoke(helper, "next"))),
    "TypeError",
  );
  assert.deepEqual(f.log, ["outer.next", "outer.return"]);
});

test("eager consumers distinguish normal close failures from callback throws", () => {
  const f = fixture();
  const closeError = f.object();
  const callbackError = f.object();
  // A normal completion propagates a non-object return result as TypeError.
  const nonObject = f.counting("a", 3, () => 1);
  assert.equal(
    f.errorName(
      f.thrown(() =>
        f.invoke(
          nonObject,
          "some",
          f.fn(() => true),
        ),
      ),
    ),
    "TypeError",
  );
  // A throwing callback wins over a throwing return method.
  const throwing = f.counting("b", 3, () => {
    throw closeError;
  });
  assert.equal(
    f.thrown(() =>
      f.invoke(
        throwing,
        "forEach",
        f.fn(() => {
          throw callbackError;
        }),
      ),
    ),
    callbackError,
  );
  // Protocol failures from next do not close the iterator.
  const failing = f.counting("c", 0);
  assert.ok(
    objects.createDataProperty(
      failing,
      "next",
      f.fn(() => 1),
      {
        undefinedValue: undefined,
        sameValue: Object.is,
        call: () => undefined,
      },
    ),
  );
  assert.equal(
    f.errorName(f.thrown(() => f.invoke(failing, "toArray"))),
    "TypeError",
  );
  assert.deepEqual(f.log, ["a.next", "a.return", "b.next", "b.return"]);
});

test("Iterator.zip closes acquired iterators in reverse order, then the input iterator", () => {
  const f = fixture();
  let step = 0;
  const input = f.iterable(
    "input",
    f.object({
      next: f.fn(() => {
        f.log.push("input.next");
        const value =
          step === 0
            ? f.counting("a", 1)
            : step === 1
              ? f.counting("b", 1)
              : "rejected string";
        step++;
        return f.object({ value, done: false });
      }),
      return: f.fn(() => {
        f.log.push("input.return");
        return f.object();
      }),
    }),
  );
  assert.equal(
    f.errorName(f.thrown(() => f.invoke(f.Iterator, "zip", input))),
    "TypeError",
  );
  assert.deepEqual(f.log, [
    "input.open",
    "input.next",
    "input.next",
    "input.next",
    "b.return",
    "a.return",
    "input.return",
  ]);
});

test("Iterator.zip shortest and strict modes close the remaining iterators in reverse order", () => {
  const f = fixture();
  const shortest = f.invoke(
    f.Iterator,
    "zip",
    f.list(f.counting("a", 2), f.counting("b", 0), f.counting("c", 2)),
  );
  assert.equal(f.get(f.invoke(shortest, "next"), "done"), true);
  assert.deepEqual(f.log, ["a.next", "b.next", "c.return", "a.return"]);
  f.log.length = 0;
  const strict = f.invoke(
    f.Iterator,
    "zip",
    f.list(f.counting("a", 2), f.counting("b", 0), f.counting("c", 2)),
    f.object({ mode: "strict" }),
  );
  assert.equal(
    f.errorName(f.thrown(() => f.invoke(strict, "next"))),
    "TypeError",
  );
  assert.deepEqual(f.log, ["a.next", "b.next", "c.return", "a.return"]);
  f.log.length = 0;
  // When the first iterator finishes, strict mode steps the others once each;
  // an iterator that is still open is closed with the strict-mode TypeError.
  const leading = f.invoke(
    f.Iterator,
    "zip",
    f.list(f.counting("a", 0), f.counting("b", 0), f.counting("c", 1)),
    f.object({ mode: "strict" }),
  );
  assert.equal(
    f.errorName(f.thrown(() => f.invoke(leading, "next"))),
    "TypeError",
  );
  assert.deepEqual(f.log, ["a.next", "b.next", "c.next", "c.return"]);
  assert.equal(f.get(f.invoke(leading, "next"), "done"), true);
});

test("Iterator.zip return keeps the first close error and still closes every iterator", () => {
  const f = fixture();
  const first = f.object();
  const zip = f.invoke(
    f.Iterator,
    "zip",
    f.list(
      f.counting("a", 1, () => {
        throw f.object();
      }),
      f.counting("b", 1),
      f.counting("c", 1, () => {
        throw first;
      }),
    ),
  );
  f.invoke(zip, "next");
  f.log.length = 0;
  assert.equal(
    f.thrown(() => f.invoke(zip, "return")),
    first,
  );
  assert.deepEqual(f.log, ["c.return", "b.return", "a.return"]);
  assert.equal(f.get(f.invoke(zip, "next"), "done"), true);
});

test("Iterator.concat reads every iterator method eagerly and opens each lazily", () => {
  const f = fixture();
  const first = f.iterable("first", f.counting("a", 1));
  const second = f.iterable("second", f.counting("b", 1));
  const helper = f.invoke(f.Iterator, "concat", first, second);
  assert.deepEqual(f.log, []);
  assert.equal(f.get(f.invoke(helper, "next"), "value"), 0);
  assert.equal(f.get(f.invoke(helper, "next"), "value"), 0);
  f.invoke(helper, "return");
  assert.deepEqual(f.log, [
    "first.open",
    "a.next",
    "a.next",
    "second.open",
    "b.next",
    "b.return",
  ]);
  const before = f.invoke(f.Iterator, "concat", first);
  f.log.length = 0;
  f.invoke(before, "return");
  assert.deepEqual(f.log, []);
});

test("Iterator.from wrappers forward next once captured and look up return per call", () => {
  const f = fixture();
  const plain = f.object({
    next: f.fn((receiver, ...args) => {
      f.log.push("next/" + args.length);
      return f.object({ done: false, value: 1 });
    }),
  });
  const wrapper = f.invoke(f.Iterator, "from", plain);
  assert.notEqual(wrapper, plain);
  objects.createDataProperty(plain, "next", 0, {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  });
  f.invoke(wrapper, "next", "ignored");
  const done = f.invoke(wrapper, "return");
  assert.equal(f.get(done, "done"), true);
  assert.equal(f.get(done, "value"), undefined);
  assert.deepEqual(f.log, ["next/0"]);
  const derived = f.counting("a", 1);
  assert.equal(f.invoke(f.Iterator, "from", derived), derived);
});

test("Iterator installation keeps the realm's single disposal intrinsic", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = objects.createErrorRealm(root, hooks);
  const key = objects.wellKnownSymbol(realm.symbolRegistry, "dispose");
  const before = objects.getOwnProperty(realm.iteratorPrototype, key)?.value;
  assert.ok(before);
  objects.installIteratorConstructor(root, realm, hooks);
  assert.equal(
    objects.getOwnProperty(realm.iteratorPrototype, key)?.value,
    before,
  );
});

test("Iterator disposal calls return, ignores its result and rejects non-callable methods", () => {
  const f = fixture();
  const iterator = f.counting("a", 0, () => 1);
  assert.equal(f.invoke(iterator, f.disposeKey), undefined);
  assert.deepEqual(f.log, ["a.return"]);
  assert.equal(
    f.invoke(f.counting("b", 0, undefined), f.disposeKey),
    undefined,
  );
  const invalid = f.object(
    { return: 1 },
    f.get(f.Iterator, "prototype") as ScriptObject,
  );
  assert.equal(
    f.errorName(f.thrown(() => f.invoke(invalid, f.disposeKey))),
    "TypeError",
  );
});
