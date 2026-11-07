import type { GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
export interface CalendarISODate {
  readonly date: GregorianDate;
  readonly calendar: string;
}
export interface CalendarDateFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly era: string | undefined;
  readonly eraYear: number | undefined;
}
export interface CalendarMonthCode {
  readonly month: number;
  readonly leap: boolean;
}
export interface CalendarInputFields {
  readonly year?: number | undefined;
  readonly month?: number | undefined;
  readonly monthCode?: CalendarMonthCode | undefined;
  readonly day?: number | undefined;
  readonly era?: string | undefined;
  readonly eraYear?: number | undefined;
}
export interface CalendarDateConversion {
  readonly value: GregorianDate | undefined;
  readonly error: "none" | "type" | "range" | "unsupported";
}
export interface CalendarIntegerResolution {
  readonly value: number | undefined;
  readonly error: "none" | "type" | "range";
}
