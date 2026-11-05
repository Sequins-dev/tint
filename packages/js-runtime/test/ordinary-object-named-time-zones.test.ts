import assert from "node:assert/strict";
import test from "node:test";
import { readTimeZoneIdentifiers } from "@tint/foundation/chrono/time-zone-identifiers";
import { tzifOffsetSecondsAt } from "@tint/foundation/chrono/tzif";
import { createNamedTimeZoneProvider } from "../src/objects/named-time-zones.ts";
function index(text: string) {
  const result = readTimeZoneIdentifiers(text);
  assert.ok(result.ok);
  return result.value;
}
function fixed() {
  const bytes = new Uint8Array(54),
    view = new DataView(bytes.buffer);
  bytes.set([84, 90, 105, 102]);
  view.setUint32(36, 1);
  view.setUint32(40, 4);
  view.setInt32(44, -18000);
  bytes.set([69, 83, 84, 0], 50);
  return bytes;
}

test("named zones share cached transition models without merging language identities", () => {
  const metadata = index(
    "Z America/New_York 0 - X\nL America/New_York US/Eastern\nZ Africa/Abidjan 0 - X\nL Africa/Abidjan Atlantic/Reykjavik",
  );
  const reads: string[] = [];
  const provider = createNamedTimeZoneProvider(metadata, (name) => {
    reads.push(name);
    return fixed();
  });
  const ny = provider.lookup("aMeRiCa/nEw_yOrK"),
    alias = provider.lookup("US/Eastern");
  assert.equal(ny.status, "available");
  assert.equal(alias.status, "available");
  if (ny.status !== "available" || alias.status !== "available") return;
  assert.equal(ny.zone, alias.zone);
  assert.equal(alias.identifier.identifier, "US/Eastern");
  assert.equal(alias.identifier.primaryIdentifier, "America/New_York");
  assert.equal(tzifOffsetSecondsAt(alias.zone, 0), -18000);
  const african = provider.lookup("Africa/Abidjan"),
    icelandic = provider.lookup("Atlantic/Reykjavik");
  assert.equal(african.status, "available");
  assert.equal(icelandic.status, "available");
  if (african.status !== "available" || icelandic.status !== "available")
    return;
  assert.equal(african.zone, icelandic.zone);
  assert.notEqual(
    african.identifier.primaryIdentifier,
    icelandic.identifier.primaryIdentifier,
  );
  assert.deepEqual(reads, ["America/New_York", "Africa/Abidjan"]);
  assert.deepEqual(provider.lookup("../America/New_York"), {
    status: "unknown",
  });
  assert.deepEqual(provider.lookup("Unknown"), { status: "unknown" });
  assert.equal(reads.length, 2);
});

test("missing or corrupt named-zone data remains distinguishable and cached", () => {
  const metadata = index(
    "Z America/New_York 0 - X\nL America/New_York US/Eastern",
  );
  for (const [bytes, error] of [
    [undefined, "MISSING_DATA"],
    [new Uint8Array(4), "INVALID_TZIF"],
  ] as const) {
    let reads = 0;
    const provider = createNamedTimeZoneProvider(metadata, () => {
      reads++;
      return bytes;
    });
    assert.deepEqual(provider.lookup("America/New_York"), {
      status: "unavailable",
      error,
    });
    assert.deepEqual(provider.lookup("US/Eastern"), {
      status: "unavailable",
      error,
    });
    assert.equal(reads, 1);
  }
});
