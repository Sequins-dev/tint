import { format } from "prettier";
import type { CldrElement, CldrPathStep } from "./cldr-xml.ts";
import { epochDayFromGregorian } from "../packages/foundation/src/chrono/gregorian-calendar/index.ts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  parseCldrElements,
  cldrPath,
  createCldrLocaleResolver,
  attributes,
} from "./cldr-xml.ts";
import { numberFormatLocaleRows } from "../packages/js-runtime/src/objects/number-format-data.ts";
const archive = process.argv[2];
if (archive === undefined)
  throw Error("usage: node tools/generate-date-time-zone-data.ts CLDR49.zip");
const archiveSha256 =
  "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
if (hash(readFileSync(archive)) !== archiveSha256)
  throw Error("archive checksum");
const inputs: { path: string; sha256: string }[] = [];
function member(path: string): string {
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive!, path], {
    maxBuffer: 16000000,
  });
  inputs.push({ path, sha256: hash(bytes) });
  return new TextDecoder("utf8", { fatal: true }).decode(bytes);
}
const parentMap = new Map<string, string>();
for (const block of member("common/supplemental/supplementalData.xml").matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const m of block[2]!.matchAll(/<parentLocale\b([^>]+)\/>/g)) {
    const a = attributes(m[1]!);
    for (const locale of a.get("locales")!.trim().split(/\s+/))
      parentMap.set(
        locale.replaceAll("_", "-").toLowerCase(),
        a.get("parent")!.replaceAll("_", "-").toLowerCase(),
      );
  }
}
const parent = (locale: string): string | undefined =>
  parentMap.get(locale) ??
  (locale.includes("-")
    ? locale.slice(0, locale.lastIndexOf("-"))
    : locale === "root"
      ? undefined
      : "root");
const paths = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
    encoding: "utf8",
    maxBuffer: 4000000,
  })
    .split("\n")
    .filter((path) => /^common\/main\/[^/]+\.xml$/.test(path))
    .sort(),
  trees = new Map<string, CldrElement>();
let loaded = 0;
for (const path of paths) {
  const text = member(path),
    dates =
      (/<dates>([\s\S]*?)<\/dates>/.exec(text)?.[0] ?? "") +
      (/<localeDisplayNames>([\s\S]*?)<\/localeDisplayNames>/.exec(text)?.[0] ??
        "");
  const tree = parseCldrElements("<ldml>" + dates + "</ldml>");
  trees.set(path.slice(12, -4).replaceAll("_", "-").toLowerCase(), tree);
  if (++loaded % 50 === 0)
    console.error(new Date().toISOString(), "loaded locale trees", loaded);
}

const resolver = createCldrLocaleResolver(trees, parent),
  zones = new Set<string>(),
  metazones = new Set<string>(),
  countries = new Set<string>();
function names(node: CldrElement): void {
  if (node.name === "zone") zones.add(node.attributes.get("type")!);
  if (node.name === "metazone") metazones.add(node.attributes.get("type")!);
  for (const child of node.children) names(child);
}
for (const tree of trees.values()) names(tree);
const metaXML = member("common/supplemental/metaZones.xml");
type Period = readonly [string, string, string];
const mappings: [string, Period[]][] = [];
for (const block of metaXML.matchAll(
  /<timezone\b([^>]+)>([\s\S]*?)<\/timezone>/g,
)) {
  const zone = attributes(block[1]!).get("type"),
    periods: Period[] = [];
  zones.add(zone!);
  for (const row of block[2]!.matchAll(/<usesMetazone\b([^>]+)\/>/g)) {
    const a = attributes(row[1]!);
    metazones.add(a.get("mzone")!);
    periods.push([a.get("mzone")!, a.get("from") ?? "", a.get("to") ?? ""]);
  }
  mappings.push([zone!, periods]);
}
const references: [string, string, string][] = [];
for (const row of metaXML.matchAll(/<mapZone\b([^>]+)\/>/g)) {
  const a = attributes(row[1]!);
  const region = a.get("territory");
  if (region !== "001" && region !== "ZZ") countries.add(region!);
  references.push([a.get("other")!, region!, a.get("type")!]);
}
const territoryRows: [string, string][] = [];
for (const path of ["common/supplemental/windowsZones.xml"])
  for (const row of member(path).matchAll(/<mapZone\b([^>]+)\/>/g)) {
    const a = attributes(row[1]!),
      region = a.get("territory");
    if (region === "001" || region === "ZZ") continue;
    countries.add(region!);
    for (const zone of a.get("type")!.trim().split(/\s+/)) {
      zones.add(zone!);
      territoryRows.push([zone, region!]);
    }
  }
for (const [, region, list] of references)
  if (region !== "001" && region !== "ZZ")
    for (const zone of list.trim().split(/\s+/))
      territoryRows.push([zone, region!]);
const primary: [string, string][] = [];
for (const row of metaXML.matchAll(
  /<primaryZone\b([^>]+)>([^<]+)<\/primaryZone>/g,
))
  primary.push([attributes(row[1]!).get("iso3166")!, row[2]!]);
const aliases: [string, string, string][] = [];
const zoneHomes = new Map<string, string>();
for (const row of member("common/bcp47/timezone.xml").matchAll(
  /<type\b([^>]+)\/>/g,
)) {
  const a = attributes(row[1]!),
    names = a.get("alias")?.trim().split(/\s+/);
  if (names === undefined) continue;
  const region = a.get("region") ?? a.get("name")!.slice(0, 2).toUpperCase();
  if (countries.has(region) && !names[0]!.startsWith("Etc/"))
    zoneHomes.set(names[0]!, region);
  for (const name of names)
    aliases.push([name, names[0]!, a.get("iana") ?? names[0]!]);
}
type DayPeriodRule = readonly [string, string, string, string];
const dayPeriods: [string, DayPeriodRule[]][] = [];
for (const block of member("common/supplemental/dayPeriods.xml").matchAll(
  /<dayPeriodRuleSet([^>]*)>([\s\S]*?)<\/dayPeriodRuleSet>/g,
)) {
  if (attributes(block[1]!).has("type")) continue;
  for (const group of block[2]!.matchAll(
    /<dayPeriodRules\b([^>]+)>([\s\S]*?)<\/dayPeriodRules>/g,
  )) {
    const a = attributes(group[1]!),
      rules: DayPeriodRule[] = [];
    for (const row of group[2]!.matchAll(/<dayPeriodRule\b([^>]+)\/>/g)) {
      const rule = attributes(row[1]!);
      rules.push([
        rule.get("type")!,
        rule.get("at") ?? "",
        rule.get("from") ?? "",
        rule.get("before") ?? "",
      ]);
    }
    for (const locale of a.get("locales")!.trim().split(/\s+/))
      dayPeriods.push([locale.replaceAll("_", "-").toLowerCase(), rules]);
  }
}
type Pool = "strings" | "fields" | "profiles";
const pools: Record<Pool, string[]> = { strings: [], fields: [], profiles: [] },
  ids: Record<Pool, Map<string, string>> = {
    strings: new Map(),
    fields: new Map(),
    profiles: new Map(),
  },
  bindings: [string, string][] = [];
function intern(group: Pool, value: string): string {
  let id = ids[group].get(value);
  if (id !== undefined) return id;
  id = String(pools[group].length);
  ids[group].set(value, id);
  pools[group].push(value);
  return id;
}
function field(entries: ReadonlyMap<string, string>): string {
  return intern(
    "fields",
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => k + ":" + intern("strings", v))
      .join(","),
  );
}
const localeKeys = numberFormatLocaleRows
    .split("\n")
    .map((row) => row.slice(0, row.indexOf("|"))),
  pathCache = new Map<string, CldrPathStep[]>();
function path(text: string): CldrPathStep[] {
  let parsed = pathCache.get(text);
  if (parsed === undefined) {
    parsed = cldrPath(text);
    pathCache.set(text, parsed);
  }
  return parsed;
}
const canonical = new Map<string, string>();
for (const [alias, preferred] of aliases) {
  const key = alias.toLowerCase(),
    previous = canonical.get(key);
  if (previous !== undefined && previous !== preferred)
    throw Error("Conflicting zone alias");
  canonical.set(key, preferred);
}
const canonicalName = (zone: string) =>
  canonical.get(zone.toLowerCase()) ?? zone;
function utcSecond(text: string): string {
  if (text === "") return "";
  const m =
    /^(-?[0-9]+)-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(
      text,
    );
  if (m === null) throw Error("Invalid metazone boundary: " + text);
  const day = epochDayFromGregorian(Number(m[1]), Number(m[2]), Number(m[3]));
  if (day === undefined) throw Error("Invalid metazone date");
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)
    throw Error("Invalid metazone time: " + text);
  return String(
    day * 86400 + Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0),
  );
}
const histories = mappings.map(
  ([zone, periods]) =>
    [
      canonicalName(zone),
      periods
        .map(
          ([name, from, to]) =>
            name + "," + utcSecond(from) + "," + utcSecond(to),
        )
        .join(";"),
    ] as const,
);
const refs = references.map(
  ([name, country, zone]) =>
    [name + "." + country, canonicalName(zone)] as const,
);
const territories = new Map<string, string>();
for (const [zone, country] of territoryRows) {
  const key = canonicalName(zone),
    existing = territories.get(key);
  // A metazone reference can serve more than one territory (e.g. Belgrade
  // serves RS and XK). The BCP47 zone's home territory determines location
  // names; reference-zone membership does not move the city to another country.
  const home = zoneHomes.get(key);
  if (home !== undefined && home !== country) continue;
  if (existing !== undefined && existing !== country)
    throw Error("Conflicting zone territory " + key);
  territories.set(key, country);
}
const primaryByCountry = new Map(
  primary.map(([country, zone]) => [country, canonicalName(zone)]),
);
for (const country of countries) {
  if (primaryByCountry.has(country)) continue;
  const names = [...territories]
    .filter(([, region]) => region === country)
    .map(([zone]) => zone);
  if (names.length === 1) primaryByCountry.set(country, names[0]!);
}
function minute(text: string): string {
  if (text === "") return "";
  if (!/^(?:[01][0-9]|2[0-4]):[0-5][0-9]$/.test(text))
    throw Error("Invalid day-period time");
  return String(Number(text.slice(0, 2)) * 60 + Number(text.slice(3)));
}
const ruleMap = new Map(dayPeriods),
  resolvedRules: [string, string][] = [];
for (const locale of localeKeys) {
  const seen = new Set<string>();
  let key: string | undefined = locale,
    rules: DayPeriodRule[] | undefined;
  while (key !== undefined) {
    if (seen.has(key)) throw Error("Day-period locale cycle");
    seen.add(key);
    rules = ruleMap.get(key);
    if (rules !== undefined) break;
    key = parent(key);
  }
  if (rules === undefined) throw Error("Missing day-period rules " + locale);
  resolvedRules.push([
    locale,
    rules
      .map(([name, at, from, before]) =>
        [name, minute(at), minute(from), minute(before)].join(","),
      )
      .join(";"),
  ]);
}
let resolved = 0;
for (const locale of localeKeys) {
  const groups = new Map<string, Map<string, string>>();
  function add(
    group: string,
    key: string,
    suffix: string,
    required = false,
  ): void {
    const value = resolver.value(locale, path(suffix));
    if (value === undefined || value === "") {
      if (required) throw Error("Missing " + locale + "/" + suffix);
      return;
    }
    if (!groups.has(group)) groups.set(group, new Map());
    groups.get(group)!.set(key, value);
  }
  for (const name of [
    "hourFormat",
    "gmtFormat",
    "regionFormat",
    "fallbackFormat",
  ])
    add("formats", name, "dates/timeZoneNames/" + name, true);
  add("formats", "gmtZeroFormat", "dates/timeZoneNames/gmtZeroFormat");
  for (const type of ["standard", "daylight"])
    add(
      "formats",
      "regionFormat." + type,
      `dates/timeZoneNames/regionFormat[@type='${type}']`,
      true,
    );
  for (const zone of [...zones].sort()) {
    add(
      "zones",
      zone + ".city",
      `dates/timeZoneNames/zone[@type='${zone}']/exemplarCity`,
    );
    for (const width of ["long", "short"])
      for (const kind of ["generic", "standard", "daylight"])
        add(
          "zones",
          zone + "." + width + "." + kind,
          `dates/timeZoneNames/zone[@type='${zone}']/${width}/${kind}`,
        );
  }
  for (const zone of [...metazones].sort())
    for (const width of ["long", "short"])
      for (const kind of ["generic", "standard", "daylight"])
        add(
          "metazones",
          zone + "." + width + "." + kind,
          `dates/timeZoneNames/metazone[@type='${zone}']/${width}/${kind}`,
        );
  for (const country of [...countries].sort()) {
    add(
      "countries",
      country,
      `localeDisplayNames/territories/territory[@type='${country}']`,
    );
    add(
      "countries",
      country + ".short",
      `localeDisplayNames/territories/territory[@type='${country}'][@alt='short']`,
    );
  }
  const profile = ["formats", "zones", "metazones", "countries"]
    .map((group) => field(groups.get(group) ?? new Map()))
    .join(",");
  bindings.push([locale, intern("profiles", profile)]);
  resolver.clear();
  console.error(
    new Date().toISOString(),
    "resolved zone locale",
    locale,
    ++resolved,
    "heapMiB",
    Math.round(process.memoryUsage().heapUsed / 1048576),
  );
  await new Promise((resolve) => setImmediate(resolve));
}

function table(entries: readonly (readonly [string, string])[]): string {
  const values = new Map<string, string>();
  for (const [key, value] of entries) {
    if (/[\r\n]/.test(key + value) || key.includes("|"))
      throw Error("Packed date-time delimiter");
    const previous = values.get(key);
    if (previous !== undefined && previous !== value)
      throw Error("Conflicting date-time record " + key);
    values.set(key, value);
  }
  return [...values]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => key + "|" + value)
    .join("\n");
}
let output =
  "// Generated by tools/generate-date-time-zone-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n// Archive SHA256: " +
  archiveSha256 +
  "\n";
for (const [name, entries] of [
  ["dateTimeZoneLocales", bindings],
  [
    "dateTimeZoneProfiles",
    pools.profiles.map((value, index) => [String(index), value] as const),
  ],
  [
    "dateTimeZoneFields",
    pools.fields.map((value, index) => [String(index), value] as const),
  ],
  [
    "dateTimeZoneStrings",
    pools.strings.map((value, index) => [String(index), value] as const),
  ],
  ["dateTimeZoneAliases", [...canonical]],
  ["dateTimeZoneHistories", histories],
  ["dateTimeZoneReferences", refs],
  ["dateTimeZoneTerritories", [...territories]],
  ["dateTimeZonePrimaryZones", [...primaryByCountry]],
  ["dateTimeDayPeriodRules", resolvedRules],
] as const)
  output +=
    "export const " + name + " = " + JSON.stringify(table(entries)) + ";\n";
output = await format(output, { parser: "typescript" });
const outputPath =
  "packages/js-runtime/src/objects/date-time-zone-format-data.ts";
writeFileSync(outputPath, output);
writeFileSync(
  "packages/js-runtime/date-time-zone-data-manifest.json",
  await format(
    JSON.stringify({
      kind: "cldr-date-time-zone-data",
      archiveSha256,
      cldrVersion: "49",
      inputs,
      locales: localeKeys.length,
      zones: zones.size,
      metazones: metazones.size,
      territories: countries.size,
      profiles: pools.profiles.length,
      fields: pools.fields.length,
      strings: pools.strings.length,
      output: {
        path: outputPath,
        sha256: hash(new TextEncoder().encode(output)),
      },
      policy:
        "General locale inheritance; zone aliases retain CLDR naming identities separately from public IANA primary identifiers; half-open UTC metazone histories; formatting day-period rules; optional zero-offset forms and territory display names retain specified fallback behavior; no host Intl.",
    }),
    { parser: "json" },
  ),
);
console.log(
  JSON.stringify({
    locales: localeKeys.length,
    zones: zones.size,
    metazones: metazones.size,
    territories: countries.size,
    strings: pools.strings.length,
    fields: pools.fields.length,
    profiles: pools.profiles.length,
  }),
);
