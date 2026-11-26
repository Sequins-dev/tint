// Generated calls of Math methods, Number, String.prototype.charCodeAt and
// charAt, and the Map and Set methods perform the builtin inline when the
// callee is the realm's own function and the operands have the inline form's
// types, and otherwise call the callee with the same operands. Node computes
// the expected observations from the same source; the native image runs under
// LLDB through the shared `general-realm-suite` binary.
import test from "node:test";
import { runGeneralRealmSuiteCase } from "./native-general-suite.ts";

test("inline builtin calls keep JavaScript semantics for any callee and operand", async () => {
  await runGeneralRealmSuiteCase("intrinsics");
});
