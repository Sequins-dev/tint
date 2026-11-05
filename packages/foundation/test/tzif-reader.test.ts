import { fixed, transitions } from "./tzif-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { readTzif } from "../src/chrono/tzif/index.ts";

test("version-one fixed offsets preserve designations and empty transition tables", () => {
  const read = readTzif(fixed());
  assert.ok(read.ok);
  if (!read.ok) return;
  assert.equal(read.value.version, 1);
  assert.equal(read.value.transitions.length, 0);
  assert.deepEqual(read.value.types, [
    {
      offsetSeconds: 19800,
      daylightSaving: false,
      designation: [73, 83, 84],
      standard: false,
      universal: false,
    },
  ]);
  assert.equal(read.value.footer, undefined);
});
test(
  "system TZif files preserve signed historical transitions and future rules",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const read = readTzif(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(read.ok);
    if (!read.ok) return;
    assert.ok(read.value.version >= 2);
    assert.ok(read.value.transitions.length > 100);
    assert.ok(read.value.types.some((t) => t.offsetSeconds === -18000));
    assert.ok(read.value.types.some((t) => t.offsetSeconds === -14400));
    assert.match(read.value.footer ?? "", /EST5EDT/);
  },
);
test("truncation, invalid indices and invalid type records are rejected", () => {
  const bytes = fixed();
  for (let length = 0; length < bytes.length; length++)
    assert.equal(
      readTzif(bytes.slice(0, length)).ok,
      false,
      `length ${length}`,
    );
  for (const [offset, value] of [
    [0, 0],
    [4, 49],
    [48, 2],
    [49, 4],
    [53, 65],
  ] as const) {
    const bad = bytes.slice();
    bad[offset] = value;
    assert.equal(readTzif(bad).ok, false, `${offset}:${value}`);
  }
});

test("signed transitions keep all 64 bits and reject unordered or invalid type indices", () => {
  const v1 = readTzif(transitions(0));
  assert.ok(v1.ok);
  if (!v1.ok) return;
  assert.deepEqual(v1.value.transitions[0], {
    at: { hi: 4294967295, lo: 4294967295 },
    type: 1,
  });
  for (const version of [50, 51, 52]) {
    const bytes = transitions(version),
      read = readTzif(bytes);
    assert.ok(read.ok);
    if (!read.ok) return;
    assert.deepEqual(
      read.value.transitions.map((t) => t.at),
      [
        { hi: 2147483648, lo: 0 },
        { hi: 2147483647, lo: 4294967295 },
      ],
    );
    assert.equal(read.value.footer, "UTC0");
    const bad = bytes.slice();
    bad[54 + 44 + 16] = 2;
    assert.equal(readTzif(bad).ok, false);
  }
  const reversed = transitions(0);
  new DataView(reversed.buffer).setInt32(48, -2);
  assert.equal(readTzif(reversed).ok, false);
});

test("indicator consistency, missing footers and leap-aware timestamps stay explicit", () => {
  const bytes = fixed(),
    withIndicators = new Uint8Array(bytes.length + 2);
  withIndicators.set(bytes);
  const view = new DataView(withIndicators.buffer);
  view.setUint32(20, 1);
  view.setUint32(24, 1);
  withIndicators[54] = 1;
  withIndicators[55] = 1;
  const valid = readTzif(withIndicators);
  assert.ok(valid.ok);
  if (!valid.ok) return;
  assert.equal(valid.value.types[0]?.standard, true);
  assert.equal(valid.value.types[0]?.universal, true);
  withIndicators[54] = 0;
  assert.equal(readTzif(withIndicators).ok, false);
  const leap = new Uint8Array(bytes.length + 8);
  leap.set(bytes);
  new DataView(leap.buffer).setUint32(28, 1);
  assert.deepEqual(readTzif(leap), {
    ok: false,
    error: "LEAP_SECONDS_UNSUPPORTED",
  });
  const version2 = transitions(50);
  for (const size of [
    version2.length - 1,
    version2.length - 2,
    version2.length - 6,
  ])
    assert.equal(readTzif(version2.slice(0, size)).ok, false);
  const nul = version2.slice();
  nul[nul.length - 2] = 0;
  assert.equal(readTzif(nul).ok, false);
});
