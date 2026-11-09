import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { attributes, xmlText } from "./cldr-xml.ts";

// Usage: node tools/generate-display-names-data.ts CLDR49.zip
// Emits packages/js-runtime/src/objects/display-names-data.ts: one sorted
// "key|value" table per available locale for Intl.DisplayNames.
const archive = process.argv[2];
if (archive === undefined)
  throw Error("usage: node tools/generate-display-names-data.ts CLDR49.zip");
const archiveSha256 =
  "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
if (hash(readFileSync(archive)) !== archiveSha256)
  throw Error("CLDR49 checksum differs");
const inputs: { path: string; sha256: string }[] = [];
function member(path: string): string {
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive!, path], {
    maxBuffer: 16 * 1024 * 1024,
  });
  inputs.push({ path, sha256: hash(bytes) });
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/<!--[\s\S]*?-->/g, "");
}

/** Available DisplayNames locales. Kept deliberately small: the tables are
 * linked into every runtime image. Every locale resolves its CLDR parents. */
const available = ["en"];

const parents = new Map<string, string>();
for (const block of member("common/supplemental/supplementalData.xml").matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const match of block[2]!.matchAll(/<parentLocale\b([^>]+)\/>/g)) {
    const a = attributes(match[1]!);
    for (const locale of a.get("locales")!.trim().split(/\s+/))
      parents.set(locale, a.get("parent")!);
  }
}
function parentOf(locale: string): string | undefined {
  if (locale === "root") return undefined;
  const explicit = parents.get(locale);
  if (explicit !== undefined) return explicit;
  const cut = locale.lastIndexOf("_");
  return cut < 0 ? "root" : locale.slice(0, cut);
}

// BCP 47 calendar names keyed by their CLDR type alias (gregorian -> gregory).
const calendarNames = new Map<string, string>();
for (const match of member("common/bcp47/calendar.xml").matchAll(
  /<type\b([^>]*)\/>/g,
)) {
  const a = attributes(match[1]!),
    name = a.get("name")!;
  if (a.get("deprecated") === "true") continue;
  calendarNames.set(name, name);
  for (const alias of (a.get("alias") ?? "").split(/\s+/))
    if (alias !== "") calendarNames.set(alias, name);
}

/** CLDR identifiers (en_GB, und_Latn) as BCP 47 language codes (en-GB). */
function languageCode(type: string): string {
  return type.replaceAll("_", "-");
}

type Rows = Map<string, string>;
function localeRows(locale: string): Rows {
  const text = member("common/main/" + locale + ".xml");
  if (/<\/identity>\s*<alias\b/.test(text))
    throw Error("Whole-locale alias: " + locale);
  const rows: Rows = new Map();
  const put = (key: string, value: string) => {
    if (value.includes("\n") || value.includes("|"))
      throw Error("DisplayNames value contains a separator: " + key);
    if (!rows.has(key)) rows.set(key, value);
  };
  const block = (name: string) =>
    new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">").exec(text)?.[1] ??
    "";
  const pattern = block("localeDisplayPattern");
  const localePattern = /<localePattern>([^<]*)<\/localePattern>/.exec(pattern),
    separator = /<localeSeparator>([^<]*)<\/localeSeparator>/.exec(pattern);
  if (localePattern !== null) put("p:locale", xmlText(localePattern[1]!));
  if (separator !== null) put("p:separator", xmlText(separator[1]!));
  const element = (
    container: string,
    tag: string,
    prefix: string,
    code: (type: string) => string,
  ) => {
    for (const match of block(container).matchAll(
      new RegExp("<" + tag + "\\b([^>]*)>([^<]*)</" + tag + ">", "g"),
    )) {
      const a = attributes(match[1]!),
        alt = a.get("alt"),
        key = prefix + code(a.get("type")!);
      if (alt === undefined) put(key, xmlText(match[2]!));
      else if (alt === "short") put(key + "@short", xmlText(match[2]!));
    }
  };
  element("languages", "language", "l:", languageCode);
  element("scripts", "script", "s:", (type) => type);
  element("territories", "territory", "r:", (type) => type);
  for (const match of block("types").matchAll(
    /<type\b([^>]*)>([^<]*)<\/type>/g,
  )) {
    const a = attributes(match[1]!);
    if (a.get("key") !== "calendar" || a.has("alt")) continue;
    const name = calendarNames.get(a.get("type")!);
    if (name !== undefined) put("k:" + name, xmlText(match[2]!));
  }
  for (const match of block("currencies").matchAll(
    /<currency\b([^>]*)>([\s\S]*?)<\/currency>/g,
  )) {
    const code = attributes(match[1]!).get("type")!,
      body = match[2]!;
    const display = /<displayName>([^<]*)<\/displayName>/.exec(body),
      symbol = /<symbol>([^<]*)<\/symbol>/.exec(body),
      narrow = /<symbol alt="narrow">([^<]*)<\/symbol>/.exec(body);
    if (display !== null) put("c:" + code, xmlText(display[1]!));
    if (symbol !== null) put("c:" + code + "@short", xmlText(symbol[1]!));
    if (narrow !== null) put("c:" + code + "@narrow", xmlText(narrow[1]!));
  }
  const fieldCodes = new Map([
    ["era", "era"],
    ["year", "year"],
    ["quarter", "quarter"],
    ["month", "month"],
    ["week", "weekOfYear"],
    ["weekday", "weekday"],
    ["day", "day"],
    ["dayperiod", "dayPeriod"],
    ["hour", "hour"],
    ["minute", "minute"],
    ["second", "second"],
    ["zone", "timeZoneName"],
  ]);
  for (const match of block("fields").matchAll(
    /<field\b([^>]*)>([\s\S]*?)<\/field>/g,
  )) {
    const type = attributes(match[1]!).get("type")!,
      [base, width] = type.split("-") as [string, string | undefined],
      code = fieldCodes.get(base);
    const display = /<displayName>([^<]*)<\/displayName>/.exec(match[2]!);
    if (code === undefined || display === null) continue;
    put(
      "f:" + code + (width === undefined ? "" : "@" + width),
      xmlText(display[1]!),
    );
  }
  return rows;
}

const tables: string[] = [];
for (const locale of available) {
  const merged: Rows = new Map();
  for (
    let current: string | undefined = locale;
    current !== undefined;
    current = parentOf(current)
  )
    for (const [key, value] of localeRows(current))
      if (!merged.has(key)) merged.set(key, value);
  for (const required of ["p:locale", "p:separator"])
    if (!merged.has(required))
      throw Error(locale + " lacks DisplayNames pattern " + required);
  const keys = [...merged.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  tables.push(keys.map((key) => key + "|" + merged.get(key)).join("\n"));
}

const output =
  "// Generated by tools/generate-display-names-data.ts; do not edit.\n" +
  "// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n" +
  "// Archive SHA256: " +
  archiveSha256 +
  "\n" +
  "/** Available Intl.DisplayNames locales (comma-separated), in table order. */\n" +
  "export const displayNamesLocales = " +
  JSON.stringify(available.join(",")) +
  ";\n" +
  "/** Sorted key|value rows for the locale at index: l: language, r: region,\n" +
  " * s: script, c: currency, k: calendar (BCP 47 name), f: dateTimeField,\n" +
  " * p: locale display patterns; @short / @narrow select the style variant. */\n" +
  "export function displayNamesTable(index: number): string | undefined {\n" +
  tables
    .map(
      (table, index) =>
        "  if (index === " +
        index +
        ") return " +
        JSON.stringify(table) +
        ";\n",
    )
    .join("") +
  "  return undefined;\n}\n";
const target = "packages/js-runtime/src/objects/display-names-data.ts";
const formatted = await format(output, { parser: "typescript" });
writeFileSync(target, formatted);
writeFileSync(
  "packages/js-runtime/display-names-data-manifest.json",
  JSON.stringify(
    {
      archiveSha256,
      locales: available,
      inputs: [...new Map(inputs.map((i) => [i.path, i])).values()],
      outputSha256: hash(new TextEncoder().encode(formatted)),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `wrote ${target}: ${tables.map((t) => t.split("\n").length).join(",")} rows`,
);
