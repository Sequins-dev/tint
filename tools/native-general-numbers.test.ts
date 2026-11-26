// Untyped locals and parameters tested as numbers carry a number shadow
// (shadowGeneralNumbers): a presence flag and an unboxed value kept with
// every store. Node computes the expected observations from the same source;
// the native image runs under LLDB through the shared `general-realm-suite`
// binary.
import test from "node:test";
import { runGeneralRealmSuiteCase } from "./native-general-suite.ts";

test("general number shadows keep JavaScript values across category changes", async () => {
  await runGeneralRealmSuiteCase("numbers");
});
