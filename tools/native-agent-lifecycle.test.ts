import assert from "node:assert/strict";
import test from "node:test";
import { NodeSharedMemoryHost } from "./node-shared-memory-host.ts";

async function fixture() {
  const api = await import("@tint/native-runtime/agents");
  const host = new NodeSharedMemoryHost();
  let clock = 0;
  const workers: ReturnType<typeof api.attachNativeAgentWorker>[] = [];
  const parking = {
    onPark: (): void => {},
    park: (_address: number, _expected: number, _timeout: number) => {
      clock++;
      parking.onPark();
      return 0;
    },
    wake: (_address: number) => 0,
  };
  const threads = {
    now: () => clock,
    entry: 17,
    start: (_entry: number, argument: number) => {
      const worker = api.attachNativeAgentWorker(
        new NodeSharedMemoryHost(host.kernel),
        parking,
        argument,
      );
      assert.ok(worker.ok);
      workers.push(worker);
      worker.value.running();
      return workers.length;
    },
    join: (_thread: number) => 0,
  };
  const cluster = api.createNativeAgentCluster(
    host,
    parking,
    threads,
    91,
    4,
    10,
  );
  assert.ok(cluster.ok);
  return { host, cluster: cluster.value, workers, threads, api, parking };
}
test("native agent startup copies source before starting and completes a readiness handshake", async () => {
  const f = await fixture();
  const started = f.cluster.start("a\0\ud800");
  assert.ok(started.ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  assert.equal(worker.value.source(), "a\0\ud800");
  assert.ok(worker.value.report("hello\udfff").ok);
  assert.equal(f.cluster.getReport(), "hello\udfff");
  assert.equal(f.cluster.getReport(), undefined);
  worker.value.leaving();
  f.cluster.joinAll();
});
test("worker failure remains visible to the owner and raw state outlives the worker facade", async () => {
  const f = await fixture();
  assert.ok(f.cluster.start("throw").ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  worker.value.source();
  worker.value.failed("worker error");
  assert.throws(() => f.cluster.getReport(), /worker error/);
  assert.throws(() => f.cluster.getReport(), /worker error/);
});
test("startup timeout is bounded without attempting unsafe asynchronous thread cancellation", async () => {
  const f = await fixture();
  f.threads.start = () => 9;
  assert.throws(() => f.cluster.start("never ready"), /TIMEOUT/);
});
test("worker errors remain terminal even if copying their diagnostic runs out of memory", async () => {
  const f = await fixture();
  assert.ok(f.cluster.start("source").ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  worker.value.source();
  f.host.kernel.failNextMap = true;
  worker.value.failed("cannot allocate this diagnostic");
  assert.throws(() => f.cluster.getReport(), /NATIVE_AGENT_FAILURE/);
});
test("joining a worker observes its native exit status", async () => {
  const f = await fixture();
  assert.ok(f.cluster.start("source").ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  worker.value.source();
  worker.value.leaving();
  f.threads.join = () => 70;
  assert.throws(() => f.cluster.joinAll(), /NATIVE_AGENT_THREAD_EXIT/);
});
test("broadcast waits for retrieval and copies exact BigInt identifiers into each worker context", async () => {
  const f = await fixture();
  assert.ok(f.cluster.start("source").ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  worker.value.source();
  const received: unknown[] = [];
  f.parking.onPark = () => {
    received.push(worker.value.pollBroadcast());
  };
  f.cluster.broadcast(4, "-9223372036854775809", true);
  assert.deepEqual(received, [
    { block: 4, identifier: "-9223372036854775809", bigInt: true },
  ]);
  assert.equal(worker.value.pollBroadcast(), undefined);
  worker.value.leaving();
  f.cluster.broadcast(4, "1", false);
  assert.equal(received.length, 1);
});
test("startup failure before consuming source is terminal and never reports source as the diagnostic", async () => {
  const f = await fixture();
  assert.ok(f.cluster.start("private worker source").ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  worker.value.failed("startup failed");
  assert.throws(() => f.cluster.getReport(), /startup failed/);
});
test("worker attachment copies shared service descriptors without sharing managed facades", async () => {
  const f = await fixture();
  const blocks = {
    base: f.host.mapMemory(16384),
    byteLength: 16384,
    engineId: 91,
  };
  const waiters = {
    base: f.host.mapMemory(16384),
    byteLength: 16384,
    engineId: 91,
  };
  const created = f.api.createNativeAgentCluster(
    f.host,
    f.parking,
    f.threads,
    91,
    2,
    10,
    { blocks, waiters },
  );
  assert.ok(created.ok);
  assert.ok(created.value.start("source").ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  assert.deepEqual(worker.value.sharedBlocks, blocks);
  assert.deepEqual(worker.value.sharedWaiters, waiters);
  assert.notEqual(worker.value.sharedBlocks, blocks);
  assert.notEqual(worker.value.sharedWaiters, waiters);
});
test("a worker failing before broadcast retrieval reports its error rather than the queued identifier", async () => {
  const f = await fixture();
  assert.ok(f.cluster.start("source").ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  worker.value.source();
  f.parking.onPark = () => {
    worker.value.failed("broadcast exploded");
  };
  assert.throws(
    () => f.cluster.broadcast(4, "123", false),
    /broadcast exploded/,
  );
});
test("unpublished startup mappings are rolled back when either queue or source allocation fails", async () => {
  for (const failureAt of [2, 3]) {
    const f = await fixture(),
      before = f.host.kernel.mappings.size;
    const map = f.host.mapMemory.bind(f.host);
    let calls = 0;
    f.host.mapMemory = (length: number) =>
      ++calls === failureAt ? -1 : map(length);
    assert.deepEqual(f.cluster.start("source"), {
      ok: false,
      error: "allocation-limit",
    });
    assert.equal(f.host.kernel.mappings.size, before);
    assert.equal(f.workers.length, 0);
  }
});
test("owner failure checkpoints do not consume pending reports", async () => {
  const f = await fixture();
  assert.ok(f.cluster.start("source").ok);
  const worker = f.workers[0];
  assert.ok(worker?.ok);
  worker.value.source();
  worker.value.report("pending");
  f.cluster.check();
  assert.equal(f.cluster.getReport(), "pending");
});
