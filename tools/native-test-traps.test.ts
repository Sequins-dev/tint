import { test } from "node:test";
import assert from "node:assert/strict";
import { handleNativeTestTraps } from "./native-test-traps.ts";
import { buildAArch64Executable } from "./aarch64-executable.ts";

test("native trap wrapper preserves fixture bytes and deduplicates imports", () => {
  const code = new Uint8Array([0xc0, 0x03, 0x5f, 0xd6]);
  const request = {
    code,
    entryOffset: 0,
    identifier: "tint.trap-test",
    minimumOS: { major: 26, minor: 0, patch: 0 },
    sdk: { major: 26, minor: 0, patch: 0 },
    maxByteLength: 1048576,
  };
  const wrapped = handleNativeTestTraps(request);
  assert.deepEqual(wrapped.code.slice(0, code.length), code);
  assert.deepEqual(request.code, code);
  assert.equal(wrapped.entryOffset, code.length);
  assert.deepEqual(wrapped.imports, ["_signal", "__exit"]);
  assert.ok(buildAArch64Executable(wrapped).ok);
  const withImports = handleNativeTestTraps({
    ...request,
    imports: ["_signal"],
  });
  assert.deepEqual(withImports.imports, ["_signal", "__exit"]);
});
