import test from "node:test";
import { verifyAtomicsFixture } from "./atomics-fixture.ts";

test("the Atomics intrinsics over native shared blocks run natively", () => {
  verifyAtomicsFixture();
});
