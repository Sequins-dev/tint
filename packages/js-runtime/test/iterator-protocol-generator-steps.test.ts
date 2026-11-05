import { test } from "node:test";
import assert from "node:assert/strict";
import * as protocol from "../src/iterators/index.ts";

test("native continuation transfers do not accumulate recursive calls", () => {
  let count = 0;
  const step: protocol.GeneratorStep<number> = (kind, value) => {
    assert.equal(kind, "next");
    if (++count === 100000) return { kind: "return", value };
    return {
      kind: "transfer",
      next: step,
      inputKind: "next",
      value: value + 1,
    };
  };
  assert.deepEqual(protocol.runGeneratorSteps(step("next", 1)), {
    kind: "return",
    value: 100000,
  });
});

test("transfers leave a native catch scope before invoking their destination", () => {
  let caught = false;
  const marker = {};
  const destination: protocol.GeneratorStep<unknown> = () => {
    throw marker;
  };
  const protectedStep: protocol.GeneratorStep<unknown> = () => {
    try {
      return {
        kind: "transfer",
        next: destination,
        inputKind: "throw",
        value: marker,
      };
    } catch {
      caught = true;
      return { kind: "return", value: undefined };
    }
  };
  assert.throws(
    () => protocol.runGeneratorSteps(protectedStep("next", undefined)),
    (error) => error === marker,
  );
  assert.equal(caught, false);
});

test("transfers preserve injected completion values and yielded identity", () => {
  const marker = {};
  const yielded = {
    get done() {
      return assert.fail("must not inspect a yielded result");
    },
  };
  for (const kind of ["next", "return", "throw"] as const) {
    const destination: protocol.GeneratorStep<unknown> = (
      receivedKind,
      value,
    ) => {
      assert.equal(receivedKind, kind);
      assert.equal(value, marker);
      return { kind: "yield", result: yielded };
    };
    assert.deepEqual(
      protocol.runGeneratorSteps<unknown>({
        kind: "transfer",
        next: destination,
        inputKind: kind,
        value: marker,
      }),
      { kind: "yield", result: yielded },
    );
  }
});

test("driver entry transfers preserve resume arguments and thrown identity", () => {
  const marker = {};
  for (const kind of ["next", "return", "throw"] as const) {
    const observed: unknown[] = [];
    const step: protocol.GeneratorStep<unknown> = (resume, value) => {
      observed.push(resume, value);
      if (resume === "throw") throw marker;
      return { kind: "return", value };
    };
    const invoke = (transfer: boolean) => {
      try {
        return {
          value: protocol.runGeneratorSteps(
            transfer
              ? { kind: "transfer", next: step, inputKind: kind, value: 42 }
              : step(kind, 42),
          ),
          thrown: undefined,
        };
      } catch (thrown) {
        return { value: undefined, thrown };
      }
    };
    const direct = invoke(false),
      transferred = invoke(true);
    assert.deepEqual(transferred, direct);
    if (kind === "throw") assert.equal(transferred.thrown, marker);
    assert.deepEqual(observed, [kind, 42, kind, 42]);
  }
});
