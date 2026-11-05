import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import * as timezone from "../src/chrono/tzif/index.ts";
import { fixed, transitions } from "./tzif-fixtures.ts";
test("fixed zones and finite histories distinguish unavailable future data", () => {
  const fixedZone = timezone.createTzifZone(fixed());
  assert.ok(fixedZone.ok);
  if (!fixedZone.ok) return;
  assert.equal(timezone.tzifOffsetSecondsAt(fixedZone.value, 0), 19800);
  const history = timezone.createTzifZone(transitions(0));
  assert.ok(history.ok);
  if (!history.ok) return;
  for (const [second, offset] of [
    [-2, 0],
    [-1, 3600],
    [0, 3600],
    [999, 3600],
    [1000, undefined],
  ] as const)
    assert.equal(timezone.tzifOffsetSecondsAt(history.value, second), offset);
  const huge = timezone.createTzifZone(transitions(50));
  assert.ok(huge.ok);
  if (!huge.ok) return;
  assert.equal(timezone.tzifOffsetSecondsAt(huge.value, 0), 3600);
});
test(
  "New York combines recorded historical offsets with future rule evaluation",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const zone = timezone.createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(zone.ok);
    if (!zone.ok) return;
    for (const [second, offset] of [
      [Date.UTC(1800, 0, 1) / 1000, -17762],
      [1710053999, -18000],
      [1710054000, -14400],
      [Date.UTC(2050, 0, 1) / 1000, -18000],
      [Date.UTC(2050, 6, 1) / 1000, -14400],
    ] as const)
      assert.equal(timezone.tzifOffsetSecondsAt(zone.value, second), offset);
    for (const second of [NaN, Infinity, 0.5])
      assert.equal(timezone.tzifOffsetSecondsAt(zone.value, second), undefined);
  },
);

test(
  "local resolution distinguishes gaps, overlaps and unavailable data",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const read = timezone.createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(read.ok);
    if (!read.ok) return;
    const zone = read.value;
    const cases = [
      {
        local: Date.UTC(2024, 10, 3, 1, 30) / 1000,
        earlier: Date.UTC(2024, 10, 3, 5, 30) / 1000,
        later: Date.UTC(2024, 10, 3, 6, 30) / 1000,
        compatible: "earlier",
      },
      {
        local: Date.UTC(2024, 2, 10, 2, 30) / 1000,
        earlier: Date.UTC(2024, 2, 10, 6, 30) / 1000,
        later: Date.UTC(2024, 2, 10, 7, 30) / 1000,
        compatible: "later",
      },
      {
        local: Date.UTC(2050, 2, 13, 2, 30) / 1000,
        earlier: Date.UTC(2050, 2, 13, 6, 30) / 1000,
        later: Date.UTC(2050, 2, 13, 7, 30) / 1000,
        compatible: "later",
      },
    ];
    for (const item of cases) {
      for (const mode of ["earlier", "later"] as const)
        assert.deepEqual(
          timezone.resolveTzifLocalSeconds(zone, item.local, mode),
          { ok: true, epochSeconds: item[mode] },
        );
      assert.deepEqual(timezone.resolveTzifLocalSeconds(zone, item.local), {
        ok: true,
        epochSeconds: item.compatible === "earlier" ? item.earlier : item.later,
      });
      assert.deepEqual(
        timezone.resolveTzifLocalSeconds(zone, item.local, "reject"),
        { ok: false, error: "ambiguous" },
      );
    }
    const unique = Date.UTC(2024, 5, 1, 12, 30) / 1000;
    assert.deepEqual(timezone.resolveTzifLocalSeconds(zone, unique, "reject"), {
      ok: true,
      epochSeconds: unique + 14400,
    });
    assert.deepEqual(timezone.resolveTzifLocalSeconds(zone, NaN), {
      ok: false,
      error: "invalid",
    });
    const finite = timezone.createTzifZone(transitions(0));
    assert.ok(finite.ok);
    if (!finite.ok) return;
    assert.deepEqual(timezone.resolveTzifLocalSeconds(finite.value, 100000), {
      ok: false,
      error: "unavailable",
    });
  },
);
test(
  "half-hour and skipped-day gaps use actual transition offsets",
  {
    skip:
      !existsSync("/usr/share/zoneinfo/Australia/Lord_Howe") ||
      !existsSync("/usr/share/zoneinfo/Pacific/Apia"),
  },
  () => {
    for (const [name, local, expected] of [
      [
        "Australia/Lord_Howe",
        Date.UTC(2024, 9, 6, 2, 15) / 1000,
        Date.UTC(2024, 9, 5, 15, 45) / 1000,
      ],
      [
        "Pacific/Apia",
        Date.UTC(2011, 11, 30, 12) / 1000,
        Date.UTC(2011, 11, 30, 22) / 1000,
      ],
    ] as const) {
      const zone = timezone.createTzifZone(
        new Uint8Array(readFileSync("/usr/share/zoneinfo/" + name)),
      );
      assert.ok(zone.ok);
      if (!zone.ok) return;
      assert.deepEqual(timezone.resolveTzifLocalSeconds(zone.value, local), {
        ok: true,
        epochSeconds: expected,
      });
    }
  },
);

test("stored-offset policy is explicit for unspecified TZif designations", () => {
  const bytes = fixed();
  bytes.set([45, 48, 48, 0], 50);
  const strict = timezone.createTzifZone(bytes),
    stored = timezone.createTzifZone(bytes, "stored");
  assert.ok(strict.ok);
  assert.ok(stored.ok);
  assert.equal(timezone.tzifOffsetSecondsAt(strict.value, 0), undefined);
  assert.equal(timezone.tzifOffsetSecondsAt(stored.value, 0), 19800);
  assert.deepEqual(stored.value.data.types[0]!.designation, [45, 48, 48]);
});

test("unspecified POSIX footer names retain the selected availability policy", () => {
  const block = fixed(50);
  new DataView(block.buffer).setInt32(44, 0);
  block.set([45, 48, 48, 0], 50);
  const footer = new TextEncoder().encode("\n<-00>0\n"),
    bytes = new Uint8Array(block.length * 2 + footer.length);
  bytes.set(block);
  bytes.set(block, block.length);
  bytes.set(footer, block.length * 2);
  const strict = timezone.createTzifZone(bytes),
    stored = timezone.createTzifZone(bytes, "stored");
  assert.ok(strict.ok);
  assert.ok(stored.ok);
  assert.equal(timezone.tzifOffsetSecondsAt(strict.value, 0), undefined);
  assert.equal(timezone.tzifOffsetSecondsAt(stored.value, 0), 0);
});
test("footer consistency compares encoded offsets independently of unspecified labels", () => {
  const bytes = transitions(50),
    view = new DataView(bytes.buffer);
  view.setBigInt64(98, -1n);
  view.setBigInt64(106, 1000n);
  bytes.set([45, 48, 48], 128);
  const zone = timezone.createTzifZone(bytes);
  assert.ok(zone.ok);
  assert.equal(timezone.tzifOffsetSecondsAt(zone.value, -2), undefined);
  assert.equal(timezone.tzifOffsetSecondsAt(zone.value, 1000), 0);
});
