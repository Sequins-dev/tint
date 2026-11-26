// Generated element access reads and overwrites the packed binary64
// elements of arrays inline (IR element-load and element-store natively)
// and leaves every other case to the generic paths. Node computes the expected
// observations from the same source; the native image runs under LLDB through
// the shared `general-realm-suite` binary (`await import(...)` + `argv`).
import test from "node:test";
import { runGeneralRealmSuiteCase } from "./native-general-suite.ts";

test("element access keeps JavaScript semantics on every receiver and key", async () => {
  await runGeneralRealmSuiteCase("elements");
});
