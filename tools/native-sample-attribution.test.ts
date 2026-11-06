import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeNativeSample } from "./native-sample-attribution.ts";

test("native sample attribution subtracts children and combines specializations", () => {
  const result = attributeNativeSample(`Call graph:
    10 Thread_1 DispatchQueue_1: com.apple.main-thread (serial)
      10 tint:process-entry (in image) + 0 [0x1000]
        8 program:array.ts:find [specialized_1] (in image) + 4 [0x1004]
        + 3 program:array.ts:find [specialized_2] (in image) + 8 [0x1008]
        + ! 1 program:helper:equal (in image) + 0 [0x100c]
        2 program:array.ts:find [specialized_3] (in image) + 4 [0x1004]
    4 Thread_2
      4 __workq_kernreturn (in libsystem_kernel.dylib) + 0
Total number in stack (recursive counted multiple, when >=5):
    13 program:array.ts:find
Sort by top of stack, same collapsed (when >= 5):
    program:array.ts:find 9
Binary Images:
`);
  assert.equal(result.samples, 10);
  assert.deepEqual(result.leafGroups, [
    { function: "program:array.ts:find", samples: 9, percent: 90 },
    { function: "program:helper:equal", samples: 1, percent: 10 },
  ]);
});

test("native sample attribution retains unknown PCs and validates the tree", () => {
  assert.deepEqual(
    attributeNativeSample(`Call graph:
    2 Thread_1 DispatchQueue_1: com.apple.main-thread (serial)
      2 ??? (in image) + 8 [0x1008]
Total number in stack:
`).leafGroups,
    [{ function: "???", samples: 2, percent: 100 }],
  );
  assert.throws(
    () =>
      attributeNativeSample(`Call graph:
    1 Thread_1 DispatchQueue_1: com.apple.main-thread (serial)
      2 impossible (in image)
Total number in stack:
`),
    /children exceed parent/,
  );
  assert.throws(() => attributeNativeSample("Node CPU profile"), /main thread/);
});
