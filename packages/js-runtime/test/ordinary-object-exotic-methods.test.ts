import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<number> = {
  undefinedValue: 0,
  sameValue: Object.is,
  call: () => 0,
};
test("exotic get and has dispatch through an ordinary prototype chain", () => {
  const log: string[] = [];
  const exotic = objects.createExoticObject<string, number>(undefined, {
    get: (object, key, receiver) => {
      log.push("get:" + key + ":" + receiver);
      return 42;
    },
    hasProperty: (object, key) => {
      log.push("has:" + key);
      return key === "yes";
    },
  });
  const child = objects.createObject<string, number>(exotic);
  assert.equal(objects.getProperty(child, "missing", 7, hooks), 42);
  assert.equal(objects.hasProperty(child, "yes"), true);
  assert.equal(objects.hasProperty(child, "missing"), false);
  assert.deepEqual(log, ["get:missing:7", "has:yes", "has:missing"]);
});
test("ordinary writes consult exotic receiver descriptors and definitions", () => {
  const log: string[] = [];
  const target = objects.createExoticObject<string, number>(undefined, {
    getOwnProperty: (object, key) => {
      log.push("own:" + key);
      return undefined;
    },
    defineOwnProperty: (object, key, update) => {
      log.push("define:" + key + ":" + update.value);
      return "accepted";
    },
  });
  const source = objects.createObject<string, number>(undefined);
  assert.equal(
    objects.setProperty(source, "x", 42, { object: target, value: 1 }, hooks),
    true,
  );
  assert.deepEqual(log, ["own:x", "define:x:42"]);
});
test("exotic lifecycle, key order and prototype operations retain their results", () => {
  const parent = objects.createObject<string, number>(undefined),
    log: string[] = [];
  const target = objects.createExoticObject<string, number>(undefined, {
    getPrototype: () => parent,
    setPrototype: () => false,
    isExtensible: () => false,
    preventExtensions: () => false,
    ownKeys: () => ["10", "2", "x"],
    deleteProperty: (object, key) => {
      log.push(key);
      return false;
    },
  });
  assert.equal(objects.getPrototype(target), parent);
  assert.equal(objects.hasPrototype(target, parent), true);
  assert.equal(objects.setPrototype(target, undefined), false);
  assert.equal(objects.isExtensible(target), false);
  assert.equal(objects.preventExtensions(target), false);
  assert.equal(objects.deleteProperty(target, "x"), false);
  assert.deepEqual(
    objects.ownKeys(target, (k) => Number(k)),
    ["10", "2", "x"],
  );
  assert.deepEqual(log, ["x"]);
});
test("exotic property and prototype failures propagate without fallback", () => {
  const marker = {};
  const target = objects.createExoticObject<string, number>(undefined, {
    get: () => {
      throw marker;
    },
  });
  assert.throws(
    () => objects.getProperty(target, "x", 1, hooks),
    (e) => e === marker,
  );
  const child = objects.createObject<string, number>(target);
  assert.throws(
    () => objects.getProperty(child, "x", 2, hooks),
    (e) => e === marker,
  );
});

test("integrity operations honor preventExtensions failure and trap ordering", () => {
  const log: string[] = [];
  const denied = objects.createExoticObject<string, number>(undefined, {
    preventExtensions: () => false,
    ownKeys: () => {
      throw new Error("must not enumerate");
    },
  });
  assert.equal(
    objects.setIntegrityLevel(denied, true, hooks, (key): number => -1),
    false,
  );
  const target = objects.createExoticObject<string, number>(undefined, {
    preventExtensions: () => {
      log.push("prevent");
      return true;
    },
    ownKeys: () => {
      log.push("keys");
      return ["x"];
    },
    getOwnProperty: () => {
      log.push("own");
      return undefined;
    },
    defineOwnProperty: () => {
      log.push("define");
      return "accepted";
    },
  });
  assert.equal(
    objects.setIntegrityLevel(target, false, hooks, (key): number => -1),
    true,
  );
  assert.deepEqual(log, ["prevent", "keys", "define"]);
  log.length = 0;
  assert.equal(
    objects.setIntegrityLevel(target, true, hooks, (key): number => -1),
    true,
  );
  assert.deepEqual(log, ["prevent", "keys", "own"]);
});
