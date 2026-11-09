import { parseLocaleId } from "./locale-id.ts";
/** Service availability is shared by Collator resolution and Locale metadata. */
const languages: readonly string[] = ["de", "en", "es", "fr", "it", "sv", "th"];
export function lookupCollatorLocale(tag: string): string | undefined {
  const locale = parseLocaleId(tag);
  if (locale === undefined) return undefined;
  const language = locale.language.language;
  return languages.includes(language) ? language : undefined;
}
export function collatorSupportsCollation(
  language: string,
  value: string | undefined,
): boolean {
  return value === "eor" || (language === "de" && value === "phonebk");
}
/** Fresh, sorted public types; the default null value and search stay private. */
export function collatorLocaleCollations(tag: string): string[] | undefined {
  const language = lookupCollatorLocale(tag);
  if (language === undefined) return undefined;
  return language === "de" ? ["eor", "phonebk"] : ["eor"];
}

/** AvailableCanonicalCollations: every public collation type some supported
 * locale accepts, sorted ("standard" and "search" are never listed). */
export function availableCollations(): string[] {
  return ["eor", "phonebk"];
}
