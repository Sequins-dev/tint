import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  lookupPluralLocale,
  pluralCompactExponent,
  createFormattedPluralOperands,
} from "../src/objects/plural-compact.ts";
import {
  pluralServiceLocales,
  pluralCompactProfiles,
} from "../src/objects/plural-compact-data.ts";
import {
  createPluralRuleSet,
  selectPluralCategory,
} from "../src/objects/plural-rules.ts";

test("plural compact metadata uses actual Japanese magnitude thresholds", () => {
  assert.equal(lookupPluralLocale("ja-JP"), "ja-JP");
  assert.equal(pluralCompactExponent("ja", "short", 3), 0);
  assert.equal(pluralCompactExponent("ja", "long", 4), 4);
});

function table(text: string): Map<string, string> {
  return new Map(
    text.split("\n").map((row) => {
      const split = row.indexOf("|");
      return [row.slice(0, split), row.slice(split + 1)];
    }),
  );
}
function referenceExponent(
  profile: string,
  style: string,
  magnitude: number,
): number {
  const values = profile.split("|")[style === "short" ? 0 : 1];
  assert.ok(values);
  const row = values
    .split(";")
    .map((x) => x.split(",").map(Number))
    .filter((x) => x[0]! <= magnitude)
    .at(-1);
  return row?.[1] ?? 0;
}

test("available locales and complete profiles match an independent XML parser's CLDR49 extraction", () => {
  const expected = table(referenceLocales),
    profiles = table(referenceProfiles),
    actual = table(pluralServiceLocales),
    actualProfiles = table(pluralCompactProfiles);
  assert.equal(expected.size, 820);
  assert.equal(actual.size, 820);
  assert.equal(profiles.size, 23);
  assert.equal(actualProfiles.size, 23);
  for (const [tag, id] of expected) {
    assert.equal(lookupPluralLocale(tag), tag, tag);
    const generatedId = actual.get(tag.toLowerCase()),
      profile = profiles.get(id);
    assert.ok(generatedId !== undefined && profile !== undefined);
    assert.equal(actualProfiles.get(generatedId), profile, tag);
    for (const style of ["short", "long"] as const)
      for (const magnitude of [
        -400, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
        18, 19, 20, 100, 1_000_000_000,
      ])
        assert.equal(
          pluralCompactExponent(tag, style, magnitude),
          referenceExponent(profile, style, magnitude),
          tag + ":" + style + ":" + magnitude,
        );
  }
});

test("locale lookup strips actual Unicode extensions and handles RFC4647 singleton truncation", () => {
  assert.equal(lookupPluralLocale("en-US-u-nu-thai"), "en-US");
  assert.equal(
    lookupPluralLocale("fr-CA-a-test-u-ca-gregory-x-u-foo"),
    "fr-CA",
  );
  assert.equal(lookupPluralLocale("en-x-u-foo"), "en");
  assert.equal(lookupPluralLocale("zh-TW"), "zh-TW");
  assert.equal(lookupPluralLocale("zxx"), undefined);
  assert.equal(lookupPluralLocale("zz-ZZ"), undefined);
  assert.equal(lookupPluralLocale("und"), undefined);
});

test("compact thresholds retain distinct long/short and requested-locale sideways inheritance", () => {
  assert.equal(pluralCompactExponent("hi", "short", 13), 13);
  assert.equal(pluralCompactExponent("hi", "long", 13), 11);
  assert.equal(pluralCompactExponent("hi-Latn", "short", 9), 7);
  assert.equal(pluralCompactExponent("hi", "short", 9), 9);
  assert.equal(pluralCompactExponent("ja", "long", 8), 8);
  assert.equal(pluralCompactExponent("en", "long", 100), 12);
  assert.equal(pluralCompactExponent("zh", "short", 3), 0);
});

test("formatted full decimals keep exact operands when compact metadata is attached", () => {
  const operands = createFormattedPluralOperands("-001200.0500", 3);
  assert.deepEqual(operands, {
    i: "1200",
    integerZeroes: 0,
    f: "500",
    t: "5",
    v: 4,
    w: 2,
    c: 3,
    e: 3,
    fractional: true,
  });
  const rules = createPluralRuleSet("fr", "cardinal"),
    standard = createFormattedPluralOperands("1500000", 0),
    compact = createFormattedPluralOperands("1500000", 6);
  assert.ok(rules && standard && compact);
  assert.equal(compact.i, "1500000");
  assert.equal(compact.integerZeroes, 0);
  assert.equal(selectPluralCategory(rules, standard), "other");
  assert.equal(selectPluralCategory(rules, compact), "many");
  assert.deepEqual(createFormattedPluralOperands("1.00", 0), {
    i: "1",
    integerZeroes: 0,
    f: "0",
    t: "0",
    v: 2,
    w: 0,
    c: 0,
    e: 0,
    fractional: false,
  });
});

test("invalid displayed decimals and compact metadata fail explicitly", () => {
  for (const text of ["", "NaN", "Infinity", "1e6", ".1"])
    assert.equal(createFormattedPluralOperands(text, 0), undefined);
  for (const exponent of [-1, 0.5, NaN, Infinity])
    assert.equal(createFormattedPluralOperands("1", exponent), undefined);
  assert.throws(() => pluralCompactExponent("zxx", "short", 3));
  for (const magnitude of [NaN, Infinity, 0.5])
    assert.throws(() => pluralCompactExponent("en", "short", magnitude));
});

test("generated compact data pins every interpreted XML input and meaningful exceptions", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../plural-compact-data-manifest.json", import.meta.url),
      "utf8",
    ),
  ) as {
    inputs: readonly { path: string; sha256: string }[];
    counts: {
      mainLocales: number;
      rawPatterns: number;
      profiles: number;
      availableLocales: number;
      formatParentOverrides: number;
      pluralParentOverrides: number;
    };
    literalForms: readonly unknown[];
    categoryDifferences: readonly unknown[];
    numberingSystemDifferences: readonly unknown[];
    output: { sha256: string };
  };
  const source = readFileSync(
    new URL("../src/objects/plural-compact-data.ts", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.output.sha256,
  );
  assert.equal(manifest.inputs.length, 932);
  assert.equal(new Set(manifest.inputs.map((x) => x.path)).size, 932);
  assert.equal(
    manifest.inputs.filter((x) => x.path.startsWith("common/main/")).length,
    929,
  );
  for (const input of manifest.inputs)
    assert.match(input.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.counts.rawPatterns, 7059);
  assert.equal(manifest.counts.profiles, 23);
  assert.equal(manifest.counts.availableLocales, 820);
  assert.equal(manifest.counts.formatParentOverrides, 198);
  assert.equal(manifest.counts.pluralParentOverrides, 0);
  assert.equal(manifest.literalForms.length, 6);
  assert.equal(manifest.categoryDifferences.length, 1);
  assert.equal(manifest.numberingSystemDifferences.length, 3);
});

test("already formatted operand attachment preserves all 3907 CLDR rule samples", () => {
  const rows = readFileSync(
    new URL("./fixtures/plural-rule-samples.txt", import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .slice(1);
  assert.equal(rows.length, 3907);
  for (const row of rows) {
    const [type, locale, expected, sample] = row.split("|");
    assert.ok((type === "cardinal" || type === "ordinal") && locale && sample);
    const [source, c = "0"] = sample.split("c");
    assert.ok(source);
    const exponent = Number(c),
      point = source.indexOf("."),
      digits = source.replace(".", ""),
      shifted = (point === -1 ? source.length : point) + exponent;
    const full =
      shifted >= digits.length
        ? digits + "0".repeat(shifted - digits.length)
        : digits.slice(0, shifted) + "." + digits.slice(shifted);
    const operands = createFormattedPluralOperands(full, exponent),
      rules = createPluralRuleSet(locale, type);
    assert.ok(operands && rules);
    assert.equal(selectPluralCategory(rules, operands), expected, row);
  }
});

// Independent ElementTree extraction of the pinned CLDR49 archive. Keeping
// these compressed reference profiles checks the production regex extractor.
const referenceLocales =
  "af|0\naf-NA|0\naf-ZA|0\nak|0\nak-GH|0\nam|0\nam-ET|0\nar|0\nar-001|0\nar-AE|0\nar-BH|0\nar-DJ|0\nar-DZ|0\nar-EG|0\nar-EH|0\nar-ER|0\nar-IL|0\nar-IQ|0\nar-JO|0\nar-KM|0\nar-KW|0\nar-LB|0\nar-LY|0\nar-MA|0\nar-MR|0\nar-OM|0\nar-PS|0\nar-QA|0\nar-SA|0\nar-SD|0\nar-SO|0\nar-SS|0\nar-SY|0\nar-TD|0\nar-TN|0\nar-YE|0\nas|1\nas-IN|1\nasa|0\nasa-TZ|0\nast|0\nast-ES|0\naz|0\naz-AZ|0\naz-Cyrl|0\naz-Cyrl-AZ|0\naz-Latn|0\naz-Latn-AZ|0\nbal|0\nbal-Latn|0\nbal-Latn-PK|0\nbal-PK|0\nbe|0\nbe-BY|0\nbe-tarask|0\nbem|0\nbem-ZM|0\nbez|0\nbez-TZ|0\nbg|0\nbg-BG|0\nbho|0\nbho-IN|0\nblo|0\nblo-BJ|0\nbm|0\nbm-ML|0\nbn|2\nbn-BD|2\nbn-IN|2\nbo|0\nbo-CN|0\nbo-IN|0\nbr|0\nbr-FR|0\nbrx|0\nbrx-IN|0\nbs|0\nbs-BA|0\nbs-Cyrl|3\nbs-Cyrl-BA|3\nbs-Latn|0\nbs-Latn-BA|0\nca|4\nca-AD|4\nca-ES|4\nca-ES-valencia|4\nca-FR|4\nca-IT|4\nce|0\nce-RU|0\nceb|0\nceb-PH|0\ncgg|0\ncgg-UG|0\nchr|0\nchr-US|0\nckb|0\nckb-IQ|0\nckb-IR|0\ncs|0\ncs-CZ|0\ncsw|0\ncsw-CA|0\ncv|0\ncv-RU|0\ncy|0\ncy-GB|0\nda|0\nda-DK|0\nda-GL|0\nde|5\nde-AT|5\nde-BE|5\nde-CH|5\nde-DE|5\nde-IT|5\nde-LI|5\nde-LU|5\ndoi|0\ndoi-IN|0\ndsb|0\ndsb-DE|0\ndz|6\ndz-BT|6\nee|0\nee-GH|0\nee-TG|0\nel|0\nel-CY|0\nel-GR|0\nel-polyton|0\nen|0\nen-001|0\nen-150|0\nen-AE|0\nen-AG|0\nen-AI|0\nen-AS|0\nen-AT|0\nen-AU|0\nen-BB|0\nen-BE|0\nen-BI|0\nen-BM|0\nen-BS|0\nen-BW|0\nen-BZ|0\nen-CA|0\nen-CC|0\nen-CH|0\nen-CK|0\nen-CM|0\nen-CX|0\nen-CY|0\nen-CZ|0\nen-DE|0\nen-DG|0\nen-DK|0\nen-DM|0\nen-EE|0\nen-ER|0\nen-ES|0\nen-FI|0\nen-FJ|0\nen-FK|0\nen-FM|0\nen-FR|0\nen-GB|0\nen-GD|0\nen-GE|0\nen-GG|0\nen-GH|0\nen-GI|0\nen-GM|0\nen-GS|0\nen-GU|0\nen-GY|0\nen-HK|0\nen-HU|0\nen-ID|0\nen-IE|0\nen-IL|0\nen-IM|0\nen-IN|7\nen-IO|0\nen-IT|0\nen-JE|0\nen-JM|0\nen-JP|0\nen-KE|0\nen-KI|0\nen-KN|0\nen-KY|0\nen-LC|0\nen-LR|0\nen-LS|0\nen-LT|0\nen-LV|0\nen-MG|0\nen-MH|0\nen-MO|0\nen-MP|0\nen-MS|0\nen-MT|0\nen-MU|0\nen-MV|0\nen-MW|0\nen-MY|0\nen-NA|0\nen-NF|0\nen-NG|0\nen-NL|0\nen-NO|0\nen-NR|0\nen-NU|0\nen-NZ|0\nen-PG|0\nen-PH|0\nen-PK|0\nen-PL|0\nen-PN|0\nen-PR|0\nen-PT|0\nen-PW|0\nen-RO|0\nen-RW|0\nen-SB|0\nen-SC|0\nen-SD|0\nen-SE|0\nen-SG|0\nen-SH|0\nen-SI|0\nen-SK|0\nen-SL|0\nen-SS|0\nen-SX|0\nen-SZ|0\nen-TC|0\nen-TK|0\nen-TO|0\nen-TT|0\nen-TV|0\nen-TZ|0\nen-UA|0\nen-UG|0\nen-UM|0\nen-US|0\nen-US-posix|0\nen-VC|0\nen-VG|0\nen-VI|0\nen-VU|0\nen-WS|0\nen-ZA|0\nen-ZM|0\nen-ZW|0\neo|0\neo-001|0\nes|4\nes-419|4\nes-AR|4\nes-BO|4\nes-BR|4\nes-BZ|4\nes-CL|4\nes-CO|4\nes-CR|4\nes-CU|4\nes-DO|4\nes-EA|4\nes-EC|4\nes-ES|4\nes-GQ|4\nes-GT|4\nes-HN|4\nes-IC|4\nes-MX|4\nes-NI|4\nes-PA|4\nes-PE|4\nes-PH|4\nes-PR|4\nes-PY|4\nes-SV|4\nes-US|4\nes-UY|4\nes-VE|4\net|0\net-EE|0\neu|8\neu-ES|8\nfa|0\nfa-AF|0\nfa-IR|0\nff|0\nff-Adlm|0\nff-Adlm-BF|0\nff-Adlm-CM|0\nff-Adlm-GH|0\nff-Adlm-GM|0\nff-Adlm-GN|0\nff-Adlm-GW|0\nff-Adlm-LR|0\nff-Adlm-MR|0\nff-Adlm-NE|0\nff-Adlm-NG|0\nff-Adlm-SL|0\nff-Adlm-SN|0\nff-BF|0\nff-CM|0\nff-GH|0\nff-GM|0\nff-GN|0\nff-GW|0\nff-LR|0\nff-Latn|0\nff-Latn-BF|0\nff-Latn-CM|0\nff-Latn-GH|0\nff-Latn-GM|0\nff-Latn-GN|0\nff-Latn-GW|0\nff-Latn-LR|0\nff-Latn-MR|0\nff-Latn-NE|0\nff-Latn-NG|0\nff-Latn-SL|0\nff-Latn-SN|0\nff-MR|0\nff-NE|0\nff-NG|0\nff-SL|0\nff-SN|0\nfi|0\nfi-FI|0\nfil|0\nfil-PH|0\nfo|0\nfo-DK|0\nfo-FO|0\nfr|0\nfr-BE|0\nfr-BF|0\nfr-BI|0\nfr-BJ|0\nfr-BL|0\nfr-CA|0\nfr-CD|0\nfr-CF|0\nfr-CG|0\nfr-CH|0\nfr-CI|0\nfr-CM|0\nfr-DJ|0\nfr-DZ|0\nfr-FR|0\nfr-GA|0\nfr-GF|0\nfr-GN|0\nfr-GP|0\nfr-GQ|0\nfr-HT|0\nfr-KM|0\nfr-LU|0\nfr-MA|0\nfr-MC|0\nfr-MF|0\nfr-MG|0\nfr-ML|0\nfr-MQ|0\nfr-MR|0\nfr-MU|0\nfr-NC|0\nfr-NE|0\nfr-PF|0\nfr-PM|0\nfr-RE|0\nfr-RW|0\nfr-SC|0\nfr-SN|0\nfr-SY|0\nfr-TD|0\nfr-TG|0\nfr-TN|0\nfr-VU|0\nfr-WF|0\nfr-YT|0\nfur|0\nfur-IT|0\nfy|0\nfy-NL|0\nga|0\nga-GB|0\nga-IE|0\ngd|0\ngd-GB|0\ngl|8\ngl-ES|8\ngsw|0\ngsw-CH|0\ngsw-FR|0\ngsw-LI|0\ngu|9\ngu-IN|9\ngv|0\ngv-IM|0\nha|0\nha-GH|0\nha-NE|0\nha-NG|0\nhaw|0\nhaw-US|0\nhe|0\nhe-IL|0\nhi|10\nhi-IN|10\nhi-Latn|7\nhi-Latn-IN|7\nhr|0\nhr-BA|0\nhr-HR|0\nhsb|0\nhsb-DE|0\nhu|0\nhu-HU|0\nhy|0\nhy-AM|0\nia|0\nia-001|0\nid|0\nid-ID|0\nie|0\nie-EE|0\nig|0\nig-NG|0\nii|0\nii-CN|0\nis|0\nis-IS|0\nit|0\nit-CH|0\nit-IT|0\nit-SM|0\nit-VA|0\nja|11\nja-JP|11\njgo|0\njgo-CM|0\njmc|0\njmc-TZ|0\njv|0\njv-ID|0\nka|0\nka-GE|0\nkab|0\nkab-DZ|0\nkde|0\nkde-TZ|0\nkea|0\nkea-CV|0\nkk|0\nkk-Arab|0\nkk-Arab-CN|0\nkk-CN|0\nkk-Cyrl|0\nkk-Cyrl-KZ|0\nkk-KZ|0\nkkj|0\nkkj-CM|0\nkl|0\nkl-GL|0\nkm|0\nkm-KH|0\nkn|0\nkn-IN|0\nko|12\nko-CN|12\nko-KP|12\nko-KR|12\nkok|13\nkok-Deva|13\nkok-Deva-IN|13\nkok-IN|13\nkok-Latn|13\nkok-Latn-IN|13\nks|0\nks-Arab|0\nks-Arab-IN|0\nks-Deva|0\nks-Deva-IN|0\nks-IN|0\nksb|0\nksb-TZ|0\nksh|0\nksh-DE|0\nku|0\nku-IQ|0\nku-Latn|0\nku-Latn-IQ|0\nku-Latn-SY|0\nku-Latn-TR|0\nku-SY|0\nku-TR|0\nkw|0\nkw-GB|0\nky|0\nky-KG|0\nlag|0\nlag-TZ|0\nlb|0\nlb-LU|0\nlg|0\nlg-UG|0\nlij|0\nlij-IT|0\nlkt|0\nlkt-US|0\nlld|0\nlld-IT|0\nln|0\nln-AO|0\nln-CD|0\nln-CF|0\nln-CG|0\nlo|14\nlo-LA|14\nlt|0\nlt-LT|0\nlv|0\nlv-LV|0\nmas|0\nmas-KE|0\nmas-TZ|0\nmg|0\nmg-MG|0\nmgo|0\nmgo-CM|0\nmk|0\nmk-MK|0\nml|0\nml-IN|0\nmn|0\nmn-MN|0\nmr|15\nmr-IN|15\nms|0\nms-BN|0\nms-ID|0\nms-MY|0\nms-SG|0\nmt|0\nmt-MT|0\nmy|16\nmy-MM|16\nnaq|0\nnaq-NA|0\nnb|0\nnb-NO|0\nnb-SJ|0\nnd|0\nnd-ZW|0\nne|17\nne-IN|17\nne-NP|17\nnl|0\nnl-AW|0\nnl-BE|0\nnl-BQ|0\nnl-CW|0\nnl-NL|0\nnl-SR|0\nnl-SX|0\nnn|0\nnn-NO|0\nnnh|0\nnnh-CM|0\nno|0\nnqo|0\nnqo-GN|0\nnso|0\nnso-ZA|0\nnyn|0\nnyn-UG|0\nom|0\nom-ET|0\nom-KE|0\nor|0\nor-IN|0\nos|0\nos-GE|0\nos-RU|0\npa|15\npa-Arab|0\npa-Arab-PK|0\npa-Guru|15\npa-Guru-IN|15\npa-IN|15\npa-PK|0\npcm|0\npcm-NG|0\npl|0\npl-PL|0\nprg|0\nprg-PL|0\nps|0\nps-AF|0\nps-PK|0\npt|0\npt-AO|0\npt-BR|0\npt-CH|0\npt-CV|0\npt-GQ|0\npt-GW|0\npt-LU|0\npt-MO|0\npt-MZ|0\npt-PT|0\npt-ST|0\npt-TL|0\nrm|18\nrm-CH|18\nro|0\nro-MD|0\nro-RO|0\nrof|0\nrof-TZ|0\nru|0\nru-BY|0\nru-KG|0\nru-KZ|0\nru-MD|0\nru-RU|0\nru-UA|0\nrwk|0\nrwk-TZ|0\nsah|0\nsah-RU|0\nsaq|0\nsaq-KE|0\nsat|0\nsat-IN|0\nsat-Olck|0\nsat-Olck-IN|0\nsc|0\nsc-IT|0\nscn|0\nscn-IT|0\nsd|0\nsd-Arab|0\nsd-Arab-PK|0\nsd-Deva|0\nsd-Deva-IN|0\nsd-IN|0\nsd-PK|0\nse|0\nse-FI|0\nse-NO|0\nse-SE|0\nseh|0\nseh-MZ|0\nses|0\nses-ML|0\nsg|0\nsg-CF|0\nshi|0\nshi-Latn|0\nshi-Latn-MA|0\nshi-MA|0\nshi-Tfng|0\nshi-Tfng-MA|0\nsi|0\nsi-LK|0\nsk|0\nsk-SK|0\nsl|0\nsl-SI|0\nsmn|0\nsmn-FI|0\nsn|0\nsn-ZW|0\nso|0\nso-DJ|0\nso-ET|0\nso-KE|0\nso-SO|0\nsq|0\nsq-AL|0\nsq-MK|0\nsq-XK|0\nsr|0\nsr-BA|0\nsr-Cyrl|0\nsr-Cyrl-BA|0\nsr-Cyrl-ME|0\nsr-Cyrl-RS|0\nsr-Cyrl-XK|0\nsr-Latn|0\nsr-Latn-BA|0\nsr-Latn-ME|0\nsr-Latn-RS|0\nsr-Latn-XK|0\nsr-ME|0\nsr-RS|0\nsr-XK|0\nst|0\nst-LS|0\nst-ZA|0\nsu|0\nsu-ID|0\nsu-Latn|0\nsu-Latn-ID|0\nsv|0\nsv-AX|0\nsv-FI|0\nsv-SE|0\nsw|0\nsw-CD|0\nsw-KE|0\nsw-TZ|0\nsw-UG|0\nsyr|0\nsyr-IQ|0\nsyr-SY|0\nta|0\nta-IN|0\nta-LK|0\nta-MY|0\nta-SG|0\nte|0\nte-IN|0\nteo|0\nteo-KE|0\nteo-UG|0\ntg|0\ntg-TJ|0\nth|19\nth-TH|19\nti|0\nti-ER|0\nti-ET|0\ntk|0\ntk-TM|0\ntn|0\ntn-BW|0\ntn-ZA|0\nto|20\nto-TO|20\ntr|0\ntr-CY|0\ntr-TR|0\ntzm|0\ntzm-MA|0\nug|0\nug-CN|0\nuk|0\nuk-UA|0\nur|21\nur-IN|21\nur-PK|21\nuz|0\nuz-AF|0\nuz-Arab|0\nuz-Arab-AF|0\nuz-Cyrl|0\nuz-Cyrl-UZ|0\nuz-Latn|0\nuz-Latn-UZ|0\nuz-UZ|0\nvec|0\nvec-IT|0\nvi|0\nvi-VN|0\nvun|0\nvun-TZ|0\nwae|0\nwae-CH|0\nwo|0\nwo-SN|0\nxh|0\nxh-ZA|0\nxog|0\nxog-UG|0\nyi|0\nyi-UA|0\nyo|0\nyo-BJ|0\nyo-NG|0\nyue|12\nyue-CN|12\nyue-HK|12\nyue-Hans|12\nyue-Hans-CN|12\nyue-Hant|12\nyue-Hant-CN|12\nyue-Hant-HK|12\nyue-Hant-MO|12\nyue-MO|12\nzh|22\nzh-CN|22\nzh-HK|0\nzh-Hans|22\nzh-Hans-CN|22\nzh-Hans-HK|22\nzh-Hans-MO|22\nzh-Hans-MY|22\nzh-Hans-SG|22\nzh-Hant|22\nzh-Hant-HK|0\nzh-Hant-MO|0\nzh-Hant-MY|22\nzh-Hant-TW|22\nzh-MO|0\nzh-MY|22\nzh-SG|22\nzh-TW|22\nzu|0\nzu-ZA|0";
const referenceProfiles =
  "0|3,3;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12|3,3;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12\n1|3,3;4,3;5,5;6,6;7,6;8,8;9,9;10,9;11,9;12,12;13,12;14,12|3,3;4,3;5,5;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12\n2|3,3;4,3;5,5;6,5;7,7;8,7;9,7;10,10;11,11;12,12;13,12;14,12|3,3;4,3;5,5;6,5;7,7;8,7;9,7;10,7;11,7;12,12;13,12;14,12\n3|3,0;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12|3,0;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12\n4|3,3;4,3;5,3;6,6;7,6;8,6;9,6;10,9;11,9;12,12;13,12;14,12|3,3;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12\n5|3,0;4,0;5,0;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12|3,3;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12\n6|3,3;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12|3,3;4,4;5,5;6,6;7,7;8,8;9,8;10,10;11,11;12,12;13,13;14,14\n7|3,3;4,3;5,5;6,5;7,7;8,7;9,7;10,10;11,10;12,12;13,12;14,12|3,3;4,3;5,5;6,5;7,7;8,7;9,7;10,7;11,7;12,12;13,12;14,12\n8|3,0;4,0;5,0;6,6;7,6;8,6;9,6;10,6;11,6;12,12;13,12;14,12|3,0;4,0;5,0;6,6;7,6;8,6;9,6;10,6;11,6;12,12;13,12;14,12\n9|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,12;13,13;14,14|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,12;13,13;14,14\n10|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,13;14,13|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,11;14,11\n11|3,0;4,4;5,4;6,4;7,4;8,8;9,8;10,8;11,8;12,12;13,12;14,12;15,12;16,16;17,16;18,16;19,16|3,0;4,4;5,4;6,4;7,4;8,8;9,8;10,8;11,8;12,12;13,12;14,12;15,12;16,16;17,16;18,16;19,16\n12|3,3;4,4;5,4;6,4;7,4;8,8;9,8;10,8;11,8;12,12;13,12;14,12|3,3;4,4;5,4;6,4;7,4;8,8;9,8;10,8;11,8;12,12;13,12;14,12\n13|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,11;14,14|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,11;14,14\n14|3,3;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12|3,3;4,3;5,5;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12\n15|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,13;14,13|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,13;14,13\n16|3,3;4,4;5,5;6,6;7,7;8,7;9,7;10,10;11,11;12,12;13,13;14,14|3,3;4,4;5,5;6,6;7,7;8,7;9,7;10,7;11,11;12,12;13,13;14,14\n17|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,13;14,13|3,3;4,3;5,5;6,6;7,6;8,6;9,9;10,9;11,9;12,11;13,13;14,13\n18|3,0;4,0;5,0;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12|3,0;4,0;5,0;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12\n19|3,3;4,3;5,3;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12|3,3;4,4;5,5;6,6;7,6;8,6;9,9;10,10;11,11;12,12;13,12;14,12\n20|3,3;4,4;5,5;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12|3,3;4,4;5,5;6,6;7,6;8,6;9,9;10,9;11,9;12,12;13,12;14,12\n21|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,12;14,12|3,3;4,3;5,5;6,5;7,7;8,7;9,9;10,9;11,11;12,11;13,12;14,12\n22|3,0;4,4;5,4;6,4;7,4;8,8;9,8;10,8;11,8;12,12;13,12;14,12|3,0;4,4;5,4;6,4;7,4;8,8;9,8;10,8;11,8;12,12;13,12;14,12";
