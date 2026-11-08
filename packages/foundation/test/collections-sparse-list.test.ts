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

test("mixed sparse mutations preserve pruned trie storage and Array presence semantics", () => {
  const list = createList<number | undefined>(0);
  const expected: (number | undefined)[] = [];
  let seed = 19;
  // Trie invariants: every node below the root is nonempty, branch counts match
  // their defined children, leaf presence masks fit in eight bits, and every
  // present index is inside the logical length.
  function verifyTrie(
    node: typeof list.root,
    base: number,
    top: boolean,
  ): void {
    if (node === undefined) return;
    if (node.leaf) {
      assert.ok(node.present >= 0 && node.present < 256);
      if (!top) assert.ok(node.present !== 0);
      for (let slot = 0; slot < 8; slot++)
        if ((node.present & (1 << slot)) !== 0)
          assert.ok(base + slot < lengthList(list));
      return;
    }
    assert.ok(node.shift > 0 && node.shift % 3 === 0);
    const children = [
      node.c0,
      node.c1,
      node.c2,
      node.c3,
      node.c4,
      node.c5,
      node.c6,
      node.c7,
    ];
    assert.equal(children.filter((c) => c !== undefined).length, node.count);
    if (!top) assert.ok(node.count > 0);
    children.forEach((c, slot) => {
      if (c === undefined) return;
      if (!c.leaf) assert.equal(c.shift, node.shift - 3);
      else assert.equal(node.shift, 3);
      verifyTrie(c, base + slot * 2 ** node.shift, false);
    });
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
    verifyTrie(list.root, 0, true);
    assert.equal(lengthList(list), expected.length);
    for (let j = 0; j < 257; j++) {
      assert.equal(readList(list, j), expected[j]);
      assert.equal(hasList(list, j), Object.hasOwn(expected, j));
    }
  }
});

test("trie roots grow for distant indices and shrink to nothing when emptied", () => {
  const list = createList<string>(0);
  for (const index of [
    7, 8, 63, 64, 511, 4096, 0x7fffffff, 0x80000000, 0xfffffffe,
  ])
    writeList(list, index, "v" + index);
  for (const index of [
    7, 8, 63, 64, 511, 4096, 0x7fffffff, 0x80000000, 0xfffffffe,
  ]) {
    assert.equal(readList(list, index), "v" + index);
    assert.ok(hasList(list, index));
    assert.equal(
      readList(list, index - 1),
      index === 8
        ? "v7"
        : index === 64
          ? "v63"
          : index === 0x80000000
            ? "v2147483647"
            : undefined,
    );
  }
  for (const index of [
    7, 8, 63, 64, 511, 4096, 0x7fffffff, 0x80000000, 0xfffffffe,
  ])
    assert.ok(deleteList(list, index));
  assert.equal(list.root, undefined);
  assert.equal(lengthList(list), 0xffffffff);
  resizeList(list, 0);
  for (let i = 0; i < 100; i++) pushList(list, "p" + i);
  resizeList(list, 33);
  assert.equal(readList(list, 32), "p32");
  assert.equal(hasList(list, 33), false);
  while (lengthList(list) > 0) popList(list);
  assert.equal(list.root, undefined);
});

test("dense appends allocate one leaf per eight elements", () => {
  const list = createList<number>(0);
  for (let i = 0; i < 4096; i++) pushList(list, i);
  let leaves = 0,
    branches = 0;
  function count(node: typeof list.root): void {
    if (node === undefined) return;
    if (node.leaf) {
      leaves++;
      assert.equal(node.present, 255);
      return;
    }
    branches++;
    for (const c of [
      node.c0,
      node.c1,
      node.c2,
      node.c3,
      node.c4,
      node.c5,
      node.c6,
      node.c7,
    ])
      count(c);
  }
  count(list.root);
  assert.equal(leaves, 512);
  assert.equal(branches, 64 + 8 + 1);
});
