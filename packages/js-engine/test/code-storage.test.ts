import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
async function fixture(capacity = 64) {
  assert.ok(
    existsSync("packages/js-engine/src/native/code-storage.ts"),
    "engine code storage must exist",
  );
  const { createEngineCodeStorage } =
    await import("../src/native/code-storage.ts");
  assert.equal(
    typeof createEngineCodeStorage,
    "function",
    "engine publisher factory must exist",
  );
  const calls: string[] = [];
  const state = { address: 4096, registration: 0, writing: 0, domain: 17 };
  const host = {
    domain: () => state.domain,
    map: (bytes: number) => {
      calls.push("map:" + bytes);
      return state.address;
    },
    register: (address: number, bytes: number) => {
      calls.push("register:" + address + ":" + bytes);
      return state.registration;
    },
    write: (
      address: number,
      capacity: number,
      offset: number,
      code: Uint8Array,
    ) => {
      calls.push(
        "write:" + address + ":" + capacity + ":" + offset + ":" + code.length,
      );
      return state.writing;
    },
  };
  return {
    storage: createEngineCodeStorage(host, capacity),
    calls,
    state,
    host,
    createEngineCodeStorage,
  };
}
test("engine publication is lazy, shared and aligned with registration before writes", async () => {
  const f = await fixture();
  assert.deepEqual(f.calls, []);
  assert.equal(f.storage.publish(new Uint8Array(3)), 4096);
  assert.equal(f.storage.publish(new Uint8Array(4)), 4112);
  assert.deepEqual(f.calls, [
    "map:64",
    "register:4096:64",
    "write:4096:64:0:3",
    "write:4096:64:16:4",
  ]);
});
test("oversized code does not map or consume the available arena", async () => {
  const f = await fixture(16);
  assert.equal(f.storage.publish(new Uint8Array(17)), undefined);
  assert.deepEqual(f.calls, []);
  assert.equal(f.storage.publish(new Uint8Array(16)), 4096);
  assert.equal(f.storage.publish(new Uint8Array(1)), undefined);
  assert.equal(f.calls.length, 3);
});
test("map and registration failures poison the arena without retrying authority", async () => {
  for (const kind of ["map", "register"] as const) {
    const f = await fixture();
    if (kind === "map") f.state.address = -1;
    else f.state.registration = -1;
    assert.equal(f.storage.publish(new Uint8Array(4)), undefined);
    const observed = f.calls.slice();
    f.state.address = 4096;
    f.state.registration = 0;
    assert.equal(f.storage.publish(new Uint8Array(4)), undefined);
    assert.deepEqual(f.calls, observed);
  }
});
test("failed writes retain consumed identities and preserve later publication", async () => {
  const f = await fixture();
  f.state.writing = -1;
  assert.equal(f.storage.publish(new Uint8Array(4)), undefined);
  f.state.writing = 0;
  assert.equal(f.storage.publish(new Uint8Array(4)), 4112);
  assert.equal(f.calls.at(-1), "write:4096:64:16:4");
});
test("host exceptions preserve map poison and write reservations", async () => {
  const marker = {};
  const f = await fixture();
  const broken = {
    ...f.host,
    map: () => {
      throw marker;
    },
  };
  const storage = f.createEngineCodeStorage(broken, 64);
  assert.throws(
    () => storage.publish(new Uint8Array(4)),
    (e) => e === marker,
  );
  assert.equal(storage.publish(new Uint8Array(4)), undefined);
  let brokenWrite = true;
  const writing = f.createEngineCodeStorage(
    {
      ...f.host,
      write: (address, capacity, offset, code) => {
        if (brokenWrite) throw marker;
        return f.host.write(address, capacity, offset, code);
      },
    },
    64,
  );
  assert.throws(
    () => writing.publish(new Uint8Array(4)),
    (e) => e === marker,
  );
  brokenWrite = false;
  assert.equal(writing.publish(new Uint8Array(4)), 4112);
});
test("empty publication preserves existing aligned arena semantics", async () => {
  const f = await fixture();
  assert.equal(f.storage.publish(new Uint8Array(0)), 4096);
  assert.equal(f.storage.publish(new Uint8Array(4)), 4096);
  assert.equal(f.calls.filter((x) => x.startsWith("map:")).length, 1);
});
test("factory rejects invalid capacities before requesting native authority", async () => {
  const f = await fixture();
  for (const capacity of [
    0,
    -1,
    NaN,
    Infinity,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(
      () => f.createEngineCodeStorage(f.host, capacity),
      RangeError,
    );
  assert.deepEqual(f.calls, []);
});

test("code storage is context-owned and rejects cross-domain publication before host effects", async () => {
  const f = await fixture();
  assert.equal(f.storage.domain, 17);
  f.state.domain = 19;
  assert.equal(f.storage.publish(new Uint8Array(4)), undefined);
  assert.deepEqual(f.calls, []);
  f.state.domain = 17;
  assert.equal(f.storage.publish(new Uint8Array(4)), 4096);
  const before = [...f.calls];
  f.state.domain = 19;
  assert.equal(f.storage.publish(new Uint8Array(4)), undefined);
  assert.deepEqual(f.calls, before);
  for (const domain of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => f.createEngineCodeStorage({ ...f.host, domain: () => domain }, 64),
      RangeError,
    );
});
test("a context switch inside publication cannot register or publish a foreign range", async () => {
  const f = await fixture();
  const switched = f.createEngineCodeStorage(
    {
      ...f.host,
      map: () => {
        f.state.domain = 19;
        return 4096;
      },
    },
    64,
  );
  assert.equal(switched.publish(new Uint8Array(4)), undefined);
  assert.deepEqual(f.calls, []);
  f.state.domain = 17;
  assert.equal(switched.publish(new Uint8Array(4)), undefined);
  const writing = f.createEngineCodeStorage(
    {
      ...f.host,
      write: () => {
        f.state.domain = 19;
        return 0;
      },
    },
    64,
  );
  assert.equal(writing.publish(new Uint8Array(4)), undefined);
});
