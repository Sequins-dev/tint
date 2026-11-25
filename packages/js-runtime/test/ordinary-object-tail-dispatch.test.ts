import assert from "node:assert/strict";
import test from "node:test";
import { callObject } from "../src/objects/call.ts";
import {
  createCallableObject,
  createObject,
  ensureRareSlots,
  type OrdinaryObject,
} from "../src/objects/operations.ts";

test("internal call transfers run 100,000 mutual steps without growing the host stack", () => {
  const legacy = () =>
    assert.fail("the call driver must use the internal dispatch");
  const left = createCallableObject<string, number>(undefined, legacy);
  const right = createCallableObject<string, number>(undefined, legacy);
  let calls = 0;
  for (const [self, next] of [
    [left, right],
    [right, left],
  ]) {
    ensureRareSlots(self!).internalTailDispatch = (
      receiver: number,
      args: readonly number[],
    ) => {
      calls++;
      const remaining = args[0]!;
      assert.equal(receiver, 42);
      return remaining === 0
        ? { kind: "return", value: 7 }
        : {
            kind: "call",
            target: next!,
            receiver,
            arguments: [remaining - 1],
          };
    };
  }
  assert.deepEqual(callObject(left, 42, [100000], 0), {
    error: "none",
    value: 7,
  });
  assert.equal(calls, 100001);
});

test("a transfer releases its own context before entering a legacy target", () => {
  const order: string[] = [];
  let active = "caller";
  const target = createCallableObject<string, unknown>(
    undefined,
    (receiver, args) => {
      assert.equal(active, "target");
      assert.equal(receiver, 42);
      assert.deepEqual(args, [7]);
      order.push("target");
      return 49;
    },
    {
      run: (action) => {
        assert.equal(active, "caller");
        active = "target";
        try {
          return action();
        } finally {
          active = "caller";
        }
      },
    },
  );
  const source = createCallableObject<string, unknown>(
    undefined,
    () => assert.fail("legacy source"),
    {
      run: () => assert.fail("the dispatch owns its source context"),
    },
  );
  ensureRareSlots(source).internalTailDispatch = () => {
    assert.equal(active, "caller");
    active = "source";
    try {
      order.push("source");
    } finally {
      active = "caller";
    }
    return { kind: "call", target, receiver: 42, arguments: [7] };
  };
  assert.deepEqual(callObject(source, undefined, [], undefined), {
    error: "none",
    value: 49,
  });
  assert.deepEqual(order, ["source", "target"]);
  assert.equal(active, "caller");
});

test("returned JavaScript values cannot forge an internal transfer", () => {
  const value = {
    kind: "call",
    target: undefined,
    receiver: undefined,
    arguments: [],
  };
  const fn = createCallableObject<string, unknown>(undefined, () =>
    assert.fail("legacy"),
  );
  ensureRareSlots(fn).internalTailDispatch = () => ({ kind: "return", value });
  assert.equal(callObject(fn, undefined, [], undefined).value, value);
});

test("nested dispatches keep their arguments and propagate thrown identity", () => {
  const failure = {};
  const inner = createCallableObject<string, unknown>(undefined, () => {
    throw failure;
  });
  const outer = createCallableObject<string, unknown>(undefined, () =>
    assert.fail("legacy"),
  );
  const original = [42];
  ensureRareSlots(outer).internalTailDispatch = (
    _receiver: unknown,
    args: readonly unknown[],
  ) => {
    assert.equal(args, original);
    assert.throws(
      () => callObject(inner, undefined, [7], undefined),
      (error) => error === failure,
    );
    assert.equal(args, original);
    return { kind: "return", value: args[0] };
  };
  assert.equal(callObject(outer, undefined, original, undefined).value, 42);
});

test("dispatch cannot make a non-callable target callable", () => {
  const plain: OrdinaryObject<string, unknown> = createObject(undefined);
  ensureRareSlots(plain).internalTailDispatch = () =>
    assert.fail("non-callable dispatch");
  assert.deepEqual(callObject(plain, undefined, [], undefined), {
    error: "type",
    value: undefined,
  });
});
