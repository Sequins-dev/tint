import type { ISODateTime } from "@tint/foundation/chrono/iso-date-time";
import type { TemporalRounding } from "./temporal-rounding.ts";
import { roundInteger } from "@tint/foundation/numeric/integer-rounding";
import { toNumber } from "@tint/foundation/numeric/big-integer";
import {
  epochDayFromGregorian,
  gregorianFromEpochDay,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  clockNanoseconds,
  splitClockNanoseconds,
} from "./temporal-time-arithmetic.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
export function roundTemporalDateTime(
  data: ISODateTime,
  settings: TemporalRounding,
  realm: ErrorRealm,
): ISODateTime {
  const rounded = roundInteger(
    clockNanoseconds(data),
    settings.increment,
    settings.mode,
  );
  if (rounded === undefined) throw "DATE_TIME_ROUNDING_INVARIANT";
  const split = splitClockNanoseconds(rounded);
  const epoch = epochDayFromGregorian(
    data.date.year,
    data.date.month,
    data.date.day,
  );
  if (epoch === undefined) throw "DATE_TIME_ROUNDING_DATE_INVARIANT";
  const date = gregorianFromEpochDay(epoch + toNumber(split.days));
  if (date === undefined) throw createRuntimeError(realm, "range");
  return combineTemporalDateTime(
    date,
    split.time,
    realm,
    data.calendar ?? "iso8601",
  );
}
