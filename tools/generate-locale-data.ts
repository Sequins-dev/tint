import collationInputs from "./locale-collation-inputs.json" with { type: "json" };
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  parseLocaleId,
  type LocaleLanguage,
} from "../packages/js-runtime/src/objects/locale-id.ts";

// Input archive and every interpreted member are checksum pinned. No host Intl.
const manifest = {
  url: "https://unicode.org/Public/cldr/49/core.zip",
  cldrVersion: "49",
  archiveSha256:
    "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89",
  license: "LICENSE",
  licenseSha256:
    "65eb33419e22a297550a811b5b535f5e532f9a7e0114b516c0ea18afd53c3804",
  inputs: [
    ...collationInputs,
    {
      path: "common/supplemental/supplementalMetadata.xml",
      sha256:
        "b06614fc2c9aab3b9a9f7e8bf9328f4f7a95d89b2d2dbb300d0caff0f885c164",
    },
    {
      path: "common/supplemental/likelySubtags.xml",
      sha256:
        "114019e183cffd98262c8c137d40d215124f80d9ba474a594d6ffa1b551b0a96",
    },
    {
      path: "common/bcp47/transform_hybrid.xml",
      sha256:
        "cefd0cd86388941868991f50351ff61a757b0493b62bca395151aef2bcc5e46c",
    },
    {
      path: "common/bcp47/measure.xml",
      sha256:
        "6a1445e2f6af8fad47b9d5b40e67d582e7f4b9502609443780d3e3641d23be4d",
    },
    {
      path: "common/bcp47/transform_mt.xml",
      sha256:
        "508428eaa699cdd857d0daf7ce8ff232023abd162b5f623640b10de1348d95e7",
    },
    {
      path: "common/bcp47/variant.xml",
      sha256:
        "e5500779baa55e838c5bf1529561c3b441fe2c331caac6ceddecffb4e425a514",
    },
    {
      path: "common/bcp47/transform_private_use.xml",
      sha256:
        "b1157b7e690aa1f17894f0c2e1d8a16e749a1115a93f743d7032fdfb1686fbe2",
    },
    {
      path: "common/bcp47/transform_ime.xml",
      sha256:
        "cdc020c18ef8d7c9d3b1ccc12b3ea711cde758f8c0aed828c9bc1bc3197e051c",
    },
    {
      path: "common/bcp47/collation.xml",
      sha256:
        "2fa8fef733069c4651a5c60c85cb38ba09a07151d71b9b148d9372eff28a4d42",
    },
    {
      path: "common/bcp47/transform.xml",
      sha256:
        "d564dd996541afbcab77b3446bea5e591c3ec5c3b27ed0cd08326ae873ec7bdb",
    },
    {
      path: "common/bcp47/currency.xml",
      sha256:
        "b1dffe8e4cd42638b9fd64b9a205746b195ceb6a3a95024cdb19b74bab2e0d3f",
    },
    {
      path: "common/bcp47/number.xml",
      sha256:
        "0c10e9578f2191527475d0f57105d56c399b2f44425ceebadf474e50157abbb6",
    },
    {
      path: "common/bcp47/transform-destination.xml",
      sha256:
        "469976ddb878572cdede31e94a6e60a4cd9d2d83df9bda3e47045c8489cf76a0",
    },
    {
      path: "common/bcp47/transform_keyboard.xml",
      sha256:
        "a719796bd59b8daf4b98d6fd294e6d5405b8bf3b36a5086a70242bd5e8a12ef9",
    },
    {
      path: "common/bcp47/calendar.xml",
      sha256:
        "60d5672ae8ba22ef5a5a34df4b48607fd02bb025d81708bdd1776cc1a7d66718",
    },
    {
      path: "common/bcp47/segmentation.xml",
      sha256:
        "9a3a00df3181b51279389655ef06f12be593d3b288c44b54caf7b2d86ed8b285",
    },
    {
      path: "common/bcp47/timezone.xml",
      sha256:
        "1f63924aba623465ad487bc3452bdc269f01fa787477610f8f526e9ad25efcae",
    },
    {
      path: "common/supplemental/supplementalData.xml",
      sha256:
        "745150ec1408d50e1a272b65654a5dd645f3e60f5cc2898b576f725b28538d1a",
    },
    {
      path: "common/properties/scriptMetadata.txt",
      sha256:
        "bb9e789af929c5db67ffcd3e47e3a58f6187686fe4c72fb8203cbe7098715a56",
    },
    {
      path: "common/supplemental/windowsZones.xml",
      sha256:
        "5f902f94106a396cb7774f0b0e1ca4dfecb686494045350c0b4935d378e3913b",
    },
    {
      path: "common/supplemental/metaZones.xml",
      sha256:
        "fa705a0568667008789e1b865c10982f33b56cddbb3d428da2546decca75e5d4",
    },
  ],
} as const;

const archive = process.argv[2];
if (archive === undefined)
  throw new Error(
    "Usage: node tools/generate-locale-data.ts /path/to/cldr-core-49.zip",
  );
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
if (digest(readFileSync(archive)) !== manifest.archiveSha256)
  throw new Error("CLDR 49 archive checksum mismatch");
function member(path: string): Uint8Array {
  return execFileSync("/usr/bin/unzip", ["-p", archive!, path], {
    maxBuffer: 16 * 1024 * 1024,
  });
}
const license = member("LICENSE");
if (digest(license) !== manifest.licenseSha256)
  throw new Error("CLDR license checksum mismatch");
writeFileSync("packages/js-runtime/LICENSE-CLDR.txt", license);
const inputs = new Map<string, string>();
for (const input of manifest.inputs) {
  const bytes = member(input.path);
  if (digest(bytes) !== input.sha256)
    throw new Error("CLDR member checksum mismatch: " + input.path);
  inputs.set(
    input.path,
    new TextDecoder().decode(bytes).replace(/<!--[\s\S]*?-->/g, ""),
  );
}
function attributes(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/([A-Za-z]+)=(?:"([^"]*)"|'([^']*)')/g)].map((m) => [
      m[1]!,
      m[2] ?? m[3]!,
    ]),
  );
}
function language(source: string, kind: string): LocaleLanguage | undefined {
  const parsed = parseLocaleId(
    (kind === "languageAlias" ? "" : "und-") + source.replaceAll("_", "-"),
  );
  return parsed !== undefined && parsed.extensions.length === 0
    ? parsed.language
    : undefined;
}
function fields(value: LocaleLanguage): string[][] {
  return [
    value.language === "und" ? [] : [value.language],
    value.script ? [value.script] : [],
    value.region ? [value.region] : [],
    [...value.variants].sort(),
  ];
}
function encode(value: LocaleLanguage): string {
  return [value.language, value.script, value.region, ...value.variants]
    .filter(Boolean)
    .join("-");
}
const aliases: { type: LocaleLanguage; replacements: LocaleLanguage[] }[] = [];
const subdivisions: string[] = [];
const metadata = inputs.get("common/supplemental/supplementalMetadata.xml")!;
for (const match of metadata.matchAll(
  /<(languageAlias|scriptAlias|territoryAlias|variantAlias|subdivisionAlias)\b([^>]+)\/>/g,
)) {
  const kind = match[1]!,
    row = attributes(match[2]!),
    type = row.get("type")!,
    replacement = row.get("replacement")!;
  if (kind === "subdivisionAlias") {
    subdivisions.push(
      type.toLowerCase() + "|" + replacement.split(" ")[0]!.toLowerCase(),
    );
    continue;
  }
  const parsed = language(type, kind);
  if (parsed === undefined) continue; // UTS35 Annex C excludes non-language-ID alias types.
  const replacements = replacement.split(" ").map((value) => {
    const parsed = language(value, kind);
    if (parsed === undefined)
      throw new Error("Invalid CLDR replacement: " + value);
    return parsed;
  });
  aliases.push({ type: parsed, replacements });
}
aliases.sort((a, b) => {
  const x = fields(a.type),
    y = fields(b.type);
  let d = y.flat().length - x.flat().length;
  if (d !== 0) return d;
  for (let k = 0; k < 4; k++) {
    d = Number(y[k]!.length > 0) - Number(x[k]!.length > 0);
    if (d !== 0) return d;
  }
  for (let k = 0; k < 4; k++) {
    const first = x[k]!.join("-"),
      second = y[k]!.join("-");
    if (first !== second) return first < second ? -1 : 1;
  }
  return 0;
});
const likely: string[] = [];
for (const match of inputs
  .get("common/supplemental/likelySubtags.xml")!
  .matchAll(/<likelySubtag\b([^>]+)\/>/g)) {
  const row = attributes(match[1]!);
  likely.push(
    (row.get("from")! + "|" + row.get("to")!)
      .replaceAll("_", "-")
      .toLowerCase(),
  );
}
const types = new Map<string, string>();
for (const [path, text] of inputs) {
  if (!path.startsWith("common/bcp47/")) continue;
  for (const keyMatch of text.matchAll(/<key\b([^>]+)>([\s\S]*?)<\/key>/g)) {
    const key = attributes(keyMatch[1]!),
      extension = key.get("extension") ?? "u";
    for (const match of keyMatch[2]!.matchAll(/<type\b([^>]+)\/>/g)) {
      const row = attributes(match[1]!),
        name = row.get("name")!,
        preferred = row.get("preferred") ?? name;
      const names = [name, ...(row.get("alias") ?? "").split(" ")];
      for (const alias of names) {
        if (
          alias.toLowerCase() === preferred.toLowerCase() ||
          !/^[A-Za-z0-9]{3,8}(?:-[A-Za-z0-9]{3,8})*$/.test(alias)
        )
          continue;
        const id = (
          extension +
          ":" +
          key.get("name")! +
          ":" +
          alias
        ).toLowerCase();
        const previous = types.get(id);
        if (previous !== undefined && previous !== preferred.toLowerCase())
          throw new Error("Conflicting type alias: " + id);
        types.set(id, preferred.toLowerCase());
      }
    }
  }
}
if (aliases.length !== 813 || likely.length !== 7868)
  throw new Error(
    "Unexpected CLDR table population: " +
      aliases.length +
      " aliases, " +
      likely.length +
      " likely subtags",
  );
let output =
  "// Generated by tools/generate-locale-data.ts; do not edit.\n" +
  "// CLDR 49: " +
  manifest.url +
  "\n// Archive SHA-256 " +
  manifest.archiveSha256 +
  "\n" +
  "// Unicode License V3 and upstream notices: ../../LICENSE-CLDR.txt\n";
function table(name: string, rows: readonly string[]): void {
  output +=
    "export const " + name + " = " + JSON.stringify(rows.join("\n")) + ";\n";
}
table(
  "localeAliasRules",
  aliases.map(
    (rule) => encode(rule.type) + "|" + rule.replacements.map(encode).join(" "),
  ),
);
function compareKeys(a: string, b: string): number {
  const first = a.slice(0, a.indexOf("|")),
    second = b.slice(0, b.indexOf("|"));
  return first < second ? -1 : first > second ? 1 : 0;
}
table("localeLikelySubtags", likely.sort(compareKeys));
table("localeSubdivisionAliases", subdivisions.sort(compareKeys));
table(
  "localeTypeAliases",
  [...types].map(([key, value]) => key + "|" + value).sort(compareKeys),
);

function mappingTable(name: string, values: ReadonlyMap<string, string>): void {
  table(
    name,
    [...values].map(([key, value]) => key + "|" + value).sort(compareKeys),
  );
}
const supplemental = inputs.get("common/supplemental/supplementalData.xml")!;
const hours = new Map<string, string>();
const cycleNames = new Map([
  ["h", "h12"],
  ["H", "h23"],
  ["K", "h11"],
  ["k", "h24"],
]);
for (const match of supplemental.matchAll(/<hours\b([^>]+)\/>/g)) {
  const row = attributes(match[1]!),
    cycles: string[] = [];
  for (const pattern of [
    row.get("preferred")!,
    ...row.get("allowed")!.split(/\s+/),
  ]) {
    const cycle = cycleNames.get(pattern.slice(0, 1));
    if (cycle === undefined)
      throw new Error("Unknown CLDR hour pattern: " + pattern);
    if (!cycles.includes(cycle)) cycles.push(cycle);
  }
  for (const region of row.get("regions")!.trim().split(/\s+/))
    hours.set(region.replaceAll("_", "-").toLowerCase(), cycles.join(","));
}
const scripts = new Map<string, string>();
for (const line of inputs
  .get("common/properties/scriptMetadata.txt")!
  .split("\n")) {
  const fields = line
    .split("#")[0]!
    .split(";")
    .map((value) => value.trim());
  if (fields.length < 7) continue;
  const direction = fields[6];
  if (direction !== "YES" && direction !== "NO" && direction !== "UNKNOWN")
    throw new Error("Unknown CLDR script direction");
  scripts.set(
    fields[0]!.toLowerCase(),
    direction === "YES" ? "rtl" : direction === "NO" ? "ltr" : "?",
  );
}
const weekNames = ["firstDay", "weekendStart", "weekendEnd"];
for (const [index, name] of [
  "localeWeekFirstDays",
  "localeWeekendStarts",
  "localeWeekendEnds",
].entries()) {
  const values = new Map<string, string>();
  for (const match of supplemental.matchAll(
    /<(firstDay|weekendStart|weekendEnd)\b([^>]+)\/>/g,
  )) {
    if (match[1] !== weekNames[index]) continue;
    const row = attributes(match[2]!);
    if (row.has("alt")) continue;
    const ordinal =
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(
        row.get("day")!,
      ) + 1;
    if (ordinal < 1) throw new Error("Unknown CLDR weekday");
    for (const region of row.get("territories")!.trim().split(/\s+/))
      values.set(region.toLowerCase(), String(ordinal));
  }
  if (!values.has("001")) throw new Error("Missing world week-data default");
  mappingTable(name, values);
}
const primaryZones = new Map<string, string>();
for (const match of inputs
  .get("common/bcp47/timezone.xml")!
  .matchAll(/<type\b([^>]+)\/>/g)) {
  const row = attributes(match[1]!),
    aliases = row.get("alias")?.trim().split(/\s+/);
  if (aliases === undefined) continue;
  let primary = row.get("iana") ?? aliases[0]!;
  if (primary === "Etc/UTC" || primary === "Etc/GMT" || primary === "GMT")
    primary = "UTC";
  for (const alias of aliases) primaryZones.set(alias, primary);
}
const zones = new Map<string, Set<string>>();
for (const path of [
  "common/supplemental/windowsZones.xml",
  "common/supplemental/metaZones.xml",
]) {
  for (const match of inputs.get(path)!.matchAll(/<mapZone\b([^>]+)\/>/g)) {
    const row = attributes(match[1]!),
      region = row.get("territory")!;
    if (region === "001" || region === "ZZ") continue;
    const key = region.toLowerCase(),
      names = zones.get(key) ?? new Set<string>();
    for (const name of row.get("type")!.trim().split(/\s+/))
      names.add(primaryZones.get(name) ?? name);
    zones.set(key, names);
  }
}
if (hours.size !== 277 || scripts.size !== 184 || zones.size !== 248)
  throw new Error("Unexpected CLDR locale metadata population");
mappingTable("localeHourCyclePreferences", hours);
mappingTable("localeScriptDirections", scripts);
mappingTable(
  "localeTerritoryTimeZones",
  new Map(
    [...zones].map(([key, values]) => [key, [...values].sort().join(",")]),
  ),
);
// Preserve CLDR's ordered common-use preferences while canonicalizing its
// internal legacy names through the pinned BCP47 calendar vocabulary.
const calendarAliases = new Map<string, string>(),
  calendarTypes = new Set<string>();
for (const section of inputs
  .get("common/bcp47/calendar.xml")!
  .matchAll(/<key\b([^>]+)>([\s\S]*?)<\/key>/g)) {
  if (attributes(section[1]!).get("name") !== "ca") continue;
  for (const match of section[2]!.matchAll(/<type\b([^>]+)\/>/g)) {
    const row = attributes(match[1]!),
      name = row.get("name")!,
      preferred = row.get("preferred") ?? name;
    calendarTypes.add(preferred);
    for (const alias of [name, ...(row.get("alias") ?? "").split(/\s+/)]) {
      if (alias === "") continue;
      const old = calendarAliases.get(alias);
      if (old !== undefined && old !== preferred)
        throw new Error("Conflicting calendar alias: " + alias);
      calendarAliases.set(alias, preferred);
    }
  }
}
const calendars = new Map<string, string>();
for (const match of supplemental.matchAll(/<calendarPreference\b([^>]+)\/>/g)) {
  const row = attributes(match[1]!),
    values: string[] = [];
  for (const name of row.get("ordering")!.split(/\s+/)) {
    const canonical = calendarAliases.get(name);
    if (canonical === undefined)
      throw new Error("Unrecognized CLDR calendar: " + name);
    if (!values.includes(canonical)) values.push(canonical);
  }
  for (const region of row.get("territories")!.split(/\s+/)) {
    const key = region.toLowerCase();
    if (calendars.has(key))
      throw new Error("Duplicate calendar preference: " + key);
    calendars.set(key, values.join(","));
  }
}
if (calendarTypes.size !== 18 || calendars.get("001") !== "gregory")
  throw new Error("Unexpected CLDR calendar catalog");
mappingTable("localeCalendarPreferences", calendars);
output +=
  "export const localeCalendarTypes = " +
  JSON.stringify([...calendarTypes].sort().join(",")) +
  ";\n";
// Collation metadata inherits individual types through the collation-specific
// parent graph. Main-locale nonlikely-script parents do not apply here.
const collationAliases = new Map<string, string>();
const collationVocabulary = inputs
  .get("common/bcp47/collation.xml")!
  .match(/<key\b[^>]*name="co"[^>]*>([\s\S]*?)<\/key>/)![1]!;
for (const match of collationVocabulary.matchAll(/<type\b([^>]+)\/>/g)) {
  const a = attributes(match[1]!),
    name = a.get("name")!;
  const canonical = a.get("preferred") ?? name;
  for (const alias of [name, ...(a.get("alias") ?? "").split(" ")])
    if (alias !== "") collationAliases.set(alias, canonical);
}
const collationParents = new Map<string, string>();
const parentData = supplemental.match(
  /<parentLocales component="collations">([\s\S]*?)<\/parentLocales>/,
)![1]!;
for (const match of parentData.matchAll(/<parentLocale\b([^>]+)\/>/g)) {
  const a = attributes(match[1]!);
  for (const locale of a.get("locales")!.split(" "))
    collationParents.set(locale, a.get("parent")!);
}
const collationOwn = new Map<string, string[]>();
for (const [path, text] of inputs) {
  if (!path.startsWith("common/collation/")) continue;
  const types: string[] = [];
  for (const match of text.matchAll(/<collation\b([^>]+)>/g)) {
    const name = attributes(match[1]!).get("type")!;
    if (name === "standard" || name === "search" || name.startsWith("private-"))
      continue;
    const canonical = collationAliases.get(name);
    // CLDR also has non-BCP47 tailoring names (for example digits-after).
    // They are not public Unicode collation identifiers.
    if (canonical === undefined) continue;
    if (!types.includes(canonical)) types.push(canonical);
  }
  collationOwn.set(path.slice("common/collation/".length, -4), types);
}
const collations = new Map<string, string>();
function inheritedCollations(
  locale: string,
  visiting = new Set<string>(),
): string[] {
  if (visiting.has(locale)) throw Error("Cyclic collation parent: " + locale);
  visiting.add(locale);
  const own = collationOwn.get(locale) ?? [];
  if (locale === "root") return own.slice().sort();
  const split = locale.lastIndexOf("_");
  const parent =
    collationParents.get(locale) ??
    (split < 0 ? "root" : locale.slice(0, split));
  return [
    ...new Set([...own, ...inheritedCollations(parent, visiting)]),
  ].sort();
}
for (const locale of new Set([
  ...collationOwn.keys(),
  ...collationParents.keys(),
]))
  collations.set(
    locale.replaceAll("_", "-"),
    inheritedCollations(locale).join(","),
  );
if (
  collations.get("root") !== "emoji,eor" ||
  collations.get("de") !== "emoji,eor,phonebk"
)
  throw Error("Unexpected CLDR collation catalog");
mappingTable("localeCollationPreferences", collations);
writeFileSync("packages/js-runtime/src/objects/locale-data.ts", output);
const corpusPath =
  "common/testData/localeIdentifiers/localeCanonicalization.txt";
const corpus = member(corpusPath);
if (
  digest(corpus) !==
  "f979d937cef53c85490fb419ac68e6fd8066a520f617fe7b367b18bf854564a9"
)
  throw new Error("CLDR locale corpus checksum mismatch");
mkdirSync("packages/js-runtime/test/fixtures", { recursive: true });
writeFileSync(
  "packages/js-runtime/test/fixtures/locale-canonicalization.txt",
  corpus,
);
console.log(
  "Generated CLDR 49 locale tables: " +
    aliases.length +
    " language rules, " +
    types.size +
    " type aliases, " +
    likely.length +
    " likely subtags.",
);
