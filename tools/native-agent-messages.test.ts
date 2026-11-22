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

test("recycling mailboxes reuse single-quantum payloads up to a bound", async () => {
  const api = await import("../packages/native-runtime/src/agent-messages.ts");
  const host = new NodeSharedMemoryHost();
  const parking = {
    park: (_address: number, _expected: number, _timeout: number) => 0,
    wake: (_address: number) => 0,
  };
  const created = api.createNativeAgentMailbox(host, parking, 73, true);
  assert.ok(created.ok);
  const queue = created.value;
  // Steady one-at-a-time traffic maps one payload block and reuses it.
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(queue.send("m" + i), { ok: true, value: undefined });
    assert.equal(queue.receive(), "m" + i);
  }
  assert.equal(host.kernel.mappings.size, 2);
  // A burst keeps at most recycledMessageBlocks blocks once drained.
  const burst = api.recycledMessageBlocks + 8;
  for (let i = 0; i < burst; i++) queue.send("b" + i);
  for (let i = 0; i < burst; i++) assert.equal(queue.receive(), "b" + i);
  assert.equal(host.kernel.mappings.size, 1 + api.recycledMessageBlocks);
  // Reused blocks carry stale free-stack links; a queue of several of them
  // must still end at its last message.
  for (let i = 0; i < 5; i++) queue.send("r" + i);
  for (let i = 0; i < 5; i++) assert.equal(queue.receive(), "r" + i);
  assert.equal(queue.receive(), undefined);
  assert.equal(host.kernel.mappings.size, 1 + api.recycledMessageBlocks);
  // Multi-quantum payloads are never recycled.
  const large = "x".repeat(20000);
  queue.send(large);
  assert.equal(queue.receive(), large);
  assert.equal(host.kernel.mappings.size, 1 + api.recycledMessageBlocks);
  api.releaseNativeAgentMailboxBlocks(host, queue.registry);
  assert.equal(host.kernel.mappings.size, 1);
  // A plain mailbox still unmaps every consumed payload.
  const plain = api.createNativeAgentMailbox(host, parking, 74);
  assert.ok(plain.ok);
  plain.value.send("once");
  assert.equal(plain.value.receive(), "once");
  assert.equal(host.kernel.mappings.size, 2);
});

test("small packets share a segment until every packet and the producer let go", async () => {
  const api = await import("../packages/native-runtime/src/agent-messages.ts");
  const host = new NodeSharedMemoryHost();
  const parking = {
    park: (_address: number, _expected: number, _timeout: number) => 0,
    wake: (_address: number) => 0,
  };
  const created = api.createNativeAgentMailbox(host, parking, 75, true);
  assert.ok(created.ok);
  const registry = created.value.registry;
  const producer = api.createNativeAgentPacketProducer(host, parking, registry);
  const sent: number[] = [];
  for (let i = 0; i < 3; i++) {
    const packet = producer.allocate(0);
    assert.ok(packet !== undefined && packet.segment !== 0);
    producer.commit(packet, 40 + i);
    api.publishNativeAgentPacket(host, parking, registry, packet, 40 + i);
    sent.push(packet.base);
  }
  // One segment mapping holds all three; a nested allocation while a
  // packet is open gets a mapping of its own.
  assert.equal(host.kernel.mappings.size, 2);
  const open = producer.allocate(0);
  assert.ok(open !== undefined);
  const nested = producer.allocate(100);
  assert.ok(nested !== undefined && nested.segment === 0);
  producer.release(nested);
  producer.release(open);
  const entries = api.drainNativeAgentPackets(host, parking, registry);
  assert.deepEqual(
    entries.map((entry) => [entry.packet.base, entry.used]),
    sent.map((base, i) => [base, 40 + i]),
  );
  // The segment outlives its drained packets while the producer holds it.
  for (const entry of entries)
    api.releaseNativeAgentPacket(host, parking, registry, entry.packet);
  assert.equal(api.drainNativeAgentPackets(host, parking, registry).length, 0);
  producer.close();
  // Closing returns it to the free stack, where the next segment comes from.
  const again = producer.allocate(0);
  assert.ok(again !== undefined);
  assert.equal(again.segment, entries[0]!.packet.segment);
  producer.release(again);
  producer.close();
  api.releaseNativeAgentMailboxBlocks(host, registry);
  assert.equal(host.kernel.mappings.size, 1);
});
