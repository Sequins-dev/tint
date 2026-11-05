import { localeTableValue } from "./locale-canonicalization.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleKey,
} from "./number-format-profile.ts";
import {
  currencySymbolFields,
  currencySymbolOwners,
  currencySymbolParents,
} from "./currency-symbol-data.ts";

function inheritedSymbol(
  locale: string,
  code: string,
  field: string,
): string | undefined {
  let current = locale;
  while (true) {
    const value = localeTableValue(
      currencySymbolFields,
      current + ":" + code + ":" + field,
    );
    if (value !== undefined) return value;
    if (current === "root") return undefined;
    const parent = localeTableValue(currencySymbolParents, current);
    current =
      parent === undefined
        ? current.includes("-")
          ? current.slice(0, current.lastIndexOf("-"))
          : "root"
        : parent;
  }
}
/** Resolve a localized currency label from the numeric service's locale owner.
 * The caller supplies a canonical locale and a validated uppercase ASCII code.
 * Each field inherits independently; a missing narrow label falls back to the
 * ordinary label, then the code. Unmatched service locales return the code.
 * This pure lookup performs no option coercion and never applies cash metadata. */
export function currencySymbol(
  locale: string,
  code: string,
  narrow: boolean,
): string {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return code;
  const owner = localeTableValue(
    currencySymbolOwners,
    numberFormatLocaleKey(matched),
  );
  if (owner === undefined) throw "CURRENCY_SYMBOL_OWNER_INVARIANT";
  if (narrow) {
    const value = inheritedSymbol(owner, code, "n");
    if (value !== undefined) return value;
  }
  const ordinary = inheritedSymbol(owner, code, "s");
  return ordinary === undefined ? code : ordinary;
}
