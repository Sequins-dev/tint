import {
  epochDayFromGregorian,
  daysInGregorianMonth,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import { parseMonthCodeText, type MonthCode } from "./temporal-month-code.ts";
import { parseISODateTime } from "@tint/foundation/chrono/iso-date-time";
import {
  temporalTimeZoneLike,
  type TemporalTimeZone,
} from "./temporal-time-zone.ts";
import type { ISOTime } from "@tint/foundation/chrono/iso-date-time";
import { temporalInteger } from "./temporal-coercion.ts";
import { primitiveValue, stringValue } from "./coercion.ts";
import {
  getProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
export interface TemporalDateFields {
  readonly present: boolean;
  readonly era: string | undefined;
  readonly eraYear: number | undefined;
  readonly offsetNanoseconds: number | undefined;
  readonly timeZone: TemporalTimeZone | undefined;
  readonly year: number | undefined;
  readonly month: number | undefined;
  readonly day: number | undefined;
  readonly monthCode: MonthCode | undefined;
  /** Hour through nanosecond, in constructor order. */
  readonly time: readonly number[];
}
/** ISO month and monthCode form a pair: replacing either discards the old pair.
 * Coercion precedes this merge; calendar validity and overflow follow it. */
export function mergeISODateFields(
  date: GregorianDate,
  fields: TemporalDateFields,
): TemporalDateFields {
  return {
    present: fields.present,
    era: fields.era,
    eraYear: fields.eraYear,
    offsetNanoseconds: fields.offsetNanoseconds,
    timeZone: fields.timeZone,
    year: fields.year ?? date.year,
    month:
      fields.month === undefined && fields.monthCode === undefined
        ? date.month
        : fields.month,
    monthCode: fields.monthCode,
    day: fields.day ?? date.day,
    time: fields.time,
  };
}
/** Calendar-specific validity follows options; syntactic coercion happens at each field read. */
export function readTemporalDateFields(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  item: unknown,
  kind:
    | "date"
    | "date-time"
    | "zoned-date-time"
    | "zoned-partial"
    | "relative"
    | "year-month"
    | "month-day",
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  initialTime?: ISOTime,
  calendar: string = "iso8601",
): TemporalDateFields {
  // Gregorian and Japanese field preparation includes eras. Their calendar
  // conversion remains a separate capability checked by each caller.
  const eraFields = calendar === "gregory" || calendar === "japanese";
  if (calendar !== "iso8601" && !eraFields)
    return rejectUnsupportedExecution(realm);
  const names = [
    "day",
    "era",
    "eraYear",
    "hour",
    "microsecond",
    "millisecond",
    "minute",
    "month",
    "monthCode",
    "nanosecond",
    "offset",
    "second",
    "timeZone",
    "year",
  ];
  const indices = [2, -1, -1, 3, 7, 6, 4, 1, -1, 8, -1, 5, -1, 0];
  const zoned =
    kind === "zoned-date-time" ||
    kind === "zoned-partial" ||
    kind === "relative";
  const clock = kind === "date-time" || zoned;
  const subsecond = initialTime?.nanosecond ?? 0;
  const fields: number[] = [
    0,
    0,
    0,
    initialTime?.hour ?? 0,
    initialTime?.minute ?? 0,
    initialTime?.second ?? 0,
    Math.floor(subsecond / 1000000),
    Math.floor(subsecond / 1000) % 1000,
    subsecond % 1000,
  ];
  let offsetNanoseconds: number | undefined = undefined;
  let timeZone: TemporalTimeZone | undefined = undefined;
  let present = false;
  let yearPresent = false,
    monthPresent = false,
    dayPresent = false;
  let monthCode: MonthCode | undefined = undefined;
  let era: string | undefined = undefined;
  let eraYear: number | undefined = undefined;
  for (let i = 0; i < names.length; i++) {
    const name = names[i],
      index = indices[i];
    if (name === undefined || index === undefined)
      throw "TEMPORAL_DATE_FIELD_INVARIANT";
    if ((name === "era" || name === "eraYear") && !eraFields) continue;
    if (
      name === "timeZone" &&
      kind !== "zoned-date-time" &&
      kind !== "relative"
    )
      continue;
    if (name === "offset" && !zoned) continue;
    if (
      !clock &&
      name !== "day" &&
      name !== "era" &&
      name !== "eraYear" &&
      name !== "month" &&
      name !== "monthCode" &&
      name !== "year"
    )
      continue;
    if (kind === "year-month" && name === "day") continue;
    const value = getProperty<ScriptPropertyKey, unknown>(
      object,
      name,
      item,
      hooks,
    );
    if (value === undefined) {
      if (name === "timeZone" && kind === "zoned-date-time")
        throw createRuntimeError(realm, "type");
      continue;
    }
    present = true;
    if (name === "era") {
      const converted = stringValue(value, hooks, realm);
      if (converted.error === "unsupported")
        return rejectUnsupportedExecution(realm);
      if (converted.error !== "none") throw createRuntimeError(realm, "type");
      era = converted.value;
    } else if (name === "eraYear")
      eraYear = temporalInteger(value, realm, hooks);
    else if (name === "timeZone") timeZone = temporalTimeZoneLike(value, realm);
    else if (name === "offset") {
      const converted = primitiveValue(value, "string", hooks, realm);
      if (converted.error === "unsupported")
        return rejectUnsupportedExecution(realm);
      if (converted.error !== "none") throw createRuntimeError(realm, "type");
      const text = converted.value;
      if (typeof text !== "string") throw createRuntimeError(realm, "type");
      // The synthetic date delegates the full UTCOffset grammar to the shared parser.
      const parsed = parseISODateTime("1970-01-01T00:00" + text);
      const data = parsed.value;
      if (
        (text.charAt(0) !== "+" && text.charAt(0) !== "-") ||
        parsed.error !== "none" ||
        data === undefined ||
        data.offsetNanoseconds === undefined ||
        data.timeZone !== undefined ||
        data.calendar !== undefined
      )
        throw createRuntimeError(realm, "range");
      offsetNanoseconds = data.offsetNanoseconds;
    } else if (name === "monthCode") {
      const converted = primitiveValue(value, "string", hooks, realm);
      if (converted.error === "unsupported")
        return rejectUnsupportedExecution(realm);
      if (converted.error !== "none") throw createRuntimeError(realm, "type");
      const text = converted.value;
      if (typeof text !== "string") throw createRuntimeError(realm, "type");
      monthCode = parseMonthCodeText(text);
      if (monthCode === undefined) throw createRuntimeError(realm, "range");
    } else {
      const number = temporalInteger(value, realm, hooks);
      if ((name === "month" || name === "day") && number <= 0)
        throw createRuntimeError(realm, "range");
      fields[index] = number;
      if (name === "year") yearPresent = true;
      if (name === "month") monthPresent = true;
      if (name === "day") dayPresent = true;
    }
  }
  return {
    present,
    era,
    eraYear,
    offsetNanoseconds,
    timeZone,
    year: yearPresent ? fields[0] : undefined,
    month: monthPresent ? fields[1] : undefined,
    day: dayPresent ? fields[2] : undefined,
    monthCode,
    time: fields.slice(3),
  };
}
export function regulateISODateFields(
  fields: TemporalDateFields,
  policy: string,
  realm: ErrorRealm,
): GregorianDate {
  const year = fields.year,
    suppliedDay = fields.day;
  if (year === undefined || suppliedDay === undefined)
    throw createRuntimeError(realm, "type");
  let month = resolveISOFieldMonth(fields, realm),
    day = suppliedDay;
  if (policy === "constrain") {
    month = Math.min(month, 12);
    day = Math.min(day, daysInGregorianMonth(year, month));
  }
  const epoch = epochDayFromGregorian(year, month, day);
  if (epoch === undefined || epoch < -100000001 || epoch > 100000000)
    throw createRuntimeError(realm, "range");
  return { year, month, day };
}

/** Month-code syntax is already parsed; resolve calendar validity before overflow. */
export function resolveISOFieldMonth(
  fields: TemporalDateFields,
  realm: ErrorRealm,
): number {
  let month = fields.month;
  const code = fields.monthCode;
  if (code !== undefined) {
    if (
      code.leap ||
      code.month < 1 ||
      code.month > 12 ||
      (month !== undefined && month !== code.month)
    )
      throw createRuntimeError(realm, "range");
    month = code.month;
  }
  if (month === undefined) throw createRuntimeError(realm, "type");
  return month;
}
