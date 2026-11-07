import { localeTableValue } from "./locale-canonicalization.ts";
import { calendarEraData } from "./calendar-data.ts";

export function calendarSupportsEra(calendar: string): boolean {
  return localeTableValue(calendarEraData, calendar) !== undefined;
}
export function calendarCanonicalEra(
  calendar: string,
  era: string,
): string | undefined {
  const data = localeTableValue(calendarEraData, calendar);
  if (data === undefined) return undefined;
  for (const row of data.split(";")) {
    if (row === undefined) throw "CALENDAR_ERA_DATA_INVARIANT";
    const fields = row.split(","),
      name = fields[0],
      alias = fields[3];
    if (name === undefined) throw "CALENDAR_ERA_DATA_INVARIANT";
    if (era === name || era === alias) return name;
  }
  return undefined;
}
export function calendarYearForEra(
  calendar: string,
  era: string,
  eraYear: number,
): number | undefined {
  if (!Number.isSafeInteger(eraYear)) return undefined;
  const data = localeTableValue(calendarEraData, calendar);
  if (data === undefined) return undefined;
  for (const row of data.split(";")) {
    if (row === undefined) throw "CALENDAR_ERA_DATA_INVARIANT";
    const fields = row.split(","),
      name = fields[0],
      direction = fields[1],
      offset = fields[2],
      alias = fields[3];
    if (name === undefined || direction === undefined || offset === undefined)
      throw "CALENDAR_ERA_DATA_INVARIANT";
    if (era === name || era === alias) {
      const year = Number(direction) * eraYear + Number(offset);
      return Number.isSafeInteger(year) ? year : undefined;
    }
  }
  return undefined;
}
