import assert from "node:assert/strict";
import test from "node:test";
import { NodeSharedMemoryHost } from "./node-shared-memory-host.ts";
import {
  createNativeSharedBlockService,
  attachNativeSharedBlockService,
} from "@tint/native-runtime/shared-blocks";
const policy = { pageSize: 16384, maxBlocks: 8, maxReservedBytes: 262144 };
const parking = {
  park: (_address: number, _expected: number, _timeout: number) => 0,
  wake: (_address: number) => 0,
};
test("native shared backing explicitly shares one waiter authority across local facades", () => {
  const host = new NodeSharedMemoryHost();
  const created = createNativeSharedBlockService(host, policy, host, {
    parking,
    now: () => 19,
    maxWaiters: 4,
  });
  assert.ok(created.ok);
  const service = created.value;
  assert.ok(service.waiting, "waiting authority must be installed explicitly");
  assert.ok(service.notifications);
  assert.ok(service.waitRegistry);
  const block = service.create(16, 16, false);
  assert.ok(block.ok);
  const handle = block.value.handle;
  assert.equal(service.writeUnsigned(handle, 0, 4, 7, "seq-cst"), "none");
  const registration = service.waiting.register(handle, 0, 4, 7, 0, false);
  assert.ok(registration.ok);
  const peerHost = new NodeSharedMemoryHost(host.kernel);
  const attached = attachNativeSharedBlockService(
    peerHost,
    { ...service.registry },
    peerHost,
    { parking, now: () => 23, registry: { ...service.waitRegistry } },
  );
  assert.ok(attached.ok);
  assert.ok(attached.value.notifications);
  assert.ok(attached.value.waiting);
  assert.deepEqual(attached.value.notifications.notify(handle, 0, 8, 1), {
    ok: true,
    value: 1,
  });
  assert.deepEqual(service.waiting.take(registration.value.ticket), {
    ok: true,
    value: "notified",
  });
  assert.equal(service.waiting.now(), 19);
  assert.equal(attached.value.waiting.now(), 23);
});
test("unconfigured native backing retains no counterfeit waiting or notify capability", () => {
  const host = new NodeSharedMemoryHost(),
    created = createNativeSharedBlockService(host, policy, host);
  assert.ok(created.ok);
  assert.equal(Reflect.get(created.value, "waiting"), undefined);
  assert.equal(created.value.notifications, undefined);
});
test("failed waiter allocation rolls back the unpublished shared-block registry", () => {
  const host = new NodeSharedMemoryHost();
  const created = createNativeSharedBlockService(host, policy, host, {
    parking,
    now: () => 0,
    maxWaiters: 0,
  });
  assert.deepEqual(created, { ok: false, error: "invalid-length" });
  assert.equal(host.kernel.mappings.size, 0);
});
