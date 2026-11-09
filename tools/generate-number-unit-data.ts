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
import { maximizeLocaleId } from "../packages/js-runtime/src/objects/locale-likely.ts";
import { numberFormatLocaleRows } from "../packages/js-runtime/src/objects/number-format-data.ts";

/** Unit patterns for every ECMA-402 sanctioned simple unit, their per-unit
 * patterns, CLDR predefined compound units and the "per" compound pattern for
 * every NumberFormat locale, from the pinned CLDR 49 archive.
 * Usage: node tools/generate-number-unit-data.ts CLDR49.zip */
const archive = process.argv[2];
if (archive === undefined)
  throw Error("usage: node tools/generate-number-unit-data.ts CLDR49.zip");
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
    units = /<units>([\s\S]*?)<\/units>/.exec(text)?.[0] ?? "";
  trees.set(
    path.slice(12, -4).replaceAll("_", "-").toLowerCase(),
    parseCldrElements("<ldml>" + units + "</ldml>"),
  );
  if (index % 100 === 0)
    console.error(new Date().toISOString(), "loaded unit trees", index + 1);
}
/** Rows such as "zh-tw" have no CLDR file of their own: like the NumberFormat
 * generator, read them from the likely-subtags maximized locale's data. */
function dataLocale(locale: string): string {
  if (trees.has(locale)) return locale;
  let preferred = maximizeLocaleId(locale)?.toLowerCase() ?? locale;
  while (!trees.has(preferred) && preferred.includes("-"))
    preferred = preferred.slice(0, preferred.lastIndexOf("-"));
  return trees.has(preferred) ? preferred : locale;
}
const resolver = createCldrLocaleResolver(trees, parent),
  pathCache = new Map<string, CldrPathStep[]>();
function get(locale: string, path: string): string | undefined {
  let parsed = pathCache.get(path);
  if (parsed === undefined) {
    parsed = cldrPath(path);
    pathCache.set(path, parsed);
  }
  return resolver.value(dataLocale(locale), parsed);
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
    if (/[\n\r|]/.test(value) && pool === "strings")
      throw Error("Unexpected separator in pattern " + JSON.stringify(value));
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
// ECMA-402 sanctioned simple units (percent is formatted separately) with
// their CLDR unit keys, and the CLDR predefined compound units ECMA-402 can name.
const units: [string, string][] = [
  ["acre", "area-acre"],
  ["bit", "digital-bit"],
  ["byte", "digital-byte"],
  ["celsius", "temperature-celsius"],
  ["centimeter", "length-centimeter"],
  ["day", "duration-day"],
  ["degree", "angle-degree"],
  ["fahrenheit", "temperature-fahrenheit"],
  ["fluid-ounce", "volume-fluid-ounce"],
  ["foot", "length-foot"],
  ["gallon", "volume-gallon"],
  ["gigabit", "digital-gigabit"],
  ["gigabyte", "digital-gigabyte"],
  ["gram", "mass-gram"],
  ["hectare", "area-hectare"],
  ["hour", "duration-hour"],
  ["inch", "length-inch"],
  ["kilobit", "digital-kilobit"],
  ["kilobyte", "digital-kilobyte"],
  ["kilogram", "mass-kilogram"],
  ["kilometer", "length-kilometer"],
  ["liter", "volume-liter"],
  ["megabit", "digital-megabit"],
  ["megabyte", "digital-megabyte"],
  ["meter", "length-meter"],
  ["microsecond", "duration-microsecond"],
  ["mile", "length-mile"],
  ["mile-scandinavian", "length-mile-scandinavian"],
  ["milliliter", "volume-milliliter"],
  ["millimeter", "length-millimeter"],
  ["millisecond", "duration-millisecond"],
  ["minute", "duration-minute"],
  ["month", "duration-month"],
  ["nanosecond", "duration-nanosecond"],
  ["ounce", "mass-ounce"],
  ["petabyte", "digital-petabyte"],
  ["pound", "mass-pound"],
  ["second", "duration-second"],
  ["stone", "mass-stone"],
  ["terabit", "digital-terabit"],
  ["terabyte", "digital-terabyte"],
  ["week", "duration-week"],
  ["yard", "length-yard"],
  ["year", "duration-year"],
  // Plain percent formats through the percent affix path; compounds such as
  // percent-per-second and second-per-percent use these unit patterns.
  ["percent", "concentr-percent"],
  ["kilometer-per-hour", "speed-kilometer-per-hour"],
  ["meter-per-second", "speed-meter-per-second"],
  ["mile-per-hour", "speed-mile-per-hour"],
  ["liter-per-kilometer", "consumption-liter-per-kilometer"],
  ["mile-per-gallon", "consumption-mile-per-gallon"],
];
const widths = ["long", "short", "narrow"],
  categories = ["zero", "one", "two", "few", "many", "other"];
/** Each placeholder appears exactly once, except that non-"other" plural
 * forms may omit the number (Arabic "فدان" for one acre). */
function template(
  locale: string,
  value: string,
  placeholders: string[],
  optionalNumber = false,
): string {
  for (const placeholder of placeholders) {
    const count = value.split(placeholder).length - 1;
    if (
      count > 1 ||
      (count === 0 && !(optionalNumber && placeholder === "{0}"))
    )
      throw Error("Invalid unit template " + locale + JSON.stringify(value));
  }
  if (/\{[^}]*\}/.test(placeholders.reduce((v, p) => v.replace(p, ""), value)))
    throw Error(
      "Unexpected unit placeholder " + locale + JSON.stringify(value),
    );
  return value;
}
const bindings: [string, string][] = [];
let completed = 0;
for (const row of numberFormatLocaleRows.split("\n")) {
  const locale = row.slice(0, row.indexOf("|")),
    groups: string[] = [];
  for (const width of widths) {
    const values = new Map<string, string>();
    const base = `units/unitLength[@type='${width}']`;
    for (const [unit, key] of units) {
      for (const category of categories) {
        const value = get(
          locale,
          `${base}/unit[@type='${key}']/unitPattern[@count='${category}']`,
        );
        if (value !== undefined && value !== "")
          values.set(
            unit + "." + category,
            template(locale, value, ["{0}"], category !== "other"),
          );
      }
      if (!values.has(unit + ".other"))
        throw Error("Missing unit pattern " + locale + width + unit);
      const per = get(locale, `${base}/unit[@type='${key}']/perUnitPattern`);
      if (per !== undefined && per !== "")
        values.set(unit + ".per", template(locale, per, ["{0}"]));
    }
    const compound = get(
      locale,
      `${base}/compoundUnit[@type='per']/compoundUnitPattern`,
    );
    if (compound === undefined || compound === "")
      throw Error("Missing per compound pattern " + locale + width);
    values.set("per", template(locale, compound, ["{0}", "{1}"]));
    groups.push(packed(values));
  }
  bindings.push([locale, intern("profiles", groups.join(","))]);
  resolver.clear();
  if (++completed % 100 === 0)
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
const output = "packages/js-runtime/src/objects/number-unit-data.ts",
  source = await format(
    "// Generated by tools/generate-number-unit-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n" +
      [
        ["numberUnitLocaleRows", table(bindings)],
        [
          "numberUnitProfiles",
          table(pools.profiles.map((v, i) => [String(i), v] as const)),
        ],
        [
          "numberUnitFields",
          table(pools.fields.map((v, i) => [String(i), v] as const)),
        ],
        [
          "numberUnitStrings",
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
  "packages/js-runtime/number-unit-data-manifest.json",
  await format(
    JSON.stringify({
      source: "https://unicode.org/Public/cldr/49/core.zip",
      archiveSha256,
      inputs,
      locales: completed,
      units: units.map(([unit, key]) => unit + "=" + key),
      widths,
      categories,
      strings: pools.strings.length,
      fields: pools.fields.length,
      profiles: pools.profiles.length,
      output,
      sha256: hash(new TextEncoder().encode(source)),
      policy:
        "Default grammatical-case unit patterns for all ECMA-402 sanctioned simple units, CLDR per-unit patterns, predefined compound units and per compound patterns with CLDR inheritance; no host Intl",
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
