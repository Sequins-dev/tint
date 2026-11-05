import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutable,
  type ExecutableRequest,
} from "../src/darwin/macho/index.ts";
function request(): ExecutableRequest {
  return {
    code: new Uint8Array(16),
    data: new Uint8Array(8),
    entryOffset: 0,
    identifier: "generic-relocation",
    minimumOS: { major: 26, minor: 6, patch: 2 },
    sdk: { major: 26, minor: 6, patch: 0 },
    maxByteLength: 1048576,
    addressFixups: [
      {
        offset: 0,
        byteLength: 8,
        alignment: 8,
        target: { kind: "data", offset: 0 },
      },
    ],
  };
}
test("image serialization resolves addresses and delegates encoding before signing", () => {
  const input = request(),
    before = input.code.slice();
  let calls = 0,
    site = -1,
    target = -1;
  const result = buildExecutable({
    ...input,
    patchAddress: (bytes, index, offset, destination) => {
      assert.equal(index, 0);
      calls++;
      site = offset;
      target = destination;
      bytes[offset] = 42;
      return "complete";
    },
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(calls, 1);
  assert.equal(site, result.value.codeFileOffset);
  assert.equal(target, result.value.dataFileOffset);
  assert.equal(result.value.bytes[site], 42);
  assert.deepEqual(input.code, before);
});
test("nonempty relocations require an explicit patcher and preserve patch failures", () => {
  for (const [status, error] of [
    ["invalid", "INVALID_REFERENCE"],
    ["range", "ADDRESS_OUT_OF_RANGE"],
  ] as const) {
    const input = request();
    const result = buildExecutable({ ...input, patchAddress: () => status });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, error);
    assert.deepEqual(input.code, new Uint8Array(16));
  }
  assert.equal(buildExecutable(request()).ok, false);
  for (const fixup of [
    {
      offset: 0,
      byteLength: 0,
      alignment: 8,
      target: { kind: "data" as const, offset: 0 },
    },
    {
      offset: 0,
      byteLength: 8,
      alignment: 3,
      target: { kind: "data" as const, offset: 0 },
    },
  ]) {
    assert.equal(
      buildExecutable({
        ...request(),
        addressFixups: [fixup],
        patchAddress: () => {
          throw Error("invalid span must not invoke target");
        },
      }).ok,
      false,
    );
  }
});
