import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeyIndex } from "../src/collections/key-index.ts";

test("hashed keys preserve identity, collisions, replacement and stored undefined", () => {
  const index = createKeyIndex<{ readonly hash: number }, number | undefined>(
    (key) => key.hash,
  );
  const a = { hash: 7 },
    b = { hash: 7 },
    c = { hash: 0xffffffff };
  index.set(a, 1);
  index.set(b, undefined);
  index.set(c, 3);
  assert.equal(index.get(a), 1);
  assert.ok(index.has(b));
  assert.equal(index.get(b), undefined);
  assert.equal(index.has({ hash: 7 }), false);
  index.set(a, 4);
  assert.equal(index.get(a), 4);
  assert.ok(index.delete(a));
  assert.equal(index.delete(a), false);
  assert.ok(index.has(b));
  assert.ok(index.delete(b));
  assert.equal(index.get(c), 3);
  index.clear();
  assert.equal(index.has(c), false);
  index.set(a, 5);
  assert.equal(index.get(a), 5);
});

test("index hashing is evaluated once per operation and invalid hashes cannot insert", () => {
  let calls = 0;
  const index = createKeyIndex<number, string>((key): number => {
    calls++;
    return key;
  });
  for (const key of [0, 1, 0xfffffffe, 0xffffffff]) {
    index.set(key, "value");
    assert.equal(index.get(key), "value");
    assert.ok(index.has(key));
    assert.ok(index.delete(key));
  }
  assert.equal(calls, 16);
  for (const key of [-1, 0.5, NaN, Infinity, 0x100000000]) {
    assert.throws(() => index.set(key, "invalid"));
  }
  index.set(0, "valid");
  assert.equal(index.get(0), "valid");
});

test("large immutable-key indexes agree with Map through collisions and deletion", () => {
  const keys = Array.from({ length: 8192 }, (_, start) => ({ start }));
  const index = createKeyIndex<{ readonly start: number }, number>(
    (key) => key.start % 2048,
  );
  const expected = new Map<object, number>();
  for (const key of keys) {
    index.set(key, key.start);
    expected.set(key, key.start);
  }
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i]!;
    assert.equal(index.get(key), expected.get(key));
    if (i % 3 === 0) assert.equal(index.delete(key), expected.delete(key));
  }
  for (const key of keys) {
    assert.equal(index.has(key), expected.has(key));
    assert.equal(index.get(key), expected.get(key));
  }
});

test("ordered traversal permits replacement and rejects structural mutation before changing state", () => {
  const index = createKeyIndex<number, string>(() => 0);
  index.set(3, "three");
  index.set(1, "one");
  index.set(2, "two");
  index.delete(1);
  index.set(1, "last");
  const seen: number[] = [];
  index.forEach((value, key) => {
    seen.push(key);
    index.set(key, value + "!");
    assert.throws(() => index.set(4, "new"));
    assert.throws(() => index.delete(key));
    assert.throws(() => index.clear());
  });
  assert.deepEqual(seen, [3, 2, 1]);
  assert.equal(index.get(1), "last!");
  assert.equal(index.has(4), false);
  assert.throws(() =>
    index.forEach(() => {
      throw Error("callback");
    }),
  );
  index.clear();
  index.set(4, "after");
  const keys: number[] = [];
  index.forEach((value, key) => keys.push(key));
  assert.deepEqual(keys, [4]);
});

test("UTF-16 string hashing retains exact identity through collisions", async () => {
  const { hashString } = await import("../src/collections/key-index.ts");
  assert.equal(hashString("Aa"), hashString("BB"));
  const index = createKeyIndex<string, number>(hashString);
  const keys = ["", "Aa", "BB", "a\u0000b", "😀", "\ud800", "é", "e\u0301"];
  keys.forEach((key, i) => index.set(key, i));
  keys.forEach((key, i) => assert.equal(index.get(key), i));
  for (const key of keys) {
    assert.ok(Number.isInteger(hashString(key)));
    assert.ok(hashString(key) >= 0 && hashString(key) <= 0xffffffff);
  }
});

test("hash table churn preserves probe chains, SameValueZero and insertion order", () => {
  const actual = createKeyIndex<number, number | undefined>((key) =>
    Number.isNaN(key) ? 7 : key & 7,
  );
  const expected = new Map<number, number | undefined>();
  for (let round = 0; round < 80; round++) {
    for (let i = 0; i < 40; i++) {
      const key = (round * 13 + i) % 101;
      if (i % 3 === 0) assert.equal(actual.delete(key), expected.delete(key));
      else {
        const value = i % 5 === 0 ? undefined : round;
        actual.set(key, value);
        expected.set(key, value);
      }
    }
    actual.set(NaN, round);
    expected.set(NaN, round);
    actual.set(-0, round);
    expected.set(-0, round);
    const seen: [number, number | undefined][] = [];
    actual.forEach((value, key) => seen.push([key === 0 ? 0 : key, value]));
    assert.deepEqual(seen, [...expected]);
    for (let key = 0; key < 105; key++) {
      assert.equal(actual.has(key), expected.has(key));
      assert.equal(actual.get(key), expected.get(key));
    }
    if (round % 17 === 16) {
      actual.clear();
      expected.clear();
    }
  }
});

test("hash callbacks may rebuild storage before an operation selects its bucket", () => {
  let expand = false;
  const index = createKeyIndex<number, number>((key) => {
    if (expand) {
      expand = false;
      index.clear();
      for (let n = 0; n < 100; n++) index.set(n, n + 1000);
    }
    return key;
  });
  index.set(5, 5);
  expand = true;
  assert.equal(index.get(5), 1005);
  expand = true;
  assert.equal(index.has(99), true);
});

test("hash callbacks can reenter the index before probing starts", () => {
  let reenter = false;
  const index = createKeyIndex<number, string>((key): number => {
    if (reenter) {
      reenter = false;
      assert.equal(index.get(1), "one");
      index.set(3, "three");
    }
    return key;
  });
  index.set(1, "one");
  reenter = true;
  index.set(2, "two");
  reenter = true;
  assert.equal(index.get(2), "two");
  reenter = true;
  assert.equal(index.delete(2), true);
  assert.equal(index.get(1), "one");
  assert.equal(index.get(3), "three");
  assert.equal(index.has(2), false);
});

test("string index factory preserves colliding keys and undefined values", async () => {
  const indexModule = await import("../src/collections/key-index.ts");
  assert.equal(typeof indexModule.createStringIndex, "function");
  const index = indexModule.createStringIndex<number | undefined>();
  index.set("Aa", 1);
  index.set("BB", undefined);
  assert.equal(index.get("Aa"), 1);
  assert.equal(index.has("BB"), true);
  assert.equal(index.delete("Aa"), true);
  assert.equal(index.has("BB"), true);
});

test("explicit equality handles value keys through collisions and rebuilds", () => {
  const index = createKeyIndex<{ id: number }, number>(
    (key) => key.id % 4,
    (a, b) => a.id === b.id,
  );
  for (let id = 0; id < 64; id++) index.set({ id }, id);
  for (let id = 0; id < 64; id++) assert.equal(index.get({ id }), id);
  index.set({ id: 3 }, 99);
  assert.equal(index.get({ id: 3 }), 99);
  assert.equal(index.delete({ id: 3 }), true);
  assert.equal(index.has({ id: 3 }), false);
  assert.equal(index.get({ id: 7 }), 7);
  index.clear();
  index.set({ id: 3 }, 42);
  assert.equal(index.get({ id: 3 }), 42);
});

test("probe hashes skip equal-bucket keys without comparing them, and reuse tombstones", () => {
  let compared = 0;
  // Full hashes differ but share the low bits that select a bucket.
  const index = createKeyIndex<number, string>(
    (key) => (key * 0x10000) >>> 0,
    (left, right) => {
      compared++;
      return left === right;
    },
  );
  for (let key = 0; key < 6; key++) index.set(key, "v" + key);
  compared = 0;
  for (let key = 0; key < 6; key++) assert.equal(index.get(key), "v" + key);
  assert.equal(compared, 6);
  compared = 0;
  assert.equal(index.get(99), undefined);
  assert.equal(index.has(99), false);
  assert.equal(compared, 0);
  assert.ok(index.delete(2));
  assert.equal(index.get(2), undefined);
  index.set(2, "again");
  assert.equal(index.get(2), "again");
  for (const key of [0, 1, 3, 4, 5]) assert.equal(index.get(key), "v" + key);
});

test("re-entrant pure equality cannot confuse the matched entry", () => {
  let nested = false;
  const index: ReturnType<typeof createKeyIndex<string, number>> =
    createKeyIndex<string, number>(
      () => 1,
      (left, right) => {
        // A pure comparator may consult the same index.
        if (!nested) {
          nested = true;
          index.has(right);
          nested = false;
        }
        return left === right;
      },
    );
  index.set("a", 1);
  index.set("b", 2);
  index.set("c", 3);
  assert.equal(index.get("b"), 2);
  assert.equal(index.get("c"), 3);
  assert.equal(index.get("z"), undefined);
  index.set("b", 20);
  assert.equal(index.get("b"), 20);
  assert.ok(index.delete("a"));
  assert.equal(index.get("a"), undefined);
  assert.equal(index.get("c"), 3);
});
