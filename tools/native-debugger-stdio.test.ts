import assert from "node:assert/strict";
import test from "node:test";
import { selectNativeDebuggerLaunch } from "./test262-native-process.ts";
test("the original LLDB stdio launch path is an explicit recorded execution mode", () => {
  assert.equal(
    selectNativeDebuggerLaunch("darwin", "lldb-local-stdio"),
    "lldb-local-stdio",
  );
  assert.equal(
    selectNativeDebuggerLaunch("linux", "lldb-local-stdio"),
    "lldb-local-stdio",
  );
  assert.throws(() => selectNativeDebuggerLaunch("darwin", "stdio-retry"));
});
