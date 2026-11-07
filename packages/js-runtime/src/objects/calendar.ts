import { canonicalLocaleType } from "./locale-canonicalization.ts";
import { localeCalendarTypes } from "./locale-data.ts";
import type { GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";

/** An ISO coordinate and its independent calendar identity. */
export interface CalendarISODate {
  readonly date: GregorianDate;
  readonly calendar: string;
}

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

export {
  calendarSupportsEra,
  calendarCanonicalEra,
  calendarYearForEra,
} from "./calendar-era.ts";
export {
  gregorianCalendarFields as calendarFieldsFromISO,
  gregorianCalendarDateFromFields as calendarDateFromFields,
  isGregorianCalendar,
} from "./calendar-gregorian.ts";
export type {
  GregorianCalendarInput as CalendarInputFields,
  GregorianCalendarDate as CalendarDateFields,
  GregorianCalendarConversion as CalendarDateConversion,
} from "./calendar-gregorian.ts";
