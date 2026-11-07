import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { viewObjectValue } from "./values.ts";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import {
  dateTimeFormatParts,
  dateTimeFormatRangeParts,
  dateTimeEpochInput,
  type DateTimeFormatter,
  type DateTimeInput,
} from "./date-time-format.ts";
import { dateTimePatternParts, type DateTimePart } from "./date-time-parts.ts";
import {
  dateTimeRangeParts,
  type DateTimeRangePart,
} from "./date-time-range.ts";
import type { ResolvedDateTimePattern } from "./date-time-skeleton.ts";
import { dateTimeTemporalPattern } from "./date-time-temporal-pattern.ts";
import { splitTemporalEpochSecond } from "./temporal-epoch.ts";
type Obj = OrdinaryObject<ScriptPropertyKey, unknown>;
export interface DateTimeFormatValue {
  readonly kind: number;
  readonly numeric: number;
  readonly object: Obj | undefined;
}
export function dateTimeTemporalKind(object: Obj): number {
  if (object.internalTemporalPlainDate !== undefined) return 0;
  if (object.internalTemporalPlainYearMonth !== undefined) return 1;
  if (object.internalTemporalPlainMonthDay !== undefined) return 2;
  if (object.internalTemporalPlainTime !== undefined) return 3;
  if (object.internalTemporalPlainDateTime !== undefined) return 4;
  if (object.internalTemporalInstant !== undefined) return 5;
  if (object.internalTemporalZonedDateTime !== undefined) return 6;
  return -1;
}
/** ToDateTimeFormattable reads brands, never Temporal public fields/valueOf.
 * Range callers convert both endpoints before checking type compatibility. */
export function toDateTimeFormatValue(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  useNow: boolean,
): DateTimeFormatValue {
  const object = viewObjectValue(value, realm.objectPrototype),
    kind = object === undefined ? -1 : dateTimeTemporalKind(object);
  if (kind >= 0) return { kind, numeric: 0, object };
  if (value === undefined && useNow) {
    const now = realm.wallClockMilliseconds;
    if (now === undefined) return rejectUnsupportedExecution(realm);
    return { kind: -1, numeric: now(), object: undefined };
  }
  const converted = numberValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  return { kind: -1, numeric: converted.value, object: undefined };
}
interface PreparedTemporalInput {
  readonly input: DateTimeInput;
  readonly pattern: ResolvedDateTimePattern;
}
function prepared(
  formatter: DateTimeFormatter,
  value: DateTimeFormatValue,
  realm: ErrorRealm,
): PreparedTemporalInput {
  if (value.kind === 6) throw createRuntimeError(realm, "type");
  const object = value.object;
  if (object === undefined) throw "DATE_TIME_TEMPORAL_VALUE_INVARIANT";
  if (value.kind !== 3 && value.kind !== 5) {
    const calendar = object.internalTemporalCalendar ?? "iso8601",
      desired = formatter.configuration.locale.calendar;
    if (
      calendar !== desired &&
      !(calendar === "iso8601" && (value.kind === 0 || value.kind === 4))
    )
      throw createRuntimeError(realm, "range");
  }
  const pattern = dateTimeTemporalPattern(formatter, value.kind);
  if (pattern === undefined) throw createRuntimeError(realm, "type");
  const instant = object.internalTemporalInstant;
  if (value.kind === 5) {
    if (instant === undefined) throw "DATE_TIME_INSTANT_INVARIANT";
    const split = splitTemporalEpochSecond(instant.integer);
    if (split === undefined) return rejectUnsupportedExecution(realm);
    const input = dateTimeEpochInput(
      formatter,
      pattern,
      split.seconds,
      split.fractionNanoseconds,
    );
    if (input === undefined) return rejectUnsupportedExecution(realm);
    return { input, pattern };
  }
  const time = object.internalTemporalPlainTime,
    dateTime = object.internalTemporalPlainDateTime;
  if (value.kind === 3) {
    if (time === undefined) throw "DATE_TIME_PLAIN_TIME_INVARIANT";
    return {
      pattern,
      input: {
        zoneName: undefined,
        fields: {
          date: { year: 1970, month: 1, day: 1 },
          hour: time.hour,
          minute: time.minute,
          second: time.second,
          millisecond: Math.floor(time.nanosecond / 1e6),
        },
      },
    };
  }
  if (value.kind === 4) {
    if (dateTime === undefined) throw "DATE_TIME_PLAIN_DATE_TIME_INVARIANT";
    return {
      pattern,
      input: {
        zoneName: undefined,
        fields: {
          date: dateTime.date,
          hour: dateTime.hour,
          minute: dateTime.minute,
          second: dateTime.second,
          millisecond: Math.floor(dateTime.nanosecond / 1e6),
        },
      },
    };
  }
  const date =
    value.kind === 0
      ? object.internalTemporalPlainDate
      : value.kind === 1
        ? object.internalTemporalPlainYearMonth
        : object.internalTemporalPlainMonthDay;
  if (date === undefined) throw "DATE_TIME_PLAIN_DATE_INVARIANT";
  return {
    pattern,
    input: {
      zoneName: undefined,
      fields: { date, hour: 12, minute: 0, second: 0, millisecond: 0 },
    },
  };
}
export function dateTimeValueParts(
  formatter: DateTimeFormatter,
  value: DateTimeFormatValue,
  realm: ErrorRealm,
): DateTimePart[] {
  if (value.kind < 0) {
    const parts = dateTimeFormatParts(formatter, value.numeric);
    if (parts === undefined) throw createRuntimeError(realm, "range");
    return parts;
  }
  const selected = prepared(formatter, value, realm),
    parts = dateTimePatternParts(
      formatter.parts,
      selected.pattern.tokens,
      selected.input.fields,
      selected.input.zoneName,
    );
  if (parts === undefined) return rejectUnsupportedExecution(realm);
  return parts;
}
export function dateTimeValueRangeParts(
  formatter: DateTimeFormatter,
  first: DateTimeFormatValue,
  last: DateTimeFormatValue,
  realm: ErrorRealm,
): DateTimeRangePart[] {
  if (first.kind !== last.kind) throw createRuntimeError(realm, "type");
  if (first.kind < 0) {
    const parts = dateTimeFormatRangeParts(
      formatter,
      first.numeric,
      last.numeric,
    );
    if (parts === undefined) throw createRuntimeError(realm, "range");
    return parts;
  }
  const start = prepared(formatter, first, realm),
    end = prepared(formatter, last, realm),
    parts = dateTimeRangeParts(
      formatter.parts,
      start.pattern,
      start.input.fields,
      end.input.fields,
      start.input.zoneName,
      end.input.zoneName,
    );
  if (parts === undefined) return rejectUnsupportedExecution(realm);
  return parts;
}
