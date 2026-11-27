import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dataViewCreate,
  dataViewGetBigInt64,
  dataViewGetBigUint64,
  dataViewGetFloat16,
  dataViewGetFloat32,
  dataViewGetFloat64,
  dataViewGetInt16,
  dataViewGetInt32,
  dataViewGetInt8,
  dataViewGetUint16,
  dataViewGetUint32,
  dataViewGetUint8,
  dataViewReadWord64,
  dataViewSetBigInt64,
  dataViewSetBigUint64,
  dataViewSetFloat16,
  dataViewSetFloat32,
  dataViewSetFloat64,
  dataViewSetInt16,
  dataViewSetInt32,
  dataViewSetInt8,
  dataViewSetUint16,
  dataViewSetUint32,
  dataViewSetUint8,
  dataViewWriteWord64,
} from "../src/binary/data-view.ts";

test("DataView integer, float, and word64 accessors match host DataView across endianness and edge values", () => {
  const nativeBytes = new Uint8Array(64);
  const hostBuf = new ArrayBuffer(64);
  const hostView = new DataView(hostBuf);
  const view = dataViewCreate(nativeBytes);

  for (const le of [false, true]) {
    dataViewSetInt8(view, 0, -129);
    hostView.setInt8(0, -129);
    assert.equal(dataViewGetInt8(view, 0), hostView.getInt8(0));

    dataViewSetUint8(view, 1, 300);
    hostView.setUint8(1, 300);
    assert.equal(dataViewGetUint8(view, 1), hostView.getUint8(1));

    dataViewSetInt16(view, 2, -12345, le);
    hostView.setInt16(2, -12345, le);
    assert.equal(dataViewGetInt16(view, 2, le), hostView.getInt16(2, le));

    dataViewSetUint16(view, 4, 0xbeef, le);
    hostView.setUint16(4, 0xbeef, le);
    assert.equal(dataViewGetUint16(view, 4, le), hostView.getUint16(4, le));

    dataViewSetInt32(view, 8, -0x12345678, le);
    hostView.setInt32(8, -0x12345678, le);
    assert.equal(dataViewGetInt32(view, 8, le), hostView.getInt32(8, le));

    dataViewSetUint32(view, 12, 0xdeadbeef, le);
    hostView.setUint32(12, 0xdeadbeef, le);
    assert.equal(dataViewGetUint32(view, 12, le), hostView.getUint32(12, le));

    for (const sample of [
      0,
      -0,
      1.5,
      -65504,
      6.103515625e-5,
      5.960464477539063e-8,
      Infinity,
      -Infinity,
      NaN,
    ]) {
      dataViewSetFloat16(view, 16, sample, le);
      hostView.setFloat16(16, sample, le);
      assert.ok(
        Object.is(
          dataViewGetFloat16(view, 16, le),
          hostView.getFloat16(16, le),
        ),
        `Float16 ${sample} le=${le}`,
      );

      dataViewSetFloat32(view, 20, sample, le);
      hostView.setFloat32(20, sample, le);
      assert.ok(
        Object.is(
          dataViewGetFloat32(view, 20, le),
          hostView.getFloat32(20, le),
        ),
        `Float32 ${sample} le=${le}`,
      );

      dataViewSetFloat64(view, 24, sample, le);
      hostView.setFloat64(24, sample, le);
      assert.ok(
        Object.is(
          dataViewGetFloat64(view, 24, le),
          hostView.getFloat64(24, le),
        ),
        `Float64 ${sample} le=${le}`,
      );
    }

    const wordsIn = new Uint32Array([0x89abcdef, 0x01234567]);
    const wordsOut = new Uint32Array(2);
    dataViewWriteWord64(view, 32, wordsIn, le);
    dataViewReadWord64(view, 32, le, wordsOut);
    assert.deepEqual(Array.from(wordsOut), Array.from(wordsIn));

    dataViewSetBigInt64(view, 40, -0x0123456789abcdefn, le);
    hostView.setBigInt64(40, -0x0123456789abcdefn, le);
    assert.equal(
      dataViewGetBigInt64(view, 40, le),
      hostView.getBigInt64(40, le),
    );

    dataViewSetBigUint64(view, 48, 0xfedcba9876543210n, le);
    hostView.setBigUint64(48, 0xfedcba9876543210n, le);
    assert.equal(
      dataViewGetBigUint64(view, 48, le),
      hostView.getBigUint64(48, le),
    );
  }
});

test("DataView offset validation handles NaN, -0, fractional, and out-of-bounds offsets", () => {
  const view = dataViewCreate(new Uint8Array(8));
  dataViewSetUint32(view, -0, 0x11223344, false);
  assert.equal(dataViewGetUint32(view, NaN, false), 0x11223344);
  assert.equal(dataViewGetUint32(view, 0.9, false), 0x11223344);
  for (const bad of [-1, 5, 8, Infinity, -Infinity]) {
    assert.throws(() => dataViewGetUint32(view, bad, true), RangeError);
    assert.throws(() => dataViewSetFloat64(view, bad, 1, true), RangeError);
    assert.throws(
      () => dataViewReadWord64(view, bad, true, new Uint32Array(2)),
      RangeError,
    );
  }
});
