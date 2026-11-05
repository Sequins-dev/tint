import assert from "node:assert/strict";
import test from "node:test";
import {
  readTimeZoneIdentifiers,
  lookupTimeZoneIdentifier,
} from "../src/chrono/time-zone-identifiers/index.ts";

test("zic indices preserve spelling while resolving case-insensitive link chains", () => {
  const result = readTimeZoneIdentifiers(
    "# version 2026c\nZ America/New_York -4:56:02 - LMT\nZone Etc/UTC 0 - UTC\nL America/New_York US/Eastern\nLink US/Eastern Alias/Eastern # chain\nL Etc/UTC UTC\nR rule 2000 max - Mar lastSun 2 1 D\n  -5 US E%sT\n",
  );
  assert.ok(result.ok);
  assert.equal(result.value.entries.length, 5);
  assert.deepEqual(lookupTimeZoneIdentifier(result.value, "aMeRiCa/nEw_yOrK"), {
    identifier: "America/New_York",
    targetIdentifier: "America/New_York",
  });
  assert.deepEqual(lookupTimeZoneIdentifier(result.value, "ALIAS/EASTERN"), {
    identifier: "Alias/Eastern",
    targetIdentifier: "America/New_York",
  });
  assert.deepEqual(lookupTimeZoneIdentifier(result.value, "utc"), {
    identifier: "UTC",
    targetIdentifier: "Etc/UTC",
  });
  assert.equal(
    lookupTimeZoneIdentifier(result.value, "America/Unknown"),
    undefined,
  );
  for (const name of [
    "../Etc/UTC",
    "America//New_York",
    "America/./New_York",
    "Аmerica/New_York",
    "America/New_York\0",
    " America/New_York",
  ])
    assert.equal(lookupTimeZoneIdentifier(result.value, name), undefined, name);
});

test("indices reject duplicate names, dangling links, cycles and unsafe paths", () => {
  for (const text of [
    "Z A 0 - X\nZ a 0 - X",
    "L Missing Alias",
    "L B A\nL A B",
    "Z A 0 - X\nL A A",
    "Z ../A 0 - X",
    "L A ../B",
    "Z",
    "L A",
    "L A B extra",
  ]) {
    const result = readTimeZoneIdentifiers(text);
    assert.equal(result.ok, false, text);
  }
});

test("empty and CRLF indices use the same deterministic identifier ordering", () => {
  const empty = readTimeZoneIdentifiers("# no zones\n");
  assert.ok(empty.ok);
  assert.deepEqual(empty.value.entries, []);
  const result = readTimeZoneIdentifiers(
    "Z Zoo/One 0 - X\r\nZ Alpha/One 0 - X\r\nL Zoo/One alias\r\n",
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.entries.map((e) => e.identifier),
    ["Alpha/One", "Zoo/One", "alias"],
  );
});

test("index errors identify the declaration responsible for invalid graph structure", () => {
  for (const [input, error, line] of [
    ["# header\nZ A 0 - X\nZ a 0 - X", "DUPLICATE_IDENTIFIER", 3],
    ["# header\nL Missing Alias", "MISSING_TARGET", 2],
    ["L B A\nL A B", "LINK_CYCLE", 1],
    ["Z A 0 - X\nL A ../Alias", "INVALID_RECORD", 2],
  ] as const) {
    assert.deepEqual(readTimeZoneIdentifiers(input), {
      ok: false,
      error,
      line,
    });
  }
});
