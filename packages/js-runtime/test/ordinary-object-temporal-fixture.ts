import assert from "node:assert/strict";
import { after } from "node:test";
import type {
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyKey,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
export const objects = await import("../src/objects/index.ts");
export type ObjectValue = OrdinaryObject<ScriptPropertyKey, unknown>;
export function createTemporalObjectFixture() {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(callee, receiver, args) {
      const fn = objects.viewObjectValue(callee, root);
      assert.ok(fn?.internalRareSlots?.internalCall);
      return fn.internalRareSlots?.internalCall(receiver, args);
    },
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installTemporalIntrinsics(root, realm, hooks);
  const temporal = objects.getOwnProperty(root, "Temporal")!
    .value as ObjectValue;
  const constructor = (name: string) =>
    objects.getOwnProperty(temporal, name)!.value as ObjectValue;
  const get = (value: ObjectValue, key: string) =>
    objects.getProperty(value, key, value, hooks);
  const call = (
    value: ObjectValue,
    key: string,
    args: readonly unknown[] = [],
  ) => {
    const fn = get(value, key) as ObjectValue;
    assert.ok(fn.internalRareSlots?.internalCall);
    return fn.internalRareSlots?.internalCall(value, args);
  };
  const bag = (data: Record<string, unknown>) => {
    const value = objects.createObject<ScriptPropertyKey, unknown>(root);
    for (const [key, field] of Object.entries(data))
      assert.equal(objects.createDataProperty(value, key, field, hooks), true);
    return value;
  };
  const from = (name: string, data: unknown) =>
    call(constructor(name), "from", [data]) as ObjectValue;
  const construct = (name: string, args: readonly unknown[]) => {
    const ctor = constructor(name);
    const result = objects.constructObjectValue(ctor, args, root);
    assert.equal(result.error, "none", `${name} construction`);
    return result.value as ObjectValue;
  };
  return { root, realm, hooks, get, call, bag, from, construct };
}
