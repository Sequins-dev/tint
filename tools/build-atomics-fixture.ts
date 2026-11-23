import { verifyAtomicsFixture } from "./atomics-fixture.ts";

// Build-only entry for LLDB runs; tools/native-atomics.test.ts runs the same
// fixture in the native test set.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("shared buffer fixture requires TINT_BUILD_ONLY=1");
verifyAtomicsFixture();
