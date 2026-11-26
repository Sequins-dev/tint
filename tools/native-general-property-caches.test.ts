// Generated property caches compare the receiver's shared shape (per-
// prototype transition trees) with the site's inline entry and load the
// cached value in place (IR property-load natively). Node computes the
// expected observations from the same source; the native image runs under LLDB
// through the shared `general-realm-suite` binary.
import test from "node:test";
import { runGeneralRealmSuiteCase } from "./native-general-suite.ts";

test("property caches keep JavaScript lookups across shapes and redefinitions", async () => {
  await runGeneralRealmSuiteCase("property-caches");
});
