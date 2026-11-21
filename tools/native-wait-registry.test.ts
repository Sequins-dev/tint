import assert from "node:assert/strict";
import test from "node:test";
import type { SharedResult } from "@tint/js-runtime/bytes/shared";
import { NodeSharedMemoryHost } from "./node-shared-memory-host.ts";
async function fixture(capacity = 4) {
  const api = await import("@tint/native-runtime/shared-blocks");
  const create = api.createNativeWaitRegistry;
  assert.equal(typeof create, "function", "native waiter registry must exist");
  const host = new NodeSharedMemoryHost(),
    wakes: { address: number; all: boolean }[] = [],
    parks: number[] = [];
  const parking = {
    park: (address: number, _expected: number, _timeout: number) => {
      parks.push(address);
      return 0;
    },
    wake: (address: number, all = false) => {
      wakes.push({ address, all });
      return 0;
    },
  };
  const created = value(create(host, parking, 99, capacity));
  const payload = host.mapMemory(16384);
  assert.equal(host.writeSharedUnsigned(payload, 16, 0, 4, 7, 1), 0);
  const location = {
    engineId: 99,
    blockId: 1,
    address: payload,
    byteLength: 16,
    byteOffset: 0,
    width: 4 as 4 | 8,
  };
  return {
    api,
    host,
    parking,
    registry: created,
    location,
    wakes,
    parks,
  };
}
function value<T>(result: SharedResult<T>): T {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("native waiter registration compares under its lock and immediate results consume no slots", async () => {
  const f = await fixture(2),
    r = f.registry;
  assert.equal(value(r.register(f.location, 8, 0, false)).state, "not-equal");
  assert.equal(value(r.register(f.location, 7, 0, true)).state, "timed-out");
  const first = value(r.register(f.location, 7, 0, false));
  const second = value(r.register(f.location, 7, 0, false));
  assert.equal(first.state, "waiting");
  assert.notEqual(first.ticket, second.ticket);
  assert.deepEqual(r.register(f.location, 7, 0, false), {
    ok: false,
    error: "allocation-limit",
  });
  assert.equal(f.parks.length, 0);
});
test("waiter FIFO follows registration order across recycled slots and ignores integer width", async () => {
  const f = await fixture(2),
    r = f.registry;
  const a = value(r.register(f.location, 7, 0, false));
  const b = value(r.register({ ...f.location, width: 8 }, 7, 0, false));
  assert.equal(value(r.notify(1, 0, 8, 1)), 1);
  assert.equal(value(r.take(a.ticket)), "notified");
  const c = value(r.register(f.location, 7, 0, false));
  assert.equal(value(r.notify(1, 0, 4, 1)), 1);
  assert.equal(value(r.poll(b.ticket)), "notified");
  assert.equal(value(r.poll(c.ticket)), "waiting");
  assert.equal(r.poll(a.ticket).ok, false);
  assert.equal(value(r.notify(1, 0, 8, Infinity)), 1);
  assert.equal(value(r.notify(1, 0, 4, Infinity)), 0);
});
test("notify and timeout compete for one terminal state and spurious wakes cannot complete a waiter", async () => {
  const f = await fixture(),
    r = f.registry;
  const a = value(r.register(f.location, 7, 0, false));
  assert.equal(value(r.park(a.ticket, 1000)), 0);
  assert.equal(value(r.poll(a.ticket)), "waiting");
  assert.equal(value(r.notify(2, 0, 4, Infinity)), 0);
  assert.equal(value(r.notify(1, 4, 4, Infinity)), 0);
  assert.equal(value(r.notify(1, 0, 4, 0)), 0);
  assert.equal(value(r.expire(a.ticket)), true);
  assert.equal(value(r.notify(1, 0, 8, 1)), 0);
  assert.equal(value(r.take(a.ticket)), "timed-out");
  const b = value(r.register(f.location, 7, 0, false));
  assert.equal(value(r.notify(1, 0, 4, 1)), 1);
  assert.equal(value(r.expire(b.ticket)), false);
  assert.equal(value(r.take(b.ticket)), "notified");
});
test("independent managed facades share only the raw registry and enforce engine identity", async () => {
  const f = await fixture();
  const attach = f.api.attachNativeWaitRegistry;
  assert.equal(typeof attach, "function");
  const second = attach(
    new NodeSharedMemoryHost(f.host.kernel),
    f.parking,
    f.registry.registry,
  );
  assert.ok(second.ok);
  const a = value(f.registry.register(f.location, 7, 0, false));
  assert.equal(value(second.value.notify(1, 0, 8, 1)), 1);
  assert.equal(value(f.registry.take(a.ticket)), "notified");
  assert.deepEqual(
    f.registry.register({ ...f.location, engineId: 100 }, 7, 0, false),
    { ok: false, error: "invalid-handle" },
  );
});
test("terminal completion order follows notifications across different locations rather than registration order", async () => {
  const f = await fixture(),
    r = f.registry;
  const first = value(r.register(f.location, 7, 0, false));
  const other = value(
    r.register({ ...f.location, byteOffset: 8 }, 0, 0, false),
  );
  assert.equal(value(r.order(first.ticket)), 0);
  value(r.notify(1, 8, 4, 1));
  value(r.notify(1, 0, 4, 1));
  assert.ok(value(r.order(other.ticket)) < value(r.order(first.ticket)));
  assert.ok(value(r.order(other.ticket)) > 0);
});
test("a cross-agent completion wakes the checkpoint regardless of which ticket it owns", async () => {
  const f = await fixture();
  const attached = f.api.attachNativeWaitRegistry(
    new NodeSharedMemoryHost(f.host.kernel),
    f.parking,
    f.registry.registry,
  );
  assert.ok(attached.ok);
  const registry = f.registry;
  const first = value(registry.register(f.location, 7, 0, false));
  const other = value(
    registry.register({ ...f.location, byteOffset: 8 }, 0, 0, false),
  );
  const before = registry.eventVersion();
  assert.equal(value(attached.value.notify(1, 8, 4, 1)), 1);
  assert.equal(value(registry.parkEvents(before, 0)), 0);
  assert.equal(f.parks.length, 0, "publication before park must skip the wait");
  assert.notEqual(registry.eventVersion(), before);
  assert.equal(value(registry.poll(first.ticket)), "waiting");
  assert.equal(value(registry.take(other.ticket)), "notified");

  const current = registry.eventVersion();
  assert.equal(value(registry.parkEvents(current, 0)), 0);
  const eventCell = f.parks[0];
  assert.notEqual(eventCell, undefined);
  assert.ok(f.wakes.some(({ address, all }) => address === eventCell && all));
  const wakes = f.wakes.length;
  attached.value.interruptEvents();
  assert.notEqual(registry.eventVersion(), current);
  assert.ok(
    f.wakes
      .slice(wakes)
      .some(({ address, all }) => address === eventCell && all),
  );
});
