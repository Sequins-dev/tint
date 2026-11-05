import assert from "node:assert/strict";
import test from "node:test";
import * as disposal from "../src/disposal/index.ts";
test("closing detaches resources and rejects reentrant registration", () => {
  const stack = disposal.createDisposalStack<number>();
  assert.equal(
    disposal.pushDisposalResource(stack, {
      value: 19,
      method: 1,
      hint: "sync",
    }),
    true,
  );
  assert.equal(
    disposal.pushDisposalResource(stack, {
      value: 42,
      method: 2,
      hint: "async",
    }),
    true,
  );
  const resources = disposal.takeDisposalResources(stack);
  assert.ok(resources);
  assert.equal(stack.state, "disposed");
  assert.equal(stack.resources.length, 0);
  const calls: number[] = [];
  for (let index = resources.length - 1; index >= 0; index--) {
    const resource = resources[index];
    assert.ok(resource);
    calls.push(resource.value);
    assert.equal(
      disposal.pushDisposalResource(stack, {
        value: 99,
        method: 3,
        hint: "sync",
      }),
      false,
    );
    assert.equal(disposal.takeDisposalResources(stack), undefined);
  }
  assert.deepEqual(calls, [42, 19]);
});
test("moving transfers ownership once without closing the recipient", () => {
  const stack = disposal.createDisposalStack<number>();
  disposal.pushDisposalResource(stack, { value: 42, method: 1, hint: "sync" });
  const moved = disposal.moveDisposalStack(stack);
  assert.ok(moved);
  assert.equal(stack.state, "disposed");
  assert.equal(stack.resources.length, 0);
  assert.equal(moved.state, "pending");
  assert.equal(moved.resources.length, 1);
  assert.equal(disposal.moveDisposalStack(stack), undefined);
  assert.equal(disposal.takeDisposalResources(stack), undefined);
  const rows = disposal.takeDisposalResources(moved);
  assert.ok(rows);
  assert.equal(rows[0]?.value, 42);
});
