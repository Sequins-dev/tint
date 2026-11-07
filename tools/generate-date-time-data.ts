import { format } from "prettier";
import type { CldrElement, CldrPathStep } from "./cldr-xml.ts";
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
import {
  parseDateTimePattern,
  dateTimePatternFields,
} from "../packages/js-runtime/src/objects/date-time-pattern.ts";
const archive = process.argv[2];
if (archive === undefined)
  throw Error("usage: node tools/generate-date-time-data.ts CLDR49.zip");
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
  trees = new Map<string, CldrElement>(),
  skeletons = new Set<string>(),
  intervals = new Set<string>(),
  differences = new Set<string>(),
  appendRequests = new Set<string>();
let loaded = 0;
function walk(node: CldrElement): void {
  if (node.name === "dateFormatItem" && !node.attributes.has("alt"))
    skeletons.add(node.attributes.get("id")!);
  if (node.name === "intervalFormatItem")
    intervals.add(node.attributes.get("id")!);
  if (node.name === "greatestDifference")
    differences.add(node.attributes.get("id")!);
  if (node.name === "appendItem")
    appendRequests.add(node.attributes.get("request")!);
  for (const child of node.children) walk(child);
}
for (const path of paths) {
  const text = member(path),
    dates = /<dates>([\s\S]*?)<\/dates>/.exec(text)?.[0] ?? "";
  const tree = parseCldrElements("<ldml>" + dates + "</ldml>");
  trees.set(path.slice(12, -4).replaceAll("_", "-").toLowerCase(), tree);
  walk(tree);
  if (++loaded % 50 === 0)
    console.error(new Date().toISOString(), "loaded locale trees", loaded);
}
const supportedSkeleton = (id: string) => {
  const tokens = parseDateTimePattern(id);
  return tokens !== undefined && dateTimePatternFields(tokens) !== undefined;
};
const skeletonList = [...skeletons].filter(supportedSkeleton).sort(),
  intervalList = [...intervals].filter(supportedSkeleton).sort(),
  differenceList = [...differences].sort();
console.error(
  "source inventory",
  trees.size,
  skeletonList.length,
  intervalList.length,
  differenceList,
);
const resolver = createCldrLocaleResolver(trees, parent),
  pathCache = new Map<string, CldrPathStep[]>();
function path(text: string): CldrPathStep[] {
  let parsed = pathCache.get(text);
  if (parsed === undefined) {
    parsed = cldrPath(text);
    pathCache.set(text, parsed);
  }
  return parsed;
}
function get(locale: string, base: string, suffix: string): string | undefined {
  return resolver.value(locale, path(base + "/" + suffix));
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
const calendars: readonly (readonly [
  string,
  string,
  number,
  readonly number[],
])[] = [
  ["gregory", "gregorian", 12, [0, 1]],
  ["iso8601", "gregorian", 12, [0, 1]],
  ["buddhist", "buddhist", 12, [0]],
  ["japanese", "japanese", 12, [232, 233, 234, 235, 236]],
  ["roc", "roc", 12, [0, 1]],
  ["coptic", "coptic", 13, [1]],
  ["ethiopic", "ethiopic", 13, [0, 1]],
  ["ethioaa", "ethiopic-amete-alem", 13, [0, 1]],
  ["indian", "indian", 12, [0]],
  ["persian", "persian", 12, [0]],
  ["islamic-civil", "islamic-civil", 12, [0, 1]],
  ["islamic-tbla", "islamic-tbla", 12, [0, 1]],
  ["islamic-umalqura", "islamic-umalqura", 12, [0, 1]],
  ["hebrew", "hebrew", 13, [0]],
  ["chinese", "chinese", 12, []],
  ["dangi", "dangi", 12, []],
];
const localeKeys = numberFormatLocaleRows
  .split("\n")
  .map((row) => row.slice(0, row.indexOf("|")));
let total = 0;
const started = Date.now();
for (const locale of localeKeys) {
  for (const [calendar, raw, maxMonth, eras] of calendars) {
    const base = "dates/calendars/calendar[@type='" + raw + "']",
      groups = new Map<string, Map<string, string>>();
    const add = (
      group: string,
      key: string,
      suffix: string,
      required = false,
    ): void => {
      const value = get(locale, base, suffix);
      if (value === undefined || value === "") {
        if (required)
          throw Error("MISSING " + locale + "/" + calendar + "/" + suffix);
        return;
      }
      if (!groups.has(group)) groups.set(group, new Map());
      groups.get(group)!.set(key, value);
    };
    for (const style of ["full", "long", "medium", "short"]) {
      add(
        "styles",
        "D." + style,
        `dateFormats/dateFormatLength[@type='${style}']/dateFormat/pattern`,
        true,
      );
      add(
        "styles",
        "T." + style,
        `timeFormats/timeFormatLength[@type='${style}']/timeFormat/pattern`,
        true,
      );
      add(
        "styles",
        "C." + style,
        `dateTimeFormats/dateTimeFormatLength[@type='${style}']/dateTimeFormat/pattern`,
        true,
      );
      add(
        "styles",
        "A." + style,
        `dateTimeFormats/dateTimeFormatLength[@type='${style}']/dateTimeFormat[@type='atTime']/pattern`,
      );
    }
    for (const id of skeletonList) {
      add(
        "patterns",
        id,
        `dateTimeFormats/availableFormats/dateFormatItem[@id='${id}']`,
      );
      add(
        "patterns",
        id + ".ascii",
        `dateTimeFormats/availableFormats/dateFormatItem[@id='${id}'][@alt='ascii']`,
      );
    }
    add(
      "intervals",
      "fallback",
      "dateTimeFormats/intervalFormats/intervalFormatFallback",
      true,
    );
    for (const id of intervalList)
      for (const difference of differenceList)
        add(
          "intervals",
          id + "." + difference,
          `dateTimeFormats/intervalFormats/intervalFormatItem[@id='${id}']/greatestDifference[@id='${difference}']`,
        );
    for (const context of ["format", "stand-alone"])
      for (const width of ["wide", "abbreviated", "narrow"]) {
        for (let month = 1; month <= maxMonth; month++)
          add(
            "months",
            context + "." + width + "." + month,
            `months/monthContext[@type='${context}']/monthWidth[@type='${width}']/month[@type='${month}']`,
            true,
          );
        if (calendar === "hebrew")
          add(
            "months",
            context + "." + width + ".7leap",
            `months/monthContext[@type='${context}']/monthWidth[@type='${width}']/month[@type='7'][@yeartype='leap']`,
          );
        for (const day of ["sun", "mon", "tue", "wed", "thu", "fri", "sat"])
          add(
            "days",
            context + "." + width + "." + day,
            `days/dayContext[@type='${context}']/dayWidth[@type='${width}']/day[@type='${day}']`,
            true,
          );
        for (const period of [
          "am",
          "pm",
          "midnight",
          "noon",
          "morning1",
          "morning2",
          "afternoon1",
          "afternoon2",
          "evening1",
          "evening2",
          "night1",
          "night2",
        ])
          add(
            "dayPeriods",
            context + "." + width + "." + period,
            `dayPeriods/dayPeriodContext[@type='${context}']/dayPeriodWidth[@type='${width}']/dayPeriod[@type='${period}']`,
          );
        add(
          "leapMonths",
          context + "." + width,
          `monthPatterns/monthPatternContext[@type='${context}']/monthPatternWidth[@type='${width}']/monthPattern[@type='leap']`,
        );
      }
    for (const context of ["format", "stand-alone"])
      for (const day of ["sun", "mon", "tue", "wed", "thu", "fri", "sat"])
        add(
          "days",
          context + ".short." + day,
          `days/dayContext[@type='${context}']/dayWidth[@type='short']/day[@type='${day}']`,
          true,
        );
    add(
      "leapMonths",
      "numeric",
      'monthPatterns/monthPatternContext[@type="numeric"]/monthPatternWidth[@type="all"]/monthPattern[@type="leap"]',
    );
    for (const [width, node] of [
      ["wide", "eraNames"],
      ["abbreviated", "eraAbbr"],
      ["narrow", "eraNarrow"],
    ] as const)
      for (const era of eras)
        add(
          "eras",
          width + "." + era,
          `eras/${node}/era[@type='${era}']`,
          true,
        );
    if (calendar === "chinese" || calendar === "dangi")
      for (const width of ["wide", "abbreviated", "narrow"])
        for (let year = 1; year <= 60; year++)
          add(
            "cyclicYears",
            width + "." + year,
            `cyclicNameSets/cyclicNameSet[@type='years']/cyclicNameContext[@type='format']/cyclicNameWidth[@type='${width}']/cyclicName[@type='${year}']`,
            true,
          );
    for (const request of appendRequests)
      add(
        "appendItems",
        request,
        `dateTimeFormats/appendItems/appendItem[@request='${request}']`,
        true,
      );
    for (const [request, field] of [
      ["Year", "year"],
      ["Month", "month"],
      ["Day", "day"],
      ["Era", "era"],
      ["Day-Of-Week", "weekday"],
      ["Hour", "hour"],
      ["Minute", "minute"],
      ["Second", "second"],
      ["Timezone", "zone"],
      ["Quarter", "quarter"],
      ["Week", "week"],
    ] as const) {
      const label = resolver.value(
        locale,
        path(`dates/fields/field[@type='${field}']/displayName`),
      );
      if (label === undefined || label === "")
        throw Error("Missing append label " + locale + "/" + request);
      const items = groups.get("appendItems");
      if (items === undefined) throw Error("Missing calendar append items");
      items.set("label." + request, label);
    }
    const groupNames = [
      "styles",
      "patterns",
      "intervals",
      "months",
      "days",
      "eras",
      "dayPeriods",
      "cyclicYears",
      "leapMonths",
      "appendItems",
    ];
    const row = groupNames
      .map((group) => field(groups.get(group) ?? new Map()))
      .join(",");
    bindings.push([locale + "#" + calendar, intern("profiles", row)]);
    total++;
  }
  resolver.clear();
  console.error(
    new Date().toISOString(),
    "resolved locale",
    locale,
    "profiles",
    total,
    "unique",
    pools.profiles.length,
    "strings",
    pools.strings.length,
    "heapMiB",
    Math.round(process.memoryUsage().heapUsed / 1048576),
  );
  await new Promise((resolve) => setImmediate(resolve));
}

function table(entries: readonly (readonly [string, string])[]): string {
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => {
      if (/[\r\n]/.test(key + value) || key.includes("|"))
        throw Error("Packed date-time delimiter");
      return key + "|" + value;
    })
    .join("\n");
}
let output =
  "// Generated by tools/generate-date-time-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n// Archive SHA256: " +
  archiveSha256 +
  "\n";
for (const [name, entries] of [
  ["dateTimeCalendarLocales", bindings],
  [
    "dateTimeCalendarProfiles",
    pools.profiles.map((value, index) => [String(index), value] as const),
  ],
  [
    "dateTimeCalendarFields",
    pools.fields.map((value, index) => [String(index), value] as const),
  ],
  [
    "dateTimeCalendarStrings",
    pools.strings.map((value, index) => [String(index), value] as const),
  ],
] as const)
  output +=
    "export const " + name + " = " + JSON.stringify(table(entries)) + ";\n";
output = await format(output, { parser: "typescript" });
const outputPath = "packages/js-runtime/src/objects/date-time-format-data.ts";
writeFileSync(outputPath, output);
writeFileSync(
  "packages/js-runtime/date-time-format-data-manifest.json",
  await format(
    JSON.stringify(
      {
        kind: "cldr-date-time-calendar-data",
        archiveSha256,
        cldrVersion: "49",
        inputs,
        locales: localeKeys.length,
        calendars: calendars.map(([name]) => name),
        bindings: bindings.length,
        profiles: pools.profiles.length,
        fields: pools.fields.length,
        strings: pools.strings.length,
        skeletons: skeletonList,
        intervalSkeletons: intervalList,
        greatestDifferences: differenceList,
        output: {
          path: outputPath,
          sha256: hash(new TextEncoder().encode(output)),
        },
        policy:
          "General parent inheritance and source-locale aliases including LDML default format types; complete numeric locale registry; all pinned draft grades; Gregorian data shared by ISO; modern Japanese eras; no host Intl.",
      },
      null,
      2,
    ),
    { parser: "json" },
  ),
);
console.log(
  JSON.stringify({
    locales: localeKeys.length,
    total,
    elapsedMS: Date.now() - started,
    strings: pools.strings.length,
    fields: pools.fields.length,
    profiles: pools.profiles.length,
  }),
);
