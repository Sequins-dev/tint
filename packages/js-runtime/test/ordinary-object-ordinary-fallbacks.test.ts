import { test } from "node:test";
import assert from "node:assert/strict";
import * as o from "../src/objects/operations.ts";
const hooks: o.ObjectHooks<number> = {
  undefinedValue: 0,
  sameValue: Object.is,
  call: () => {
    throw new Error("unexpected call");
  },
};
test("exotics delegate ordinary keys without reentering their own overrides", () => {
  let reads = 0,
    writes = 0;
  const parent = o.createExoticObject<string, number>(undefined, {
    get: (_object, key) => (key === "inherited" ? 19 : 0),
    hasProperty: (_object, key) => key === "inherited",
  });
  const object = o.createExoticObject<string, number>(parent, {
    get: (target, key, receiver, h) => {
      reads++;
      return key === "virtual"
        ? 42
        : o.ordinaryGetProperty(target, key, receiver, h);
    },
    hasProperty: (target, key) =>
      key === "virtual" || o.ordinaryHasProperty(target, key),
    set: (target, key, value, receiver, h) => {
      writes++;
      return o.ordinarySetProperty(target, key, value, receiver, h);
    },
    deleteProperty: (target, key) => o.ordinaryDeleteProperty(target, key),
    ownKeys: (target) => ["virtual", ...o.ordinaryOwnKeys(target, () => -1)],
  });
  o.createDataProperty(object, "own", 23, hooks);
  assert.equal(o.getProperty(object, "own", 0, hooks), 23);
  assert.equal(o.getProperty(object, "inherited", 0, hooks), 19);
  assert.equal(o.getProperty(object, "virtual", 0, hooks), 42);
  assert.equal(reads, 3);
  assert.ok(o.hasProperty(object, "inherited"));
  const receiver = o.createObject<string, number>(undefined);
  assert.ok(
    o.setProperty(object, "own", 31, { object: receiver, value: 0 }, hooks),
  );
  assert.equal(o.getOwnProperty(receiver, "own")?.value, 31);
  assert.equal(o.getOwnProperty(object, "own")?.value, 23);
  assert.equal(writes, 1);
  assert.deepEqual(
    o.ownKeys(object, () => -1),
    ["virtual", "own"],
  );
  assert.ok(o.deleteProperty(object, "own"));
  assert.deepEqual(
    o.ownKeys(object, () => -1),
    ["virtual"],
  );
});
