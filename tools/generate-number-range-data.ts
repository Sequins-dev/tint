import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { canonicalizeLocaleId } from "../packages/js-runtime/src/objects/locale-canonicalization.ts";
import {
  numberFormatLocaleRows,
  numberingSystemDigits,
} from "../packages/js-runtime/src/objects/number-format-data.ts";

const archive = process.argv[2];
if (archive === undefined)
  throw new Error("Usage: node tools/generate-number-range-data.ts CLDR49.zip");
const archiveSha256 =
  "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89";
const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
if (digest(readFileSync(archive)) !== archiveSha256)
  throw new Error("CLDR49 archive checksum mismatch");
const numericManifestPath =
  "packages/js-runtime/number-format-data-manifest.json";
const numericManifestBytes = readFileSync(numericManifestPath);
const numericManifest: {
  readonly version: string;
  readonly archive: { readonly sha256: string };
  readonly aliases: readonly {
    readonly locale: string;
    readonly source: string;
  }[];
  readonly output: { readonly path: string; readonly sha256: string };
} = JSON.parse(new TextDecoder().decode(numericManifestBytes));
if (
  numericManifest.version !== "49" ||
  numericManifest.archive.sha256 !== archiveSha256 ||
  digest(readFileSync(numericManifest.output.path)) !==
    numericManifest.output.sha256
)
  throw new Error("Numeric locale registry provenance mismatch");
const aliases = new Map(
  numericManifest.aliases.map((row) => [row.locale, row.source]),
);
const inputs: { readonly path: string; readonly sha256: string }[] = [];
function member(path: string): string {
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive!, path], {
    maxBuffer: 16 * 1024 * 1024,
  });
  inputs.push({ path, sha256: digest(bytes) });
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/<!--[\s\S]*?-->/g, "");
}
function text(value: string): string {
  const entity = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g;
  if (value.replace(entity, "").includes("&") || value.includes("<"))
    throw new Error("Unsupported XML text markup");
  return value.replace(entity, (e) => {
    if (e === "&amp;") return "&";
    if (e === "&lt;") return "<";
    if (e === "&gt;") return ">";
    if (e === "&quot;") return '"';
    if (e === "&apos;") return "'";
    const point = e.startsWith("&#x")
      ? parseInt(e.slice(3, -1), 16)
      : Number(e.slice(2, -1));
    if (
      !Number.isInteger(point) ||
      point < 0 ||
      point > 0x10ffff ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      throw new Error("Invalid XML character reference");
    return String.fromCodePoint(point);
  });
}
function attributes(value: string): Map<string, string> {
  return new Map(
    [...value.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((m) => [
      m[1]!,
      text(m[2]!),
    ]),
  );
}
function tag(locale: string): string {
  if (locale === "root") return locale;
  const value = canonicalizeLocaleId(locale.replaceAll("_", "-"));
  if (value === undefined) throw new Error("Invalid CLDR locale: " + locale);
  return value.toLowerCase();
}
const parents = new Map<string, string>();
for (const block of member("common/supplemental/supplementalData.xml").matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const row of block[2]!.matchAll(/<parentLocale\b([^>]*)\/>/g)) {
    const attrs = attributes(row[1]!),
      parent = attrs.get("parent"),
      locales = attrs.get("locales");
    if (parent === undefined || locales === undefined)
      throw new Error("Unsupported parent locale declaration");
    for (const locale of locales.trim().split(/\s+/))
      parents.set(tag(locale), tag(parent));
  }
}
interface RawRange {
  readonly separator: string | undefined;
  readonly alias: string | undefined;
}
const raw = new Map<string, ReadonlyMap<string, RawRange>>();
const paths = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
})
  .split("\n")
  .filter((path) => /^common\/main\/[^/]+\.xml$/.test(path))
  .sort();
for (const path of paths) {
  const xml = member(path),
    locale = tag(path.slice("common/main/".length, -4));
  const containers = new Map<string, RawRange>();
  for (const block of xml.matchAll(
    /<miscPatterns\b([^>]*)>([\s\S]*?)<\/miscPatterns>/g,
  )) {
    const system = attributes(block[1]!).get("numberSystem");
    if (system === undefined)
      throw new Error("Missing miscellaneous numbering system");
    let separator: string | undefined, alias: string | undefined;
    const leading = /^\s*<alias\b([^>]*)\/>\s*$/.exec(block[2]!);
    if (leading !== null) {
      const attrs = attributes(leading[1]!),
        match = /^\.\.\/miscPatterns\[@numberSystem='([a-z0-9]+)'\]$/.exec(
          attrs.get("path") ?? "",
        );
      if (attrs.get("source") !== "locale" || match === null)
        throw new Error("Unsupported range container alias");
      alias = match[1];
    } else {
      for (const row of block[2]!.matchAll(
        /<pattern\b([^>]*)>([^<]*)<\/pattern>/g,
      )) {
        const attrs = attributes(row[1]!);
        if (attrs.has("alt") || attrs.get("type") !== "range") continue;
        const pattern = text(row[2]!);
        if (pattern === "↑↑↑") continue;
        if (!/^\{0\}[^{}]+\{1\}$/.test(pattern) || /[\t\r\n|]/.test(pattern))
          throw new Error("Unsupported number range pattern");
        if (separator !== undefined) throw new Error("Duplicate range pattern");
        separator = pattern.slice(3, -3);
      }
    }
    if (containers.has(system)) throw new Error("Duplicate range container");
    containers.set(system, { separator, alias });
  }
  if (raw.has(locale)) throw new Error("Duplicate canonical range locale");
  raw.set(locale, containers);
}
function chain(locale: string): string[] {
  const out: string[] = [],
    seen = new Set<string>();
  while (true) {
    if (seen.has(locale)) throw new Error("Number range parent cycle");
    seen.add(locale);
    out.push(locale);
    if (locale === "root") return out;
    locale =
      parents.get(locale) ??
      (locale.includes("-")
        ? locale.slice(0, locale.lastIndexOf("-"))
        : "root");
  }
}
const cache = new Map<string, string>();
function separator(
  locale: string,
  system: string,
  seen: ReadonlySet<string> = new Set(),
): string {
  const key = locale + ":" + system;
  if (seen.has(key)) throw new Error("Number range alias cycle");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  for (const ancestor of chain(locale)) {
    const row = raw.get(ancestor)?.get(system);
    if (row?.separator !== undefined) {
      cache.set(key, row.separator);
      return row.separator;
    }
    if (row?.alias !== undefined) {
      const resolved = separator(locale, row.alias, new Set([...seen, key]));
      cache.set(key, resolved);
      return resolved;
    }
  }
  throw new Error("Missing number range: " + key);
}
function owner(locale: string): string {
  const seen = new Set<string>();
  while (aliases.has(locale)) {
    if (seen.has(locale)) throw new Error("Number range registry owner cycle");
    seen.add(locale);
    locale = aliases.get(locale)!;
  }
  if (!raw.has(locale)) throw new Error("Missing numeric locale owner");
  return locale;
}
function table(rows: ReadonlyMap<string, string>): string {
  return [...rows]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => key + "|" + value)
    .join("\n");
}
const systems = numberingSystemDigits
  .split("\n")
  .map((row) => row.slice(0, row.indexOf("|")));
const separators: string[] = [],
  bindings: string[] = [],
  locales = new Map<string, string>();
// Validate all raw locale/system pairs, including rows excluded from availability.
for (const locale of raw.keys())
  for (const system of systems) separator(locale, system);
for (const row of numberFormatLocaleRows.split("\n")) {
  const locale = row.slice(0, row.indexOf("|")),
    source = owner(locale);
  const encoded = systems
    .map((system) => {
      const value = separator(source, system);
      let id = separators.indexOf(value);
      if (id < 0) {
        id = separators.length;
        separators.push(value);
      }
      return system + "," + id;
    })
    .join(";");
  let binding = bindings.indexOf(encoded);
  if (binding < 0) {
    binding = bindings.length;
    bindings.push(encoded);
  }
  locales.set(locale, source + "," + binding);
}
if (
  raw.size !== 929 ||
  systems.length !== 78 ||
  locales.size !== 860 ||
  aliases.size !== 46 ||
  parents.size !== 198 ||
  separators.length !== 10
)
  throw new Error("Unexpected CLDR49 numeric range population");
const sourcePath = "packages/js-runtime/src/objects/number-range-data.ts";
const source = await format(
  "// Generated by tools/generate-number-range-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n// https://unicode.org/Public/cldr/49/core.zip\n// Archive SHA256: " +
    archiveSha256 +
    "\n" +
    [
      [
        "numberRangeSeparators",
        table(new Map(separators.map((value, id) => [String(id), value]))),
      ],
      [
        "numberRangeBindings",
        table(new Map(bindings.map((value, id) => [String(id), value]))),
      ],
      ["numberRangeLocales", table(locales)],
    ]
      .map(
        ([name, value]) =>
          "export const " + name + " = " + JSON.stringify(value) + ";\n",
      )
      .join(""),
  { parser: "typescript" },
);
writeFileSync(sourcePath, source);
writeFileSync(
  "packages/js-runtime/number-range-data-manifest.json",
  JSON.stringify(
    {
      kind: "cldr-number-range-data",
      version: "49",
      archive: {
        url: "https://unicode.org/Public/cldr/49/core.zip",
        sha256: archiveSha256,
      },
      license: "LICENSE-CLDR.txt",
      inputs,
      registry: {
        manifest: numericManifestPath,
        sha256: digest(numericManifestBytes),
        source: numericManifest.output,
      },
      policy: {
        availability:
          "Exactly the existing numeric locale/system registry; structural aliases retain their original numeric data owner.",
        rendering:
          "Standard decimal ranges with no CollapseNumberRange; range separators preserve pinned CLDR text; approximation uses numeric symbols.",
      },
      counts: {
        mainLocales: raw.size,
        numericSystems: systems.length,
        rawLocaleSystemPairs: raw.size * systems.length,
        availableLocales: locales.size,
        advertisedLocaleSystemPairs: locales.size * systems.length,
        structuralAliases: aliases.size,
        parentOverrides: parents.size,
        separators: separators.length,
        bindingMaps: bindings.length,
      },
      output: {
        path: sourcePath,
        sha256: digest(new TextEncoder().encode(source)),
      },
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(
  JSON.stringify({
    locales: locales.size,
    systems: systems.length,
    separators: separators.length,
    bindings: bindings.length,
  }) + "\n",
);
