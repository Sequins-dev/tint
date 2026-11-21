import assert from "node:assert/strict";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  generalCallLoopSource,
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

process.env.TINT_GENERAL_FALLBACK = "0";
verifyHostedFixture(typedCallLoopSource, "typed-call-loop");
