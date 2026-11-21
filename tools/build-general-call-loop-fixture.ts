import assert from "node:assert/strict";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  generalCallLoopSource,
  generalSlotCollectionSource,
  typedCallLoopSource,
} from "./general-call-loop-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("general call and loop fixture requires TINT_BUILD_ONLY=1");

delete process.env.TINT_GENERAL_FALLBACK;
let general = false;
verifyHostedFixture(
  generalCallLoopSource,
  "general-call-loop",
  [],
  [],
  [],
  [],
  {
    managedBytes: 128 * 1024 * 1024,
    allocationCapacity: 1_048_576,
    onGeneralFallback: () => {
      general = true;
    },
  },
);
assert.ok(general, "expected general lowering");

const memory = "packages/native-runtime/src/intrinsics/memory.ts";
let movingGeneral = false;
verifyHostedFixture(
  'import { collectGarbage } from "memory";\n' + generalSlotCollectionSource,
  "general-slot-moving-collection",
  [["memory", memory]],
  [],
  [],
  [{ module: memory, namespace: "native-memory" }],
  {
    managedBytes: 32 * 1024 * 1024,
    allocationCapacity: 262144,
    runtimeEntry: "initializeCopyingRuntime",
    hostBindings: [
      { module: memory, name: "collectGarbage", operation: "collect-garbage" },
    ],
    onGeneralFallback: () => {
      movingGeneral = true;
    },
  },
);
assert.ok(
  movingGeneral,
  "expected general lowering for the moving collection fixture",
);

process.env.TINT_GENERAL_FALLBACK = "0";
verifyHostedFixture(typedCallLoopSource, "typed-call-loop");
