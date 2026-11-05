import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGeneratorRecord,
  resumeGenerator,
  type GeneratorHooks,
  type GeneratorRecord,
} from "../src/iterators/generator.ts";

const hooks: GeneratorHooks<unknown> = {
  undefinedValue: undefined,
  typeError: () => new TypeError("generator already executing"),
  iteratorResult: (value, done) => ({ value, done }),
};

test("generator creation is lazy and the initial next argument is ignored", () => {
  let calls = 0;
  const yielded = { value: 19, done: false };
  const record: GeneratorRecord<unknown> = createGeneratorRecord<unknown>(
    (kind, value) => {
      assert.equal(record.state, "executing");
      assert.equal(kind, "next");
      if (calls++ === 0) {
        assert.equal(value, undefined);
        return { kind: "yield", result: yielded };
      }
      return { kind: "return", value };
    },
  );
  assert.equal(calls, 0);
  assert.equal(record.state, "suspended-start");
  assert.equal(resumeGenerator(record, "next", 99, hooks), yielded);
  assert.equal(record.state, "suspended-yield");
  assert.deepEqual(resumeGenerator(record, "next", 42, hooks), {
    value: 42,
    done: true,
  });
  assert.equal(record.state, "completed");
  assert.equal(record.continuation, undefined);
  assert.equal(calls, 2);
});

test("return and throw before starting never execute the body", () => {
  for (const kind of ["return", "throw"] as const) {
    const marker = {};
    const record = createGeneratorRecord<unknown>(() => {
      assert.fail("body must not run");
    });
    if (kind === "throw")
      assert.throws(
        () => resumeGenerator(record, kind, marker, hooks),
        (e) => e === marker,
      );
    else
      assert.deepEqual(resumeGenerator(record, kind, marker, hooks), {
        value: marker,
        done: true,
      });
    assert.equal(record.state, "completed");
    assert.equal(record.continuation, undefined);
    assert.deepEqual(resumeGenerator(record, "next", 42, hooks), {
      value: undefined,
      done: true,
    });
  }
});

test("completed generators preserve each new abrupt completion and allocate fresh results", () => {
  const record = createGeneratorRecord<unknown>(() => ({
    kind: "return",
    value: 1,
  }));
  resumeGenerator(record, "next", undefined, hooks);
  const first = resumeGenerator(record, "return", 42, hooks);
  const second = resumeGenerator(record, "return", 42, hooks);
  assert.deepEqual(first, { value: 42, done: true });
  assert.notEqual(first, second);
  const marker = {};
  assert.throws(
    () => resumeGenerator(record, "throw", marker, hooks),
    (e) => e === marker,
  );
  assert.equal(record.state, "completed");
});

test("reentrancy is rejected without corrupting a caught suspension", () => {
  for (const kind of ["next", "return", "throw"] as const) {
    let record: GeneratorRecord<unknown>;
    record = createGeneratorRecord<unknown>(() => {
      assert.throws(() => resumeGenerator(record, kind, 42, hooks), TypeError);
      assert.equal(record.state, "executing");
      return { kind: "yield", result: { value: 19, done: false } };
    });
    assert.deepEqual(resumeGenerator(record, "next", undefined, hooks), {
      value: 19,
      done: false,
    });
    assert.equal(record.state, "suspended-yield");
  }
});

test("uncaught body exceptions permanently complete and release the continuation", () => {
  const marker = {};
  const record = createGeneratorRecord<unknown>(() => {
    throw marker;
  });
  assert.throws(
    () => resumeGenerator(record, "next", undefined, hooks),
    (e) => e === marker,
  );
  assert.equal(record.state, "completed");
  assert.equal(record.continuation, undefined);
  assert.deepEqual(resumeGenerator(record, "next", undefined, hooks), {
    value: undefined,
    done: true,
  });
});

test("a return may suspend inside finally, matching a JavaScript generator", () => {
  function* reference(): Generator<number, unknown, unknown> {
    try {
      yield 1;
    } finally {
      yield 2;
    }
    return undefined;
  }
  const oracle = reference();
  let phase = 0;
  let pending: unknown;
  const record = createGeneratorRecord<unknown>((kind, value) => {
    if (phase++ === 0)
      return { kind: "yield", result: { value: 1, done: false } };
    if (phase === 2) {
      assert.equal(kind, "return");
      pending = value;
      return { kind: "yield", result: { value: 2, done: false } };
    }
    return { kind: "return", value: kind === "return" ? value : pending };
  });
  assert.deepEqual(
    resumeGenerator(record, "next", undefined, hooks),
    oracle.next(),
  );
  assert.deepEqual(
    resumeGenerator(record, "return", 42, hooks),
    oracle.return(42),
  );
  assert.equal(record.state, "suspended-yield");
  assert.deepEqual(
    resumeGenerator(record, "next", undefined, hooks),
    oracle.next(),
  );
});

test("yielded iterator-result objects pass through without reading or copying properties", () => {
  const result = Object.defineProperty({}, "done", {
    get() {
      assert.fail("generator control must not read user result properties");
    },
  });
  const record = createGeneratorRecord<unknown>(() => ({
    kind: "yield",
    result,
  }));
  assert.equal(resumeGenerator(record, "next", undefined, hooks), result);
  assert.equal(record.state, "suspended-yield");
});

test("an injected throw can be caught and yield again without completing", () => {
  function* reference(): Generator<unknown, number, unknown> {
    try {
      yield 1;
    } catch (error) {
      yield error;
    }
    return 42;
  }
  const oracle = reference();
  let phase = 0;
  const record = createGeneratorRecord<unknown>((kind, value) => {
    if (phase++ === 0)
      return { kind: "yield", result: { value: 1, done: false } };
    if (phase === 2) {
      assert.equal(kind, "throw");
      return { kind: "yield", result: { value, done: false } };
    }
    return { kind: "return", value: 42 };
  });
  const marker = {};
  assert.deepEqual(
    resumeGenerator(record, "next", undefined, hooks),
    oracle.next(),
  );
  assert.deepEqual(
    resumeGenerator(record, "throw", marker, hooks),
    oracle.throw(marker),
  );
  assert.equal(record.state, "suspended-yield");
  assert.deepEqual(
    resumeGenerator(record, "next", undefined, hooks),
    oracle.next(),
  );
});
