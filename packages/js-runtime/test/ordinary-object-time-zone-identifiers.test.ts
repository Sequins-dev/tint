import assert from "node:assert/strict";
import test from "node:test";
import { readTimeZoneIdentifiers } from "@tint/foundation/chrono/time-zone-identifiers";
import { resolveNamedTimeZoneIdentifier } from "../src/objects/time-zone-identifiers.ts";

test("language identifiers preserve aliases and country-primary exceptions", () => {
  const index = readTimeZoneIdentifiers(
    "Z Africa/Abidjan 0 - GMT\nL Africa/Abidjan Atlantic/Reykjavik\nZ Europe/Prague 0 - GMT\nL Europe/Prague Europe/Bratislava\nZ America/New_York 0 - GMT\nL America/New_York US/Eastern\nZ Etc/UTC 0 - UTC\nL Etc/UTC UTC\nZ Europe/Kyiv 0 - GMT\nL Europe/Kyiv Europe/Kiev",
  );
  assert.ok(index.ok);
  assert.deepEqual(resolveNamedTimeZoneIdentifier(index.value, "uS/eAsTeRn"), {
    identifier: "US/Eastern",
    primaryIdentifier: "America/New_York",
    dataIdentifier: "America/New_York",
  });
  assert.equal(
    resolveNamedTimeZoneIdentifier(index.value, "Atlantic/Reykjavik")
      ?.primaryIdentifier,
    "Atlantic/Reykjavik",
  );
  assert.equal(
    resolveNamedTimeZoneIdentifier(index.value, "Europe/Bratislava")
      ?.primaryIdentifier,
    "Europe/Bratislava",
  );
  assert.equal(
    resolveNamedTimeZoneIdentifier(index.value, "europe/kiev")
      ?.primaryIdentifier,
    "Europe/Kyiv",
  );
  assert.equal(
    resolveNamedTimeZoneIdentifier(index.value, "Etc/UTC")?.primaryIdentifier,
    "UTC",
  );
  assert.equal(
    resolveNamedTimeZoneIdentifier(index.value, "Not/AZone"),
    undefined,
  );
});

test("new zones can remain primary while unmapped links retain explicit missing policy", () => {
  const index = readTimeZoneIdentifiers(
    "Z New/Zone 0 - GMT\nL New/Zone New/Alias\nZ Europe/Kiev 0 - GMT",
  );
  assert.ok(index.ok);
  assert.deepEqual(resolveNamedTimeZoneIdentifier(index.value, "new/zone"), {
    identifier: "New/Zone",
    primaryIdentifier: "New/Zone",
    dataIdentifier: "New/Zone",
  });
  assert.deepEqual(resolveNamedTimeZoneIdentifier(index.value, "New/Alias"), {
    identifier: "New/Alias",
    primaryIdentifier: undefined,
    dataIdentifier: "New/Zone",
  });
  assert.equal(
    resolveNamedTimeZoneIdentifier(index.value, "Europe/Kiev")
      ?.primaryIdentifier,
    undefined,
    "do not invent an unavailable replacement identifier for an older database",
  );
});

test("primary enumeration is sorted, deduplicated and preserves country exceptions", async () => {
  const { primaryTimeZoneIdentifiers } =
    await import("../src/objects/time-zone-identifiers.ts");
  const index = readTimeZoneIdentifiers(
    "Z Africa/Abidjan 0 - GMT\nL Africa/Abidjan Atlantic/Reykjavik\nZ America/New_York 0 - GMT\nL America/New_York US/Eastern\nZ Etc/UTC 0 - UTC\nL Etc/UTC UTC\nZ New/Zone 0 - GMT\nL New/Zone New/Alias",
  );
  assert.ok(index.ok);
  assert.deepEqual(primaryTimeZoneIdentifiers(index.value), [
    "Africa/Abidjan",
    "America/New_York",
    "Atlantic/Reykjavik",
    "New/Zone",
    "UTC",
  ]);
});
