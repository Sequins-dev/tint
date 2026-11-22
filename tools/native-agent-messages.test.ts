import assert from "node:assert/strict";
import test from "node:test";
import { NodeSharedMemoryHost } from "./node-shared-memory-host.ts";

async function fixture() {
  const api = await import("../packages/native-runtime/src/agent-messages.ts");
  const host = new NodeSharedMemoryHost();
  const parking = {
    park: (_address: number, _expected: number, _timeout: number) => 0,
    wake: (_address: number) => 0,
  };
  const queue = api.createNativeAgentMailbox(host, parking, 71);
  assert.ok(queue.ok);
  const peer = api.attachNativeAgentMailbox(
    new NodeSharedMemoryHost(host.kernel),
    parking,
    { ...queue.value.registry },
  );
  assert.ok(peer.ok);
  return { host, queue: queue.value, peer: peer.value, api, parking };
}

test("agent report mailbox copies exact UTF-16 through raw mappings and releases consumed payloads", async () => {
  const f = await fixture();
  const messages = ["", "a\0b", "😀", "\ud800x\udfff", "42", "x".repeat(20000)];
  // Receiving reads eight units at a time and then the remainder.
  for (let length = 0; length <= 17; length++)
    messages.push(
      Array.from({ length }, (_, i) =>
        String.fromCharCode(0xd7f0 + i * 257),
      ).join(""),
    );
  assert.equal(f.peer.receive(), undefined);
  for (const message of messages)
    assert.deepEqual(f.queue.send(message), { ok: true, value: undefined });
  assert.equal(f.host.kernel.mappings.size, messages.length + 1);
  for (const message of messages) assert.equal(f.peer.receive(), message);
  assert.equal(f.queue.receive(), undefined);
  assert.equal(f.host.kernel.mappings.size, 1);
});

test("mailbox publication is FIFO across independent facades and a failed allocation publishes nothing", async () => {
  const f = await fixture();
  assert.ok(f.queue.send("first").ok);
  f.host.kernel.failNextMap = true;
  assert.deepEqual(f.peer.send("discarded"), {
    ok: false,
    error: "allocation-limit",
  });
  assert.ok(f.peer.send("second").ok);
  assert.equal(f.queue.receive(), "first");
  assert.ok(f.queue.send("third").ok);
  assert.equal(f.peer.receive(), "second");
  assert.equal(f.queue.receive(), "third");
  assert.equal(f.host.kernel.mappings.size, 1);
});

test("agent mailbox attachment rejects another engine and malformed descriptors", async () => {
  const f = await fixture();
  for (const registry of [
    { ...f.queue.registry, engineId: 72 },
    { ...f.queue.registry, byteLength: 8 },
    { ...f.queue.registry, base: 0 },
  ])
    assert.deepEqual(
      f.api.attachNativeAgentMailbox(f.host, f.parking, registry),
      { ok: false, error: "invalid-handle" },
    );
});
