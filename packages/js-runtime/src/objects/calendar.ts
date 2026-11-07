import { canonicalLocaleType } from "./locale-canonicalization.ts";
import { localeCalendarTypes } from "./locale-data.ts";

/** Calendar identity is shared with Intl; arithmetic availability is independent. */
export function canonicalCalendarIdentifier(
  source: string,
): string | undefined {
  let folded = "";
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    folded += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  const identifier = canonicalLocaleType("u", "ca", folded);
  return localeCalendarTypes.split(",").includes(identifier)
    ? identifier
    : undefined;
}
