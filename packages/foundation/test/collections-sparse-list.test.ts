import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createList,
  readList,
  writeList,
  pushList,
  popList,
  lengthList,
  hasList,
  deleteList,
  resizeList,
} from "@tint/foundation/collections/sparse-list";
test("generic lists preserve holes, identity, replacement and trailing holes", () => {
  const list = createList<string>(0);
  assert.equal(pushList(list, "a"), 1);
  writeList(list, 3, "d");
  assert.equal(lengthList(list), 4);
  assert.equal(readList(list, 1), undefined);
  writeList(list, 0, "");
  assert.equal(readList(list, 0), "");
  assert.equal(popList(list), "d");
  assert.equal(popList(list), undefined);
  assert.equal(lengthList(list), 2);
  const object = { value: 1 },
    objects = createList<{ value: number }>(100);
  pushList(objects, object);
  assert.equal(readList(objects, 0), object);
  assert.equal(lengthList(objects), 1);
});
test("sparse indices do not allocate holes and strict mutation bounds preserve state", () => {
  const list = createList<string>(0);
  writeList(list, 0xfffffffe, "last");
  assert.equal(lengthList(list), 0xffffffff);
  assert.equal(readList(list, 0xfffffffd), undefined);
  assert.equal(readList(list, 0xfffffffe), "last");
  assert.throws(() => pushList(list, "overflow"));
  assert.equal(lengthList(list), 0xffffffff);
  assert.equal(popList(list), "last");
  assert.equal(lengthList(list), 0xfffffffe);
  for (const index of [-1, 0.5, NaN, Infinity, 0xffffffff]) {
    assert.equal(readList(list, index), undefined);
    assert.throws(() => writeList(list, index, "bad"));
    assert.equal(lengthList(list), 0xfffffffe);
  }
  for (const capacity of [-1, 0.5, NaN, Infinity, 0x100000000])
    assert.throws(() => createList<string>(capacity));
});
test("deterministic string array mutations match ordinary arrays", () => {
  const list = createList<string | undefined>(0),
    expected: (string | undefined)[] = [];
  let seed = 121;
  for (let i = 0; i < 500; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const index = seed % 31,
      value = i % 7 === 0 ? undefined : "v" + i;
    const op = (seed >>> 8) % 3;
    if (op === 0) {
      writeList(list, index, value);
      expected[index] = value;
    } else if (op === 1)
      assert.equal(pushList(list, value), expected.push(value));
    else assert.equal(popList(list), expected.pop());
    assert.equal(lengthList(list), expected.length);
    for (let j = 0; j <= expected.length; j++)
      assert.equal(readList(list, j), expected[j]);
  }
});

test("presence and deletion distinguish holes from stored undefined without changing length", () => {
  const list = createList<string | undefined>(0);
  writeList(list, 2, undefined);
  writeList(list, 4, "last");
  assert.equal(hasList(list, 1), false);
  assert.equal(hasList(list, 2), true);
  assert.equal(deleteList(list, 2), true);
  assert.equal(deleteList(list, 2), false);
  assert.equal(lengthList(list), 5);
  assert.equal(hasList(list, 2), false);
  for (const index of [-1, 0.5, NaN, Infinity, 0xffffffff]) {
    assert.equal(hasList(list, index), false);
    assert.equal(deleteList(list, index), false);
  }
});
test("sparse resizing removes truncated entries and never resurrects them", () => {
  const list = createList<string | undefined>(0);
  writeList(list, 0, "keep");
  writeList(list, 2, undefined);
  writeList(list, 0xfffffffe, "last");
  resizeList(list, 2);
  assert.equal(lengthList(list), 2);
  assert.equal(readList(list, 0), "keep");
  resizeList(list, 0xffffffff);
  assert.equal(hasList(list, 2), false);
  assert.equal(hasList(list, 0xfffffffe), false);
  for (const length of [-1, 0.5, NaN, Infinity, 0x100000000]) {
    assert.throws(() => resizeList(list, length));
    assert.equal(lengthList(list), 0xffffffff);
  }
  resizeList(list, -0);
  assert.equal(Object.is(lengthList(list), 0), true);
});

test("indexed reads scale with tree depth rather than populated length", () => {
  const list = createList<number>(0);
  const count = 4096;
  for (let i = 0; i < count; i++) writeList(list, i, i);
  let reads = 0;
  const proxies = new WeakMap<object, object>();
  function observe<T extends object>(value: T): T {
    const cached = proxies.get(value);
    if (cached !== undefined) return cached as T;
    const proxy = new Proxy(value, {
      get(target, key, receiver) {
        reads++;
        const result: unknown = Reflect.get(target, key, receiver);
        return typeof result === "object" && result !== null
          ? observe(result)
          : result;
      },
    });
    proxies.set(value, proxy);
    return proxy;
  }
  const observed = observe(list);
  for (let i = 0; i < count; i++) assert.equal(readList(observed, i), i);
  assert.ok(reads < count * 128, `indexed reads took ${reads} field accesses`);
});

test("mixed sparse mutations preserve balanced storage and Array presence semantics", () => {
  const list = createList<number | undefined>(0);
  const expected: (number | undefined)[] = [];
  let seed = 19;
  function verifyTree(
    node: typeof list.root,
    low: number,
    high: number,
  ): number {
    if (node === undefined) return 0;
    assert.ok(node.index > low && node.index < high);
    const left = verifyTree(node.left, low, node.index);
    const right = verifyTree(node.right, node.index, high);
    assert.ok(Math.abs(left - right) <= 1);
    assert.equal(node.height, 1 + Math.max(left, right));
    return node.height;
  }
  for (let i = 0; i < 10000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const index = seed % 257;
    const operation = (seed >>> 16) % 8;
    if (operation < 5) {
      const value = operation === 0 ? undefined : i;
      writeList(list, index, value);
      expected[index] = value;
    } else if (operation === 5) {
      assert.equal(deleteList(list, index), Object.hasOwn(expected, index));
      delete expected[index];
    } else if (operation === 6) {
      resizeList(list, index);
      expected.length = index;
    } else assert.equal(popList(list), expected.pop());
    verifyTree(list.root, -1, 0xffffffff);
    assert.equal(lengthList(list), expected.length);
    for (let j = 0; j < 257; j++) {
      assert.equal(readList(list, j), expected[j]);
      assert.equal(hasList(list, j), Object.hasOwn(expected, j));
    }
  }
});
