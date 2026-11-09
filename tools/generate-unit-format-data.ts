import { format } from "prettier";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  parseCldrElements,
  cldrPath,
  createCldrLocaleResolver,
  attributes,
  type CldrElement,
  type CldrPathStep,
} from "./cldr-xml.ts";
import { numberFormatLocaleRows } from "../packages/js-runtime/src/objects/number-format-data.ts";
import { numberFormatLocaleData } from "../packages/js-runtime/src/objects/number-format-profile.ts";
import { parseDateTimePattern } from "../packages/js-runtime/src/objects/date-time-pattern.ts";
const archive = process.argv[2];
if (archive === undefined)
  throw Error("usage: node tools/generate-unit-format-data.ts CLDR49.zip");
const archiveSha256 =
    "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89",
  hash = (bytes: Uint8Array) =>
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
const parents = new Map<string, string>();
for (const block of member("common/supplemental/supplementalData.xml").matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const row of block[2]!.matchAll(/<parentLocale\b([^>]+)\/>/g)) {
    const a = attributes(row[1]!);
    for (const locale of a.get("locales")!.trim().split(/\s+/))
      parents.set(
        locale.replaceAll("_", "-").toLowerCase(),
        a.get("parent")!.replaceAll("_", "-").toLowerCase(),
      );
  }
}
const parent = (locale: string): string | undefined =>
    parents.get(locale) ??
    (locale.includes("-")
      ? locale.slice(0, locale.lastIndexOf("-"))
      : locale === "root"
        ? undefined
        : "root"),
  paths = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
    encoding: "utf8",
    maxBuffer: 4000000,
  })
    .split("\n")
    .filter((p) => /^common\/main\/[^/]+\.xml$/.test(p))
    .sort(),
  trees = new Map<string, CldrElement>();
for (let index = 0; index < paths.length; index++) {
  const path = paths[index]!,
    text = member(path),
    parts = ["units", "numbers", "listPatterns"].map(
      (name) =>
        new RegExp("<" + name + ">([\\s\\S]*?)<\\/" + name + ">").exec(
          text,
        )?.[0] ?? "",
    );
  trees.set(
    path.slice(12, -4).replaceAll("_", "-").toLowerCase(),
    parseCldrElements("<ldml>" + parts.join("") + "</ldml>"),
  );
  if (index % 50 === 0)
    console.error(
      new Date().toISOString(),
      "loaded unit/number/list trees",
      index + 1,
    );
}
const resolver = createCldrLocaleResolver(trees, parent),
  pathCache = new Map<string, CldrPathStep[]>();
function get(locale: string, path: string): string | undefined {
  let parsed = pathCache.get(path);
  if (parsed === undefined) {
    parsed = cldrPath(path);
    pathCache.set(path, parsed);
  }
  return resolver.value(locale, parsed);
}
type Pool = "strings" | "fields" | "profiles";
const pools: Record<Pool, string[]> = { strings: [], fields: [], profiles: [] },
  ids: Record<Pool, Map<string, string>> = {
    strings: new Map(),
    fields: new Map(),
    profiles: new Map(),
  };
function intern(pool: Pool, value: string): string {
  let id = ids[pool].get(value);
  if (id === undefined) {
    if (value.includes("\n") || value.includes("\r"))
      throw Error("Unexpected multiline unit data");
    id = String(pools[pool].length);
    pools[pool].push(value);
    ids[pool].set(value, id);
  }
  return id;
}
function packed(entries: Map<string, string>): string {
  return intern(
    "fields",
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => key + ":" + intern("strings", value))
      .join(","),
  );
}
function table(entries: readonly (readonly [string, string])[]): string {
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => key + "|" + value)
    .join("\n");
}
function durationPattern(text: string): {
  hourMinute: string;
  minuteSecond: string;
  twoDigit: boolean;
} {
  const tokens = parseDateTimePattern(text);
  if (tokens === undefined) throw Error("Invalid duration pattern " + text);
  const fields = tokens.filter((t) => t.symbol !== "");
  if (
    fields.length !== 3 ||
    !"hH".includes(fields[0]!.symbol) ||
    fields[1]!.symbol !== "m" ||
    fields[2]!.symbol !== "s"
  )
    throw Error("Unsupported duration pattern " + text);
  let position = 0,
    hourMinute = "",
    minuteSecond = "";
  for (const token of tokens) {
    if (token.symbol !== "") position++;
    else if (position === 1) hourMinute += token.literal;
    else if (position === 2) minuteSecond += token.literal;
    // ECMA's DigitalFormat record contains separators and padding only;
    // outer labels in a CLDR elapsed-time pattern do not describe those fields.
  }
  if (hourMinute === "" || minuteSecond === "")
    throw Error("Empty duration separator " + text);
  return { hourMinute, minuteSecond, twoDigit: fields[0]!.width === 2 };
}
const units = [
    "year",
    "month",
    "week",
    "day",
    "hour",
    "minute",
    "second",
    "millisecond",
    "microsecond",
    "nanosecond",
  ],
  widths = ["long", "short", "narrow"],
  categories = ["zero", "one", "two", "few", "many", "other"],
  bindings: [string, string][] = [];
let completed = 0;
for (const row of numberFormatLocaleRows.split("\n")) {
  const locale = row.slice(0, row.indexOf("|")),
    unitValues = new Map<string, string>(),
    digital = new Map<string, string>(),
    lists = new Map<string, string>(),
    numeric = numberFormatLocaleData(locale);
  if (numeric === undefined) throw Error("Missing numeric locale " + locale);
  for (const width of widths) {
    for (const unit of units)
      for (const category of categories) {
        const value = get(
          locale,
          `units/unitLength[@type='${width}']/unit[@type='duration-${unit}']/unitPattern[@count='${category}']`,
        );
        if (value !== undefined && value !== "") {
          if (
            value.split("{0}").length > 2 ||
            /\{[^}]*\}/.test(value.replace("{0}", ""))
          )
            throw Error("Invalid unit template " + locale + value);
          unitValues.set(width + "." + unit + "." + category, value);
        } else if (category === "other")
          throw Error("Missing unit pattern " + locale + width + unit);
      }
    const type = width === "long" ? "unit" : "unit-" + width;
    for (const part of ["2", "start", "middle", "end"]) {
      const value = get(
        locale,
        `listPatterns/listPattern[@type='${type}']/listPatternPart[@type='${part}']`,
      );
      if (
        value === undefined ||
        value.split("{0}").length !== 2 ||
        value.split("{1}").length !== 2
      )
        throw Error("Invalid unit list " + locale + width + part);
      lists.set(width + "." + part, value);
    }
  }
  const raw = get(
    locale,
    "units/durationUnit[@type='hms']/durationUnitPattern",
  );
  if (raw === undefined) throw Error("Missing duration pattern " + locale);
  const pattern = durationPattern(raw),
    latin = get(locale, "numbers/symbols[@numberSystem='latn']/timeSeparator");
  for (const system of numeric.numberingSystems) {
    const separator =
      get(locale, `numbers/symbols[@numberSystem='${system}']/timeSeparator`) ??
      latin;
    digital.set(system + ".hm", separator ?? pattern.hourMinute);
    digital.set(system + ".ms", separator ?? pattern.minuteSecond);
    digital.set(system + ".hh", pattern.twoDigit ? "1" : "0");
  }
  bindings.push([
    locale,
    intern(
      "profiles",
      [packed(unitValues), packed(digital), packed(lists)].join(","),
    ),
  ]);
  resolver.clear();
  if (++completed % 25 === 0)
    console.error(
      new Date().toISOString(),
      "resolved unit profiles",
      completed,
      "unique",
      pools.profiles.length,
      "strings",
      pools.strings.length,
    );
}
const output = "packages/js-runtime/src/objects/unit-format-data.ts",
  source = await format(
    "// Generated by tools/generate-unit-format-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n" +
      [
        ["unitFormatLocaleRows", table(bindings)],
        [
          "unitFormatProfiles",
          table(pools.profiles.map((v, i) => [String(i), v] as const)),
        ],
        [
          "unitFormatFields",
          table(pools.fields.map((v, i) => [String(i), v] as const)),
        ],
        [
          "unitFormatStrings",
          table(pools.strings.map((v, i) => [String(i), v] as const)),
        ],
      ]
        .map(
          ([name, value]) =>
            "export const " + name + " = " + JSON.stringify(value) + ";\n",
        )
        .join(""),
    { parser: "typescript" },
  );
writeFileSync(output, source);
writeFileSync(
  "packages/js-runtime/unit-format-data-manifest.json",
  await format(
    JSON.stringify({
      source: "https://unicode.org/Public/cldr/49/core.zip",
      archiveSha256,
      inputs,
      locales: completed,
      units,
      widths,
      categories,
      strings: pools.strings.length,
      fields: pools.fields.length,
      profiles: pools.profiles.length,
      output,
      sha256: hash(new TextEncoder().encode(source)),
      policy:
        "Complete default grammatical-case time-unit patterns and inherited unit lists; zero/one numeric placeholders allowed; duration clock padding and numbering-system separators; no host Intl",
    }),
    { parser: "json" },
  ),
);
console.log(
  JSON.stringify({
    locales: completed,
    strings: pools.strings.length,
    fields: pools.fields.length,
    profiles: pools.profiles.length,
  }),
);
