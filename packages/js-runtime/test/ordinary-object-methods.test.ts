import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";

const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (callee, receiver, args) =>
    objects.callObject(
      callee as objects.OrdinaryObject<string, unknown>,
      receiver,
      args,
      undefined,
    ).value,
};

test("method home objects survive extraction and observe later prototype changes", () => {
  assert.equal(typeof objects.makeMethod, "function");
  const first = objects.createObject<string, unknown>(undefined);
  const second = objects.createObject<string, unknown>(undefined);
  const home = objects.createObject(first);
  const receiver = objects.createObject(second);
  const method = objects.createCallableObject<string, unknown>(
    undefined,
    () => 42,
  );
  objects.makeMethod(method, home);
  objects.createDataProperty(receiver, "extracted", method, hooks);
  assert.equal(method.internalRareSlots?.internalHomeObject, home);
  assert.equal(objects.getSuperBase(method), first);
  const captured = objects.getSuperBase(method);
  objects.setPrototype(home, second);
  assert.equal(captured, first);
  assert.equal(objects.getSuperBase(method), second);
  objects.setPrototype(home, undefined);
  assert.equal(objects.getSuperBase(method), undefined);
  assert.equal(objects.getOwnProperty(method, "internalHomeObject"), undefined);
});

test("super lookup uses the home base while accessors and writes use the actual receiver", () => {
  assert.equal(typeof objects.makeMethod, "function");
  const base = objects.createObject<string, unknown>(undefined);
  const home = objects.createObject(base);
  const receiver = objects.createObject<string, unknown>(undefined);
  const getter = objects.createCallableObject<string, unknown>(
    undefined,
    (value) => value,
  );
  let setterReceiver: unknown;
  let setterValue: unknown;
  const setter = objects.createCallableObject<string, unknown>(
    undefined,
    (value, args) => {
      setterReceiver = value;
      setterValue = args[0];
      return undefined;
    },
  );
  objects.createAccessorProperty(base, "accessor", getter, false, hooks);
  objects.createAccessorProperty(base, "accessor", setter, true, hooks);
  objects.createDataProperty(base, "data", 1, hooks);
  const method = objects.createCallableObject<string, unknown>(
    undefined,
    () => undefined,
  );
  objects.makeMethod(method, home);
  const captured = objects.getSuperBase(method)!;
  assert.equal(
    objects.getProperty(captured, "accessor", receiver, hooks),
    receiver,
  );
  assert.equal(
    objects.setProperty(
      captured,
      "accessor",
      42,
      { value: 7, object: undefined },
      hooks,
    ),
    true,
  );
  assert.equal(setterReceiver, 7);
  assert.equal(setterValue, 42);
  assert.equal(
    objects.setProperty(
      captured,
      "data",
      42,
      { value: receiver, object: receiver },
      hooks,
    ),
    true,
  );
  assert.equal(objects.getOwnProperty(receiver, "data")?.value, 42);
  assert.equal(objects.getOwnProperty(base, "data")?.value, 1);
  assert.equal(objects.getOwnProperty(home, "data"), undefined);
});
