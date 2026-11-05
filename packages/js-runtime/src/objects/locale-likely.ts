import { parseLocaleId, type LocaleLanguage } from "./locale-id.ts";
import {
  canonicalizeLocaleId,
  printLocaleLanguage,
  localeTableValue,
} from "./locale-canonicalization.ts";
import { localeLikelySubtags } from "./locale-data.ts";

function maximizeLanguage(source: LocaleLanguage): LocaleLanguage | undefined {
  const script = source.script === "zzzz" ? "" : source.script;
  const region = source.region === "zz" ? "" : source.region;
  if (source.language !== "und" && script !== "" && region !== "")
    return { language: source.language, script, region, variants: [] };
  const scriptPart = script === "" ? "" : "-" + script;
  const regionPart = region === "" ? "" : "-" + region;
  for (const key of [
    source.language + scriptPart + regionPart,
    source.language + scriptPart,
    source.language + regionPart,
    source.language,
  ]) {
    if (key === undefined) throw "LOCALE_LIKELY_DATA_INVARIANT";
    const found = localeTableValue(localeLikelySubtags, key);
    if (found === undefined) continue;
    const parsed = parseLocaleId(found);
    if (parsed === undefined) throw "LOCALE_LIKELY_DATA_INVARIANT";
    return {
      language:
        source.language === "und" ? parsed.language.language : source.language,
      script: script === "" ? parsed.language.script : script,
      region: region === "" ? parsed.language.region : region,
      variants: [],
    };
  }
  return undefined;
}

function core(
  language: string,
  script: string,
  region: string,
): LocaleLanguage {
  return { language, script, region, variants: [] };
}

function sameCore(a: LocaleLanguage, b: LocaleLanguage): boolean {
  return (
    a.language === b.language && a.script === b.script && a.region === b.region
  );
}

/** UTS35 Add/Remove Likely Subtags. No match preserves the canonical input,
 * including unknown languages; variants and extensions never become defaults. */
function likelyLocale(source: string, minimize: boolean): string | undefined {
  const canonical = canonicalizeLocaleId(source);
  if (canonical === undefined) return undefined;
  const parsed = parseLocaleId(canonical);
  if (parsed === undefined) throw "LOCALE_LIKELY_DATA_INVARIANT";
  const original = parsed.language,
    maximal = maximizeLanguage(original);
  if (maximal === undefined) return canonical;
  const suffix = canonical.slice(printLocaleLanguage(original, false).length);
  let result = maximal;
  if (minimize) {
    const trials = [
      core(maximal.language, "", ""),
      core(maximal.language, "", maximal.region),
      core(maximal.language, maximal.script, ""),
    ];
    for (const trial of trials) {
      if (trial === undefined) throw "LOCALE_LIKELY_DATA_INVARIANT";
      const expanded = maximizeLanguage(trial);
      if (expanded !== undefined && sameCore(expanded, maximal)) {
        result = trial;
        break;
      }
    }
  }
  return (
    printLocaleLanguage(
      {
        language: result.language,
        script: result.script,
        region: result.region,
        variants: original.variants,
      },
      false,
    ) + suffix
  );
}

export function maximizeLocaleId(source: string): string | undefined {
  return likelyLocale(source, false);
}

export function minimizeLocaleId(source: string): string | undefined {
  return likelyLocale(source, true);
}
