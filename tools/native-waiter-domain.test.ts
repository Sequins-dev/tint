import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
async function api() {
  assert.ok(
    existsSync("tools/native-waiter-domain.ts"),
    "bounded native waiter fixture must exist",
  );
  return import("./native-waiter-domain.ts");
}
test("waiter fixture uses exact LP64 SDK objects and the proven platform bridge", async () => {
  const { waiterCode } = await api();
  const code = waiterCode();
  assert.deepEqual(code.sdkLayout, {
    mutexBytes: 64,
    conditionBytes: 48,
    alignment: 8,
    timespecBytes: 16,
    etimedout: 60,
    eintr: 4,
  });
  assert.ok(code.imports.includes("_pthread_cond_timedwait_relative_np"));
  assert.ok(code.imports.includes("_pthread_cond_signal"));
  assert.ok(
    !code.instructions.some(
      (i) =>
        i.op.includes("cvt") ||
        i.op.startsWith("f") ||
        ("rd" in i && i.rd === 18),
    ),
  );
  assert.equal(code.frameBytes, 96);
  assert.ok(code.waitOffset > 0 && code.notifyOffset > code.waitOffset);
  assert.ok(code.instructions.some((i) => i.op === "ldar" && i.width === 32));
  assert.ok(code.instructions.some((i) => i.op === "ldar" && i.width === 64));
  for (const offset of [0, code.waitOffset, code.notifyOffset])
    assert.equal(code.instructions[offset / 4]?.op, "stp");
});
test("cooperative waiter protocol models park, key identity, FIFO and timeout/notify ownership", async () => {
  await api();
  const { WaiterModel } = await import("./native-waiter-model.ts");
  const model = new WaiterModel();
  assert.equal(model.wait(0, 7, 256, 4, 1, 0), "not-equal");
  assert.equal(model.parks, 0);
  assert.equal(model.wait(0, 7, 256, 4, 0, 0), "timed-out");
  assert.equal(model.parks, 1);
  assert.equal(model.wait(0, 7, 256, 4, 0, 5), "pending");
  assert.equal(model.wait(1, 7, 256, 8, 0, 5), "pending");
  const locks = model.locks;
  assert.equal(model.notify(7, 256, 8, 0), 0);
  assert.equal(model.notify(7, 260, 4, 2), 0);
  assert.equal(model.notify(8, 256, 8, 2), 0);
  assert.equal(model.locks, locks + 3);
  assert.deepEqual(model.states, ["waiting", "waiting"]);
  model.spurious(1);
  assert.equal(model.states[1], "waiting");
  assert.equal(model.notify(7, 256, 8, 1), 1);
  assert.deepEqual(model.states, ["notified", "waiting"]);
  assert.equal(model.timeout(0), false);
  assert.equal(model.notify(7, 256, 4, Infinity), 1);
  assert.equal(model.notify(7, 256, 4, Infinity), 0);
  assert.deepEqual(model.states, ["notified", "notified"]);
});
test("cooperative abort removes each remaining registration exactly once", async () => {
  await api();
  const { WaiterModel } = await import("./native-waiter-model.ts");
  const model = new WaiterModel();
  model.wait(0, 7, 256, 4, 0, 5);
  model.wait(1, 7, 256, 8, 0, 5);
  assert.equal(model.timeout(0), true);
  assert.equal(model.notify(7, 256, 4, 1), 1);
  assert.equal(model.timeout(1), false);
  const second = new WaiterModel();
  second.wait(0, 7, 256, 4, 0, 5);
  second.abort();
  assert.deepEqual(second.states, ["aborted", "idle"]);
  assert.equal(second.notify(7, 256, 4, 1), 0);
});

test("generated waiter branches stay inside code and SDK storage never overlaps", async () => {
  const { waiterCode } = await api();
  const code = waiterCode();
  for (const [at, i] of code.instructions.entries())
    if (i.op === "b" || i.op === "bl" || i.op === "b.cond") {
      const target = at * 4 + i.displacement;
      assert.ok(target >= 0 && target < code.code.length && target % 4 === 0);
      if (i.op === "bl")
        assert.ok(target === code.waitOffset || target === code.notifyOffset);
    }
  assert.ok(
    code.instructions
      .filter((i) => i.op === "sub-reg" && i.setFlags)
      .every((i) => i.op === "sub-reg" && i.rn !== i.rm),
  );
  assert.equal(code.layout.conditions[0], code.sdkLayout.mutexBytes);
  for (let i = 0; i < 3; i++) {
    const start = code.layout.conditions[i]!;
    assert.equal(start % 8, 0);
    assert.ok(
      start + 48 <=
        (i === 2 ? code.layout.sequence : code.layout.conditions[i + 1]!),
    );
  }
  assert.equal(code.instructions.filter((i) => i.op === "dmb").length, 2);
});
test("bounded FIFO selection uses registration order rather than record index or width", async () => {
  await api();
  const { WaiterModel } = await import("./native-waiter-model.ts");
  const model = new WaiterModel();
  model.wait(1, 7, 0, 8, 0, 5);
  model.wait(0, 7, 0, 4, 0, 5);
  assert.equal(model.notify(7, 0, 4, 1), 1);
  assert.deepEqual(model.states, ["waiting", "notified"]);
});
