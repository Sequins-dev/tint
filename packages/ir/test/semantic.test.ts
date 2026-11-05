import assert from "node:assert/strict";
import test from "node:test";
import {
  shortCircuit,
  propertyReference,
  callReference,
  representationFor,
} from "../src/semantic/index.ts";
test("short circuit operands remain lazy regions and retain operand results", () => {
  assert.deepEqual(shortCircuit("&&", 4, 9), {
    kind: "short-circuit",
    left: 4,
    rightRegion: 9,
    test: "truthy",
    evaluateRightWhen: true,
  });
  assert.deepEqual(shortCircuit("||", 4, 9), {
    kind: "short-circuit",
    left: 4,
    rightRegion: 9,
    test: "truthy",
    evaluateRightWhen: false,
  });
  assert.deepEqual(shortCircuit("??", 4, 9), {
    kind: "short-circuit",
    left: 4,
    rightRegion: 9,
    test: "nullish",
    evaluateRightWhen: true,
  });
});
test("property references preserve the receiver independently from the callable value", () => {
  const reference = propertyReference(3, 5);
  assert.deepEqual(callReference(reference, 7, [8]), {
    kind: "call",
    callee: 7,
    receiver: 3,
    arguments: [8],
  });
});
test("source annotations never authorize specialized storage", () => {
  assert.equal(
    representationFor(
      { declared: 3, variants: [3], origin: "annotation", guard: undefined },
      [],
    ),
    "dynamic",
  );
  assert.equal(
    representationFor(
      { declared: 3, variants: [3], origin: "analysis", guard: undefined },
      [],
    ),
    "fixed",
  );
  assert.equal(
    representationFor(
      { declared: 3, variants: [3, 4], origin: "analysis", guard: undefined },
      [],
    ),
    "tagged-union",
  );
  assert.equal(
    representationFor(
      { declared: 3, variants: [3], origin: "guard", guard: 12 },
      [],
    ),
    "dynamic",
  );
  assert.equal(
    representationFor(
      { declared: 3, variants: [3], origin: "guard", guard: 12 },
      [12],
    ),
    "fixed",
  );
  assert.equal(
    representationFor(
      { declared: 3, variants: [], origin: "analysis", guard: undefined },
      [],
    ),
    "dynamic",
  );
});
