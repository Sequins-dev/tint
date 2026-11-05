import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDebugInfo, type DebugRequest } from "@tint/image/dwarf";
function request(): DebugRequest {
  return {
    codeAddress: 0x100001000,
    codeLength: 32,
    directory: "/project",
    functions: [{ name: "run", offset: 0, byteLength: 16 }],
    lines: [
      { offset: 4, byteLength: 4, file: "main.ts", line: 3, column: 5 },
      { offset: 12, byteLength: 4, file: "main.ts", line: 9, column: 1 },
    ],
    maxByteLength: 10000,
  };
}
test("DWARF v4 emits independent bounded line sequences and function information", () => {
  const result = buildDebugInfo(request());
  assert.ok(result.ok);
  for (const bytes of [result.value.info, result.value.line]) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(v.getUint32(0, true), bytes.length - 4);
    assert.equal(v.getUint16(4, true), 4);
  }
  const data = result.value.line,
    v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 10 + v.getUint32(6, true);
  function leb(signed = false) {
    let value = 0,
      shift = 0,
      byte = 0;
    do {
      byte = data[at++]!;
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return signed && byte & 64 ? value - 2 ** shift : value;
  }
  for (const row of request().lines) {
    assert.equal(data[at++], 0);
    assert.equal(leb(), 9);
    assert.equal(data[at++], 2);
    assert.equal(
      v.getBigUint64(at, true),
      BigInt(request().codeAddress + row.offset),
    );
    at += 8;
    assert.equal(data[at++], 4);
    assert.equal(leb(), 1);
    assert.equal(data[at++], 3);
    assert.equal(leb(true), row.line - 1);
    assert.equal(data[at++], 5);
    assert.equal(leb(), row.column);
    assert.equal(data[at++], 1);
    assert.equal(data[at++], 2);
    assert.equal(leb(), row.byteLength);
    assert.deepEqual([...data.subarray(at, at + 3)], [0, 1, 1]);
    at += 3;
  }
  assert.equal(at, data.length);
  assert.ok(new TextDecoder().decode(result.value.info).includes("run\0"));
  assert.deepEqual(
    buildDebugInfo({
      ...request(),
      maxByteLength:
        result.value.info.length +
        result.value.line.length +
        result.value.abbrev.length,
    }),
    result,
  );
  assert.deepEqual(buildDebugInfo({ ...request(), maxByteLength: 1 }), {
    ok: false,
    error: "SIZE_LIMIT",
  });
});
test("debug ranges reject overlap, invalid positions, and escaping addresses", () => {
  for (const patch of [
    { codeAddress: Number.MAX_SAFE_INTEGER },
    { directory: "bad\0path" },
    { lines: [{ ...request().lines[0]!, line: 0 }] },
    { lines: [{ ...request().lines[0]!, offset: 31 }] },
    { lines: [request().lines[1]!, request().lines[0]!] },
  ])
    assert.deepEqual(buildDebugInfo({ ...request(), ...patch }), {
      ok: false,
      error: "INVALID_INPUT",
    });
});
