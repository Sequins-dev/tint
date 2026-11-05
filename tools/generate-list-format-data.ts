import { xmlText, attributes } from "./cldr-xml.ts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { canonicalizeLocaleId } from "../packages/js-runtime/src/objects/locale-canonicalization.ts";
import { maximizeLocaleId } from "../packages/js-runtime/src/objects/locale-likely.ts";

const archive = process.argv[2];
if (archive === undefined)
  throw new Error(
    "Usage: node tools/generate-list-format-data.ts CLDR49.zip [UnicodeData17.txt]",
  );
const archiveSha256 =
  "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89";
const unicodeSha256 =
  "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c";
const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
if (digest(readFileSync(archive)) !== archiveSha256)
  throw new Error("CLDR49 archive checksum mismatch");
const inputs: { path: string; sha256: string }[] = [];
function member(path: string): string {
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive!, path], {
    maxBuffer: 16 * 1024 * 1024,
  });
  inputs.push({ path, sha256: digest(bytes) });
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/<!--[\s\S]*?-->/g, "");
}
const parents = new Map<string, string>();
const supplemental = member("common/supplemental/supplementalData.xml");
for (const block of supplemental.matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const match of block[2]!.matchAll(/<parentLocale\b([^>]+)\/>/g)) {
    const row = attributes(match[1]!),
      parent = row.get("parent")!;
    for (const locale of row.get("locales")!.trim().split(/\s+/))
      parents.set(
        locale.replaceAll("_", "-").toLowerCase(),
        parent.replaceAll("_", "-").toLowerCase(),
      );
  }
}
interface RawPattern {
  readonly alias: string | undefined;
  readonly parts: ReadonlyMap<string, string>;
}
const raw = new Map<string, Map<string, RawPattern>>(),
  groups = new Map<string, string>();
const paths = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
})
  .split("\n")
  .filter((path) => /^common\/main\/[^/]+\.xml$/.test(path))
  .sort();
for (const path of paths) {
  const text = member(path),
    locale = path
      .slice("common/main/".length, -4)
      .replaceAll("_", "-")
      .toLowerCase();
  if (/<\/identity>\s*<alias\b/.test(text))
    throw new Error("Unsupported whole-locale alias: " + locale);
  const patterns = new Map<string, RawPattern>();
  const block =
    /<listPatterns>([\s\S]*?)<\/listPatterns>/.exec(text)?.[1] ?? "";
  for (const match of block.matchAll(
    /<listPattern\b([^>]*)>([\s\S]*?)<\/listPattern>/g,
  )) {
    const kind = attributes(match[1]!).get("type") ?? "standard",
      body = match[2]!;
    const alias = /<alias\b([^>]+)\/>/.exec(body);
    const parts = new Map<string, string>();
    for (const part of body.matchAll(
      /<listPatternPart\b([^>]+)>([\s\S]*?)<\/listPatternPart>/g,
    ))
      parts.set(attributes(part[1]!).get("type")!, xmlText(part[2]!));
    let target: string | undefined;
    if (alias !== null) {
      const row = attributes(alias[1]!);
      const parsed = /^\.\.\/listPattern(?:\[@type='([^']+)'\])?$/.exec(
        row.get("path")!,
      );
      if (row.get("source") !== "locale" || parsed === null || parts.size !== 0)
        throw new Error("Unsupported list-pattern alias");
      target = parsed[1] ?? "standard";
    }
    patterns.set(kind, { alias: target, parts });
  }
  raw.set(locale, patterns);
  const symbols =
    /<symbols\b[^>]*numberSystem="latn"[^>]*>([\s\S]*?)<\/symbols>/.exec(
      text,
    )?.[1];
  const group =
    symbols === undefined
      ? undefined
      : /<group\b[^>]*>([\s\S]*?)<\/group>/.exec(symbols)?.[1];
  if (group !== undefined && group !== "↑↑↑")
    groups.set(locale, xmlText(group));
}
function parent(locale: string): string {
  return (
    parents.get(locale) ??
    (locale.includes("-") ? locale.slice(0, locale.lastIndexOf("-")) : "root")
  );
}
function chain(locale: string): string[] {
  const seen = new Set<string>(),
    result: string[] = [];
  for (let key = locale; ; key = parent(key)) {
    if (seen.has(key)) throw new Error("CLDR parent cycle: " + key);
    seen.add(key);
    result.push(key);
    if (key === "root") return result;
  }
}
function resolve(
  locale: string,
  kind: string,
  part: string,
  seen: ReadonlySet<string> = new Set(),
): string {
  const state = locale + "|" + kind + "|" + part;
  if (seen.has(state)) throw new Error("List-pattern alias cycle");
  for (const ancestor of chain(locale)) {
    const source = raw.get(ancestor)?.get(kind),
      value = source?.parts.get(part);
    if (value !== undefined && value !== "↑↑↑") return value;
    if (source?.alias !== undefined)
      return resolve(locale, source.alias, part, new Set([...seen, state]));
  }
  throw new Error("Missing list pattern: " + state);
}
const available = [...raw.keys()]
  .filter(
    (locale) =>
      locale !== "root" &&
      chain(locale).some(
        (key) => key !== "root" && (raw.get(key)?.size ?? 0) > 0,
      ),
  )
  .sort();
const aliases = new Map(available.map((locale) => [locale, locale]));
function addAlias(locale: string, source: string): void {
  if (aliases.has(locale)) return;
  let preferred = maximizeLocaleId(locale)?.toLowerCase() ?? locale;
  while (!aliases.has(preferred) && preferred.includes("-"))
    preferred = preferred.slice(0, preferred.lastIndexOf("-"));
  aliases.set(locale, aliases.get(preferred) ?? source);
}
for (const locale of available) {
  const fields = locale.split("-");
  if (
    fields.length >= 3 &&
    fields[1]!.length === 4 &&
    (fields[2]!.length === 2 || fields[2]!.length === 3)
  )
    addAlias([fields[0], ...fields.slice(2)].join("-"), locale);
  if (fields.length > 1) addAlias(fields[0]!, locale);
}
const kinds = [
    "standard",
    "standard-short",
    "standard-narrow",
    "or",
    "or-short",
    "or-narrow",
    "unit",
    "unit-short",
    "unit-narrow",
  ],
  parts = ["2", "start", "middle", "end"];
const strings: string[] = [],
  profiles: string[] = [],
  patternIds = new Map<string, number>(),
  profileIds = new Map<string, number>(),
  locales = new Map<string, string>();
function validatePattern(text: string, part: string): void {
  const zero = text.indexOf("{0}"),
    one = text.indexOf("{1}");
  const remainder = text.replaceAll("{0}", "").replaceAll("{1}", "");
  if (
    zero < 0 ||
    one < zero ||
    text.split("{0}").length !== 2 ||
    text.split("{1}").length !== 2 ||
    remainder.includes("{") ||
    remainder.includes("}") ||
    text.includes("\n")
  )
    throw new Error("Unsupported list-pattern placeholders");
  if (
    ((part === "start" || part === "middle") && one + 3 !== text.length) ||
    ((part === "middle" || part === "end") && zero !== 0)
  )
    throw new Error("Unsupported list-pattern linearization shape");
}
for (const [locale, source] of [...aliases].sort(([a], [b]) =>
  a < b ? -1 : a > b ? 1 : 0,
)) {
  if (canonicalizeLocaleId(locale)?.toLowerCase() !== locale)
    throw new Error("Noncanonical service locale: " + locale);
  const ids = kinds.flatMap((kind) =>
    parts.map((part) => {
      const value = resolve(source, kind, part);
      validatePattern(value, part);
      let id = patternIds.get(value);
      if (id === undefined) {
        id = strings.length;
        strings.push(value);
        patternIds.set(value, id);
      }
      return id;
    }),
  );
  const key = ids.join(",");
  let profile = profileIds.get(key);
  if (profile === undefined) {
    profile = profiles.length;
    profiles.push(key);
    profileIds.set(key, profile);
  }
  locales.set(locale, String(profile));
}
const grouping = new Map<string, string>();
for (const [locale, source] of aliases) {
  if (locale !== "es" && !locale.startsWith("es-")) continue;
  const group = chain(source)
    .map((key) => groups.get(key))
    .find((value) => value !== undefined);
  if (group === undefined) throw new Error("Missing Spanish grouping data");
  grouping.set(locale, group);
}
const unicodePath = process.argv[3],
  unicodeUrl = "https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt";
const response =
  unicodePath === undefined ? await fetch(unicodeUrl) : undefined;
if (response !== undefined && !response.ok)
  throw new Error("UnicodeData: HTTP " + response.status);
const unicode =
  unicodePath === undefined
    ? new Uint8Array(await response!.arrayBuffer())
    : readFileSync(unicodePath);
if (digest(unicode) !== unicodeSha256)
  throw new Error("Unicode17 data checksum mismatch");
const decomposition = new Map<number, readonly number[]>();
for (const line of new TextDecoder().decode(unicode).split("\n")) {
  const fields = line.split(";"),
    mapping = fields[5];
  if (mapping && !mapping.startsWith("<"))
    decomposition.set(
      parseInt(fields[0]!, 16),
      mapping.split(" ").map((point) => parseInt(point, 16)),
    );
}
function nfd(point: number, seen: ReadonlySet<number> = new Set()): number[] {
  if (seen.has(point)) throw new Error("Canonical decomposition cycle");
  return (
    decomposition
      .get(point)
      ?.flatMap((value) => nfd(value, new Set([...seen, point]))) ?? [point]
  );
}
const prefixes = new Map<string, string>();
for (const point of decomposition.keys()) {
  const points = nfd(point);
  if ("hHiIoOaAeE".includes(String.fromCodePoint(points[0]!)))
    prefixes.set(String(point), String.fromCodePoint(...points));
}
if (
  raw.size !== 929 ||
  available.length !== 709 ||
  locales.size !== 749 ||
  profiles.length !== 173 ||
  strings.length !== 329 ||
  prefixes.size !== 223 ||
  !locales.has("en") ||
  locales.has("zxx")
)
  throw new Error("Unexpected CLDR ListFormat dataset population");
let output =
  "// Generated by tools/generate-list-format-data.ts; do not edit.\n// CLDR49 archive SHA-256 " +
  archiveSha256 +
  "\n// Unicode17 UnicodeData SHA-256 " +
  unicodeSha256 +
  "\n// Unicode licenses: ../../LICENSE-CLDR.txt and ../../LICENSE-UNICODE.txt\n";
function table(name: string, rows: ReadonlyMap<string, string>): void {
  const encoded = [...rows]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => {
      if (key.includes("\n") || value.includes("\n"))
        throw new Error("Unrepresentable table row");
      return key + "|" + value;
    })
    .join("\n");
  output += "export const " + name + " = " + JSON.stringify(encoded) + ";\n";
}
table("listFormatLocales", locales);
table(
  "listFormatPatterns",
  new Map(strings.map((value, index) => [String(index), value])),
);
table(
  "listFormatProfiles",
  new Map(profiles.map((value, index) => [String(index), value])),
);
table("listFormatSpanishGrouping", grouping);
table("listFormatCanonicalPrefixes", prefixes);
output = await format(output, { parser: "typescript" });
writeFileSync("packages/js-runtime/src/objects/list-format-data.ts", output);
writeFileSync(
  "packages/js-runtime/list-format-data-manifest.json",
  JSON.stringify(
    {
      cldrVersion: "49",
      archiveUrl: "https://unicode.org/Public/cldr/49/core.zip",
      archiveSha256,
      inputs,
      unicode: { url: unicodeUrl, sha256: unicodeSha256, version: "17.0.0" },
      counts: {
        mainFiles: raw.size,
        availableLocales: locales.size,
        profiles: profiles.length,
        patterns: strings.length,
        canonicalPrefixes: prefixes.size,
      },
      policies: {
        defaultLocale: "en",
        bestFit: "lookup",
        supported:
          "Actual non-root patterns plus required structural service-locale closure",
        normalization:
          "Only canonical prefix decompositions rooted at ASCII hHiIoOaAeE; no compatibility decomposition",
      },
      outputSha256: digest(new TextEncoder().encode(output)),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Generated ListFormat data: 749 locales, 173 profiles, 329 patterns, 223 canonical prefixes.",
);
