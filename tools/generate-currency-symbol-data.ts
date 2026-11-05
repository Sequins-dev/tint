import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { canonicalizeLocaleId } from "../packages/js-runtime/src/objects/locale-canonicalization.ts";

const archive = process.argv[2];
if (archive === undefined)
  throw new Error(
    "Usage: node tools/generate-currency-symbol-data.ts CLDR49.zip",
  );
const archiveSha256 =
  "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89";
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
function xmlText(text: string): string {
  const entities = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/g;
  if (text.replace(entities, "").includes("&") || text.includes("<"))
    throw new Error("Unsupported XML text markup");
  return text.replace(entities, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const point = entity.startsWith("&#x")
      ? parseInt(entity.slice(3, -1), 16)
      : Number(entity.slice(2, -1));
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
function attributes(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/([A-Za-z][A-Za-z0-9]*)="([^"]*)"/g)].map((m) => [
      m[1]!,
      xmlText(m[2]!),
    ]),
  );
}
function tag(locale: string): string {
  if (locale === "root") return locale;
  const canonical = canonicalizeLocaleId(locale.replaceAll("_", "-"));
  if (canonical === undefined) throw new Error("Invalid CLDR locale " + locale);
  return canonical.toLowerCase();
}
function table(rows: ReadonlyMap<string, string>): string {
  return [...rows]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([a, b]) => a + "|" + b)
    .join("\n");
}
const numericManifestPath =
  "packages/js-runtime/number-format-data-manifest.json";
const numericManifestBytes = readFileSync(numericManifestPath);
const numericManifest = JSON.parse(
  new TextDecoder().decode(numericManifestBytes),
) as {
  aliases: { locale: string; source: string }[];
  output: { path: string; sha256: string };
};
if (
  digest(readFileSync(numericManifest.output.path)) !==
  numericManifest.output.sha256
)
  throw Error("Numeric registry output checksum mismatch");
const parents = new Map<string, string>();
for (const block of member("common/supplemental/supplementalData.xml").matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const row of block[2]!.matchAll(/<parentLocale\b([^>]*)\/>/g)) {
    const attrs = attributes(row[1]!);
    const parent = attrs.get("parent"),
      locales = attrs.get("locales");
    if (parent === undefined || locales === undefined)
      throw Error("Invalid general currency parent");
    for (const locale of locales.trim().split(/\s+/))
      parents.set(tag(locale), tag(parent));
  }
}
const fields = new Map<string, string>();
const paths = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
})
  .split("\n")
  .filter((path) => /^common\/main\/[^/]+\.xml$/.test(path))
  .sort();
let ordinary = 0,
  narrow = 0,
  inherited = 0,
  excluded = 0,
  spacingContainers = 0;
for (const path of paths) {
  const xml = member(path),
    locale = tag(path.slice("common/main/".length, -4));
  for (const container of xml.matchAll(
    /<currencyFormats\b([^>]*)>([\s\S]*?)<\/currencyFormats>/g,
  )) {
    const spacing = /<currencySpacing>([\s\S]*?)<\/currencySpacing>/.exec(
      container[2]!,
    );
    if (spacing === null) continue;
    spacingContainers++;
    const system = attributes(container[1]!).get("numberSystem");
    if (locale !== "root") throw Error("Unsupported nonroot currency spacing");
    if (system === "arab") {
      const alias = /^\s*<alias\b([^>]*)\/>\s*$/.exec(spacing[1]!);
      if (alias === null) throw Error("Unsupported Arabic currency spacing");
      const attrs = attributes(alias[1]!);
      if (
        attrs.get("source") !== "locale" ||
        attrs.get("path") !==
          "../../currencyFormats[@numberSystem='latn']/currencySpacing"
      )
        throw Error("Unsupported Arabic spacing alias");
    } else if (system === "latn") {
      for (const direction of ["beforeCurrency", "afterCurrency"]) {
        const branch = new RegExp(
          "<" + direction + ">([\\s\\S]*?)</" + direction + ">",
        ).exec(spacing[1]!);
        if (branch === null) throw Error("Missing currency spacing direction");
        const fields = new Map(
          [
            ...branch[1]!.matchAll(
              /<(currencyMatch|surroundingMatch|insertBetween)>([^<]*)<\/\1>/g,
            ),
          ].map((field) => [field[1]!, xmlText(field[2]!)]),
        );
        if (
          fields.size !== 3 ||
          fields.get("currencyMatch") !== "[[:^S:]&[:^Z:]]" ||
          fields.get("surroundingMatch") !== "[:digit:]" ||
          fields.get("insertBetween") !== "\u00a0"
        )
          throw Error("Unsupported currency spacing rules");
      }
    } else throw Error("Unsupported currency spacing system");
  }
  const body = /<currencies>([\s\S]*?)<\/currencies>/.exec(xml)?.[1] ?? "";
  if (/<alias\b/.test(body)) throw Error("Unsupported currency alias: " + path);
  for (const currency of body.matchAll(
    /<currency\b([^>]*)>([\s\S]*?)<\/currency>/g,
  )) {
    const code = attributes(currency[1]!).get("type");
    if (code === undefined || !/^[A-Z]{3}$/.test(code))
      throw Error("Invalid currency code");
    for (const symbol of currency[2]!.matchAll(
      /<symbol\b([^>]*)>([^<]*)<\/symbol>/g,
    )) {
      const attrs = attributes(symbol[1]!),
        alt = attrs.get("alt");
      if ((alt !== undefined && alt !== "narrow") || attrs.has("case")) {
        excluded++;
        continue;
      }
      const value = xmlText(symbol[2]!);
      if (value === "↑↑↑") {
        inherited++;
        continue;
      }
      if (/[|\r\n]/.test(value) || value === "")
        throw Error("Invalid currency symbol field");
      const key = locale + ":" + code + ":" + (alt === "narrow" ? "n" : "s");
      if (fields.has(key)) throw Error("Duplicate currency field " + key);
      fields.set(key, value);
      if (alt === "narrow") narrow++;
      else ordinary++;
    }
  }
}
import { numberFormatLocaleRows } from "../packages/js-runtime/src/objects/number-format-data.ts";
const aliases = new Map(
  numericManifest.aliases.map((row) => [row.locale, row.source]),
);
const owners = new Map(
  numberFormatLocaleRows.split("\n").map((row) => {
    const locale = row.slice(0, row.indexOf("|"));
    return [locale, aliases.get(locale) ?? locale];
  }),
);
if (
  spacingContainers !== 2 ||
  paths.length !== 929 ||
  ordinary !== 2065 ||
  narrow !== 793 ||
  owners.size !== 860 ||
  parents.size !== 198
)
  throw Error(
    "Unexpected pinned currency population: " +
      JSON.stringify({
        main: paths.length,
        ordinary,
        narrow,
        owners: owners.size,
        parents: parents.size,
      }),
  );
const sourcePath = "packages/js-runtime/src/objects/currency-symbol-data.ts";
const output = await format(
  "// Generated by tools/generate-currency-symbol-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n// https://unicode.org/Public/cldr/49/core.zip\n// Archive SHA256: " +
    archiveSha256 +
    "\n" +
    [
      ["currencySymbolFields", table(fields)],
      ["currencySymbolOwners", table(owners)],
      ["currencySymbolParents", table(parents)],
    ]
      .map(
        ([name, value]) =>
          "export const " + name + " = " + JSON.stringify(value) + ";\n",
      )
      .join(""),
  { parser: "typescript" },
);
writeFileSync(sourcePath, output);
const manifest = {
  kind: "cldr-currency-symbol-data",
  version: "49",
  archive: {
    url: "https://unicode.org/Public/cldr/49/core.zip",
    sha256: archiveSha256,
  },
  license: "LICENSE-CLDR.txt",
  inputs,
  numericRegistry: {
    path: numericManifestPath,
    sha256: digest(numericManifestBytes),
  },
  policy: {
    grades: "All pinned CLDR draft grades retained.",
    fields:
      "Ordinary symbol and alt=narrow only; formal/variant and case alternatives excluded. Inheritance markers omitted.",
    fallback:
      "Per-field general-parent ancestry from the numeric-service alias source owner. Narrow falls back to ordinary, then caller's canonical code. Unknown service locales return code.",
    cash: "No cash metadata or currency names.",
    spacing:
      "Exactly root latn beforeCurrency/afterCurrency: currencyMatch=[[:^S:]&[:^Z:]], surroundingMatch=[:digit:], insertBetween=NBSP; root arab aliases latn. No other raw spacing containers.",
  },
  counts: {
    spacingContainers,
    mainLocales: paths.length,
    ordinaryFields: ordinary,
    narrowFields: narrow,
    symbolFields: fields.size,
    availableLocales: owners.size,
    parentOverrides: parents.size,
    inheritedMarkers: inherited,
    excludedFields: excluded,
  },
  output: {
    path: sourcePath,
    sha256: digest(new TextEncoder().encode(output)),
  },
};
writeFileSync(
  "packages/js-runtime/currency-symbol-data-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest.counts));
